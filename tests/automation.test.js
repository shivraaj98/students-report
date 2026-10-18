'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const E = require('../automation/engine');
const { Store, encrypt, decrypt } = require('../automation/store');
const { AutomationService } = require('../automation/service');
const { extractDocument } = require('../automation/vision');
const { createApplication } = require('../automation/server');
const masterKey = 'a'.repeat(64), setupToken = 'b'.repeat(64), internalToken = 'c'.repeat(64);
const today = E.localDate();
function record(overrides = {}) {
  return E.normaliseRecord({ kind: 'homework', scope: 'student', student_id: 'STU001', student_name: 'Student One', parent_phone: null, guardian_name: null, date: today, subject: 'Mathematics', description: 'Four of five exercises completed.', evidence_quote: 'STU001 Student One 4/5 completed', needs_review: false, homework_assigned: 5, homework_completed: 4, score: null, max_score: null, ...overrides }, today);
}
function fixture(t) {
  const root = path.resolve(__dirname, '../.runtime'); fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, 'automation-test-'));
  t.after(() => { assert.ok(directory.startsWith(root + path.sep)); fs.rmSync(directory, { recursive: true, force: true }); });
  const store = new Store(directory), sends = [], events = [];
  store.update((data) => {
    Object.assign(data.settings, { class_name: 'Test class', teacher_name: 'Example Teacher', group_id: '12345@g.us', teacher_ids: ['19999990100@c.us'] });
    data.participants = [{ id: '19999990101@c.us', phone: '19999990101', name: 'Parent One' }];
    data.students.push({ id: 'STU001', name: 'Student One', guardian_name: 'Parent One', parent_phone: '19999990101', parent_chat_id: '19999990101@c.us', verified: true, opt_in: true, consent_evidence: 'Fictional permission for tests only', consent_at: '2026-10-18T00:00:00Z' });
    data.observations.push({ ...record(), id: crypto.randomUUID(), source_id: 'fixture', review_state: 'accepted' });
  });
  const connector = { status: 'ready', error: '', self: { id: '19999990100@c.us', name: 'Teacher' }, async sendPrivate(to, message, check) { check(); sends.push({ to, message }); return 'fictional-message-' + sends.length; } };
  const service = new AutomationService({ store, masterKey, connector, notify: async (event, payload) => events.push({ event, payload }), vision: async () => ({ records: [record()], warnings: [], school_name: '', class_name: '', teacher_name: '' }) });
  store.update((data) => E.generateDrafts(data, today));
  return { store, service, connector, sends, events, directory, draft: () => store.data.drafts.find((draft) => draft.status === 'pending') };
}
function reviewAndApprove(f, actor = 'teacher') {
  const draft = f.draft(), reviewed = f.service.reviewDraft(draft.id, draft.message, actor);
  return f.service.approveDraft(draft.id, { permission: true, token: reviewed.token }, actor).then(() => draft.id);
}
test('automatic matching never guesses a student when ID and name disagree or names repeat', () => {
  const students = [{ id: 'STU001', name: 'Student One' }, { id: 'STU002', name: 'Student One' }];
  assert.equal(E.matchStudent(students, { student_id: '', student_name: 'Student One' }), null);
  assert.equal(E.matchStudent(students, { student_id: 'STU001', student_name: 'Student Two' }), null);
  assert.equal(E.matchStudent(students, { student_id: 'wrong', student_name: 'Student One' }), null);
  assert.equal(E.matchStudent(students, { student_id: 'STU001', student_name: 'student one' }).id, 'STU001');
});
test('impossible marks, homework counts and class-wide individual outcomes are rejected', () => {
  for (const overrides of [{ score: 51, max_score: 50 }, { homework_completed: 6 }, { homework_completed: 1.5 }, { scope: 'class' }]) assert.throws(() => record(overrides));
});
test('an assignment announcement never implies homework completion', (t) => {
  const f = fixture(t), entry = { ...record({ scope: 'class', student_id: null, student_name: null, homework_assigned: null, homework_completed: null, description: 'Read chapter 3.' }), student_id: 'STU001', id: 'assignment', review_state: 'accepted' };
  const result = E.buildMessage(f.store.data.students[0], [entry], f.store.data.settings, today);
  assert.match(result.message, /Read chapter 3/); assert.doesNotMatch(result.message, /assignments completed|Pending in these/);
});
test('rosters alone do not manufacture a student performance report', (t) => {
  const f = fixture(t), row = { ...record({ kind: 'roster' }), student_id: 'STU001', review_state: 'accepted' };
  assert.equal(E.buildMessage(f.store.data.students[0], [row], f.store.data.settings, today), null);
});
test('respectful reports use only accepted records and do not repeat shaming labels', (t) => {
  const f = fixture(t), rows = [
    { ...record({ kind: 'concern', description: 'lazy and stupid', homework_assigned: null, homework_completed: null }), id: 'concern', student_id: 'STU001', review_state: 'accepted' },
    { ...record({ kind: 'exam', score: 1, max_score: 100 }), id: 'unconfirmed', student_id: 'STU001', review_state: 'pending' },
  ];
  const result = E.buildMessage(f.store.data.students[0], rows, f.store.data.settings, today);
  assert.match(result.message, /^Respected Parent One,/); assert.doesNotMatch(result.message, /lazy|stupid|1\/100/); assert.match(result.message, /contact the teacher privately/);
});
test('comparison uses two recorded assessments of the same subject and kind and preserves source IDs', (t) => {
  const f = fixture(t), old = new Date(today + 'T00:00:00Z'); old.setUTCDate(old.getUTCDate() - 10);
  const rows = [
    { ...record({ kind: 'test', date: old.toISOString().slice(0, 10), score: 20, max_score: 50 }), id: 'previous-test', review_state: 'accepted' },
    { ...record({ kind: 'test', score: 30, max_score: 50 }), id: 'current-test', review_state: 'accepted' },
  ];
  const result = E.buildMessage(f.store.data.students[0], rows, f.store.data.settings, today);
  assert.match(result.message, /\+20.0 percentage points/); assert.match(result.message, /difficulty may differ/); assert.ok(result.record_ids.includes('previous-test'));
});
test('vision API uses structured output, disables storage, and validates returned facts', async () => {
  let sent;
  const result = await extractDocument({ apiKey: 'fictional-test-key', model: 'test-model', source: { mime: 'text/plain', kind: 'auto', document_date: today }, bytes: Buffer.from('fictional record'), fetchImpl: async (url, input) => { sent = { url, input: JSON.parse(input.body) }; return { ok: true, json: async () => ({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ school_name: null, class_name: null, teacher_name: null, warnings: [], records: [record()] }) }] }] }) }; } });
  assert.equal(sent.url, 'https://api.openai.com/v1/responses'); assert.equal(sent.input.store, false); assert.equal(sent.input.text.format.strict, true); assert.equal(result.records.length, 1); assert.equal(sent.input.tools, undefined);
});
test('incomplete or refused vision responses cannot become student records', async () => {
  for (const response of [{ status: 'incomplete', output: [] }, { status: 'completed', output: [{ content: [{ type: 'refusal' }] }] }]) await assert.rejects(extractDocument({ apiKey: 'fictional', model: 'test', source: { mime: 'text/plain', document_date: today }, bytes: Buffer.from('test'), fetchImpl: async () => ({ ok: true, json: async () => response }) }));
});
test('vision keys are encrypted and authenticated at rest', () => {
  const encrypted = encrypt('fictional-secret', masterKey); assert.ok(!JSON.stringify(encrypted).includes('fictional-secret')); assert.equal(decrypt(encrypted, masterKey), 'fictional-secret');
  assert.throws(() => decrypt({ ...encrypted, tag: '00'.repeat(16) }, masterKey));
});
test('duplicate uploads and repeated WhatsApp event IDs create one queued document', async (t) => {
  const f = fixture(t), document = { bytes: Buffer.from('fictional homework log'), mime: 'text/plain', filename: 'test.txt', teacher_id: 'teacher', document_date: today };
  const first = await f.service.enqueue(document), second = await f.service.enqueue(document);
  assert.equal(first.id, second.id); assert.equal(second.duplicate, true); assert.equal(f.store.data.sources.length, 1); assert.equal(f.events.length, 1);
});
test('missing cloud authorization queues documents without an external model request', async (t) => {
  const f = fixture(t), source = await f.service.enqueue({ bytes: Buffer.from('test'), mime: 'text/plain', filename: 'test.txt', teacher_id: 'teacher', document_date: today });
  assert.equal((await f.service.processSource(source.id)).status, 'waiting_credentials'); assert.equal(f.store.data.sources[0].attempts, 0); assert.equal(f.sends.length, 0);
});
test('a roster photo creates an unverified student and never grants parent consent', async (t) => {
  const f = fixture(t); f.service.saveVision('fictional-key', 'test-model', true, 'admin');
  f.service.vision = async () => ({ records: [record({ kind: 'roster', student_id: 'STU002', student_name: 'Student Two', parent_phone: '19999990102', guardian_name: 'Parent Two', homework_assigned: null, homework_completed: null })], warnings: [], school_name: '', class_name: '', teacher_name: '' });
  const source = await f.service.enqueue({ bytes: Buffer.from('new roster'), mime: 'text/plain', filename: 'roster.txt', teacher_id: 'teacher', document_date: today });
  await f.service.processSource(source.id);
  const student = f.store.data.students.find((entry) => entry.id === 'STU002'); assert.equal(student.parent_phone, '19999990102'); assert.equal(student.verified, false); assert.equal(student.opt_in, false);
});
test('the scheduler prepares drafts but cannot approve or send a pending report', async (t) => {
  const f = fixture(t); await f.service.tick(); assert.equal(f.draft().status, 'pending'); assert.equal(f.sends.length, 0); assert.ok(f.store.data.last_tick);
});
test('dispatch refuses any draft that has not received individual approval', async (t) => {
  const f = fixture(t); assert.equal((await f.service.dispatch(f.draft().id)).status, 'pending'); assert.equal(f.sends.length, 0);
});
test('false permission, wrong user, or an invalid review token cannot approve delivery', async (t) => {
  const f = fixture(t), draft = f.draft(), review = f.service.reviewDraft(draft.id, draft.message, 'teacher');
  await assert.rejects(f.service.approveDraft(draft.id, { permission: false, token: review.token }, 'teacher'));
  await assert.rejects(f.service.approveDraft(draft.id, { permission: true, token: review.token }, 'other-teacher'));
  await assert.rejects(f.service.approveDraft(draft.id, { permission: true, token: 'wrong-token' }, 'teacher'));
  assert.equal(f.sends.length, 0);
});
test('review cannot authorize a group recipient or an unconsented parent', (t) => {
  const f = fixture(t), draft = f.draft();
  f.store.update((data) => { data.students[0].opt_in = false; }); assert.throws(() => f.service.reviewDraft(draft.id, draft.message, 'teacher'), /consent/);
  f.store.update((data) => { data.students[0].opt_in = true; data.students[0].parent_chat_id = '123@g.us'; data.drafts[0].parent_chat_id = '123@g.us'; });
  assert.throws(() => f.service.reviewDraft(draft.id, draft.message, 'teacher'), /individual WhatsApp contact/);
});
test('one approval delivers only the exact reviewed text to the private parent and cannot be reused', async (t) => {
  const f = fixture(t), draft = f.draft(), text = draft.message + '\nThank you, respected parent.';
  const reviewed = f.service.reviewDraft(draft.id, text, 'teacher');
  await f.service.approveDraft(draft.id, { permission: true, token: reviewed.token }, 'teacher');
  await assert.rejects(f.service.approveDraft(draft.id, { permission: true, token: reviewed.token }, 'teacher'));
  assert.equal((await f.service.dispatch(draft.id)).status, 'submitted'); assert.equal(f.sends.length, 1); assert.equal(f.sends[0].message, text); assert.equal(f.sends[0].to, '19999990101@c.us');
  await f.service.dispatch(draft.id); assert.equal(f.sends.length, 1);
});
test('simultaneous n8n webhook and scheduler dispatch cannot send a report twice', async (t) => {
  const f = fixture(t), id = await reviewAndApprove(f); await Promise.all([f.service.dispatch(id), f.service.dispatch(id), f.service.tick()]); assert.equal(f.sends.length, 1);
});
test('new source facts invalidate an already approved message', async (t) => {
  const f = fixture(t), id = await reviewAndApprove(f);
  f.store.update((data) => { data.observations[0].homework_completed = 3; });
  assert.equal((await f.service.dispatch(id)).status, 'blocked'); assert.equal(f.sends.length, 0);
});

test('excluding the last accepted fact retires its report and never sends an old approval', async (t) => {
  const f = fixture(t), id = await reviewAndApprove(f);
  f.service.reviewRecord(f.store.data.observations[0].id, { reject: true }, 'teacher');
  assert.equal(f.store.data.drafts.find((draft) => draft.id === id).status, 'superseded');
  await f.service.dispatch(id); assert.equal(f.sends.length, 0); assert.equal(f.draft(), undefined);
});
test('a parent STOP blocks a previously reviewed report', async (t) => {
  const f = fixture(t), id = await reviewAndApprove(f); f.service.withdraw({ id: '19999990101@c.us', phone: '19999990101' });
  await f.service.dispatch(id); assert.equal(f.sends.length, 0); assert.equal(f.store.data.students[0].opt_in, false);
});
test('consent is checked again immediately before the connector sends', async (t) => {
  const f = fixture(t), id = await reviewAndApprove(f);
  f.connector.sendPrivate = async (to, message, check) => { f.service.withdraw({ id: to }); check(); f.sends.push({ to, message }); return 'fictional'; };
  await f.service.dispatch(id); assert.equal(f.sends.length, 0);
});
test('expired approvals never send and disconnected sessions do not consume a valid approval', async (t) => {
  const f = fixture(t), id = await reviewAndApprove(f); f.connector.status = 'disconnected';
  assert.equal((await f.service.dispatch(id)).status, 'awaiting_whatsapp'); assert.equal(f.store.data.drafts[0].status, 'approved');
  f.store.update((data) => { data.drafts[0].approval_expires = Date.now() - 1; }); f.connector.status = 'ready';
  assert.equal((await f.service.dispatch(id)).status, 'expired'); assert.equal(f.sends.length, 0);
});
test('uncertain delivery is never retried automatically and a restart preserves that boundary', async (t) => {
  const f = fixture(t), id = await reviewAndApprove(f); let attempts = 0;
  f.connector.sendPrivate = async () => { attempts++; throw new Error('simulated network loss'); };
  assert.equal((await f.service.dispatch(id)).status, 'unknown'); await f.service.tick(); assert.equal(attempts, 1);
  f.store.update((data) => { data.drafts[0].status = 'sending'; }); const restarted = new Store(f.directory); assert.equal(restarted.data.drafts[0].status, 'unknown');
});
test('submission is not called delivered or read without WhatsApp acknowledgements', async (t) => {
  const f = fixture(t), id = await reviewAndApprove(f); await f.service.dispatch(id);
  f.service.ack('fictional-message-1', 1); assert.equal(f.store.data.drafts[0].status, 'submitted');
  f.service.ack('fictional-message-1', 2); assert.equal(f.store.data.drafts[0].status, 'delivered');
  f.service.ack('fictional-message-1', 3); assert.equal(f.store.data.drafts[0].status, 'read');
});
test('a forged image MIME type is rejected before storage or cloud processing', async (t) => {
  const f = fixture(t); await assert.rejects(f.service.enqueue({ bytes: Buffer.from('<html>not a photo</html>'), mime: 'image/png', filename: 'fake.png', teacher_id: 'teacher' }), /does not match/);
});
test('HTTP endpoints require login, internal secret and same-origin writes', async (t) => {
  const publicOrigin = 'https://fictional-class.trycloudflare.com';
  const f = fixture(t), application = createApplication({ store: f.store, directory: f.directory, internalToken, setupToken, masterKey, connector: f.connector, publicOrigin, notify: async () => {} });
  await new Promise((resolve) => application.server.listen(0, '127.0.0.1', resolve)); t.after(() => application.close());
  const base = `http://127.0.0.1:${application.server.address().port}`;
  assert.equal((await fetch(base + '/api/state')).status, 401);
  assert.equal((await fetch(base + '/internal/tick', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  const bootstrap = await fetch(base + '/api/bootstrap', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: publicOrigin }, body: JSON.stringify({ token: setupToken, name: 'Teacher', password: 'fictional-test-password' }) });
  assert.equal(bootstrap.status, 200); const cookie = bootstrap.headers.get('set-cookie').split(';')[0]; assert.match(bootstrap.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.match(bootstrap.headers.get('set-cookie'), /; Secure/);
  const state = await fetch(base + '/api/state', { headers: { Cookie: cookie } }); assert.equal(state.status, 200); const data = await state.json(); assert.equal(data.users, undefined); assert.equal(data.settings.vision_key, undefined);
  assert.equal((await fetch(base + '/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'https://untrusted.test' }, body: '{}' })).status, 403);
  assert.equal((await fetch(base + '/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: publicOrigin }, body: '{}' })).status, 200);
});
test('n8n exports contain a token gate and schedules never issue an approval', () => {
  const directory = path.join(__dirname, '../automation/workflows');
  for (const filename of fs.readdirSync(directory)) {
    const workflow = JSON.parse(fs.readFileSync(path.join(directory, filename)));
    assert.equal(workflow.active, false);
    for (const node of workflow.nodes) if (node.type === 'n8n-nodes-base.httpRequest') { assert.match(node.parameters.url, /^http:\/\/automation:8787\/internal\//); assert.doesNotMatch(node.parameters.url, /approve|review/); }
    if (workflow.id !== 'cbSchedule20261018') assert.ok(workflow.nodes.some((node) => node.name === 'Verify internal event token'));
  }
});
