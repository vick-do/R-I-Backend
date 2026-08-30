# ri-api

Backend for the MEST Africa **Research & Impact** platform — the system of record for impact
data across all programmes, and the source of every number the dashboard displays.

Stack mirrors `mest-api` (Express + Mongoose + JWT + winston + express-validator) so it is
familiar to the same team and deploys the same way. It is a **separate** service: `mest-api` is
operational (individual trainees inside one cohort), this is aggregate impact reporting across
many programmes over years.

## Getting started

```bash
npm install
cp .env.example .env      # then edit the secrets
npm run seed              # programmes, metric catalog, dimensions, first admin
npm run dev               # http://localhost:4000
npm run verify            # 99 checks against an in-memory MongoDB
```

`npm run seed` is idempotent and never deletes facts, so it is safe to re-run after a catalog
change.

## The core idea

Every sheet in both source workbooks — learner counts, enterprise splits, social media metrics —
reduces to one shape:

```
program × metric × period × dimensions = value
```

| Source                 | program        | metric           | period   | dimensions             | value  |
| ---------------------- | -------------- | ---------------- | -------- | ---------------------- | ------ |
| Grow, "Accra 402"      | Grow           | `learners_total` | all-time | `{hub: accra}`         | 402    |
| Pre Mest, "Female 403" | Pre Mest       | `learners_total` | all-time | `{gender: female}`     | 403    |
| EdTech, April Facebook | EdTech Mondays | `impressions`    | 2026-04  | `{platform: facebook}` | 761993 |

One model serves every programme, so adding a programme or metric is data entry, not code.

## Three invariants

**1. Facts are append-only.** A correction writes a new version and marks the previous one
superseded. Nothing is destroyed, and `GET /api/v1/facts/history` returns every revision with its
author and timestamp.

**2. Totals are derived, never typed.** Only leaf facts are stored. Totals stated in a spreadsheet
become reconciliation checks on the import batch, not facts. This is what prevents the old
dashboard's situation of claiming 14,800 people trained against ~1,592 of real data.

**3. Aggregation never mixes dimension signatures.** A fact's _signature_ is the sorted list of
dimensions it is broken down by. Grow holds both a programme total (signature `[]` = 793) and a hub
breakdown (signature `["hub"]` = 402 + 236 + 155). Summing across signatures would report 1,586.
Every aggregation therefore pins one exact signature — see `src/utils/dimensions.js` and
`src/services/facts.service.js`.

When no direct total exists, `resolveTotal` sums the finest available breakdown and returns
`basis: "derived_from_breakdown"`, so the UI can show _how_ a number was arrived at instead of
presenting a derived figure as a recorded one.

## Reading spreadsheets

Both workbooks were exported from Google Sheets, which wraps **every cell** as
`IFERROR(__xludf.DUMMYFUNCTION("COMPUTED_VALUE"), 793)`. The real figure is in `cell.result`, not
`cell.value`. `src/utils/workbook.js` is the only place cells are read, and it handles that plus
`-` placeholders, `#REF!` errors, rich text, and thousands separators.

## API

| Method       | Path                        | Role   | Purpose                                             |
| ------------ | --------------------------- | ------ | --------------------------------------------------- |
| POST         | `/api/v1/auth/login`        | —      | Sign in; returns access + refresh tokens            |
| POST         | `/api/v1/auth/refresh`      | —      | Rotate a session                                    |
| GET          | `/api/v1/auth/me`           | any    | Current user                                        |
| GET/POST/PUT | `/api/v1/auth/users`        | admin  | User management                                     |
| GET          | `/api/v1/programs`          | any    | Programme tree (`?flat=true` for a list)            |
| GET          | `/api/v1/programs/:pageKey` | any    | One programme plus its metrics, for form generation |
| GET          | `/api/v1/metrics`           | any    | Metric catalog                                      |
| POST/PUT     | `/api/v1/metrics`           | editor | Extend the catalog without a deploy                 |
| GET          | `/api/v1/dimensions`        | any    | Dimension catalog with labels and aliases           |
| GET          | `/api/v1/facts/aggregate`   | any    | Grouped values; `groupBy` pins the signature        |
| GET          | `/api/v1/facts/total`       | any    | One headline number plus its `basis`                |
| GET          | `/api/v1/facts/org-totals`  | any    | Overview figures, all derived                       |
| GET          | `/api/v1/facts/summary`     | any    | A whole programme page in one request               |
| GET          | `/api/v1/facts/history`     | any    | Every revision behind one number                    |
| POST         | `/api/v1/facts`             | editor | Manual entry (append-only)                          |

Roles: `admin` (everything, incl. user management and batch rollback), `editor` (enter data, run
imports, edit the catalog), `viewer` (read only).

## Notes

- **MongoDB version for `npm run verify`:** MongoDB 8 aborts with SIGABRT on macOS 12, so the
  verify script pins `MONGOMS_VERSION=6.0.14`. Override the env var on other machines if needed.
- **`xlsx` is deliberately not used.** The npm build of SheetJS has unpatched prototype-pollution
  and ReDoS advisories with no fix available, which is unacceptable for a service whose main job is
  parsing uploaded files. `exceljs` is used instead, with a `uuid` override to clear its one
  transitive advisory. `npm audit` reports 0 vulnerabilities.

## Breakdown values that grow

Dimensions are **open** or **closed**:

|        | Axes                                                   | Behaviour                                             |
| ------ | ------------------------------------------------------ | ----------------------------------------------------- |
| Open   | hub, cohort, track, region, sector                     | An unseen value is added to the catalog automatically |
| Closed | gender, enterprise_stage, platform, channel, post_type | An unseen value is rejected, listing what is valid    |

Cohorts keep being added, so capping the list at whatever was seeded would mean a developer had to
extend it every intake. Entering "7" in the form — or importing a sheet containing it — creates
`Cohort 7` and says so in the response, so a typo cannot quietly become a permanent cohort.

`Dimension.labelTemplate` (e.g. `"Cohort {value}"`) both formats new labels and **parses input**, so
`"Cohort 8"`, `"8"` and `"cohort 8"` all resolve to one entry. Without the parsing step the first
two produced separate catalog values and split one cohort's figures across two breakdowns.

Manual entry and the importer share `Dimension.resolveOrCreate`, so a value typed into the form and
the same value read out of a spreadsheet can never diverge.

## The importer

`POST /api/v1/imports` → `:id/plan` (dry run) → `:id/commit` → `:id/rollback`. Nothing is written
until commit, and commit re-plans against current data so the result reflects the database as it is
now, not as it was at preview time.

**Three block layouts**, because both workbooks stack many small unrelated tables per sheet:

| Layout                            | Shape                               | Example                               |
| --------------------------------- | ----------------------------------- | ------------------------------------- |
| `long`                            | one observation per row             | Grow's `Hub / Total Learners` columns |
| `crosstab` + `headerRole: period` | metrics down, periods across        | the 2026 Consolidated sheet           |
| `crosstab` + `headerRole: none`   | metric names down, one value column | the monthly per-channel totals        |

**Blocks are located by anchor, not by cell address.** The EdTech monthly sheets move their blocks
between months — February puts `MEST TOTAL` at W6, March–November at V6, and the Citi FM block
drifts between rows 20 and 22. A fixed mapping would quietly read the wrong cells every month, so
`crosstab.anchor` finds the label and derives the block from it. All 20 monthly blocks resolve.

**Guards worth knowing about:**

- A stated total in the sheet is never imported as a fact — it becomes a reconciliation check.
- Two cells claiming the same coordinate with different values are reported as a conflict rather
  than last-write-wins.
- A row missing its dimension label is skipped, so a stray subtotal cannot become an unlabelled
  fact competing with the programme total.
- Commit refuses when reconciliation fails unless `acknowledgeMismatch: true` is sent.

## Backfill

```bash
npm run backfill:dry    # report only, writes nothing
npm run backfill        # 17 Data Summary blocks + 20 EdTech monthly blocks
```

Each block is its own reversible batch, so one bad mapping can be undone without touching the rest.

### Data-quality issues the reconciliation surfaced

These are **real inconsistencies in the source workbooks**, not import errors. They are reported
rather than silently resolved, because picking a number is the R&I team's call:

- **Pre Mest learner count has four different values.** Stated total 761; gender rows sum to 759;
  the sheet's own gender subtotal says 758; track rows and the graduated split both sum to 757.
- **MEST Scale sector breakdown covers 101 of 112 enterprises** — 11 have no sector recorded. The
  sheet's own subtotal agrees at 101, so the gap is missing data rather than an arithmetic error.

## Status

Phases 1–4 complete, verified by `npm run verify` (**99 checks**: 51 + 48).

The headline check: EdTech Mondays figures are imported **only** from the monthly sheets, and all
nine metrics then reconcile exactly against the untouched 2026 Consolidated sheet
(38 posts / 2,800,672 impressions / 1,978,763 reach / 7,920 engagement / 230,786 video views).

Phase 3 complete: the dashboard is rebuilt against this API (see `../R&I`) with real routing,
validated charts, period filters, and generated programme pages.

`GET /api/v1/facts/summary` serves a whole programme page in one request. It computes every metric,
breakdown, and monthly trend in **two aggregation pipelines** rather than one round trip per
metric — that change took a roll-up node from 7.4s to 1.1s.
