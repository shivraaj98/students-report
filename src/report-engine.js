'use strict';

// Kept dependency-free so the same code runs in n8n's JavaScript Code node.
const MAX_STUDENTS = 45;
const CSV_COLUMNS = [
  'student_id', 'student_name', 'parent_name', 'parent_phone',
  'homework_completed', 'homework_assigned', 'exam_results',
  'teacher_concerns', 'parent_action',
];
const REQUIRED_COLUMNS = CSV_COLUMNS.filter(
  (column) => !['parent_name', 'parent_action'].includes(column),
);

function text(value, label, { required = false, limit = 1000, multiline = true } = {}) {
  if (value !== null && value !== undefined && !['string', 'number'].includes(typeof value)) {
    throw new Error(`${label} must be text.`);
  }
  const result = String(value ?? '').replace(/\r\n?/g, '\n').trim();
  if (required && !result) throw new Error(`${label} is required.`);
  if (result.length > limit) throw new Error(`${label} exceeds ${limit} characters.`);
  if ((!multiline && /[\n\t]/.test(result)) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result)) {
    throw new Error(`${label} contains an unsupported control character.`);
  }
  return result;
}

function phoneNumber(value, label) {
  let number = text(value, label, { limit: 40, multiline: false });
  if (!number) return '';
  // Country codes are supplied by the teacher, never inferred from a location.
  if (!/^(?:\+|00)?[0-9 ()\-.]+$/.test(number)) {
    throw new Error(`${label}: use a full international number with its country code.`);
  }
  number = number.replace(/[+ ()\-.]/g, '');
  if (number.startsWith('00')) number = number.slice(2);
  if (!/^[1-9][0-9]{7,14}$/.test(number)) {
    throw new Error(`${label}: use 8-15 digits including the country code, without a local leading zero.`);
  }
  return number;
}

function homeworkCount(value, label) {
  const input = text(value, label, { limit: 12, multiline: false });
  if (!input) return null;
  if (!/^[0-9]+$/.test(input) || !Number.isSafeInteger(Number(input))) {
    throw new Error(`${label} must be a whole number of zero or more.`);
  }
  return Number(input);
}

function parseTable(table) {
  if (!Array.isArray(table) || !Array.isArray(table[0])) {
    throw new Error('Upload a CSV with a header row and 1-45 students.');
  }
  const headers = table[0].map((header) => text(
    String(header ?? '').replace(/^\uFEFF/, ''), 'CSV header',
    { required: true, limit: 80, multiline: false },
  ));
  if (new Set(headers).size !== headers.length) {
    throw new Error('The CSV has duplicate column names. Each column must appear once.');
  }
  const missing = REQUIRED_COLUMNS.filter((column) => !headers.includes(column));
  if (missing.length) throw new Error(`Missing CSV columns: ${missing.join(', ')}.`);
  const unknown = headers.filter((column) => !CSV_COLUMNS.includes(column));
  if (unknown.length) throw new Error(`Unknown CSV columns: ${unknown.join(', ')}. Use the supplied template.`);

  const rows = [];
  table.slice(1).forEach((row, index) => {
    if (!Array.isArray(row)) throw new Error(`CSV row ${index + 2} is not a record.`);
    if (row.every((cell) => String(cell ?? '').trim() === '')) return;
    if (row.length !== headers.length) {
      throw new Error(`CSV row ${index + 2} has ${row.length} cells; expected ${headers.length}.`);
    }
    rows.push({ rowNumber: index + 2, fields: Object.fromEntries(headers.map((key, i) => [key, row[i]])) });
  });
  if (!rows.length) throw new Error('The CSV contains no students. Add 1-45 student rows.');
  if (rows.length > MAX_STUDENTS) throw new Error(`Found ${rows.length} students; the class limit is ${MAX_STUDENTS}.`);
  return rows;
}

function studentRecord({ fields, rowNumber }) {
  const prefix = `CSV row ${rowNumber}`;
  const single = { limit: 120, multiline: false };
  const student = {
    student_id: text(fields.student_id, `${prefix}: student_id`, { ...single, required: true }),
    student_name: text(fields.student_name, `${prefix}: student_name`, { ...single, required: true }),
    parent_name: text(fields.parent_name, `${prefix}: parent_name`, single),
    parent_phone: phoneNumber(fields.parent_phone, `${prefix}: parent_phone`),
    homework_completed: homeworkCount(fields.homework_completed, `${prefix}: homework_completed`),
    homework_assigned: homeworkCount(fields.homework_assigned, `${prefix}: homework_assigned`),
    exam_results: text(fields.exam_results, `${prefix}: exam_results`),
    teacher_concerns: text(fields.teacher_concerns, `${prefix}: teacher_concerns`),
    parent_action: text(fields.parent_action, `${prefix}: parent_action`),
  };
  if ((student.homework_completed === null) !== (student.homework_assigned === null)) {
    throw new Error(`${prefix}: enter both homework counts, or leave both blank if not recorded.`);
  }
  if (student.homework_completed !== null && student.homework_completed > student.homework_assigned) {
    throw new Error(`${prefix}: completed homework cannot exceed assigned homework.`);
  }
  return student;
}

function messageFor(student, settings) {
  let homework = 'Not recorded.';
  if (student.homework_assigned === 0) homework = 'No homework assigned for this period.';
  else if (student.homework_assigned !== null) {
    homework = `Completed ${student.homework_completed}/${student.homework_assigned} assignments. `
      + `Pending: ${student.homework_assigned - student.homework_completed}.`;
  }
  const exams = student.exam_results
    ? student.exam_results.split(/;|\n/).map((line) => line.trim()).filter(Boolean).join('\n')
    : 'Not recorded.';
  const sections = [
    '*Student progress report*',
    `${settings.school_name}\nClass: ${settings.class_name}\nPeriod: ${settings.report_period}`,
    `Dear ${student.parent_name || 'Parent / Guardian'},`,
    `*Student:* ${student.student_name}\n*Student ID:* ${student.student_id}`,
    `*Homework*\n${homework}`,
    `*Exam results*\n${exams}`,
    `*Teacher concerns*\n${student.teacher_concerns || 'Not recorded.'}`,
  ];
  if (student.parent_action) sections.push(`*Parent support requested*\n${student.parent_action}`);
  sections.push(`Regards,\n${settings.teacher_name}\nClass teacher`);
  return sections.join('\n\n');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function reviewHtml(reports, settings) {
  const ready = reports.filter((report) => report.whatsapp_url).length;
  const phoneCounts = new Map();
  reports.forEach((report) => {
    if (report.parent_phone) phoneCounts.set(report.parent_phone, (phoneCounts.get(report.parent_phone) || 0) + 1);
  });
  const cards = reports.map((report, index) => {
    const shared = (phoneCounts.get(report.parent_phone) || 0) > 1
      ? '<p class="notice">This parent number is shared by multiple students. Check the student name before sending.</p>' : '';
    const action = report.whatsapp_url
      ? `<a class="open-chat" href="${escapeHtml(report.whatsapp_url)}" target="_blank" rel="noopener noreferrer">Open WhatsApp for ${escapeHtml(report.student_name)}</a>`
      : '<p class="notice">Add this parent\'s full international number to parent_phone in the CSV to enable WhatsApp.</p>';
    return `<article>
      <div class="card-heading"><span class="number">${index + 1}</span><div>
        <h2>${escapeHtml(report.student_name)}</h2><p class="meta">${escapeHtml(report.student_id)} &middot; ${escapeHtml(report.parent_name || 'Parent / Guardian')}${report.parent_phone ? ` &middot; +${escapeHtml(report.parent_phone)}` : ''}</p>
      </div><span class="badge">${report.whatsapp_url ? 'Ready for review' : 'Phone needed'}</span></div>
      <pre>${escapeHtml(report.message)}</pre>${shared}${action}
    </article>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer"><title>Parent reports - ${escapeHtml(settings.class_name)}</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f1f5f4;color:#172b27;font:16px/1.55 system-ui,sans-serif}
main{max-width:900px;margin:0 auto;padding:32px 20px 64px}header{margin-bottom:28px}h1{font-size:30px;line-height:1.2;margin:8px 0}
h2{font-size:20px;margin:0}.eyebrow{color:#286656;font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:13px}
.subtitle,.meta{color:#4b625c}.meta{font-size:14px;margin:3px 0}.instructions{padding:16px 20px;background:#e2efea;border-radius:12px}
article{background:white;border:1px solid #d7e1dd;border-radius:16px;padding:24px;margin:20px 0;break-inside:avoid}
.card-heading{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.number{display:grid;place-items:center;width:36px;height:36px;border-radius:50%;background:#e6efeb;font-weight:700}
.badge{margin-left:auto;background:#edf3f0;border-radius:20px;padding:5px 10px;font-size:12px;color:#285546}
pre{font:15px/1.65 system-ui,sans-serif;white-space:pre-wrap;overflow-wrap:anywhere;background:#f7faf8;padding:20px;border-radius:10px;margin:20px 0}
.open-chat{display:inline-block;text-decoration:none;color:white;background:#146c50;padding:12px 18px;border-radius:8px;font-weight:600}
.open-chat:focus-visible{outline:3px solid #172b27;outline-offset:4px}.open-chat:hover{background:#0b513b}.notice{color:#7a4219;background:#fff3df;padding:12px 16px;border-radius:8px}
footer{font-size:14px;color:#4b625c}@media(max-width:540px){main{padding:20px 12px}article{padding:16px}.badge{margin-left:50px}pre{padding:14px}.open-chat{display:block;text-align:center}}
@media print{body{background:white}main{max-width:none;padding:0}.open-chat{display:none}article{border-color:#aaa}}
</style></head><body><main>
<header><div class="eyebrow">${escapeHtml(settings.school_name)}</div><h1>Reports for class ${escapeHtml(settings.class_name)}</h1>
<p class="subtitle">${escapeHtml(settings.report_period)} &middot; ${reports.length} student reports &middot; ${ready} WhatsApp links ready</p>
<div class="instructions"><strong>Review and send one report at a time.</strong><br>Open the student's WhatsApp link, verify the parent and message, then press <strong>Send</strong> in WhatsApp. Opening a link does not send the message or confirm delivery.</div>
${ready < reports.length ? `<p class="notice">${reports.length - ready} report(s) need a parent phone number. Update the CSV and submit it again.</p>` : ''}</header>
${cards}
<footer>Prepared from the teacher's records. Blank results or concerns mean “Not recorded”. Only each individual report should be sent to its parent. You can print or save this page for your own records.</footer>
</main></body></html>`;
}

function buildReports(table, rawSettings = {}) {
  const settings = {};
  for (const key of ['school_name', 'class_name', 'teacher_name', 'report_period']) {
    settings[key] = text(rawSettings[key], key, { required: true, limit: 160, multiline: false });
  }
  const students = parseTable(table).map(studentRecord);
  const ids = new Set();
  for (const student of students) {
    const id = student.student_id.toLowerCase();
    if (ids.has(id)) throw new Error(`Duplicate student_id: ${student.student_id}. Each student needs a unique ID.`);
    ids.add(id);
  }
  const reports = students.map((student) => {
    const message = messageFor(student, settings);
    return {
      student_id: student.student_id,
      student_name: student.student_name,
      parent_name: student.parent_name,
      parent_phone: student.parent_phone,
      status: student.parent_phone ? 'ready_for_review' : 'missing_phone',
      message,
      whatsapp_url: student.parent_phone
        ? `https://wa.me/${student.parent_phone}?text=${encodeURIComponent(message)}` : '',
    };
  });
  return {
    student_count: reports.length,
    ready_count: reports.filter((report) => report.whatsapp_url).length,
    reports,
    html: reviewHtml(reports, settings),
  };
}

// The export is only used by local tests and the workflow builder.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildReports, CSV_COLUMNS, MAX_STUDENTS };
}
