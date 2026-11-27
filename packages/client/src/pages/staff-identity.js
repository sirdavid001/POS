import { registerDelete, registerGet, registerPatch, registerPost } from '../register-badge.js';
import { escapeAttribute, escapeHTML, toast } from '../utils.js';

const roles = { admin: 'Store admin', manager: 'Manager', cashier: 'Cashier' };
const validPhoto = (value) => /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value || '');

function makeDialog(title, markup) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<section class="modal staff-identity-dialog" role="dialog" aria-modal="true" aria-labelledby="staff-dialog-title">
    <header class="staff-identity-header">
      <h2 id="staff-dialog-title">${escapeHTML(title)}</h2>
      <button type="button" class="btn btn-ghost" data-dialog-close>Close</button>
    </header>
    ${markup}
  </section>`;
  overlay.querySelector('[data-dialog-close]').addEventListener('click', () => overlay.remove());
  document.body.append(overlay);
  return overlay;
}

async function resizePhoto(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
    throw new Error('Choose a PNG, JPG or WebP under 5 MB.');
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, 300 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    const photo = canvas.toDataURL('image/jpeg', 0.85);
    if (!validPhoto(photo) || photo.length > 180000) throw new Error('That photo could not be resized. Try a smaller photo.');
    return photo;
  } finally { URL.revokeObjectURL(url); }
}

const avatar = (profile) => validPhoto(profile.staff_photo)
  ? `<img src="${escapeAttribute(profile.staff_photo)}" alt="">`
  : `<span aria-hidden="true">${escapeHTML((profile.name || '?').trim().charAt(0).toUpperCase())}</span>`;

function bindBusyForm(form, action) {
  const status = form.querySelector('[role=status]');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.submitter || form.querySelector('[type=submit]');
    if (button.disabled) return;
    button.disabled = true;
    status.textContent = 'Saving…';
    try { await action(new FormData(form)); }
    catch (error) { status.textContent = error.message || 'Could not save. Try again.'; }
    finally { button.disabled = false; }
  });
}

export async function openStaffProfile({ id, self = false, onUpdate } = {}) {
  const profile = (await registerGet(id ? `/profiles/${id}` : '/profile')).profile;
  const overlay = makeDialog(self ? 'My profile' : 'Staff profile', `
    <div class="staff-profile-summary">
      <div class="staff-photo" data-staff-photo>${avatar(profile)}</div>
      <div><strong>${escapeHTML(profile.name)}</strong><p>${escapeHTML(profile.store_name)} • ${escapeHTML(roles[profile.role] || profile.role)}</p></div>
    </div>
    <form data-staff-profile-form>
      <div class="form-group">
        <label class="label" for="profile-photo-file">Profile photo</label>
        <input class="input" id="profile-photo-file" type="file" accept="image/png,image/jpeg,image/webp">
        <button type="button" class="btn btn-ghost" data-remove-photo>Remove photo</button>
      </div>
      <div class="form-group"><label class="label" for="staff-full-name">Full name</label><input class="input" id="staff-full-name" name="name" autocomplete="name" maxlength="255" value="${escapeAttribute(profile.name)}" required></div>
      <div class="form-group"><label class="label" for="staff-phone">Phone</label><input class="input" type="tel" id="staff-phone" name="phone" autocomplete="tel" maxlength="50" value="${escapeAttribute(profile.phone || '')}"></div>
      <div class="form-group"><label class="label" for="staff-email">Email</label><input class="input" type="email" id="staff-email" name="email" autocomplete="email" maxlength="255" value="${escapeAttribute(profile.email)}" required ${self ? '' : 'readonly'}></div>
      ${self ? '<div class="form-group" data-email-password hidden><label class="label" for="profile-current-password">Current password to change your sign-in email</label><input class="input" id="profile-current-password" type="password" name="current_password" autocomplete="current-password"></div>' : '<p class="field-help">Staff can change their sign-in email from My profile.</p>'}
      <div class="register-actions"><button type="submit" class="btn btn-primary">Save profile</button><p role="status" class="register-message"></p></div>
    </form>
  `);
  const form = overlay.querySelector('[data-staff-profile-form]');
  const status = form.querySelector('[role=status]');
  const photoPreview = overlay.querySelector('[data-staff-photo]');
  const photoInput = overlay.querySelector('#profile-photo-file');
  const submit = form.querySelector('[type=submit]');
  let photo;
  let photoChange = 0;
  photoInput.addEventListener('change', async () => {
    const file = photoInput.files?.[0];
    if (!file) return;
    const revision = ++photoChange;
    submit.disabled = true;
    status.textContent = 'Resizing photo…';
    try {
      const resized = await resizePhoto(file);
      if (photoChange !== revision) return;
      photo = resized;
      photoPreview.innerHTML = avatar({ ...profile, staff_photo: photo });
      status.textContent = 'Photo ready. Save your profile to apply it.';
    } catch (error) { if (photoChange === revision) status.textContent = error.message || 'Could not read this photo.'; }
    finally { if (photoChange === revision) submit.disabled = false; }
  });
  overlay.querySelector('[data-remove-photo]').addEventListener('click', () => {
    photoChange++;
    photo = null;
    photoInput.value = '';
    photoPreview.innerHTML = avatar({ ...profile, staff_photo: null });
    submit.disabled = false;
    status.textContent = 'Save your profile to remove the photo.';
  });
  const passwordGroup = form.querySelector('[data-email-password]');
  form.elements.email.addEventListener('input', () => {
    if (!passwordGroup) return;
    passwordGroup.hidden = form.elements.email.value.trim().toLowerCase() === profile.email;
    form.elements.current_password.required = !passwordGroup.hidden;
    if (passwordGroup.hidden) form.elements.current_password.value = '';
  });
  bindBusyForm(form, async (data) => {
    const { profile: saved } = await registerPatch(`/profiles/${profile.id}`, {
      name: data.get('name'), phone: data.get('phone'), email: data.get('email'), photo,
      current_password: passwordGroup && !passwordGroup.hidden ? data.get('current_password') : undefined,
    });
    if (self) {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      if (user.id === saved.id) localStorage.setItem('user', JSON.stringify({ ...user, name: saved.name, email: saved.email }));
    }
    overlay.remove();
    toast('Staff profile saved.', 'success');
    onUpdate?.();
  });
}

export function openSupervisorPin({ enabled, onUpdate }) {
  const overlay = makeDialog('Supervisor PIN', `
    <p class="settings-help">Use a personal PIN to approve basket changes when you don’t have your badge. Never share it with cashiers.</p>
    <form>
      <div class="form-group"><label class="label" for="supervisor-pin-new">New eight-digit PIN</label>
        <input class="input" id="supervisor-pin-new" name="pin" type="password" inputmode="numeric" pattern="[0-9]{8}" minlength="8" maxlength="8" autocomplete="off" required></div>
      <div class="form-group"><label class="label" for="supervisor-pin-password">Current account password</label>
        <input class="input" id="supervisor-pin-password" name="password" type="password" autocomplete="current-password" required></div>
      <div class="register-actions">
        <button type="submit" class="btn btn-primary">Save PIN</button>
        ${enabled ? '<button type="button" class="btn btn-ghost" data-remove-pin>Remove PIN</button>' : ''}
      </div>
      <p role="status" class="register-message"></p>
    </form>`);
  const form = overlay.querySelector('form');
  const save = async (pin, password) => {
    await registerPatch('/supervisor-pin', { pin, password });
    overlay.remove();
    toast(pin ? 'Supervisor PIN saved.' : 'Supervisor PIN removed.', 'success');
    onUpdate?.();
  };
  bindBusyForm(form, (data) => save(data.get('pin'), data.get('password')));
  overlay.querySelector('[data-remove-pin]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    if (!form.elements.password.reportValidity()) return;
    button.disabled = true;
    try { await save(null, form.elements.password.value); }
    catch (error) { form.querySelector('[role=status]').textContent = error.message; }
    finally { button.disabled = false; }
  });
}

function showBadgeCard(overlay, profile, token, barcode) {
  const panel = overlay.querySelector('[data-badge-content]');
  panel.innerHTML = `
    <p class="settings-help">Print or save this card now. The barcode won’t be shown again. Treat it like a key to the register.</p>
    <div class="staff-card-sheet">
      <section class="staff-card-face staff-card-front" aria-label="Front of staff card">
        <div class="staff-card-store"><img src="./brand/quickpos-mark.svg" alt="" width="20" height="20"><strong>${escapeHTML(profile.store_name)}</strong></div>
        <div class="staff-card-person"><div class="staff-card-photo">${avatar(profile)}</div><div>
          <h3>${escapeHTML(profile.name)}</h3><p>${escapeHTML(roles[profile.role] || profile.role)}</p>
        </div></div>
        <span>QuickPOS staff identification</span>
      </section>
      <section class="staff-card-face staff-card-back" aria-label="Back of staff card">
        <strong>Register access</strong>
        <svg data-print-barcode role="img" aria-label="Staff badge barcode"></svg>
        <span>If found, return this card to ${escapeHTML(profile.store_name)}.</span>
      </section>
    </div>
    <button type="button" class="btn btn-primary" data-print-card>Print or save as PDF</button>
    <p class="field-help">Print both sides at actual size. Use Print → Save as PDF to keep a copy.</p>`;
  const svg = panel.querySelector('[data-print-barcode]');
  barcode(svg, token, { format: 'CODE128', displayValue: false, width: 2, height: 55, margin: 20, marginTop: 6, marginBottom: 6 });
  panel.querySelector('[data-print-card]').addEventListener('click', () => {
    document.body.classList.add('staff-card-printing');
    try { window.print(); }
    finally { document.body.classList.remove('staff-card-printing'); }
  });
}

export async function openStaffBadge({ id, onUpdate }) {
  const { profile } = await registerGet(`/profiles/${id}`);
  const overlay = makeDialog('Staff ID card', `
    <div class="staff-profile-summary"><div class="staff-photo">${avatar(profile)}</div><div>
      <strong>${escapeHTML(profile.name)}</strong>
      <p>${escapeHTML(roles[profile.role] || profile.role)} • ${profile.staff_badge_issued_at ? 'Badge active' : 'No active badge'}</p>
    </div></div>
    <div data-badge-content>
      <p class="settings-help">${profile.staff_badge_issued_at ? 'Issuing a replacement immediately invalidates the current card and its register access.' : 'Issue a printable card for this staff member.'}</p>
      <div class="register-actions">
        <button class="btn btn-primary" type="button" data-issue-badge ${profile.is_active ? '' : 'disabled'}>${profile.staff_badge_issued_at ? 'Replace and print badge' : 'Issue and print badge'}</button>
        ${profile.staff_badge_issued_at ? '<button class="btn btn-ghost" type="button" data-revoke-badge>Revoke badge</button>' : ''}
      </div>
      <p role="status" class="register-message"></p>
    </div>`);
  const status = overlay.querySelector('[role=status]');
  const actions = [...overlay.querySelectorAll('[data-badge-content] button')];
  async function run(work) {
    if (actions.some((button) => button.disabled)) return;
    actions.forEach((button) => { button.disabled = true; });
    status.textContent = 'Working…';
    try { await work(); }
    catch (error) { status.textContent = error.message || 'Could not update this badge.'; }
    finally { actions.forEach((button) => { button.disabled = false; }); }
  }
  overlay.querySelector('[data-issue-badge]').addEventListener('click', () => run(async () => {
    const { default: barcode } = await import('jsbarcode');
    const { badge, profile: issued } = await registerPost(`/badges/${profile.id}`, {});
    if (overlay.isConnected) showBadgeCard(overlay, issued, badge, barcode);
    onUpdate?.();
  }));
  overlay.querySelector('[data-revoke-badge]')?.addEventListener('click', () => run(async () => {
    if (!window.confirm(`Revoke ${profile.name}’s current badge?`)) { status.textContent = ''; return; }
    await registerDelete(`/badges/${profile.id}`);
    overlay.remove();
    toast('Badge revoked.', 'success');
    onUpdate?.();
  }));
}

const labels = {
  account_login: 'Signed in', register_opened: 'Opened register', register_closed: 'Closed register',
  basket_reduced: 'Removed basket items', basket_cleared: 'Cleared basket', sale_completed: 'Completed sale',
  sale_refunded: 'Refunded sale', staff_profile_updated: 'Updated staff profile', staff_badge_issued: 'Issued staff badge',
  staff_badge_revoked: 'Revoked staff badge', supervisor_pin_changed: 'Changed supervisor PIN', register_policy_changed: 'Changed badge checkout',
};

function eventDetail(event) {
  if (event.approver_name) {
    const items = Array.isArray(event.items) ? event.items : [];
    const summary = items.slice(0, 3).map(({ quantity, name, product_id: id }) => `${quantity} × ${name || `item ${id}`}`).join(', ');
    return `${summary}${items.length > 3 ? ` + ${items.length - 3} more` : ''} · Approved by ${event.approver_name} (${event.approval_method === 'pin' ? 'PIN' : 'badge'})`;
  }
  if (event.order_number) return `${event.order_number}${event.reason ? ` · ${event.reason}` : ''}`;
  if (event.subject_name) return event.subject_name;
  if (event.enabled) return event.enabled === 'true' ? 'Turned on' : 'Turned off';
  return '—';
}

export function mountActivity(panel) {
  if (!panel || panel.dataset.mounted) return;
  panel.dataset.mounted = 'true';
  panel.innerHTML = `
    <h2>Store activity</h2>
    <p class="settings-help">See staff sign-ins, sales and refunds, badge changes, and who approved register removals.</p>
    <div class="activity-controls">
      <div><label for="activity-action" class="label">Event type</label>
        <select id="activity-action" class="input"><option value="">All events</option>${Object.entries(labels).map(([value, label]) => `<option value="${value}">${escapeHTML(label)}</option>`).join('')}</select>
      </div>
      <button type="button" class="btn btn-ghost" data-activity-refresh>Refresh activity</button>
    </div>
    <p role="status" class="register-message"></p>
    <div class="table-scroll-wrapper" tabindex="0" aria-label="Store activity results">
      <table class="data-table staff-activity">
        <thead><tr><th scope="col">When</th><th scope="col">Staff member</th><th scope="col">Action</th><th scope="col">Details</th></tr></thead>
        <tbody></tbody>
      </table>
    </div>
    <button type="button" class="btn btn-ghost" data-activity-more hidden>Load older activity</button>`;
  const rows = panel.querySelector('tbody');
  const status = panel.querySelector('[role=status]');
  const next = panel.querySelector('[data-activity-more]');
  const type = panel.querySelector('select');
  let before = null;
  let generation = 0;
  async function load(append = false) {
    const current = ++generation;
    next.disabled = true;
    status.textContent = 'Loading activity…';
    const query = new URLSearchParams();
    if (type.value) query.set('action', type.value);
    if (append && before) query.set('before', before);
    try {
      const { events, next: cursor } = await registerGet(`/activity?${query}`);
      if (current !== generation || !panel.isConnected) return;
      before = cursor;
      if (!append) rows.replaceChildren();
      rows.insertAdjacentHTML('beforeend', events.map((event) => `
        <tr>
          <td><time datetime="${escapeAttribute(event.created_at)}">${escapeHTML(new Date(event.created_at).toLocaleString())}</time></td>
          <td><strong>${escapeHTML(event.actor_name || 'System')}</strong><small>${escapeHTML(roles[event.actor_role] || event.actor_role || '')}</small></td>
          <td>${escapeHTML(labels[event.action] || event.action)}</td>
          <td>${escapeHTML(eventDetail(event))}</td>
        </tr>`).join(''));
      next.hidden = !cursor;
      status.textContent = rows.children.length ? `${rows.children.length} events shown` : 'No matching activity yet.';
    } catch (error) { if (current === generation) status.textContent = error.message || 'Could not load activity. Try again.'; }
    finally { if (current === generation) next.disabled = false; }
  }
  type.addEventListener('change', () => { rows.replaceChildren(); next.hidden = true; load(); });
  next.addEventListener('click', () => load(true));
  panel.querySelector('[data-activity-refresh]').addEventListener('click', () => load());
  load();
}
