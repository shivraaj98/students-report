'use strict';
const crypto = require('node:crypto');
const KINDS = ['roster', 'homework', 'diary', 'concern', 'test', 'exam'];
function text(value, limit = 1000) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string' || value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new Error('A record contains invalid text.');
  return value.replace(/\r\n?/g, '\n').trim();
}
function phone(value) {
  const input = text(value, 40);
  if (!/^(?:\+|00)?[0-9 ()\-.]+$/.test(input)) throw new Error('Invalid international parent number.');
  const result = input.replace(/[+ ()\-.]/g, '').replace(/^00/, '');
  if (!/^[1-9]\d{7,14}$/.test(result)) throw new Error('Use an international number including the country code.');
  return result;
}
const fingerprint = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const canonicalName = (value) => value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
function dateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error('Use a valid YYYY-MM-DD document date.');
  return value;
}
function localDate(now = new Date(), timezone = 'Asia/Kathmandu') {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (name) => parts.find((item) => item.type === name).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function normaliseRecord(raw, sourceDate) {
  if (!raw || !KINDS.includes(raw.kind)) throw new Error('Unsupported extracted record type.');
  const number = (key) => { const value = raw[key]; if (value === null || value === undefined) return null; if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100000) throw new Error(`Invalid ${key}.`); return value; };
  const result = { kind: raw.kind, scope: raw.scope === 'class' ? 'class' : 'student', student_id: text(raw.student_id, 120), student_name: text(raw.student_name, 120), parent_phone: raw.parent_phone ? phone(raw.parent_phone) : '', guardian_name: text(raw.guardian_name, 120), date: dateOnly(raw.date || sourceDate), subject: text(raw.subject, 120), description: text(raw.description), evidence_quote: text(raw.evidence_quote, 700), needs_review: raw.needs_review !== false, homework_assigned: number('homework_assigned'), homework_completed: number('homework_completed'), score: number('score'), max_score: number('max_score') };
  if ((result.score !== null && (result.max_score === null || result.max_score <= 0 || result.score > result.max_score)) || (result.max_score !== null && result.score === null)) throw new Error('An extracted mark has an invalid total.');
  if (result.homework_assigned !== null && !Number.isInteger(result.homework_assigned) || result.homework_completed !== null && !Number.isInteger(result.homework_completed)) throw new Error('Homework counts must be whole numbers.');
  if (result.homework_completed !== null && (result.homework_assigned === null || result.homework_completed > result.homework_assigned)) throw new Error('An extracted homework count is invalid.');
  if (result.scope === 'class' && (!['homework', 'diary'].includes(result.kind) || result.homework_completed !== null || result.score !== null || result.parent_phone)) throw new Error('Class-wide records may describe assignments, never individual completion, marks, or concerns.');
  if (!result.evidence_quote) result.needs_review = true;
  return result;
}
function matchStudent(students, record) {
  if (record.student_id) {
    const matches = students.filter((student) => student.id.toLocaleLowerCase() === record.student_id.toLocaleLowerCase());
    if (matches.length !== 1) return null;
    if (record.student_name && canonicalName(matches[0].name) !== canonicalName(record.student_name)) return null;
    return matches[0];
  }
  if (!record.student_name) return null;
  const matches = students.filter((student) => canonicalName(student.name) === canonicalName(record.student_name));
  return matches.length === 1 ? matches[0] : null;
}
function safeObservation(value) {
  if (/\b(lazy|stupid|idiot|dumb|bad child|useless|hopeless)\b/i.test(value)) return 'A teacher concern was recorded. Please contact the teacher privately to discuss the observation and suitable support.';
  return value;
}
function reportWindow(settings, today) {
  const end = dateOnly(today), days = Number(settings.report_days);
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new Error('Reporting window must be 1–90 days.');
  const start = new Date(end + 'T00:00:00Z'); start.setUTCDate(start.getUTCDate() - days + 1);
  return { start: start.toISOString().slice(0, 10), end };
}
function buildMessage(student, observations, settings, today = localDate()) {
  const window = reportWindow(settings, today);
  const all = observations.filter((record) => record.student_id === student.id && record.review_state === 'accepted' && record.kind !== 'roster');
  const records = all.filter((record) => record.date >= window.start && record.date <= window.end).sort((a, b) => a.date.localeCompare(b.date));
  if (!records.length) return null;
  const homework = records.filter((record) => record.kind === 'homework' && record.homework_assigned !== null && record.homework_completed !== null);
  const assigned = homework.reduce((sum, record) => sum + record.homework_assigned, 0), completed = homework.reduce((sum, record) => sum + record.homework_completed, 0);
  const supportingIds = new Set(records.map((record) => record.id));
  const sections = [`Respected ${student.guardian_name || 'Parent / Guardian'},`, `We would like to share a progress update for ${student.name}${settings.class_name ? ` (${settings.class_name})` : ''}.\nPeriod: ${window.start} to ${window.end}.`];
  if (homework.length) sections.push(`Homework: ${completed} of ${assigned} recorded assignments completed. Pending in these records: ${assigned - completed}.`);
  const notes = records.filter((record) => ['homework', 'diary'].includes(record.kind) && record.description).slice(-5);
  if (notes.length) sections.push('Diary / homework notes:\n' + notes.map((record) => `• ${record.date}${record.subject ? ` · ${record.subject}` : ''}: ${safeObservation(record.description)}`).join('\n'));
  const marks = records.filter((record) => ['test', 'exam'].includes(record.kind) && record.score !== null);
  if (marks.length) {
    sections.push('Recorded test / examination results:\n' + marks.slice(-8).map((record) => `• ${record.date} · ${record.subject || record.kind}: ${record.score}/${record.max_score} (${(record.score / record.max_score * 100).toFixed(1)}%).`).join('\n'));
    const latest = marks.at(-1);
    const previous = all.filter((record) => record.id !== latest.id && record.kind === latest.kind && record.subject === latest.subject && record.date < latest.date && record.score !== null && record.max_score > 0).sort((a, b) => a.date.localeCompare(b.date)).at(-1);
    if (previous) {
      supportingIds.add(previous.id);
      const change = latest.score / latest.max_score * 100 - previous.score / previous.max_score * 100;
      sections.push(`For the two latest recorded ${latest.subject || latest.kind} assessments of this type, the score changed by ${change >= 0 ? '+' : ''}${change.toFixed(1)} percentage points. Assessment difficulty may differ.`);
    }
  }
  const concerns = records.filter((record) => record.kind === 'concern' && record.description).slice(-4);
  if (concerns.length) sections.push('Teacher observations for your information:\n' + concerns.map((record) => `• ${record.date}: ${safeObservation(record.description)}`).join('\n'));
  sections.push('Thank you for your continued support. Please contact the class teacher if you would like to discuss these records or need any clarification.');
  sections.push(`With respect,\n${settings.teacher_name || 'Class teacher'}${settings.school_name ? `\n${settings.school_name}` : ''}`);
  return { message: sections.join('\n\n'), record_ids: [...supportingIds], window };
}
function basisFor(data, student, today) {
  const built = buildMessage(student, data.observations, data.settings, today);
  if (!built) return null;
  const basis = fingerprint([data.settings.group_id, data.settings.teacher_name, data.settings.class_name, data.settings.school_name, student, built.message, built.record_ids, built.window]);
  return { ...built, basis };
}
function generateDrafts(data, today = localDate(new Date(), data.settings.timezone)) {
  let count = 0;
  for (const student of data.students) {
    const built = basisFor(data, student, today);
    if (!built) {
      for (const draft of data.drafts) if (draft.student_id === student.id && ['pending', 'approved'].includes(draft.status)) draft.status = 'superseded';
      continue;
    }
    if (data.drafts.some((draft) => draft.student_id === student.id && draft.basis === built.basis && !['superseded', 'cancelled', 'expired', 'blocked'].includes(draft.status))) continue;
    for (const draft of data.drafts) if (draft.student_id === student.id && ['pending', 'approved'].includes(draft.status)) draft.status = 'superseded';
    data.drafts.push({ id: crypto.randomUUID(), student_id: student.id, student_name: student.name, parent_phone: student.parent_phone || '', parent_chat_id: student.parent_chat_id || '', message: built.message, basis: built.basis, record_ids: built.record_ids, window: built.window, generated_date: today, revision: 1, status: 'pending', created_at: new Date().toISOString() }); count++;
  }
  return count;
}
function eligibleStudent(data, draft) {
  const student = data.students.find((entry) => entry.id === draft.student_id);
  if (!student || !student.verified || !student.opt_in || !student.consent_evidence || !student.consent_at) throw new Error('Verify the student-parent match and record parent consent first.');
  if (!data.settings.group_id) throw new Error('Select the class group first.');
  if (!/^\d+@(c\.us|lid)$/.test(student.parent_chat_id || '')) throw new Error('An individual WhatsApp contact is required; group messages are never used for reports.');
  if (phone(student.parent_phone) !== draft.parent_phone || student.parent_chat_id !== draft.parent_chat_id) throw new Error('The parent recipient changed. Generate and review a new draft.');
  const current = basisFor(data, student, draft.generated_date);
  if (!current || current.basis !== draft.basis) throw new Error('The source records or class details changed. Generate and review a new draft.');
  return student;
}
module.exports = { KINDS, text, phone, fingerprint, dateOnly, localDate, normaliseRecord, matchStudent, safeObservation, buildMessage, basisFor, generateDrafts, eligibleStudent };
