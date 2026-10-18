'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const E = require('./engine');
const { encrypt, decrypt, audit } = require('./store');
const { extractDocument } = require('./vision');
class AutomationService {
  constructor({ store, masterKey, notify, vision = extractDocument, connector = null }) {
    Object.assign(this, { store, masterKey, notify, vision, connector }); this.processing = new Set();
    this.uploads = path.join(store.directory, 'uploads'); fs.mkdirSync(this.uploads, { recursive: true, mode: 0o700 });
  }
  async enqueue({ bytes, mime, filename, kind = 'auto', teacher_id, source = 'site', source_message_id = '', caption = '', document_date = E.localDate() }) {
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error('Upload a nonempty document up to 10 MB.');
    if (!['image/jpeg', 'image/png', 'image/webp', 'text/plain'].includes(mime)) throw new Error('Use a JPG, PNG, WebP photo, or UTF-8 text document.');
    if (mime === 'image/jpeg' && bytes.subarray(0, 3).toString('hex') !== 'ffd8ff' || mime === 'image/png' && bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || mime === 'image/webp' && (bytes.subarray(0, 4).toString() !== 'RIFF' || bytes.subarray(8, 12).toString() !== 'WEBP')) throw new Error('The uploaded file does not match its image type.');
    if (kind !== 'auto' && !E.KINDS.includes(kind)) throw new Error('Unknown document category.');
    E.dateOnly(document_date);
    const contentHash = E.fingerprint([crypto.createHash('sha256').update(bytes).digest('hex'), document_date, kind]);
    const existing = this.store.data.sources.find((entry) => entry.content_hash === contentHash || source_message_id && entry.source_message_id === source_message_id);
    if (existing) return { id: existing.id, duplicate: true };
    const id = crypto.randomUUID();
    fs.writeFileSync(path.join(this.uploads, id), bytes, { mode: 0o600 });
    this.store.update((data) => { data.sources.push({ id, mime, filename: E.text(filename, 200), kind, teacher_id, source, source_message_id, caption: E.text(caption), document_date, content_hash: contentHash, received_at: new Date().toISOString(), status: 'queued', attempts: 0, record_count: 0, warnings: [] }); audit(data, teacher_id, 'document_uploaded', { source_id: id }); });
    await this.notify('ingest', { source_id: id }).catch(() => {});
    return { id, duplicate: false };
  }
  async processSource(id) {
    const source = this.store.data.sources.find((entry) => entry.id === id);
    if (!source) throw new Error('Document not found.');
    if (this.processing.has(id) || !['queued', 'waiting_credentials'].includes(source.status)) return { status: source.status };
    if (!this.store.data.settings.cloud_authorized || !this.store.data.settings.vision_key) {
      this.store.update((data) => { data.sources.find((entry) => entry.id === id).status = 'waiting_credentials'; });
      return { status: 'waiting_credentials' };
    }
    this.processing.add(id);
    this.store.update((data) => { const entry = data.sources.find((item) => item.id === id); entry.status = 'processing'; entry.attempts++; entry.error = ''; });
    try {
      const settings = this.store.data.settings;
      const extracted = await this.vision({ apiKey: decrypt(settings.vision_key, this.masterKey), model: settings.model, source, bytes: fs.readFileSync(path.join(this.uploads, id)) });
      this.store.update((data) => {
        // A category hint is not permission to change school identity or contacts.
        if (!data.settings.school_name && extracted.school_name) data.settings.school_name = E.text(extracted.school_name, 160);
        if (!data.settings.class_name && extracted.class_name) data.settings.class_name = E.text(extracted.class_name, 160);
        const rows = extracted.records.map((record) => E.normaliseRecord(record, source.document_date)).sort((a, b) => Number(b.kind === 'roster') - Number(a.kind === 'roster'));
        for (const record of rows) this.importRecord(data, id, record);
        const entry = data.sources.find((item) => item.id === id);
        entry.warnings = extracted.warnings; entry.record_count = data.observations.filter((record) => record.source_id === id).length;
        entry.status = !entry.record_count || data.observations.some((record) => record.source_id === id && record.review_state === 'pending') ? 'needs_review' : 'processed';
        E.generateDrafts(data); audit(data, 'n8n', 'document_extracted', { source_id: id, records: entry.record_count });
      });
      return { status: this.store.data.sources.find((entry) => entry.id === id).status };
    } catch (error) {
      this.store.update((data) => { const entry = data.sources.find((item) => item.id === id); entry.status = 'failed'; entry.error = error.message?.slice(0, 500) || 'Document extraction failed.'; audit(data, 'n8n', 'extraction_failed', { source_id: id }); });
      return { status: 'failed' };
    } finally { this.processing.delete(id); }
  }
  importRecord(data, sourceId, record) {
    let student = E.matchStudent(data.students, record);
    if (record.kind === 'roster' && !student && record.student_name) {
      if (data.students.length >= 200) throw new Error('The class has reached the 200-student limit.');
      const id = record.student_id || 'name_' + E.fingerprint(record.student_name).slice(0, 12);
      if (data.students.some((entry) => entry.id.toLowerCase() === id.toLowerCase())) record.needs_review = true;
      else { student = { id, name: record.student_name, guardian_name: record.guardian_name, parent_phone: record.parent_phone, parent_chat_id: '', verified: false, opt_in: false, consent_evidence: '', consent_at: '' }; data.students.push(student); }
    }
    const targets = record.scope === 'class' ? data.students : [student];
    if (!targets.length) targets.push(null);
    for (const target of targets) {
      const factHash = E.fingerprint([target?.id || record.student_id, record.kind, record.date, record.subject, record.description, record.score, record.max_score, record.homework_assigned, record.homework_completed]);
      if (data.observations.some((entry) => entry.fact_hash === factHash)) continue;
      const conflict = target && ['test', 'exam'].includes(record.kind) && data.observations.some((entry) => entry.student_id === target.id && entry.kind === record.kind && entry.date === record.date && entry.subject === record.subject && entry.score !== record.score);
      data.observations.push({ ...record, id: crypto.randomUUID(), source_id: sourceId, student_id: target?.id || '', extracted_student_id: record.student_id, extracted_student_name: record.student_name, fact_hash: factHash, review_state: target && !record.needs_review && !conflict && !['roster', 'concern'].includes(record.kind) ? 'accepted' : 'pending', conflict: Boolean(conflict) });
    }
  }
  reviewRecord(id, patch, actor) {
    this.store.update((data) => {
      const record = data.observations.find((entry) => entry.id === id); if (!record) throw new Error('Record not found.');
      if (patch.reject === true) { record.review_state = 'rejected'; audit(data, actor, 'record_rejected', { record_id: id }); }
      else {
        const student = data.students.find((entry) => entry.id === patch.student_id); if (!student) throw new Error('Select the correct student.');
        const edited = E.normaliseRecord({ ...record, ...patch, student_id: student.id, student_name: student.name, scope: 'student', needs_review: false }, record.date);
        Object.assign(record, edited, { student_id: student.id, review_state: 'accepted', reviewed_by: actor, reviewed_at: new Date().toISOString() });
        audit(data, actor, 'record_confirmed', { record_id: id });
      }
      const source = data.sources.find((entry) => entry.id === record.source_id);
      if (source && !data.observations.some((entry) => entry.source_id === source.id && entry.review_state === 'pending')) source.status = 'processed';
      E.generateDrafts(data);
    });
  }
  setContact(id, input, actor) {
    this.store.update((data) => {
      const student = data.students.find((entry) => entry.id === id); if (!student) throw new Error('Student not found.');
      const participant = data.participants.find((entry) => entry.id === input.participant_id);
      if (!participant?.phone) throw new Error('Select a group participant with a resolved international number.');
      const evidence = E.text(input.evidence, 500);
      if (input.opt_in === true && (input.verified !== true || !evidence)) throw new Error('Verify the student-parent match and record evidence of the parent’s permission.');
      Object.assign(student, { name: E.text(input.student_name || student.name, 120), guardian_name: E.text(input.guardian_name || participant.name, 120), parent_phone: E.phone(participant.phone), parent_chat_id: participant.id, verified: input.verified === true, opt_in: input.opt_in === true, consent_evidence: input.opt_in ? evidence : '', consent_at: input.opt_in ? new Date().toISOString() : '' });
      E.generateDrafts(data); audit(data, actor, 'parent_contact_updated', { student_id: id, opt_in: student.opt_in });
    });
  }
  parentClaim(claim) {
    this.store.update((data) => {
      const student = E.matchStudent(data.students, { student_id: claim.student_id, student_name: claim.student_name });
      if (!student) { audit(data, 'parent', 'unmatched_parent_claim', { message_id: claim.message_id }); return; }
      student.parent_claim = { chat_id: claim.id, phone: claim.phone, name: claim.name, evidence: E.text(claim.evidence, 500), received_at: new Date().toISOString() };
      audit(data, 'parent', 'parent_permission_claim_received', { student_id: student.id });
    });
  }
  withdraw(sender) {
    this.store.update((data) => { for (const student of data.students) if (student.parent_chat_id === sender.id || sender.phone && student.parent_phone === sender.phone) { student.opt_in = false; student.consent_evidence = ''; student.consent_at = ''; audit(data, 'parent', 'parent_opt_out', { student_id: student.id }); } E.generateDrafts(data); });
  }
  reviewDraft(id, message, actor) {
    const token = crypto.randomBytes(32).toString('hex');
    let reviewed;
    this.store.update((data) => {
      const draft = data.drafts.find((entry) => entry.id === id); if (!draft || draft.status !== 'pending') throw new Error('This draft is no longer pending. Generate a new report if needed.');
      E.eligibleStudent(data, draft);
      const finalMessage = E.text(message || draft.message, 12000); if (!finalMessage) throw new Error('The report cannot be empty.');
      draft.message = finalMessage; draft.revision++; draft.review_hash = E.fingerprint(token); draft.review_expires = Date.now() + 10 * 60000;
      draft.review_content = E.fingerprint([draft.id, draft.revision, draft.parent_chat_id, draft.parent_phone, draft.message, draft.basis]);
      draft.review_actor = actor;
      reviewed = { id: draft.id, student_name: draft.student_name, parent_phone: draft.parent_phone, message: draft.message, token, revision: draft.revision, expires_at: draft.review_expires };
    });
    return reviewed;
  }
  async approveDraft(id, input, actor) {
    this.store.update((data) => {
      const draft = data.drafts.find((entry) => entry.id === id);
      if (!draft || draft.status !== 'pending' || input.permission !== true || draft.review_actor !== actor || !draft.review_hash || draft.review_hash !== E.fingerprint(input.token) || draft.review_expires < Date.now()) throw new Error('Review this exact message and give fresh permission before sending.');
      E.eligibleStudent(data, draft);
      if (draft.review_content !== E.fingerprint([draft.id, draft.revision, draft.parent_chat_id, draft.parent_phone, draft.message, draft.basis])) throw new Error('The reviewed message changed. Review it again.');
      draft.status = 'approved'; draft.approved_by = actor; draft.approved_at = new Date().toISOString(); draft.approval_expires = Date.now() + 10 * 60000; delete draft.review_hash;
      audit(data, actor, 'individual_message_approved', { draft_id: id, student_id: draft.student_id });
    });
    await this.notify('dispatch', { draft_id: id }).catch(() => {});
    return { status: 'approved' };
  }
  async dispatch(id) {
    const current = this.store.data.drafts.find((entry) => entry.id === id);
    if (!current || current.status !== 'approved') return { status: current?.status || 'not_found' };
    if (current.approval_expires < Date.now()) { this.store.update((data) => { data.drafts.find((entry) => entry.id === id).status = 'expired'; }); return { status: 'expired' }; }
    if (this.connector?.status !== 'ready') return { status: 'awaiting_whatsapp' };
    try { E.eligibleStudent(this.store.data, current); }
    catch (error) { this.store.update((data) => { const draft = data.drafts.find((entry) => entry.id === id); draft.status = 'blocked'; draft.error = error.message; }); return { status: 'blocked' }; }
    // Claim and durably persist before awaiting any external operation.
    this.store.update((data) => { const draft = data.drafts.find((entry) => entry.id === id); if (draft.status !== 'approved') throw new Error('Approval already consumed.'); draft.status = 'sending'; audit(data, 'n8n', 'send_started', { draft_id: id }); });
    try {
      const messageId = await this.connector.sendPrivate(current.parent_chat_id, current.message, () => {
        const draft = this.store.data.drafts.find((entry) => entry.id === id);
        if (draft.status !== 'sending' || draft.approval_expires < Date.now()) throw new Error('Approval no longer active.');
        E.eligibleStudent(this.store.data, draft);
      });
      this.store.update((data) => { const draft = data.drafts.find((entry) => entry.id === id); draft.status = 'submitted'; draft.whatsapp_message_id = messageId; draft.submitted_at = new Date().toISOString(); audit(data, 'n8n', 'message_submitted', { draft_id: id }); });
      return { status: 'submitted' };
    } catch {
      this.store.update((data) => { const draft = data.drafts.find((entry) => entry.id === id); draft.status = 'unknown'; draft.error = 'Delivery is uncertain. Check the private WhatsApp chat before preparing another report. Automatic retries are disabled.'; audit(data, 'n8n', 'delivery_uncertain', { draft_id: id }); });
      return { status: 'unknown' };
    }
  }
  ack(messageId, ack) {
    if (ack < 2) return;
    this.store.update((data) => { const draft = data.drafts.find((entry) => entry.whatsapp_message_id === messageId); if (draft && ['submitted', 'delivered', 'read'].includes(draft.status)) draft.status = ack >= 3 ? 'read' : draft.status === 'read' ? 'read' : 'delivered'; });
  }
  async tick() {
    this.store.update((data) => { data.last_tick = new Date().toISOString(); });
    const approved = this.store.data.drafts.find((draft) => draft.status === 'approved');
    if (approved) await this.dispatch(approved.id);
    const queued = this.store.data.sources.find((source) => ['queued', 'waiting_credentials'].includes(source.status));
    if (queued) await this.processSource(queued.id);
    return { ok: true };
  }
  saveVision(key, model, authorized, actor) {
    if (authorized !== true) throw new Error('Authorize cloud processing of selected class documents first.');
    if (!/^[A-Za-z0-9._:-]{1,100}$/.test(model)) throw new Error('Invalid vision model name.');
    if (!key || key.length > 500 || /\s/.test(key)) throw new Error('Enter a valid API key.');
    this.store.update((data) => { data.settings.vision_key = encrypt(key, this.masterKey); data.settings.model = model; data.settings.cloud_authorized = true; for (const source of data.sources) if (source.status === 'waiting_credentials') source.status = 'queued'; audit(data, actor, 'vision_account_connected'); });
  }
}
module.exports = { AutomationService };
