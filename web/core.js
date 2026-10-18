(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../src/report-engine'));
  else root.ClassBridge = factory(root.ReportEngine);
})(typeof globalThis === 'undefined' ? this : globalThis, function (engine) {
  'use strict';
  const CONSENT = 'I agree to receive private student progress reports from this teacher on WhatsApp. I can withdraw by replying STOP to the teacher.';
  const consumedReviews = new WeakSet();
  const clean = (value, label, limit = 160) => {
    if (typeof value !== 'string' || !value.trim() || value.length > limit || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`Enter a valid ${label}.`);
    return value.trim();
  };
  function phone(value) {
    const raw = clean(value, 'international phone number', 40);
    if (!/^(?:\+|00)?[0-9 ()\-.]+$/.test(raw)) throw new Error('Use a full international phone number, including the country code.');
    const digits = raw.replace(/[+ ()\-.]/g, '').replace(/^00/, '');
    if (!/^[1-9][0-9]{7,14}$/.test(digits)) throw new Error('Use 8–15 digits including the country code, without a local leading zero.');
    return digits;
  }
  function parseCsv(input) {
    if (typeof input !== 'string' || input.length > 1024 * 1024) throw new Error('Choose a CSV smaller than 1 MB.');
    const source = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const table = []; let row = [], cell = '', quoted = false, closed = false;
    for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      if (quoted) {
        if (ch === '"' && source[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') { quoted = false; closed = true; }
        else cell += ch;
      } else if (ch === ',' || ch === '\n') {
        row.push(cell); cell = ''; closed = false;
        if (ch === '\n') { table.push(row); row = []; }
      } else if (ch === '"' && !cell && !closed) quoted = true;
      else if (ch === '"' || closed) throw new Error('The CSV has an invalid quoted field. Export it again as CSV UTF-8.');
      else cell += ch;
    }
    if (quoted) throw new Error('The CSV has an unclosed quoted field.');
    if (cell || row.length || closed) { row.push(cell); table.push(row); }
    return table;
  }
  const tableFor = (students) => [engine.CSV_COLUMNS, ...students.map((student) => engine.CSV_COLUMNS.map((key) => student[key] ?? ''))];
  function settingsFor(settings) {
    const result = {};
    for (const key of ['school_name', 'class_name', 'teacher_name', 'report_period']) result[key] = clean(settings[key], key.replaceAll('_', ' '));
    result.teacher_phone = settings.teacher_phone ? phone(settings.teacher_phone) : '';
    return result;
  }
  function studentsFromCsv(input, settings) {
    const table = parseCsv(input);
    engine.buildReports(table, settingsFor(settings));
    const headers = table[0];
    return table.slice(1).filter((row) => row.some((cell) => cell.trim())).map((row) => Object.fromEntries(engine.CSV_COLUMNS.map((key) => [key, String(row[headers.indexOf(key)] ?? '').trim()])));
  }
  function reportsFor(state) {
    return engine.buildReports(tableFor(state.students), settingsFor(state.settings)).reports;
  }
  function reportFor(state, id) {
    const report = reportsFor(state).find((item) => item.student_id === id);
    if (!report) throw new Error('This student is no longer in the class.');
    return report;
  }
  function consentFor(state, report) {
    const consent = state.contacts[report.student_id];
    return Boolean(consent && consent.opt_in === true && consent.verified === true && consent.phone === report.parent_phone && consent.parent_name === report.parent_name && consent.student_name === report.student_name && typeof consent.evidence === 'string' && consent.evidence.trim() && consent.recorded_at);
  }
  function reviewFor(state, id) {
    const report = reportFor(state, id);
    if (!report.parent_phone) throw new Error('Add the parent’s international WhatsApp number first.');
    if (!consentFor(state, report)) throw new Error('Verify the parent and record their permission before opening a report.');
    const signature = JSON.stringify([report.student_id, report.student_name, report.parent_name, report.parent_phone, report.message, state.contacts[id]]);
    return { student_id: id, student_name: report.student_name, parent_name: report.parent_name, parent_phone: report.parent_phone, message: report.message, signature };
  }
  function authorizeReview(state, reviewed, permission, now = new Date()) {
    if (permission !== true) throw new Error('Approve this individual message before opening WhatsApp.');
    if (consumedReviews.has(reviewed)) throw new Error('This approval has already been used. Review the report again for another WhatsApp handoff.');
    const current = reviewFor(state, reviewed.student_id);
    if (current.signature !== reviewed.signature) throw new Error('The report or parent details changed. Review the updated message and approve it again.');
    consumedReviews.add(reviewed);
    return {
      url: `https://wa.me/${current.parent_phone}?text=${encodeURIComponent(current.message)}`,
      event: { student_id: current.student_id, student_name: current.student_name, parent_phone: current.parent_phone, at: now.toISOString(), status: 'opened_unverified', message: current.message },
    };
  }
  function invitation(settings, baseUrl) {
    const validated = settingsFor(settings);
    if (!validated.teacher_phone) throw new Error('Add your teacher WhatsApp number in Class setup first.');
    const url = new URL(baseUrl); url.search = ''; url.hash = '';
    const payload = { school_name: validated.school_name, class_name: validated.class_name, teacher_name: validated.teacher_name, teacher_phone: validated.teacher_phone };
    // The fragment is not sent to the hosting server. It contains class details only.
    url.hash = 'join=' + encodeURIComponent(JSON.stringify(payload));
    return url.href;
  }
  function parseInvitation(fragment) {
    if (fragment.length > 4000 || !fragment.startsWith('#join=')) throw new Error('This parent registration link is invalid. Ask your teacher for a new link.');
    const input = JSON.parse(decodeURIComponent(fragment.slice(6)));
    return {
      school_name: clean(input.school_name, 'school'), class_name: clean(input.class_name, 'class'),
      teacher_name: clean(input.teacher_name, 'teacher'), teacher_phone: phone(input.teacher_phone),
    };
  }
  function registrationText(invite, input, permission) {
    if (permission !== true) throw new Error('Parent permission is required.');
    const data = {
      version: 1, school_name: clean(invite.school_name, 'school'), class_name: clean(invite.class_name, 'class'),
      student_id: clean(input.student_id, 'student ID', 120), student_name: clean(input.student_name, 'student name', 120),
      parent_name: clean(input.parent_name, 'parent name', 120), parent_phone: phone(input.parent_phone),
      consent: CONSENT,
    };
    return 'CLASSBRIDGE PARENT REGISTRATION\n' + JSON.stringify(data, null, 2);
  }
  function parseRegistration(input, settings) {
    const marker = 'CLASSBRIDGE PARENT REGISTRATION\n';
    if (typeof input !== 'string' || input.length > 5000 || !input.startsWith(marker)) throw new Error('Paste the full ClassBridge registration message received from the parent.');
    const data = JSON.parse(input.slice(marker.length));
    if (data.version !== 1 || data.consent !== CONSENT) throw new Error('This registration does not include the expected parent permission.');
    if (data.class_name !== settings.class_name || data.school_name !== settings.school_name) throw new Error('This registration belongs to a different school or class.');
    return {
      student_id: clean(data.student_id, 'student ID', 120), student_name: clean(data.student_name, 'student name', 120),
      parent_name: clean(data.parent_name, 'parent name', 120), parent_phone: phone(data.parent_phone),
    };
  }
  function restoreBackup(input) {
    if (typeof input !== 'string' || input.length > 2 * 1024 * 1024) throw new Error('Choose a class backup smaller than 2 MB.');
    const data = JSON.parse(input);
    if (data.version !== 1 || !Array.isArray(data.students)) throw new Error('This is not a ClassBridge class backup.');
    const settings = settingsFor(data.settings);
    const students = data.students.map((student) => Object.fromEntries(engine.CSV_COLUMNS.map((key) => [key, String(student[key] ?? '')])));
    if (students.length) engine.buildReports(tableFor(students), settings);
    // Imported files never grant permission or restore approvals.
    return { version: 1, settings, students, contacts: Object.create(null), events: [] };
  }
  return Object.freeze({ CONSENT, phone, parseCsv, tableFor, settingsFor, studentsFromCsv, reportsFor, reportFor, consentFor, reviewFor, authorizeReview, invitation, parseInvitation, registrationText, parseRegistration, restoreBackup });
});
