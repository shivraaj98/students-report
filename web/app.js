/* ClassBridge makes no network requests. WhatsApp opens only after a user action. */
(function () {
  'use strict';
  const C = window.ClassBridge, E = window.ReportEngine;
  const app = document.querySelector('#app'), modal = document.querySelector('#modal');
  const storageKey = 'classbridge.workspace.v1';
  let page = 'setup', search = '', remember = false, toastTimer;
  let state = { version: 1, settings: { school_name: '', class_name: '', teacher_name: '', report_period: '', teacher_phone: '' }, students: [], contacts: Object.create(null), events: [] };
  const icons = {
    bridge: '<path d="M3 19V9l9-5 9 5v10M3 12h18M8 12v7m8-7v7"/>',
    home: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M15 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8m-8 4h6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    shield: '<path d="M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7zM8 12l3 3 5-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    upload: '<path d="M12 16V3m-5 5 5-5 5 5M3 16v4a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-4"/>',
    download: '<path d="M12 3v13m-5-5 5 5 5-5M3 16v4a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-4"/>',
    chat: '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5A8.5 8.5 0 0 1 10.5 3h2a8.5 8.5 0 0 1 8.5 8.5zM7 10h9m-9 4h6"/>',
    search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
    arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
    device: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>',
    link: '<path d="m10 13 4-4m-6 7-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 1 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/>',
  };
  const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.file}</svg>`;
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const initials = (name) => String(name || 'Teacher').trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase();
  const badge = (text, kind = '') => `<span class="badge ${kind}"><span class="dot"></span>${esc(text)}</span>`;
  const button = (action, label, symbol, primary = false) => `<button type="button" class="button${primary ? ' primary' : ''}" data-action="${action}">${symbol ? icon(symbol) : ''}${label}</button>`;
  const notice = (text, warning = false) => `<div class="notice${warning ? ' warning' : ''}">${icon('shield')}<p>${text}</p></div>`;
  const field = (name, label, value = '', options = '') => `<label class="field">${label}<input name="${name}" value="${esc(value)}" ${options}></label>`;
  function showToast(message) {
    const element = document.querySelector('#toast'); element.textContent = message; element.classList.add('visible');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => element.classList.remove('visible'), 5500);
  }
  function showError(error, target = modal) {
    let element = target.querySelector('.error');
    if (!element) { element = document.createElement('p'); element.className = 'error'; element.setAttribute('role', 'alert'); target.append(element); }
    element.textContent = error.message || 'Something went wrong. Please try again.'; element.classList.add('visible');
  }
  function persist() {
    try { if (remember) localStorage.setItem(storageKey, JSON.stringify(state)); else localStorage.removeItem(storageKey); }
    catch { remember = false; showToast('Browser storage is unavailable or full. Export a backup to keep this class.'); }
  }
  function loadSaved() {
    try {
      const raw = localStorage.getItem(storageKey); if (!raw) return;
      const data = JSON.parse(raw), restored = C.restoreBackup(raw);
      if (data.contacts && typeof data.contacts === 'object') {
        for (const student of restored.students) {
          const contact = Object.hasOwn(data.contacts, student.student_id) ? data.contacts[student.student_id] : null;
          if (contact && typeof contact.evidence === 'string' && contact.evidence.length <= 240 && !Number.isNaN(Date.parse(contact.recorded_at))) restored.contacts[student.student_id] = contact;
        }
      }
      if (Array.isArray(data.events)) restored.events = data.events.filter((event) => event && event.status === 'opened_unverified' && typeof event.message === 'string' && event.message.length < 10000 && !Number.isNaN(Date.parse(event.at))).slice(-500);
      state = restored; remember = true;
      page = state.students.length ? 'students' : 'setup';
    } catch { showToast('The saved class could not be loaded. Import a valid backup or start a new class.'); }
  }
  function reports() { return state.students.length ? C.reportsFor(state) : []; }
  function stats() {
    const list = reports(), ready = list.filter((report) => C.consentFor(state, report)).length;
    return `<div class="stats"><div class="stat"><div><span class="stat-label">Students in class</span><strong class="stat-value">${list.length.toString().padStart(2, '0')}</strong><span class="stat-caption">Up to 45 per class</span></div><span class="stat-icon">${icon('users')}</span></div><div class="stat"><div><span class="stat-label">Parent permission recorded</span><strong class="stat-value">${ready.toString().padStart(2, '0')}</strong><span class="stat-caption">Contact matched to student</span></div><span class="stat-icon">${icon('shield')}</span></div><div class="stat"><div><span class="stat-label">Awaiting your review</span><strong class="stat-value">${ready.toString().padStart(2, '0')}</strong><span class="stat-caption">Each opening needs approval</span></div><span class="stat-icon">${icon('file')}</span></div></div>`;
  }
  function hero() {
    return `<section class="hero"><div><span class="eyebrow">A little care. A stronger connection.</span><h2>Keep every parent in the picture.</h2><p>Turn class records into personal progress updates. You review each report, give permission, and send privately in WhatsApp.</p>${button('invite', 'Invite parents from your group', 'link', true)}</div><div class="hero-art" aria-hidden="true">${icon('file')}<span class="bubble">${icon('chat')}</span></div></section>`;
  }
  function render() {
    const titles = { setup: 'Your class, connected.', students: 'Students & parents', reports: 'A thoughtful update for every parent.', activity: 'Your message activity' };
    const subtitles = { setup: 'Set up your class once. Make every parent update more personal.', students: 'Keep student details, parent contacts, and permission in one place.', reports: 'Review the details. Approve one message. Continue in WhatsApp.', activity: 'A record of approved WhatsApp handoffs on this device.' };
    const nav = [['setup', 'Class setup', 'home'], ['students', 'Students & parents', 'users'], ['reports', 'Reports & approvals', 'file'], ['activity', 'Activity', 'clock']];
    app.innerHTML = `<div class="shell"><aside class="sidebar"><a class="brand" href="#"> <span class="brand-mark">${icon('bridge')}</span>ClassBridge</a><p class="brand-small">A closer school community</p><span class="nav-label">Your workspace</span><nav aria-label="Workspace">${nav.map(([id, title, symbol]) => `<button type="button" class="nav-item ${page === id ? 'active' : ''}" data-page="${id}" ${page === id ? 'aria-current="page"' : ''}>${icon(symbol)}${title}${id === 'students' ? `<span class="nav-count">${state.students.length}</span>` : ''}</button>`).join('')}</nav><div class="side-bottom"><div class="side-note"><strong>${icon('shield')}Always with your permission</strong>Every parent report needs your review. You choose when to open WhatsApp and press Send.</div><div class="side-links"><button type="button" class="text-button" data-action="help">How it works</button><button type="button" class="text-button" data-action="privacy">Privacy</button></div></div></aside><div class="workspace"><header class="topbar"><div class="breadcrumb">Workspace <span>/</span> <strong>${esc(state.settings.class_name || 'Your classroom')}</strong></div><div class="top-actions"><span class="device-label">${icon('device')}${remember ? 'Saved on this device' : 'Session only'}</span>${button('export', 'Export class', 'download')}<span class="avatar" aria-label="Teacher initials">${esc(initials(state.settings.teacher_name))}</span></div></header><main id="main" class="main-content" tabindex="-1"><div class="page-heading"><div><h1>${titles[page]}</h1><p class="subtitle">${subtitles[page]}</p></div>${page === 'students' ? `<div class="heading-actions">${button('registration', 'Import parent reply', 'chat')}${button('add', 'Add student', 'plus', true)}</div>` : ''}</div>${page === 'setup' ? hero() : ''}${page !== 'activity' ? stats() : ''}${pageContent()}<p class="footnote">${icon('shield')}Class records stay in your browser. WhatsApp opens only after your approval. Sending and delivery are not tracked.</p><p class="footer-brand">ClassBridge <span aria-hidden="true">·</span> Built for the people behind the progress.</p></main></div></div>`;
    bindWorkspace();
  }
  function pageContent() {
    if (page === 'setup') return setupPage();
    if (page === 'students') return studentsPage();
    if (page === 'reports') return reportsPage();
    return activityPage();
  }
  function setupPage() {
    const s = state.settings;
    return `<div class="split-grid"><section class="panel"><div class="panel-head"><div><h2>Class details</h2><p>These details appear in every student’s report.</p></div>${badge('Start here', 'neutral')}</div><div class="panel-body"><form id="settings-form"><div class="form-grid">${field('school_name', 'School name', s.school_name, 'required maxlength="160" placeholder="e.g. Green Valley School"')}${field('class_name', 'Class / group name', s.class_name, 'required maxlength="160" placeholder="e.g. Class 6 · Section A"')}${field('teacher_name', 'Teacher name', s.teacher_name, 'required maxlength="160" placeholder="Your name"')}${field('report_period', 'Reporting period', s.report_period, 'required maxlength="160" placeholder="e.g. Week of 19 October"')}<label class="field full">Your WhatsApp number <input name="teacher_phone" type="tel" autocomplete="tel" value="${esc(s.teacher_phone ? '+' + s.teacher_phone : '')}" maxlength="40" placeholder="+ country code and number"><small>Parents send registration and permission to this number. Required only for invitation links.</small></label></div><div class="form-footer"><span class="hint">You can update the reporting period anytime.</span><button class="button primary" type="submit">Save class details ${icon('arrow')}</button></div><div class="error" role="alert"></div></form></div><div class="storage-row"><label class="checkbox"><input type="checkbox" id="remember" ${remember ? 'checked' : ''}><span>Remember this class on this device<small>Use only on a trusted device. This does not sync across devices.</small></span></label><button class="text-button" type="button" data-action="restore">Restore backup</button></div><div class="steps"><div class="step"><span>1</span>Set up your class</div><div class="step"><span>2</span>Invite parents</div><div class="step"><span>3</span>Prepare reports</div><div class="step"><span>4</span>Approve & send</div></div></section><aside class="info-card"><h3>One group. Private updates.</h3><p>Share a registration link in your existing WhatsApp group. Parents reply privately with their details and permission.</p><ol><li>Match each reply to the right student.</li><li>Record homework, results, and concerns.</li><li>Review and approve each private report.</li></ol><hr><h3>Just exploring?</h3><p>Try a fictional class with two students. Demo contacts are blank and cannot open parent chats.</p>${button('demo', 'Load example class', 'users')}<hr><button class="text-button" type="button" data-action="reset">Clear this workspace</button></aside></div>`;
  }
  function studentRows() {
    const query = search.toLocaleLowerCase();
    return reports().filter((r) => [r.student_name, r.student_id, r.parent_name].join(' ').toLocaleLowerCase().includes(query)).map((r) => `<tr><td><div class="student-cell"><span class="student-initial">${esc(initials(r.student_name))}</span><div><strong>${esc(r.student_name)}</strong><small>${esc(r.student_id)}</small></div></div></td><td class="parent-cell">${esc(r.parent_name || 'Not recorded')}<small>${r.parent_phone ? '+' + esc(r.parent_phone) : 'Phone number needed'}</small></td><td>${C.consentFor(state, r) ? badge('Permission recorded', 'ready') : badge(r.parent_phone ? 'Permission needed' : 'Contact needed')}</td><td><button type="button" class="button small" data-edit="${esc(r.student_id)}">Edit & verify</button></td></tr>`).join('');
  }
  function studentsPage() {
    return `<section class="panel"><div class="panel-head"><div><h2>Class roster <span class="hint">(${state.students.length}/45)</span></h2><p>CSV imports never grant permission to contact a parent.</p></div>${button('csv', 'Import CSV', 'upload')}</div><div class="toolbar"><div class="search-wrap">${icon('search')}<input class="search" type="search" id="search" value="${esc(search)}" placeholder="Search student or parent" aria-label="Search students and parents"></div><a class="hint" href="./students.csv" download="students-template.csv">Download CSV template</a></div>${state.students.length ? `<div class="table-wrap"><table><thead><tr><th scope="col">Student</th><th scope="col">Parent / guardian</th><th scope="col">Contact permission</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody id="student-rows">${studentRows()}</tbody></table></div><div id="search-empty" class="empty" hidden>No students match this search.</div>` : `<div class="empty">${icon('users')}<h3>A class starts with its students.</h3><p>Upload the CSV template, add a student, or paste a registration reply received privately from a parent.</p><div class="inline-actions center-actions">${button('csv', 'Import class CSV', 'upload', true)}${button('demo', 'Try example class', 'users')}</div></div>`}</section>${notice('Use your existing WhatsApp group to share the invitation. Parents provide their own contact details. Verify every reply against your school records before approving a parent contact.')}`;
  }
  function reportsPage() {
    const list = reports();
    if (!list.length) return `<section class="panel"><div class="empty">${icon('file')}<h3>Your first reports are a few details away.</h3><p>Save your class details, then add students or import the class CSV to prepare individual reports.</p><button type="button" class="button primary" data-page="students">Go to students ${icon('arrow')}</button></div></section>`;
    return `${notice('Each report opens a <strong>private parent chat</strong>. Review the student, recipient, and full message before approving. Nothing is posted to your class group.')}<div class="report-grid">${list.map((r) => {
      const ready = C.consentFor(state, r), contact = state.contacts[r.student_id];
      return `<article class="report-card"><header><div><h2>${esc(r.student_name)}</h2><p class="meta">${esc(r.student_id)} · ${esc(r.parent_name || 'Parent / guardian')}${r.parent_phone ? ' · +' + esc(r.parent_phone) : ''}</p></div>${badge(ready ? 'Needs your approval' : 'Contact not ready', ready ? 'ready' : '')}</header><pre class="message">${esc(r.message)}</pre><p class="hint">${ready ? 'Parent permission recorded ' + esc(new Date(contact.recorded_at).toLocaleDateString()) + '. Your approval is still required.' : 'Verify this parent and record their permission to enable review.'}</p>${ready ? `<button type="button" class="button primary" data-review="${esc(r.student_id)}">${icon('shield')}Review & approve</button>` : `<button type="button" class="button" data-edit="${esc(r.student_id)}">${icon('users')}Add contact & permission</button>`}</article>`;
    }).join('')}</div>`;
  }
  function activityPage() {
    return `${notice('This log records a request to open WhatsApp after your approval. It cannot confirm whether you pressed Send or whether a message was delivered or read.')}<section class="panel"><div class="panel-head"><div><h2>Approved handoffs</h2><p>${state.events.length} recorded on this device · no automatic retries</p></div>${badge('Manual sending', 'neutral')}</div>${state.events.length ? state.events.slice().reverse().map((event) => `<article class="activity-item"><div><strong>${esc(event.student_name)}</strong><p>${esc(event.student_id)} · +${esc(event.parent_phone)} · <time datetime="${esc(event.at)}">${esc(new Date(event.at).toLocaleString())}</time></p><details><summary>View approved message</summary><pre class="message">${esc(event.message)}</pre></details></div><div class="activity-state">${badge('Sending unverified', 'neutral')}</div></article>`).join('') : `<div class="empty">${icon('clock')}<h3>Nothing has been handed off yet.</h3><p>After you approve a report and request its WhatsApp chat, the action appears here.</p></div>`}</section>`;
  }
  function bindWorkspace() {
    app.onclick = (event) => {
      const target = event.target.closest('button'); if (!target) return;
      if (target.dataset.page) { page = target.dataset.page; search = ''; render(); document.querySelector('#main').focus({ preventScroll: true }); return; }
      if (target.dataset.action) runAction(target.dataset.action);
      if (target.dataset.edit) editStudent(target.dataset.edit);
      if (target.dataset.review) reviewStudent(target.dataset.review);
    };
    const form = document.querySelector('#settings-form');
    if (form) form.onsubmit = (event) => {
      event.preventDefault();
      try {
        const settings = C.settingsFor(Object.fromEntries(new FormData(form)));
        const identityChanged = ['school_name', 'class_name', 'teacher_name', 'teacher_phone'].some((key) => settings[key] !== state.settings[key]);
        state.settings = settings;
        if (identityChanged) state.contacts = Object.create(null);
        persist(); render(); showToast(identityChanged && state.students.length ? 'Class saved. Reconfirm parent permission for the updated class or teacher.' : 'Class details saved. Next, invite parents or add students.');
      } catch (error) { showError(error, form); }
    };
    const rememberBox = document.querySelector('#remember');
    if (rememberBox) rememberBox.onchange = () => { remember = rememberBox.checked; persist(); render(); showToast(remember ? 'This class will be saved in this browser. Export a backup before changing devices.' : 'Saved browser copy removed. Current records remain for this session.'); };
    const searchInput = document.querySelector('#search');
    if (searchInput) searchInput.oninput = () => { search = searchInput.value; document.querySelector('#student-rows')?.replaceChildren(); const body = document.querySelector('#student-rows'); if (body) { body.innerHTML = studentRows(); document.querySelector('#search-empty').hidden = Boolean(body.children.length); } };
  }
  function runAction(action) {
    const actions = { invite: inviteParents, add: () => editStudent(), registration: importRegistration, csv: importCsv, export: exportBackup, restore: restoreBackup, privacy: privacyDialog, help: helpDialog, demo: loadDemo, reset: resetWorkspace };
    try { actions[action]?.(); } catch (error) { showToast(error.message); }
  }
  function openModal(title, subtitle, body, actions = '', submit = null) {
    if (modal.open) modal.close();
    modal.innerHTML = `<form id="modal-form"><div class="modal-head"><div><h2 id="modal-title">${esc(title)}</h2><p>${esc(subtitle)}</p></div><button type="button" class="close" data-close aria-label="Close dialog">×</button></div><div class="modal-body">${body}<div class="error" role="alert"></div></div><div class="modal-actions"><button type="button" class="button" data-close>Cancel</button>${actions}</div></form>`;
    modal.querySelectorAll('[data-close]').forEach((button) => button.onclick = () => modal.close());
    modal.querySelector('form').onsubmit = (event) => { event.preventDefault(); if (submit) { try { submit(event.currentTarget); } catch (error) { showError(error); } } };
    modal.showModal();
  }
  function confirmAction(title, description, action) {
    openModal(title, 'Please review before continuing.', `<p class="hint">${esc(description)}</p>`, '<button class="button primary" type="submit">Continue</button>', () => { modal.close(); action(); });
  }
  function ensureSettings() { try { C.settingsFor(state.settings); } catch { page = 'setup'; render(); throw new Error('Save your class details first, then return to this step.'); } }
  function editStudent(id, registered = null) {
    ensureSettings();
    const existing = state.students.find((student) => student.student_id === id);
    const record = existing || Object.fromEntries(E.CSV_COLUMNS.map((key) => [key, '']));
    const student = { ...record, ...registered };
    const contact = existing ? state.contacts[existing.student_id] : null;
    const alreadyVerified = existing && !registered && C.consentFor(state, C.reportFor(state, existing.student_id));
    openModal(existing ? 'Student details & parent permission' : 'Add a student', 'Match the parent contact with your school records before confirming permission.', `<div class="form-grid">${field('student_id', 'Student ID / roll number', student.student_id, `required maxlength="120" ${existing ? 'readonly' : ''}`)}${field('student_name', 'Student name', student.student_name, 'required maxlength="120"')}${field('parent_name', 'Parent / guardian name', student.parent_name, 'maxlength="120"')}${field('parent_phone', 'Parent WhatsApp number', student.parent_phone ? '+' + C.phone(student.parent_phone) : '', 'type="tel" maxlength="40" placeholder="+ country code and number"')}${field('homework_completed', 'Homework completed', student.homework_completed, 'type="number" min="0" step="1"')}${field('homework_assigned', 'Homework assigned', student.homework_assigned, 'type="number" min="0" step="1"')}<label class="field full">Exam results<textarea name="exam_results" maxlength="1000" placeholder="Mathematics: 38/50; English: 42/50">${esc(student.exam_results)}</textarea></label><label class="field full">Teacher concerns / class behavior<textarea name="teacher_concerns" maxlength="1000" placeholder="Record observed concerns, or leave blank if not recorded.">${esc(student.teacher_concerns)}</textarea></label><label class="field full">Parent support requested<textarea name="parent_action" maxlength="1000">${esc(student.parent_action)}</textarea></label></div>${notice(registered ? 'A registration reply is a <strong>claim</strong>. Confirm that the sender’s WhatsApp number matches the number below and that this is the correct student.' : 'A phone number or group membership alone is not parent permission. Record consent received from the parent.') }<label class="checkbox"><input type="checkbox" name="verified" ${alreadyVerified ? 'checked' : ''}><span>I verified that this number belongs to this student’s parent / guardian.</span></label><label class="checkbox"><input type="checkbox" name="opt_in" ${alreadyVerified ? 'checked' : ''}><span>The parent agreed to receive private student progress reports on WhatsApp. They can withdraw by telling me to stop.</span></label><label class="field consent-evidence">Permission record<input name="evidence" value="${esc(registered ? 'Parent registration received privately in WhatsApp; sender checked by teacher.' : contact?.evidence || '')}" maxlength="240" placeholder="e.g. Parent’s WhatsApp reply on 20 October"><small>Required when permission is checked. Keep the original parent reply in WhatsApp.</small></label>`, `${existing ? '<button class="button danger" type="button" id="remove-student">Remove student</button>' : ''}<button class="button primary" type="submit">Save student</button>`, (form) => {
      const data = new FormData(form), updated = Object.fromEntries(E.CSV_COLUMNS.map((key) => [key, String(data.get(key) || '').trim()]));
      if (updated.parent_phone) updated.parent_phone = C.phone(updated.parent_phone);
      const students = existing ? state.students.map((item) => item.student_id === id ? updated : item) : [...state.students, updated];
      E.buildReports(C.tableFor(students), state.settings);
      const verified = data.get('verified') === 'on', optIn = data.get('opt_in') === 'on', evidence = String(data.get('evidence') || '').trim();
      if ((verified || optIn) && (!verified || !optIn || !updated.parent_phone || !evidence)) throw new Error('To record permission, provide a parent number, both confirmations, and a permission record. Uncheck both to save without permission.');
      const consent = verified && optIn ? { phone: updated.parent_phone, parent_name: updated.parent_name, student_name: updated.student_name, verified: true, opt_in: true, evidence, recorded_at: new Date().toISOString() } : null;
      state.students = students;
      if (consent) state.contacts[updated.student_id] = consent; else delete state.contacts[updated.student_id];
      persist(); modal.close(); render(); showToast(consent ? 'Parent permission recorded. Each report still needs your approval.' : 'Student saved. Parent contact permission is not recorded.');
    });
    if (existing) document.querySelector('#remove-student').onclick = () => confirmAction('Remove this student?', 'This removes the student and their contact permission from the current class.', () => { state.students = state.students.filter((student) => student.student_id !== id); delete state.contacts[id]; persist(); render(); showToast('Student removed.'); });
    for (const name of ['student_name', 'parent_name', 'parent_phone']) modal.querySelector(`[name="${name}"]`).addEventListener('input', () => { modal.querySelector('[name="verified"]').checked = false; modal.querySelector('[name="opt_in"]').checked = false; });
  }
  function reviewStudent(id) {
    try {
      const reviewed = C.reviewFor(state, id);
      openModal('Approve this private report', 'Permission applies only to the student, parent, and exact message shown below.', `<h3>${esc(reviewed.student_name)} <span class="hint">${esc(reviewed.student_id)}</span></h3><p class="hint">To: ${esc(reviewed.parent_name || 'Parent / guardian')} · <strong>+${esc(reviewed.parent_phone)}</strong></p><pre class="message">${esc(reviewed.message)}</pre>${notice('After approval, WhatsApp opens a private draft. Verify the recipient again and press <strong>Send</strong> in WhatsApp. This tool cannot confirm delivery.')}<label class="checkbox"><input id="approve-message" type="checkbox"><span>I checked this student, parent number, and complete report. I approve opening <strong>this individual message</strong> in WhatsApp.</span></label>`, '<button class="button primary" type="submit" id="open-whatsapp" disabled>Approve & open WhatsApp</button>', () => {
        const approved = C.authorizeReview(state, reviewed, document.querySelector('#approve-message').checked);
        window.open(approved.url, '_blank', 'noopener,noreferrer');
        state.events.push(approved.event); state.events = state.events.slice(-500);
        persist(); modal.close(); render(); showToast('WhatsApp handoff requested. Sending is unverified. If no tab opened, allow pop-ups and review again.');
      });
      document.querySelector('#approve-message').onchange = (event) => { document.querySelector('#open-whatsapp').disabled = !event.target.checked; };
    } catch (error) { showToast(error.message); }
  }
  function inviteParents() {
    ensureSettings();
    const link = C.invitation(state.settings, location.href);
    const text = `Hello parents of ${state.settings.class_name}, ${state.settings.school_name}. Please register your student and your permission to receive private progress reports from ${state.settings.teacher_name}. Open this link, check the teacher number, and send your registration privately in WhatsApp.\n\n${link}\n\nYou can withdraw permission by replying STOP to the teacher.`;
    openModal('Invite parents from your WhatsApp group', 'You choose the existing group in WhatsApp. ClassBridge does not read group contacts.', `<label class="field">Parent registration link<textarea id="invite-link" readonly rows="4">${esc(link)}</textarea></label><div class="inline-actions">${button('copy-link', 'Copy link', 'link')}</div><h3 class="section-label">Group invitation preview</h3><pre class="message">${esc(text)}</pre><p class="hint">Registration replies go privately to <strong>+${esc(state.settings.teacher_phone)}</strong>. The link includes your school, class, teacher name, and this number.</p><label class="checkbox"><input type="checkbox" id="approve-invite"><span>I approve sharing this invitation with my class group. I will choose the group and press Send in WhatsApp.</span></label>`, '<button class="button primary" type="submit" id="share-invite" disabled>Approve & choose group in WhatsApp</button>', () => {
      if (!document.querySelector('#approve-invite').checked) throw new Error('Approve the group invitation first.');
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer'); modal.close(); showToast('Choose your class group and press Send in WhatsApp.');
    });
    modal.querySelector('[data-action="copy-link"]').onclick = async () => { try { await navigator.clipboard.writeText(link); showToast('Parent registration link copied.'); } catch { document.querySelector('#invite-link').focus(); document.querySelector('#invite-link').select(); showToast('Select and copy the registration link.'); } };
    document.querySelector('#approve-invite').onchange = (event) => { document.querySelector('#share-invite').disabled = !event.target.checked; };
  }
  function importRegistration() {
    ensureSettings();
    openModal('Import a parent’s private reply', 'Copy the complete registration message you received from the parent in WhatsApp.', '<label class="field">Registration message<textarea id="parent-reply" rows="9" placeholder="CLASSBRIDGE PARENT REGISTRATION…" required></textarea></label><p class="hint">Next, you will match the sender to the student and confirm the parent’s permission. Pasting alone grants no permission.</p>', '<button class="button primary" type="submit">Review parent details</button>', () => {
      const data = C.parseRegistration(document.querySelector('#parent-reply').value.replace(/\r\n/g, '\n').trim(), state.settings);
      const existing = state.students.find((student) => student.student_id.toLowerCase() === data.student_id.toLowerCase());
      if (existing) data.student_id = existing.student_id;
      editStudent(existing?.student_id, data);
    });
  }
  async function chooseFile(accept, maxSize, handler) {
    const input = document.createElement('input'); input.type = 'file'; input.accept = accept;
    input.onchange = async () => { const file = input.files[0]; if (!file) return; try { if (file.size > maxSize) throw new Error('This file is too large. Choose a smaller class file.'); handler(await file.text()); } catch (error) { showToast(error.message); } }; input.click();
  }
  function importCsv() {
    ensureSettings();
    chooseFile('.csv,text/csv', 1024 * 1024, (input) => {
      const students = C.studentsFromCsv(input, state.settings);
      const apply = () => { state.students = students; state.contacts = Object.create(null); persist(); page = 'students'; render(); showToast(`${students.length} students imported. Verify each parent and record permission before opening reports.`); };
      if (state.students.length) confirmAction('Replace the class roster?', 'The CSV will replace all current students and clear their permission records. Export your current class first if you need a backup.', apply); else apply();
    });
  }
  function download(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type })), anchor = document.createElement('a');
    anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportBackup() {
    ensureSettings();
    download('classbridge-class-backup.json', JSON.stringify(state, null, 2), 'application/json');
    showToast('Backup downloaded. It contains private student records; store it securely.');
  }
  function restoreBackup() {
    chooseFile('.json,application/json', 2 * 1024 * 1024, (input) => {
      const restored = C.restoreBackup(input);
      confirmAction('Restore this class backup?', 'This replaces the current class. Parent permissions must be reconfirmed after restoring; imported backups cannot authorize messages.', () => { state = restored; persist(); page = 'students'; render(); showToast('Class restored. Reconfirm parent contacts and permission.'); });
    });
  }
  function loadDemo() {
    const apply = () => {
      state = { version: 1, settings: { school_name: 'Example School', class_name: '6 A', teacher_name: 'Example Teacher', report_period: 'Example week', teacher_phone: '' }, students: [
        { student_id: 'STU001', student_name: 'Aarav (example)', parent_name: 'Parent One', parent_phone: '', homework_completed: '4', homework_assigned: '5', exam_results: 'Mathematics: 38/50; English: 42/50', teacher_concerns: 'One homework assignment is pending.', parent_action: 'Please help complete the pending assignment by Friday.' },
        { student_id: 'STU002', student_name: 'Sara (example)', parent_name: 'Parent Two', parent_phone: '', homework_completed: '5', homework_assigned: '5', exam_results: 'Mathematics: 45/50; English: 44/50', teacher_concerns: 'None reported.', parent_action: 'Please continue the regular reading practice.' },
      ], contacts: Object.create(null), events: [] };
      persist(); page = 'students'; render(); showToast('Fictional example loaded. Parent phone numbers are blank.');
    };
    if (state.students.length || state.settings.school_name) confirmAction('Load the example class?', 'This replaces your current workspace. Export your class first if you want to keep it.', apply); else apply();
  }
  function resetWorkspace() {
    confirmAction('Clear this workspace?', 'This removes this class and saved browser records. Export a backup first if you need them. WhatsApp conversations are unaffected.', () => { state = { version: 1, settings: { school_name: '', class_name: '', teacher_name: '', report_period: '', teacher_phone: '' }, students: [], contacts: Object.create(null), events: [] }; remember = false; persist(); page = 'setup'; render(); showToast('Workspace cleared.'); });
  }
  function privacyDialog() {
    openModal('Your class records stay with you', 'How ClassBridge handles student and parent information.', `<div class="privacy-copy"><h3>On your device</h3><p>The app processes CSV files, names, parent numbers, progress records, and permission notes in this browser. It makes no background API requests and has no analytics. Hosting providers still receive ordinary page requests and may keep access logs.</p><p>Records last for this session unless you enable “Remember this class on this device”. Browser storage is not encrypted by the app and does not sync. Use a trusted device, export backups carefully, and clear the workspace on shared devices.</p><h3>When you share or send</h3><p>The invitation contains your school, class, teacher name, and teacher number. Parents should confirm those details with their school. Parent registrations open a private teacher chat. Approved reports open the individual parent’s chat; their content is passed to WhatsApp in the draft link.</p><h3>Parent permission and withdrawal</h3><p>Parents can withdraw by replying STOP or asking the teacher to stop. The teacher must immediately uncheck both contact confirmation boxes for that student. ClassBridge cannot read WhatsApp replies or automatically process STOP messages.</p><h3>Your responsibility as the teacher</h3><p>Verify recipients, use accurate records, collect the appropriate parent permission, and send only the individual report. Permissions imported from a backup must be confirmed again.</p></div>`, '');
  }
  function helpDialog() {
    openModal('From your class group to a private update', 'Works with standard WhatsApp. No Business API account is required.', '<div class="privacy-copy"><ol><li>Save your school, class, teacher, reporting period, and teacher WhatsApp number.</li><li>Open “Invite parents from your group”. Review the invitation, approve it, then choose your group and send it in WhatsApp.</li><li>Parents open the link, enter their details, and send a registration privately to the teacher.</li><li>Paste each registration into “Import parent reply”, match the number and student with your records, and confirm parent permission. You may also import your own class CSV.</li><li>Fill in each student’s homework, results, behavior observations, and requested support.</li><li>Open “Reports & approvals”, review a report, and approve that individual message. In WhatsApp, check the recipient and press Send.</li></ol><p>The tool cannot read an existing group’s member list or messages. It cannot confirm delivery. Use “Export class” and “Restore backup” to move between devices.</p></div>', '');
  }
  function renderParent() {
    let invite;
    try { invite = C.parseInvitation(location.hash); }
    catch (error) { app.innerHTML = `<main class="parent-page"><h1>Registration link unavailable</h1><p>${esc(error.message)}</p><a class="button" href="./">Open teacher workspace</a></main>`; return; }
    app.innerHTML = `<main id="main" class="parent-page"><a class="brand" href="./"><span class="brand-mark">${icon('bridge')}</span>ClassBridge</a><header class="parent-banner"><span class="eyebrow">A closer school community</span><h1>Your child’s progress.<br>A private conversation.</h1><p>Register to receive individual student updates from your teacher in WhatsApp.</p></header><section class="panel"><div class="panel-head"><div><h2>${esc(invite.school_name)}</h2><p>${esc(invite.class_name)} · ${esc(invite.teacher_name)}</p></div>${badge('Parent registration', 'ready')}</div><div class="panel-body"><form id="parent-form"><div class="form-grid">${field('student_id', 'Student ID / roll number', '', 'required maxlength="120" autocomplete="off"')}${field('student_name', 'Student’s full name', '', 'required maxlength="120" autocomplete="off"')}${field('parent_name', 'Your name (parent / guardian)', '', 'required maxlength="120" autocomplete="name"')}${field('parent_phone', 'Your WhatsApp number', '', 'required maxlength="40" type="tel" autocomplete="tel" placeholder="+ country code and number"')}</div>${notice(`Your registration goes privately to <strong>${esc(invite.teacher_name)} at +${esc(invite.teacher_phone)}</strong>. Confirm this teacher and number with your school before sending.`)}<label class="checkbox"><input type="checkbox" name="consent" required><span>${esc(C.CONSENT)}</span></label><p class="hint parent-note">Your teacher will verify the student and contact before sending reports. This page does not verify school or teacher identity.</p><button class="button primary" type="submit">Review my registration ${icon('arrow')}</button><div class="error" role="alert"></div></form></div></section><p class="footnote">${icon('shield')}Your details stay in this browser until you choose to send them in WhatsApp. They are not saved by this page.</p><p class="footer-brand">ClassBridge · Private updates. Personal connections.</p></main>`;
    document.querySelector('#parent-form').onsubmit = (event) => {
      event.preventDefault(); const form = event.currentTarget;
      try {
        const data = Object.fromEntries(new FormData(form));
        const message = C.registrationText(invite, data, data.consent === 'on');
        openModal('Review your parent registration', `Private reply to ${invite.teacher_name} · +${invite.teacher_phone}`, `<pre class="message">${esc(message)}</pre>${notice('Open the teacher’s private WhatsApp chat, verify the number, and press Send. If this is not your teacher, cancel.')}<label class="checkbox"><input type="checkbox" id="approve-registration"><span>I checked the teacher’s number and approve opening this registration in WhatsApp.</span></label>`, '<button class="button primary" id="send-registration" type="submit" disabled>Approve & open teacher chat</button>', () => {
          if (!document.querySelector('#approve-registration').checked) throw new Error('Confirm the teacher before continuing.');
          window.open(`https://wa.me/${invite.teacher_phone}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer'); modal.close(); showToast('Check the teacher number and press Send in WhatsApp.');
        });
        document.querySelector('#approve-registration').onchange = (change) => { document.querySelector('#send-registration').disabled = !change.target.checked; };
      } catch (error) { showError(error, form); }
    };
  }
  window.addEventListener('hashchange', () => { if (modal.open) modal.close(); if (location.hash.startsWith('#join=')) renderParent(); else render(); });
  document.querySelector('#footer-help').onclick = helpDialog;
  document.querySelector('#footer-privacy').onclick = privacyDialog;
  document.querySelector('#footer-reset').onclick = () => { if (location.hash.startsWith('#join=')) showToast('Ask your teacher to update or remove your registration in their workspace.'); else resetWorkspace(); };
  if (location.hash.startsWith('#join=')) renderParent(); else { loadSaved(); render(); }
})();
