'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildReports, CSV_COLUMNS } = require('../src/report-engine');

const settings = {
  school_name: 'Example School', class_name: '6 A',
  teacher_name: 'Ms Example', report_period: 'Week 3',
};
function record(overrides = {}) {
  return {
    student_id: 'STU001', student_name: 'Student One', parent_name: 'Parent One',
    // Test data only. No browser is opened and no network request is made.
    parent_phone: '+1 (999) 999-0101', homework_completed: '4', homework_assigned: '5',
    exam_results: 'Math: 38/50; English: 42/50', teacher_concerns: 'One assignment is pending.',
    parent_action: 'Please help complete the pending assignment.', ...overrides,
  };
}
function table(records, headers = CSV_COLUMNS) {
  return [headers, ...records.map((student) => headers.map((key) => student[key] ?? ''))];
}
function build(records = [record()], config = settings) {
  return buildReports(table(records), config);
}

test('prepares a named report with accurate homework, exam results, and parent support', () => {
  const output = build();
  assert.equal(output.student_count, 1);
  assert.equal(output.ready_count, 1);
  const report = output.reports[0];
  assert.match(report.message, /Dear Parent One,/);
  assert.match(report.message, /\*Student:\* Student One/);
  assert.match(report.message, /Completed 4\/5 assignments\. Pending: 1\./);
  assert.match(report.message, /Math: 38\/50\nEnglish: 42\/50/);
  assert.match(report.message, /One assignment is pending\./);
  assert.match(report.message, /Please help complete the pending assignment\./);
  assert.match(report.message, /Ms Example/);
  const url = new URL(report.whatsapp_url);
  assert.equal(url.origin, 'https://wa.me');
  assert.equal(url.pathname, '/19999990101');
  assert.equal(url.searchParams.get('text'), report.message);
  assert.equal(report.status, 'ready_for_review');
  assert.match(output.html, /Opening a link does not send the message or confirm delivery/);
});

test('keeps each student and parent mapped correctly for all 45 students', () => {
  const records = Array.from({ length: 45 }, (_, index) => record({
    student_id: `ID${index}`, student_name: `Student_${index}_Only`,
    parent_name: `Parent_${index}_Only`, parent_phone: `1999999${String(index).padStart(4, '0')}`,
    teacher_concerns: `Concern_${index}_Only`,
  }));
  const output = build(records);
  assert.equal(output.student_count, 45);
  assert.equal(output.ready_count, 45);
  output.reports.forEach((report, index) => {
    assert.equal(report.student_id, records[index].student_id);
    assert.equal(report.parent_phone, records[index].parent_phone);
    assert.match(report.message, new RegExp(`Student_${index}_Only`));
    assert.match(report.message, new RegExp(`Concern_${index}_Only`));
    assert.doesNotMatch(report.message, new RegExp(`Student_${(index + 1) % 45}_Only`));
    assert.equal(new URL(report.whatsapp_url).searchParams.get('text'), report.message);
  });
});

test('rejects a class exceeding 45 instead of silently truncating it', () => {
  const records = Array.from({ length: 46 }, (_, i) => record({ student_id: `ID${i}` }));
  assert.throws(() => build(records), /Found 46 students; the class limit is 45/);
});

test('rejects duplicate IDs, including differences only in case', () => {
  assert.throws(() => build([record(), record({ student_id: 'stu001' })]), /Duplicate student_id/);
});

test('allows the same student name or a shared parent number for siblings', () => {
  const output = build([record(), record({ student_id: 'STU002' })]);
  assert.equal(output.student_count, 2);
  assert.match(output.html, /parent number is shared by multiple students/);
});

test('missing phones produce a readable draft without a WhatsApp link', () => {
  const output = build([record({ parent_phone: '' })]);
  assert.equal(output.ready_count, 0);
  assert.equal(output.reports[0].whatsapp_url, '');
  assert.equal(output.reports[0].status, 'missing_phone');
  assert.match(output.html, /Phone needed/);
  assert.doesNotMatch(output.html, /href="https:\/\/wa.me/);
});

test('phone numbers accept international prefixes and formatting', () => {
  const output = build([record({ parent_phone: '001 (999) 999-0101' })]);
  assert.equal(output.reports[0].parent_phone, '19999990101');
});

test('rejects malformed phones instead of guessing the country', () => {
  for (const parent_phone of ['09999990101', '123', '1999999010112345', 'CALL-PARENT', '1999+9990101', '=19999990101']) {
    assert.throws(() => build([record({ parent_phone })]), /parent_phone/);
  }
});

test('encodes Unicode names, newlines, and reserved URL characters losslessly', () => {
  const output = build([record({ student_name: 'सीता & Asha', teacher_concerns: 'Ask about A&B? #week1\nSupport café reading.' })]);
  const report = output.reports[0];
  assert.equal(new URL(report.whatsapp_url).searchParams.get('text'), report.message);
  assert.match(report.message, /सीता & Asha/);
});

test('blank results and concerns are explicitly not recorded', () => {
  const { message } = build([record({ homework_completed: '', homework_assigned: '', exam_results: '', teacher_concerns: '', parent_action: '', parent_name: '' })]).reports[0];
  assert.match(message, /Dear Parent \/ Guardian,/);
  assert.match(message, /\*Homework\*\nNot recorded\./);
  assert.match(message, /\*Exam results\*\nNot recorded\./);
  assert.match(message, /\*Teacher concerns\*\nNot recorded\./);
  assert.doesNotMatch(message, /None reported/);
  assert.doesNotMatch(message, /Parent support requested/);
});

test('distinguishes zero homework assigned from missing or incomplete work', () => {
  assert.match(build([record({ homework_completed: '0', homework_assigned: '0' })]).reports[0].message, /No homework assigned/);
  assert.match(build([record({ homework_completed: '0', homework_assigned: '5' })]).reports[0].message, /Completed 0\/5 assignments\. Pending: 5/);
});

test('rejects impossible, partial, fractional, negative, or unsafe homework counts', () => {
  for (const overrides of [
    { homework_completed: '6' }, { homework_completed: '-1' },
    { homework_completed: '1.5' }, { homework_completed: 'many' },
    { homework_completed: '' }, { homework_assigned: '' },
    { homework_completed: '99999999999999999999' },
  ]) assert.throws(() => build([record(overrides)]), /homework/);
});

test('requires student IDs, student names, and all teacher details', () => {
  assert.throws(() => build([record({ student_name: '' })]), /student_name is required/);
  assert.throws(() => build([record({ student_id: '' })]), /student_id is required/);
  for (const key of Object.keys(settings)) {
    assert.throws(() => build([record()], { ...settings, [key]: '' }), new RegExp(`${key} is required`));
  }
});

test('escapes student records and form settings in the HTML preview', () => {
  const attack = '<script>alert("example")</script>';
  const output = build([record({ student_name: attack, teacher_concerns: '</pre><img src=x onerror=alert(1)>' })], {
    ...settings, class_name: attack,
  });
  assert.doesNotMatch(output.html, /<script>/);
  assert.doesNotMatch(output.html, /<img src=x/);
  assert.match(output.html, /&lt;script&gt;/);
  assert.match(output.reports[0].message, /<script>/);
});

test('rejects unsupported control characters and excessively long remarks', () => {
  assert.throws(() => build([record({ student_name: 'Student\nAnother' })]), /control character/);
  assert.throws(() => build([record({ teacher_concerns: 'x'.repeat(1001) })]), /exceeds 1000/);
});

test('requires the template columns and rejects duplicate or misspelled headers', () => {
  assert.throws(() => buildReports(table([record()], CSV_COLUMNS.filter((key) => key !== 'student_id')), settings), /Missing CSV columns: student_id/);
  assert.throws(() => buildReports(table([record()], [...CSV_COLUMNS, 'student_id']), settings), /duplicate column names/);
  assert.throws(() => buildReports(table([record()], [...CSV_COLUMNS, 'teacher_complaint']), settings), /Unknown CSV columns/);
});

test('accepts reordered columns, UTF-8 BOM, and optional parent fields being omitted', () => {
  const columns = CSV_COLUMNS.filter((key) => !['parent_name', 'parent_action'].includes(key)).reverse();
  const input = table([record()], columns);
  input[0] = input[0].map((column, i) => `${i === 0 ? '\uFEFF' : ''} ${column} `);
  const output = buildReports(input, settings);
  assert.equal(output.student_count, 1);
  assert.match(output.reports[0].message, /Dear Parent \/ Guardian,/);
});

test('rejects empty uploads and malformed rows, while ignoring fully blank rows', () => {
  for (const input of [[], [undefined], [CSV_COLUMNS]]) {
    assert.throws(() => buildReports(input, settings), /CSV|no students/);
  }
  const input = table([record()]);
  input.push(CSV_COLUMNS.map(() => ''));
  assert.equal(buildReports(input, settings).student_count, 1);
  assert.throws(() => buildReports([CSV_COLUMNS, ['STU001']], settings), /has 1 cells/);
});

test('generated workflow has a connected upload, extraction, Code, and review path', () => {
  const workflow = JSON.parse(fs.readFileSync(path.join(__dirname, '../student-reports.n8n.json'), 'utf8'));
  const types = workflow.nodes.filter((node) => node.type !== 'n8n-nodes-base.stickyNote').map((node) => node.type);
  assert.deepEqual(types, ['n8n-nodes-base.formTrigger', 'n8n-nodes-base.extractFromFile', 'n8n-nodes-base.code', 'n8n-nodes-base.form']);
  assert.equal(workflow.active, false);
  const names = new Set(workflow.nodes.map((node) => node.name));
  for (const [origin, connection] of Object.entries(workflow.connections)) {
    assert.ok(names.has(origin));
    for (const port of connection.main) for (const edge of port) assert.ok(names.has(edge.node));
  }
  const trigger = workflow.nodes[0];
  assert.equal(trigger.parameters.formFields.values.find((field) => field.fieldType === 'file').fieldName, 'student_csv');
  const extract = workflow.nodes[1];
  assert.equal(extract.parameters.binaryPropertyName, 'student_csv');
  assert.equal(extract.parameters.options.headerRow, false);
  assert.equal(extract.parameters.options.includeEmptyCells, true);
  assert.equal(extract.parameters.options.maxRowCount, undefined);
  assert.equal(extract.alwaysOutputData, true);
  assert.equal(workflow.nodes[3].parameters.responseText, '={{ $json.html }}');
});

test('the exact embedded n8n code executes with n8n inputs and no CommonJS helpers', () => {
  const workflow = JSON.parse(fs.readFileSync(path.join(__dirname, '../student-reports.n8n.json'), 'utf8'));
  const code = workflow.nodes.find((node) => node.type === 'n8n-nodes-base.code').parameters.jsCode;
  const engine = fs.readFileSync(path.join(__dirname, '../src/report-engine.js'), 'utf8');
  assert.ok(code.startsWith(engine), 'Rebuild the workflow after changing the engine.');
  const input = table([record(), record({ student_id: 'STU002', student_name: 'Student Two', parent_phone: '' })]);
  const result = vm.runInNewContext(`(function () { ${code}\n})()`, {
    $input: { all: () => input.map((row) => ({ json: { row } })) },
    $: (name) => {
      assert.equal(name, 'Teacher details and student CSV');
      return { first: () => ({ json: settings }) };
    },
  }, { timeout: 2000 });
  assert.equal(result.length, 1);
  assert.equal(result[0].json.student_count, 2);
  assert.equal(result[0].json.ready_count, 1);
  assert.match(result[0].json.html, /Student Two/);
});

test('example preview contains no real contact links or sending automation', () => {
  const html = fs.readFileSync(path.join(__dirname, '../examples/report-preview.html'), 'utf8');
  assert.match(html, /Aarav \(example\)/);
  assert.match(html, /Sita \(example\)/);
  assert.doesNotMatch(html, /href="https:\/\/wa.me/);
  assert.doesNotMatch(html, /<script/);
});
