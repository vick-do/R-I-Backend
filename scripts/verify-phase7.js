/**
 * Phase 7 verification — administration: roles, scopes, and the audit trail.
 *
 *   node scripts/verify-phase7.js
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
  process.env.PORT = '4996';
  process.env.MONGODB_URI = mongo.getUri('ri_admin_test');
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
  const Program = require('../src/models/Program.model');
  const User = require('../src/models/User.model');

  await seedPrograms();
  await seedMetrics();
  await seedDimensions();
  await seedAdmin();

  const signIn = async (email, password) => {
    const res = await request('POST', '/api/v1/auth/login', { body: { email, password } });
    return res.body?.data?.accessToken;
  };

  const adminToken = await signIn('admin@mest.local', 'VerifyPassword123!');
  const grow = await Program.findOne({ pageKey: 'digital-skills-grow' });
  const edtech = await Program.findOne({ pageKey: 'ecosystem-edtech-mondays' });

  // ------------------------------------------------------------------ roles
  section('Roles');

  const roles = User.ROLES;
  check('Four roles, approver between admin and editor',
    roles.join(',') === 'admin,approver,editor,viewer', roles.join(','));

  const madeApprover = await request('POST', '/api/v1/auth/users', {
    token: adminToken,
    body: {
      firstName: 'Victoria', lastName: 'Asare', email: 'victoria@mest.local',
      password: 'ApproverPass123!', role: 'approver',
    },
  });
  check('An approver can be created', madeApprover.status === 201, `got ${madeApprover.status}`);

  const badRole = await request('POST', '/api/v1/auth/users', {
    token: adminToken,
    body: {
      firstName: 'X', lastName: 'Y', email: 'x@mest.local',
      password: 'Password123!', role: 'superuser',
    },
  });
  check('An unknown role is refused', badRole.status === 422, `got ${badRole.status}`);

  // ----------------------------------------------------------------- scopes
  section('Scopes');

  const scoped = await request('POST', '/api/v1/auth/users', {
    token: adminToken,
    body: {
      firstName: 'Ama', lastName: 'Owusu', email: 'ama@mest.local',
      password: 'EditorPass123!', role: 'editor',
      scopes: { programs: [String(grow._id)], metrics: ['learners_total'] },
    },
  });
  check('A scoped editor can be created', scoped.status === 201, `got ${scoped.status}`);
  check('Their scope comes back on the record',
    scoped.body.data.user.scopes.programs.length === 1 &&
    scoped.body.data.user.scopes.metrics[0] === 'learners_total',
    JSON.stringify(scoped.body.data.user.scopes));

  const amaToken = await signIn('ama@mest.local', 'EditorPass123!');

  const inScope = await request('POST', '/api/v1/facts', {
    token: amaToken,
    body: { program: 'digital-skills-grow', metric: 'learners_total', periodType: 'all_time', value: 793 },
  });
  check('They may write inside their scope', inScope.status === 201, `got ${inScope.status}`);

  const wrongProgramme = await request('POST', '/api/v1/facts', {
    token: amaToken,
    body: { program: 'ecosystem-edtech-mondays', metric: 'impressions', periodType: 'all_time', value: 5 },
  });
  check('Another programme is refused', wrongProgramme.status === 403, `got ${wrongProgramme.status}`);
  check('…and the refusal names the programme',
    /EdTech Mondays/.test(wrongProgramme.body?.error?.message ?? ''),
    wrongProgramme.body?.error?.message);

  const wrongMetric = await request('POST', '/api/v1/facts', {
    token: amaToken,
    body: { program: 'digital-skills-grow', metric: 'graduates', periodType: 'all_time', value: 10 },
  });
  check('A metric outside their scope is refused', wrongMetric.status === 403, `got ${wrongMetric.status}`);

  // An editor with no scopes set keeps working exactly as before.
  await request('POST', '/api/v1/auth/users', {
    token: adminToken,
    body: {
      firstName: 'Kwame', lastName: 'Boateng', email: 'kwame@mest.local',
      password: 'EditorPass123!', role: 'editor',
    },
  });
  const kwameToken = await signIn('kwame@mest.local', 'EditorPass123!');
  const unscoped = await request('POST', '/api/v1/facts', {
    token: kwameToken,
    body: { program: 'ecosystem-edtech-mondays', metric: 'impressions', periodType: 'all_time', value: 42 },
  });
  check('An editor with no scopes is unrestricted', unscoped.status === 201, `got ${unscoped.status}`);

  const victoriaToken = await signIn('victoria@mest.local', 'ApproverPass123!');
  const approverWrite = await request('POST', '/api/v1/facts', {
    token: victoriaToken,
    body: { program: 'digital-skills-grow', metric: 'graduates', periodType: 'all_time', value: 604 },
  });
  check('An approver writes anywhere', approverWrite.status === 201, `got ${approverWrite.status}`);

  // --------------------------------------------------------- self-lockout
  section('An admin cannot lock themselves out');

  const me = await request('GET', '/api/v1/auth/me', { token: adminToken });
  const selfDemote = await request('PUT', `/api/v1/auth/users/${me.body.data.user.id}`, {
    token: adminToken,
    body: { role: 'viewer' },
  });
  check('Demoting yourself is refused', selfDemote.status === 422, `got ${selfDemote.status}`);

  const selfDisable = await request('PUT', `/api/v1/auth/users/${me.body.data.user.id}`, {
    token: adminToken,
    body: { isActive: false },
  });
  check('Disabling yourself is refused', selfDisable.status === 422, `got ${selfDisable.status}`);

  const demoteOther = await request('PUT', `/api/v1/auth/users/${scoped.body.data.user.id}`, {
    token: adminToken,
    body: { role: 'viewer' },
  });
  check('Demoting someone else still works', demoteOther.status === 200, `got ${demoteOther.status}`);

  const nowViewer = await signIn('ama@mest.local', 'EditorPass123!');
  const viewerWrite = await request('POST', '/api/v1/facts', {
    token: nowViewer,
    body: { program: 'digital-skills-grow', metric: 'learners_total', periodType: 'all_time', value: 1 },
  });
  check('A viewer cannot write at all', viewerWrite.status === 403, `got ${viewerWrite.status}`);

  // ------------------------------------------------------------ audit trail
  section('Audit trail');

  const audit = await request('GET', '/api/v1/audit', { token: adminToken });
  check('The log reads back', audit.status === 200, `got ${audit.status}`);

  const entries = audit.body.data.entries;
  check('It recorded the user creations',
    entries.filter((e) => e.action === 'user.create').length === 3,
    String(entries.filter((e) => e.action === 'user.create').length));
  check('It recorded the fact writes', entries.some((e) => e.action === 'fact.create'));
  check('Each entry names its actor', entries.every((e) => e.actor === null || Boolean(e.actor?.email)));
  check('Newest first',
    entries.length < 2 ||
    new Date(entries[0].createdAt) >= new Date(entries[entries.length - 1].createdAt));

  const filtered = await request('GET', '/api/v1/audit?action=user.create', { token: adminToken });
  check('Filtering by action works',
    filtered.body.data.entries.every((e) => e.action === 'user.create'),
    JSON.stringify(filtered.body.data.entries.map((e) => e.action)));

  const editorReadsAudit = await request('GET', '/api/v1/audit', { token: kwameToken });
  check('An editor cannot read the audit log', editorReadsAudit.status === 403,
    `got ${editorReadsAudit.status}`);

  const anonAudit = await request('GET', '/api/v1/audit');
  check('Nor can an anonymous caller', anonAudit.status === 401, `got ${anonAudit.status}`);

  const editorListsUsers = await request('GET', '/api/v1/auth/users', { token: kwameToken });
  check('An editor cannot list users', editorListsUsers.status === 403, `got ${editorListsUsers.status}`);

  // ---------------------------------------------------------------- invites
  section('Invitations');

  const invited = await request('POST', '/api/v1/auth/users', {
    token: adminToken,
    body: {
      firstName: 'Nana', lastName: 'Mensah', email: 'nana@mest.local', role: 'editor',
    },
  });
  check('A user can be created with no password', invited.status === 201, `got ${invited.status}`);
  check('An invite link comes back', /\/invite\/[a-f0-9]{64}$/.test(invited.body.data.invite?.url ?? ''),
    invited.body.data.invite?.url);
  check('They read as invited, not active', invited.body.data.user.status === 'invited',
    invited.body.data.user.status);

  const token = invited.body.data.invite.url.split('/invite/')[1];

  const cannotSignIn = await request('POST', '/api/v1/auth/login', {
    body: { email: 'nana@mest.local', password: 'anything-at-all' },
  });
  check('They cannot sign in before accepting', cannotSignIn.status === 401, `got ${cannotSignIn.status}`);

  const lookup = await request('GET', `/api/v1/auth/invite/${token}`);
  check('The link says who it is for', lookup.status === 200 && lookup.body.data.email === 'nana@mest.local',
    JSON.stringify(lookup.body.data));
  check('It does not leak a password hash', !JSON.stringify(lookup.body).includes('password'));

  const badToken = await request('GET', '/api/v1/auth/invite/not-a-real-token');
  check('An unknown link is refused', badToken.status === 404, `got ${badToken.status}`);

  const tooShort = await request('POST', `/api/v1/auth/invite/${token}`, { body: { password: 'short' } });
  check('A weak password is refused', tooShort.status === 422, `got ${tooShort.status}`);

  const accepted = await request('POST', `/api/v1/auth/invite/${token}`, {
    body: { password: 'TheirOwnPassword123!' },
  });
  check('Accepting works and signs them straight in',
    accepted.status === 200 && Boolean(accepted.body.data.accessToken), `got ${accepted.status}`);
  check('They now read as active', accepted.body.data.user.status === 'active',
    accepted.body.data.user.status);
  check('Their role survived the invite', accepted.body.data.user.role === 'editor',
    accepted.body.data.user.role);

  const reused = await request('POST', `/api/v1/auth/invite/${token}`, {
    body: { password: 'SomeoneElsePassword123!' },
  });
  check('The link cannot be used twice', reused.status === 404, `got ${reused.status}`);

  const nowSignsIn = await request('POST', '/api/v1/auth/login', {
    body: { email: 'nana@mest.local', password: 'TheirOwnPassword123!' },
  });
  check('They can sign in with the password they chose', nowSignsIn.status === 200, `got ${nowSignsIn.status}`);

  const resendToAccepted = await request('POST', `/api/v1/auth/users/${invited.body.data.user.id}/invite`, {
    token: adminToken,
  });
  check('Re-inviting a set-up account is refused', resendToAccepted.status === 422,
    `got ${resendToAccepted.status}`);

  // A second outstanding invite retires the first.
  const pending = await request('POST', '/api/v1/auth/users', {
    token: adminToken,
    body: { firstName: 'Yaw', lastName: 'Darko', email: 'yaw@mest.local', role: 'viewer' },
  });
  const firstToken = pending.body.data.invite.url.split('/invite/')[1];
  const reissued = await request('POST', `/api/v1/auth/users/${pending.body.data.user.id}/invite`, {
    token: adminToken,
  });
  check('An invite can be re-issued', reissued.status === 200, `got ${reissued.status}`);
  check('…and the old link stops working',
    (await request('GET', `/api/v1/auth/invite/${firstToken}`)).status === 404);
  check('…while the new one works',
    (await request('GET', `/api/v1/auth/invite/${reissued.body.data.invite.url.split('/invite/')[1]}`)).status === 200);

  const editorInvites = await request('POST', '/api/v1/auth/users', {
    token: kwameToken,
    body: { firstName: 'A', lastName: 'B', email: 'ab@mest.local', role: 'admin' },
  });
  check('An editor cannot invite anyone', editorInvites.status === 403, `got ${editorInvites.status}`);

  // ------------------------------------------------------- revoke & delete
  section('Revoking and deleting');

  const target = await request('POST', '/api/v1/auth/users', {
    token: adminToken,
    body: {
      firstName: 'Efua', lastName: 'Sam', email: 'efua@mest.local',
      password: 'EditorPass123!', role: 'editor',
    },
  });
  const efuaId = target.body.data.user.id;
  const efuaToken = await signIn('efua@mest.local', 'EditorPass123!');
  check('They can sign in before revocation', Boolean(efuaToken));

  const efuaRefresh = (await request('POST', '/api/v1/auth/login', {
    body: { email: 'efua@mest.local', password: 'EditorPass123!' },
  })).body.data.refreshToken;

  const revoked = await request('POST', `/api/v1/auth/users/${efuaId}/revoke`, { token: adminToken });
  check('Access can be revoked', revoked.status === 200, `got ${revoked.status}`);
  check('They read as disabled', revoked.body.data.user.status === 'disabled',
    revoked.body.data.user.status);

  const afterRevoke = await request('POST', '/api/v1/auth/login', {
    body: { email: 'efua@mest.local', password: 'EditorPass123!' },
  });
  check('They can no longer sign in', afterRevoke.status === 403, `got ${afterRevoke.status}`);

  const staleRefresh = await request('POST', '/api/v1/auth/refresh', { body: { refreshToken: efuaRefresh } });
  check('Their live session is ended too', staleRefresh.status === 401, `got ${staleRefresh.status}`);

  // Revoking a pending invite kills the link.
  const pendingUser = await request('POST', '/api/v1/auth/users', {
    token: adminToken,
    body: { firstName: 'Kojo', lastName: 'Antwi', email: 'kojo@mest.local', role: 'viewer' },
  });
  const kojoToken = pendingUser.body.data.invite.url.split('/invite/')[1];
  await request('POST', `/api/v1/auth/users/${pendingUser.body.data.user.id}/revoke`, { token: adminToken });
  check('Revoking cancels a pending invitation',
    (await request('GET', `/api/v1/auth/invite/${kojoToken}`)).status === 404);

  // Restoring is the update endpoint, not a special case.
  const restored = await request('PUT', `/api/v1/auth/users/${efuaId}`, {
    token: adminToken, body: { isActive: true },
  });
  check('Access can be restored', restored.status === 200 && restored.body.data.user.status === 'active',
    restored.body.data.user.status);

  // Deletion.
  const footprintBefore = await request('GET', '/api/v1/auth/users', { token: adminToken });
  const efuaRow = footprintBefore.body.data.users.find((u) => u.id === efuaId);
  check('The list reports what each user authored', typeof efuaRow.footprint?.facts === 'number',
    JSON.stringify(efuaRow.footprint));

  const deleted = await request('DELETE', `/api/v1/auth/users/${efuaId}`, { token: adminToken });
  check('A user can be deleted', deleted.status === 200, `got ${deleted.status}`);

  const gone = await request('GET', '/api/v1/auth/users', { token: adminToken });
  check('They are gone from the list', !gone.body.data.users.some((u) => u.id === efuaId));

  const deletionEntry = (await request('GET', '/api/v1/audit', { token: adminToken })).body.data.entries
    .find((e) => (e.summary ?? '').startsWith('Deleted'));
  check('The audit log keeps their name and email',
    /efua@mest.local/.test(deletionEntry?.summary ?? '') && /Efua Sam/.test(deletionEntry?.summary ?? ''),
    deletionEntry?.summary);

  const selfDelete = await request('DELETE', `/api/v1/auth/users/${me.body.data.user.id}`, { token: adminToken });
  check('You cannot delete yourself', selfDelete.status === 422, `got ${selfDelete.status}`);

  const selfRevoke = await request('POST', `/api/v1/auth/users/${me.body.data.user.id}/revoke`, { token: adminToken });
  check('Nor revoke yourself', selfRevoke.status === 422, `got ${selfRevoke.status}`);

  // The last active admin is protected even from another admin.
  const secondAdmin = await request('POST', '/api/v1/auth/users', {
    token: adminToken,
    body: {
      firstName: 'Second', lastName: 'Admin', email: 'second@mest.local',
      password: 'AdminPass123!', role: 'admin',
    },
  });
  const secondToken = await signIn('second@mest.local', 'AdminPass123!');
  const deleteOtherAdmin = await request('DELETE', `/api/v1/auth/users/${me.body.data.user.id}`, {
    token: secondToken,
  });
  check('One admin may delete another while a third remains', deleteOtherAdmin.status === 200,
    `got ${deleteOtherAdmin.status}`);

  const lastAdmin = await request('DELETE', `/api/v1/auth/users/${secondAdmin.body.data.user.id}`, {
    token: secondToken,
  });
  check('But the last admin cannot be removed', lastAdmin.status === 422, `got ${lastAdmin.status}`);

  const editorDeletes = await request('DELETE', `/api/v1/auth/users/${secondAdmin.body.data.user.id}`, {
    token: kwameToken,
  });
  check('An editor cannot delete anyone', editorDeletes.status === 403, `got ${editorDeletes.status}`);

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
