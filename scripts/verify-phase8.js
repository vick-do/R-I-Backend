/**
 * Phase 8 verification — maker-checker approvals.
 *
 *   node scripts/verify-phase8.js
 */

process.env.MONGOMS_VERSION = process.env.MONGOMS_VERSION ?? '6.0.14';

const { MongoMemoryServer } = require('mongodb-memory-server');

let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  } else {
    failed += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

async function main() {
  const mongo = await MongoMemoryServer.create();

  process.env.NODE_ENV = 'test';
  process.env.PORT = '4995';
  process.env.MONGODB_URI = mongo.getUri('ri_approvals_test');
  process.env.JWT_ACCESS_SECRET = 'test-access-secret-value-for-verification';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-value-for-verification';
  process.env.JWT_ACCESS_EXPIRES_IN = '15m';
  process.env.JWT_REFRESH_EXPIRES_IN = '7d';
  process.env.BCRYPT_SALT_ROUNDS = '4';
  process.env.CORS_ORIGIN = 'http://localhost:5173';
  process.env.SEED_ADMIN_EMAIL = 'admin@mest.local';
  process.env.SEED_ADMIN_PASSWORD = 'VerifyPassword123!';

  const mongoose = require('mongoose');
  await mongoose.connect(process.env.MONGODB_URI);

  const app = require('../src/app');
  const request = await makeClient(app);

  const { seedPrograms, seedMetrics, seedDimensions, seedAdmin } = require('../src/seeds/seed');
  const Fact = require('../src/models/Fact.model');
  const FactSubmission = require('../src/models/FactSubmission.model');

  await seedPrograms();
  await seedMetrics();
  await seedDimensions();
  await seedAdmin();

  const signIn = async (email, password) =>
    (await request('POST', '/api/v1/auth/login', { body: { email, password } })).body?.data?.accessToken;

  const adminToken = await signIn('admin@mest.local', 'VerifyPassword123!');

  const make = async (role, email) => {
    await request('POST', '/api/v1/auth/users', {
      token: adminToken,
      body: { firstName: role, lastName: 'User', email, password: 'Password12345!', role },
    });
    return signIn(email, 'Password12345!');
  };

  const editorToken = await make('editor', 'editor@mest.local');
  const approverToken = await make('approver', 'approver@mest.local');
  const viewerToken = await make('viewer', 'viewer@mest.local');

  const record = (token, body) => request('POST', '/api/v1/facts', { token, body });
  const grow = { program: 'digital-skills-grow', metric: 'learners_total', periodType: 'all_time' };

  // -------------------------------------------------------- the two paths
  section('Recording splits by role');

  const byApprover = await record(approverToken, { ...grow, value: 793 });
  check('An approver publishes directly', byApprover.body.data.outcome === 'created',
    byApprover.body.data.outcome);
  check('…and the figure is live at once', (await Fact.countDocuments({ isCurrent: true })) === 1);

  const byEditor = await record(editorToken, {
    ...grow, dimensions: { hub: 'accra' }, value: 402, note: 'Cohort 6 registry',
  });
  check('An editor proposes instead', byEditor.body.data.outcome === 'submitted',
    byEditor.body.data.outcome);
  check('…and says so plainly', /Submitted for approval/.test(byEditor.body.message ?? ''),
    byEditor.body.message);
  check('…and nothing was written', (await Fact.countDocuments({ isCurrent: true })) === 1,
    String(await Fact.countDocuments({ isCurrent: true })));

  const byViewer = await record(viewerToken, { ...grow, value: 1 });
  check('A viewer cannot even propose', byViewer.status === 403, `got ${byViewer.status}`);

  // ----------------------------------------------------------------- queue
  section('The queue');

  const reviewerQueue = await request('GET', '/api/v1/submissions', { token: approverToken });
  check('A reviewer sees the proposal', reviewerQueue.body.data.submissions.length === 1,
    String(reviewerQueue.body.data.submissions.length));
  check('…and is told they may review', reviewerQueue.body.data.canReview === true);

  const item = reviewerQueue.body.data.submissions[0];
  check('It names the submitter', item.submittedBy?.email === 'editor@mest.local', item.submittedBy?.email);
  check('It carries the note', item.note === 'Cohort 6 registry', item.note);
  check('It reads as a first value, since nothing exists at that coordinate',
    item.isFirstValue === true && item.currentValue === null, JSON.stringify(item.currentValue));

  const editorQueue = await request('GET', '/api/v1/submissions', { token: editorToken });
  check('An editor sees their own', editorQueue.body.data.submissions.length === 1);
  check('…but is not offered review', editorQueue.body.data.canReview === false);

  const editorApproves = await request('POST', `/api/v1/submissions/${item.id}/approve`, { token: editorToken });
  check('An editor cannot approve', editorApproves.status === 403, `got ${editorApproves.status}`);

  // --------------------------------------------------------------- approve
  section('Approving');

  const approved = await request('POST', `/api/v1/submissions/${item.id}/approve`, { token: approverToken });
  check('A reviewer can approve', approved.status === 200, `got ${approved.status}`);
  check('The figure is now live', (await Fact.countDocuments({ isCurrent: true })) === 2);

  const written = await Fact.findOne({ dimensionKey: 'hub=accra', isCurrent: true }).populate('enteredBy');
  check('The value is what was proposed', written.value === 402, String(written.value));
  check('Its author is the submitter, not the approver',
    written.enteredBy?.email === 'editor@mest.local', written.enteredBy?.email);
  check('The submitter’s note travelled with it', written.note === 'Cohort 6 registry', written.note);

  const auditEntries = (await request('GET', '/api/v1/audit', { token: adminToken })).body.data.entries;
  const approval = auditEntries.find((e) => (e.summary ?? '').startsWith('Approved'));
  check('The audit records who approved whose figure',
    /Approved editor User's Learners trained/.test(approval?.summary ?? ''), approval?.summary);
  check('…attributed to the approver', approval?.actor?.email === 'approver@mest.local',
    approval?.actor?.email);

  const twice = await request('POST', `/api/v1/submissions/${item.id}/approve`, { token: approverToken });
  check('It cannot be approved twice', twice.status === 422, `got ${twice.status}`);

  // ---------------------------------------------------------------- return
  section('Returning');

  const second = await record(editorToken, { ...grow, dimensions: { hub: 'accra' }, value: 9999 });
  const queued = (await request('GET', '/api/v1/submissions', { token: approverToken })).body.data.submissions[0];

  check('A revision shows what it would replace', queued.currentValue === 402, String(queued.currentValue));
  check('…and by how much', queued.change === 9597, String(queued.change));
  check('…and is not a first value', queued.isFirstValue === false);

  const noReason = await request('POST', `/api/v1/submissions/${queued.id}/return`, { token: approverToken });
  check('Returning requires a reason', noReason.status === 422, `got ${noReason.status}`);

  const returned = await request('POST', `/api/v1/submissions/${queued.id}/return`, {
    token: approverToken,
    body: { note: 'That looks like a typo — 402 is the registry figure.' },
  });
  check('It can be returned with one', returned.status === 200, `got ${returned.status}`);
  check('The live figure is untouched',
    (await Fact.findOne({ dimensionKey: 'hub=accra', isCurrent: true })).value === 402);

  const afterReturn = await request('GET', '/api/v1/submissions?status=returned', { token: editorToken });
  check('The submitter sees it came back', afterReturn.body.data.submissions.length === 1);
  check('…with the reviewer’s reason',
    /typo/.test(afterReturn.body.data.submissions[0].reviewNote ?? ''),
    afterReturn.body.data.submissions[0].reviewNote);

  const returnAgain = await request('POST', `/api/v1/submissions/${queued.id}/return`, {
    token: approverToken, body: { note: 'again' },
  });
  check('A returned proposal cannot be returned again', returnAgain.status === 422, `got ${returnAgain.status}`);

  // ---------------------------------------------------------------- counts
  section('Counts');

  const counts = (await request('GET', '/api/v1/submissions', { token: approverToken })).body.data.counts;
  check('Nothing is pending now', counts.pending === 0, String(counts.pending));
  check('Held import batches are counted too', typeof counts.heldBatches === 'number',
    String(counts.heldBatches));

  const third = await record(editorToken, { ...grow, dimensions: { hub: 'plugin' }, value: 40 });
  const after = (await request('GET', '/api/v1/submissions', { token: approverToken })).body.data.counts;
  check('A new proposal raises the count', after.pending === 1, String(after.pending));

  const submissionCount = await FactSubmission.countDocuments();
  check('Every proposal is kept, whatever its outcome', submissionCount === 3, String(submissionCount));

  console.log(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m`);

  await mongoose.disconnect();
  await mongo.stop();
  process.exit(failed === 0 ? 0 : 1);
}

async function makeClient(app) {
  const http = require('http');
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  return async function request(method, path, { token, body } = {}) {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let parsed = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }
    return { status: res.status, body: parsed };
  };
}

main().catch((err) => {
  console.error('\x1b[31mVerification crashed:\x1b[0m', err);
  process.exit(1);
});
