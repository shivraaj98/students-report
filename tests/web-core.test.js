'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../web/core');
const E = require('../src/report-engine');
function workspace() {
  return {
    version: 1,
    settings: { school_name: 'Example School', class_name: '6 A', teacher_name: 'Example Teacher', report_period: 'Week 1', teacher_phone: '19999990100' },
    students: [{ student_id: 'STU001', student_name: 'Student One', parent_name: 'Parent One', parent_phone: '19999990101', homework_completed: '4', homework_assigned: '5', exam_results: 'Mathematics: 38/50', teacher_concerns: '', parent_action: '' }],
    contacts: Object.create(null), events: [],
  };
}
function consent(state) {
  const student = state.students[0];
  state.contacts[student.student_id] = { phone: student.parent_phone, student_name: student.student_name, parent_name: student.parent_name, verified: true, opt_in: true, evidence: 'Fictional parent reply verified by teacher', recorded_at: '2026-10-18T00:00:00.000Z' };
}
test('CSV parsing preserves Unicode, quoted commas, escaped quotes and embedded newlines', () => {
  assert.deepEqual(C.parseCsv('\uFEFFname,notes\r\n"सरिता","Math, reading\r\nSaid ""hello"""\r\n'), [['name', 'notes'], ['सरिता', 'Math, reading\nSaid "hello"']]);
});
test('CSV parsing rejects unclosed quotes, bare quotes and content after a closing quote', () => {
  for (const input of ['a,b\n"unfinished', 'a,b\nhello"world,x', 'a,b\n"hello"x,y']) assert.throws(() => C.parseCsv(input), /quoted field/);
});
test('CSV import validates records without granting parent permission', () => {
  const state = workspace(), csv = E.CSV_COLUMNS.join(',') + '\n' + E.CSV_COLUMNS.map((key) => state.students[0][key]).join(',');
  state.students = C.studentsFromCsv(csv, state.settings);
  assert.equal(state.students.length, 1);
  assert.throws(() => C.reviewFor(state, 'STU001'), /record their permission/);
});
test('a parent phone number alone cannot authorize a report', () => {
  assert.throws(() => C.reviewFor(workspace(), 'STU001'), /record their permission/);
});
test('both verified student-parent mapping and documented opt-in are required', () => {
  for (const [key, value] of [['verified', false], ['opt_in', false], ['evidence', ''], ['recorded_at', '']]) {
    const state = workspace(); consent(state); state.contacts.STU001[key] = value;
    assert.throws(() => C.reviewFor(state, 'STU001'), /record their permission/);
  }
});
test('teacher must explicitly approve each individual WhatsApp handoff', () => {
  const state = workspace(); consent(state); const reviewed = C.reviewFor(state, 'STU001');
  for (const value of [false, undefined, 'true', 1]) assert.throws(() => C.authorizeReview(state, reviewed, value), /Approve this individual message/);
  const approved = C.authorizeReview(state, reviewed, true, new Date('2026-10-18T01:00:00Z'));
  const url = new URL(approved.url);
  assert.equal(url.origin, 'https://wa.me');
  assert.equal(url.pathname, '/19999990101');
  assert.equal(url.searchParams.get('text'), reviewed.message);
  assert.equal(approved.event.status, 'opened_unverified');
  assert.equal(state.events.length, 0, 'core does not claim sending or trigger network calls');
});
test('a reviewed approval is single-use and each retry requires a new review', () => {
  const state = workspace(); consent(state); const reviewed = C.reviewFor(state, 'STU001');
  C.authorizeReview(state, reviewed, true);
  assert.throws(() => C.authorizeReview(state, reviewed, true), /already been used/);
  assert.doesNotThrow(() => C.authorizeReview(state, C.reviewFor(state, 'STU001'), true));
});
test('changing homework, class, period or teacher invalidates the exact message approval', () => {
  for (const change of [s => { s.students[0].homework_completed = '3'; }, s => { s.settings.class_name = '6 B'; }, s => { s.settings.report_period = 'Week 2'; }, s => { s.settings.teacher_name = 'Another teacher'; }]) {
    const state = workspace(); consent(state); const reviewed = C.reviewFor(state, 'STU001'); change(state);
    assert.throws(() => C.authorizeReview(state, reviewed, true), /changed/);
  }
});
test('changing parent phone, parent name or student identity invalidates parent permission', () => {
  for (const [key, value] of [['parent_phone', '19999990102'], ['parent_name', 'Another parent'], ['student_name', 'Another student']]) {
    const state = workspace(); consent(state); const reviewed = C.reviewFor(state, 'STU001'); state.students[0][key] = value;
    assert.throws(() => C.authorizeReview(state, reviewed, true), /record their permission/);
  }
});
test('withdrawing permission stops an already-reviewed report', () => {
  const state = workspace(); consent(state); const reviewed = C.reviewFor(state, 'STU001'); delete state.contacts.STU001;
  assert.throws(() => C.authorizeReview(state, reviewed, true), /record their permission/);
});
test('group registration link contains only class and teacher details in its fragment', () => {
  const state = workspace(), url = new URL(C.invitation(state.settings, 'https://example.test/?old=1#old'));
  assert.equal(url.search, ''); assert.ok(url.hash.startsWith('#join='));
  const invite = C.parseInvitation(url.hash);
  assert.equal(invite.teacher_phone, state.settings.teacher_phone);
  assert.ok(!url.href.includes('STU001'));
  assert.ok(!url.href.includes('19999990101'));
});
test('registration requires parent permission and preserves the exact student-parent association', () => {
  const state = workspace(), invite = C.parseInvitation(new URL(C.invitation(state.settings, 'https://example.test')).hash);
  assert.throws(() => C.registrationText(invite, state.students[0], false), /permission is required/);
  const input = C.registrationText(invite, state.students[0], true), registration = C.parseRegistration(input, state.settings);
  assert.deepEqual(registration, { student_id: 'STU001', student_name: 'Student One', parent_name: 'Parent One', parent_phone: '19999990101' });
  assert.equal(state.contacts.STU001, undefined, 'parsing a parent claim never grants permission');
});
test('registration from another class or without the required consent statement is rejected', () => {
  const state = workspace(), input = C.registrationText(state.settings, state.students[0], true);
  assert.throws(() => C.parseRegistration(input, { ...state.settings, class_name: 'Another class' }), /different school or class/);
  assert.throws(() => C.parseRegistration(input.replace(C.CONSENT, 'No consent'), state.settings), /expected parent permission/);
});
test('restoring backups clears all contact permissions and handoff approvals', () => {
  const state = workspace(); consent(state); state.events.push({ status: 'opened_unverified' });
  const restored = C.restoreBackup(JSON.stringify(state));
  assert.equal(restored.students.length, 1); assert.deepEqual(Object.keys(restored.contacts), []); assert.deepEqual(restored.events, []);
  assert.throws(() => C.reviewFor(restored, 'STU001'), /record their permission/);
});
test('restored backups and imported CSVs must satisfy the original 45-student validation', () => {
  const state = workspace(); state.students = Array.from({ length: 46 }, (_, i) => ({ ...state.students[0], student_id: `STU${i}` }));
  assert.throws(() => C.restoreBackup(JSON.stringify(state)), /class limit is 45/);
});
test('invitations, phone numbers and oversized imports are validated', () => {
  assert.throws(() => C.parseInvitation('#join=not-json'));
  assert.throws(() => C.phone('javascript:alert(1)'));
  assert.throws(() => C.parseCsv('x'.repeat(1024 * 1024 + 1)), /smaller than 1 MB/);
  assert.throws(() => C.invitation({ ...workspace().settings, teacher_phone: '' }, 'https://example.test'), /teacher WhatsApp number/);
});
