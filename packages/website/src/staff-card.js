import './staff-card.css';

const titles = { admin: 'Store admin', manager: 'Manager', cashier: 'Cashier' };
const tag = (name, className, value) => {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
};

function cardSheet(profile, badge, barcode) {
  const sheet = tag('div', 'site-card-sheet');
  const front = tag('section', 'site-card-face site-card-front');
  const back = tag('section', 'site-card-face');
  front.setAttribute('aria-label', 'Front of staff card');
  back.setAttribute('aria-label', 'Back of staff card');
  const photo = tag('div', 'site-card-photo', profile.name.trim().charAt(0).toUpperCase());
  if (/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(profile.staff_photo || '')) {
    const img = tag('img');
    img.alt = '';
    img.src = profile.staff_photo;
    photo.replaceChildren(img);
  }
  photo.setAttribute('aria-hidden', 'true');
  const identity = tag('div');
  identity.append(tag('strong', '', profile.name), tag('p', '', titles[profile.role] || 'Staff'));
  const person = tag('div', 'site-card-person');
  person.append(photo, identity);
  front.append(tag('strong', 'site-card-store', profile.store_name), person, tag('span', '', 'QuickPOS staff identification'));

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Staff badge barcode');
  barcode(svg, badge, { format: 'CODE128', displayValue: false, width: 2, height: 55, margin: 20, marginTop: 6, marginBottom: 6 });
  const size = [svg.getAttribute('width'), svg.getAttribute('height')].map(parseFloat);
  if (size.every(Number.isFinite)) svg.setAttribute('viewBox', `0 0 ${size.join(' ')}`);
  back.append(tag('strong', '', 'Register access'), svg, tag('span', '', `If found, return this card to ${profile.store_name}.`));
  sheet.append(front, back);
  return sheet;
}

export async function openWebsiteStaffCard(api, id, opener) {
  const uri = `/register-control/badges/${id}`;
  const { profile } = await api.get(uri);
  if (!opener.isConnected || document.querySelector('.site-card-dialog[open]')) return;
  const modal = tag('dialog', 'site-card-dialog');
  modal.setAttribute('aria-labelledby', 'site-staff-card-title');
  const heading = tag('h2', '', `ID card for ${profile.name}`);
  heading.id = 'site-staff-card-title';
  const close = tag('button', 'staff-action-button', 'Close');
  close.type = 'button';
  close.autofocus = true;
  const header = tag('header', 'site-card-dialog-header');
  header.append(heading, close);
  const desc = tag('p', 'account-muted', !profile.is_active ? 'Reactivate this staff account before issuing another card.'
    : profile.staff_badge_issued_at ? 'Replacing this card invalidates the current barcode immediately.'
      : 'Issue a card, then print or save both sides. The barcode is shown only when a card is issued.');
  const status = tag('p', 'site-card-status');
  status.setAttribute('role', 'status');
  const actions = tag('div', 'site-card-actions');
  const issue = tag('button', 'button', profile.staff_badge_issued_at ? 'Replace card' : 'Issue card');
  issue.type = 'button';
  actions.append(issue);
  issue.disabled = !profile.is_active;
  const revoke = tag('button', 'staff-action-button', 'Revoke card');
  revoke.type = 'button';
  if (profile.staff_badge_issued_at) actions.append(revoke);
  const body = tag('div');
  body.append(desc, actions);
  modal.append(header, status, body);
  document.body.append(modal);

  let busy = false;
  function hideCard() {
    document.body.classList.remove('site-card-printing');
    modal.remove();
    if (opener.isConnected) opener.focus();
  }
  function finishPrint() {
    document.body.classList.remove('site-card-printing');
  }
  close.addEventListener('click', () => { if (!busy) modal.close(); });
  modal.addEventListener('cancel', (event) => { if (busy) event.preventDefault(); });
  modal.addEventListener('close', hideCard, { once: true });
  async function run(action) {
    if (busy) return;
    busy = true;
    [issue, revoke, close].forEach(button => { button.disabled = true; });
    status.textContent = 'Working…';
    try { await action(); }
    catch (error) { status.textContent = error.message || 'Could not update this card. Try again.'; }
    finally {
      busy = false;
      [revoke, close].forEach(button => { button.disabled = false; });
      issue.disabled = !profile.is_active;
    }
  }
  issue.addEventListener('click', () => {
    if (profile.staff_badge_issued_at && !window.confirm('Replace the active card? The previous barcode will stop working.')) return;
    run(async () => {
      const { default: barcode } = await import('jsbarcode');
      const { badge, profile: issued } = await api.post(uri, {});
      const sheet = cardSheet(issued, badge, barcode);
      const print = tag('button', 'button', 'Print or save as PDF');
      print.type = 'button';
      const note = tag('p', 'account-muted', 'Print at actual size or choose Save as PDF. Keep the barcode private.');
      body.replaceChildren(note, sheet, print);
      status.textContent = 'Card issued. Both sides are ready to print.';
      print.addEventListener('click', () => {
        document.body.classList.add('site-card-printing');
        try { window.print(); } finally { finishPrint(); }
      });
      print.focus();
    });
  });
  revoke.addEventListener('click', () => {
    if (!window.confirm('Revoke this card? The barcode will stop working immediately.')) return;
    run(async () => {
      await api.delete(uri);
      profile.staff_badge_issued_at = null;
      revoke.remove();
      issue.textContent = 'Issue card';
      desc.textContent = 'Issue a replacement when the staff member needs a new card.';
      status.textContent = 'Card revoked.';
      close.disabled = false;
      close.focus();
    });
  });
  // Never keep a credential preview visible after leaving Staff or signing out.
  const closeOnNavigation = () => { if (modal.open) modal.close(); };
  const observers = new AbortController();
  window.addEventListener('hashchange', closeOnNavigation, { signal: observers.signal });
  window.addEventListener('quickpos:session-change', () => {
    if (!api.accessToken) closeOnNavigation();
  }, { signal: observers.signal });
  window.addEventListener('afterprint', finishPrint, { signal: observers.signal });
  modal.addEventListener('close', () => observers.abort(), { once: true });
  modal.showModal();
}
