'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildReports, CSV_COLUMNS } = require('../src/report-engine');
const root = path.join(__dirname, '..');
const formName = 'Teacher details and student CSV';
const source = fs.readFileSync(path.join(root, 'src/report-engine.js'), 'utf8');
const jsCode = `${source}\n\nconst settings = $('${formName}').first().json;\nconst table = $input.all().map((item) => item.json.row);\nreturn [{ json: buildReports(table, settings) }];\n`;

const workflow = {
  name: 'Class reports - individual WhatsApp drafts (up to 45 students)',
  nodes: [
    {
      parameters: {
        formTitle: 'Prepare parent reports',
        formDescription: 'Upload one class CSV (maximum 45 students). Review personalised homework, exam, and teacher concern messages before opening each parent\'s WhatsApp chat.',
        formFields: { values: [
          { fieldLabel: 'School name', fieldName: 'school_name', fieldType: 'text', requiredField: true },
          { fieldLabel: 'Class / section', fieldName: 'class_name', fieldType: 'text', requiredField: true },
          { fieldLabel: 'Teacher name', fieldName: 'teacher_name', fieldType: 'text', requiredField: true },
          { fieldLabel: 'Reporting period', fieldName: 'report_period', fieldType: 'text', placeholder: 'For example: Week 3, Term 1', requiredField: true },
          { fieldLabel: 'Student records (CSV)', fieldName: 'student_csv', fieldType: 'file', acceptFileTypes: '.csv', multipleFiles: false, requiredField: true },
        ] },
        responseMode: 'lastNode',
        options: { path: 'class-parent-reports', buttonLabel: 'Prepare reports', useWorkflowTimezone: true },
      },
      id: '7c821f8f-1212-4f1f-bf99-886d34b4c492',
      name: formName, type: 'n8n-nodes-base.formTrigger', typeVersion: 2.4,
      position: [0, 0], webhookId: 'e9de0fa5-dc5f-4328-a784-7413156321ad',
    },
    {
      parameters: {
        operation: 'csv', binaryPropertyName: 'student_csv',
        // Preserve the header as a row, so duplicate headers cannot overwrite data.
        options: { headerRow: false, includeEmptyCells: true, encoding: 'utf8', enableBOM: true, delimiter: ',' },
      },
      id: 'da41e29d-b583-42b0-a783-344fd5ad4cb1',
      name: 'Read student CSV', type: 'n8n-nodes-base.extractFromFile', typeVersion: 1.1,
      position: [300, 0], alwaysOutputData: true,
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode },
      id: 'ccecb2ca-4425-4740-b634-7e7681bc55de',
      name: 'Validate and prepare individual reports', type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [600, 0],
    },
    {
      parameters: { operation: 'completion', respondWith: 'showText', responseText: '={{ $json.html }}' },
      id: '96aaf327-0dc3-4e99-af10-5d1137201b45',
      name: 'Review reports and open WhatsApp', type: 'n8n-nodes-base.form', typeVersion: 2.3,
      position: [900, 0], webhookId: '2dbe72ea-085d-4a4d-894f-a561257b845e',
    },
    {
      parameters: {
        content: '## How to use\n1. Execute workflow and open the teacher form.\n2. Enter teacher details and upload examples/students.csv or your own CSV (up to 45).\n3. Review each message and open its individual WhatsApp link.\n4. Press Send in WhatsApp.\n\nExample phone numbers are intentionally blank. Supply actual parent numbers with country codes. This workflow prepares drafts; it does not send or track delivery.',
        width: 680, height: 320,
      },
      id: '22f3c9cb-3442-46b7-898e-3d6fd7740cf9', name: 'Instructions',
      type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: [100, -400],
    },
  ],
  connections: {
    [formName]: { main: [[{ node: 'Read student CSV', type: 'main', index: 0 }]] },
    'Read student CSV': { main: [[{ node: 'Validate and prepare individual reports', type: 'main', index: 0 }]] },
    'Validate and prepare individual reports': { main: [[{ node: 'Review reports and open WhatsApp', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1', timezone: 'Asia/Kathmandu' },
  active: false,
  pinData: {},
  tags: [],
};

fs.writeFileSync(path.join(root, 'student-reports.n8n.json'), `${JSON.stringify(workflow, null, 2)}\n`, 'utf8');

// An offline, anonymised preview; its blank numbers cannot open a parent chat.
const previewRows = [
  ['STU001', 'Aarav (example)', 'Parent One', '', '4', '5', 'Mathematics: 38/50; English: 42/50', 'One homework assignment is pending.', 'Please help complete the pending assignment by Friday.'],
  ['STU002', 'Sita (example)', 'Parent Two', '', '5', '5', 'Mathematics: 46/50; English: 44/50', 'None reported.', 'Please encourage the same regular study habits.'],
];
const preview = buildReports([CSV_COLUMNS, ...previewRows], {
  school_name: 'Example School', class_name: '6 A', teacher_name: 'Example Teacher', report_period: 'Example week',
});
fs.writeFileSync(path.join(root, 'examples/report-preview.html'), preview.html, 'utf8');
console.log('Built student-reports.n8n.json and examples/report-preview.html');
