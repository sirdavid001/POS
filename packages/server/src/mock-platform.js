// Demo data and routes for the platform console (QP Control) on the mock API.
// Every signed-in mock user is treated as a platform admin. Local testing only.

const DAY = 86400000;
const now = Date.now();
const iso = (msAgo) => new Date(now - msAgo).toISOString();

const STORE_NAMES = [
  ['Mama Nkechi Provisions', 'Nkechi Obi'], ['Lekki Fresh Mart', 'Tunde Bakare'], ['Abuja Phone Hub', 'Musa Ibrahim'],
  ['Kano Textiles', 'Aisha Bello'], ['Ibadan Pharmacy Plus', 'Femi Adeyemi'], ['Enugu Hardware Depot', 'Chika Eze'],
  ['Port Harcourt Kids Store', 'Ebi Douglas'], ['Jos Stationery Corner', 'Grace Pam'], ['Benin Cosmetics', 'Osas Igbinedion'],
  ['Calabar Grocers', 'Effiong Bassey'], ['Ikeja Shoe Gallery', 'Bola Ahmed'], ['Owerri Mini Mart', 'Ifeanyi Okafor'],
  ['Accra Corner Shop', 'Kwame Mensah'], ['Ilorin Bookshop', 'Yusuf Salami'],
];

const mockStores = STORE_NAMES.map(([name, owner], index) => {
  const id = 100 + index;
  const createdAt = iso((index * 13 + 2) * DAY);
  const paid = index % 3 !== 1;
  const slug = name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '');
  return {
    id,
    name,
    email: `${slug}@example.com`,
    phone: null,
    currency: index === 12 ? 'USD' : 'NGN',
    created_at: createdAt,
    owner: { id: 1000 + index, name: owner, email: `owner.${slug}@example.com`, phone: null, is_active: index !== 5, role: 'admin' },
    subscription: paid
      ? { status: 'active', plan_code: 'activation_5m', provider: 'paystack', activation_fee_paid: true, current_period_start: createdAt, current_period_end: new Date(Date.parse(createdAt) + 150 * DAY).toISOString() }
      : { status: 'pending_activation', plan_code: null, provider: null, activation_fee_paid: false, current_period_start: null, current_period_end: null },
  };
});

let paymentId = 500;
const mockPayments = [];
mockStores.forEach((store, index) => {
  if (store.subscription.activation_fee_paid) {
    const paidAt = new Date(Date.parse(store.created_at) + DAY).toISOString();
    mockPayments.push({ id: paymentId++, store_id: store.id, provider: index % 2 ? 'flutterwave' : 'paystack', provider_reference: `QP-${store.id}-ACT`, provider_transaction_id: `T${store.id}1`, plan_code: 'activation_5m', amount: store.currency === 'USD' ? 15 : 20000, currency: store.currency, status: 'success', paid_at: paidAt, created_at: paidAt });
  } else {
    mockPayments.push({ id: paymentId++, store_id: store.id, provider: 'paystack', provider_reference: `QP-${store.id}-TRY`, provider_transaction_id: null, plan_code: 'activation_5m', amount: 20000, currency: 'NGN', status: 'initialized', paid_at: null, created_at: store.created_at });
  }
});

let auditId = 1;
const mockAudit = [];

function storeRow(store) {
  const payment = mockPayments.filter((p) => p.store_id === store.id && p.status === 'success').sort((a, b) => b.paid_at.localeCompare(a.paid_at))[0];
  return {
    id: store.id, name: store.name, email: store.email, phone: store.phone, currency: store.currency, created_at: store.created_at,
    owner_id: store.owner.id, owner_name: store.owner.name, owner_email: store.owner.email, owner_phone: null, owner_is_active: store.owner.is_active,
    subscription_status: store.subscription.status, plan_code: store.subscription.plan_code, provider: store.subscription.provider,
    activation_fee_paid: store.subscription.activation_fee_paid, current_period_end: store.subscription.current_period_end,
    payment_provider: payment?.provider || null, payment_reference: payment?.provider_reference || null,
    payment_amount: payment?.amount ?? null, payment_currency: payment?.currency || null, payment_paid_at: payment?.paid_at || null,
  };
}

function storeMatches(store, search, status) {
  const term = String(search || '').trim().toLowerCase();
  const text = `${store.name} ${store.email} ${store.owner.name} ${store.owner.email}`.toLowerCase();
  if (term && !text.includes(term)) return false;
  const paid = mockPayments.some((p) => p.store_id === store.id && p.status === 'success');
  const active = store.subscription.status === 'grandfathered'
    || (store.subscription.status === 'active' && Date.parse(store.subscription.current_period_end) > Date.now());
  if (status === 'paid') return paid;
  if (status === 'pending') return !paid;
  if (status === 'active') return active;
  if (status === 'inactive') return !active;
  return true;
}

function paymentRows(search, status) {
  const term = String(search || '').trim().toLowerCase();
  return mockPayments
    .map((p) => ({ ...p, store_name: mockStores.find((s) => s.id === p.store_id)?.name, store_email: mockStores.find((s) => s.id === p.store_id)?.email }))
    .filter((p) => (!term || `${p.store_name} ${p.provider_reference}`.toLowerCase().includes(term)) && (!status || status === 'all' || p.status === status))
    .sort((a, b) => (b.paid_at || b.created_at).localeCompare(a.paid_at || a.created_at));
}

function page(req) {
  const pageNumber = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(10, Number.parseInt(req.query.limit, 10) || 20));
  return { page: pageNumber, limit, offset: (pageNumber - 1) * limit };
}

function audit(req, { storeId = null, userId = null, action, oldValues = null, newValues = null }) {
  const store = mockStores.find((s) => s.id === storeId);
  const target = mockStores.map((s) => s.owner).find((u) => u.id === userId);
  const entry = {
    id: auditId++, action, old_values: oldValues, new_values: newValues, created_at: new Date().toISOString(),
    store_id: storeId, store_name: store?.name || null, target_user_name: target?.name || null, target_user_email: target?.email || null,
    actor_name: req.user.name, actor_email: req.user.email,
  };
  mockAudit.unshift(entry);
  return entry;
}

export function registerMockPlatform(app, auth) {
  const base = '/api/v1/platform';

  app.get(`${base}/me`, auth, (req, res) => res.json({
    user: { id: req.user.id, email: req.user.email, name: req.user.name },
    platform_admin: true,
    granted_at: req.user.created_at,
  }));

  app.get(`${base}/overview`, auth, (req, res) => {
    const { page: pageNumber, limit, offset } = page(req);
    const matching = mockStores.filter((s) => storeMatches(s, req.query.search, req.query.status));
    const success = mockPayments.filter((p) => p.status === 'success');
    const totals = {};
    success.forEach((p) => { totals[p.currency] = totals[p.currency] || { currency: p.currency, count: 0, amount: 0 }; totals[p.currency].count += 1; totals[p.currency].amount += p.amount; });
    res.json({
      summary: {
        registered_stores: mockStores.length,
        registered_last_7_days: mockStores.filter((s) => Date.parse(s.created_at) >= now - 7 * DAY).length,
        paid_stores: new Set(success.map((p) => p.store_id)).size,
        pending_stores: mockStores.length - new Set(success.map((p) => p.store_id)).size,
        payment_totals: Object.values(totals),
      },
      stores: matching.slice(offset, offset + limit).map(storeRow),
      recent_payments: paymentRows('', 'all').slice(0, 8),
      pagination: { page: pageNumber, limit, total: matching.length },
    });
  });

  app.get(`${base}/payments`, auth, (req, res) => {
    const { page: pageNumber, limit, offset } = page(req);
    const rows = paymentRows(req.query.search, req.query.status);
    res.json({ payments: rows.slice(offset, offset + limit), pagination: { page: pageNumber, limit, total: rows.length } });
  });

  app.get(`${base}/trends`, auth, (req, res) => {
    const months = Math.min(24, Math.max(3, Number.parseInt(req.query.months, 10) || 12));
    const list = [];
    const today = new Date();
    for (let i = months - 1; i >= 0; i -= 1) {
      const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1));
      const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i + 1, 1));
      const inMonth = (value) => value && Date.parse(value) >= start.getTime() && Date.parse(value) < end.getTime();
      const firstPaid = mockStores.map((s) => mockPayments.filter((p) => p.store_id === s.id && p.status === 'success').map((p) => p.paid_at).sort()[0]);
      const revenue = {};
      mockPayments.filter((p) => p.status === 'success' && inMonth(p.paid_at)).forEach((p) => {
        revenue[p.currency] = revenue[p.currency] || { currency: p.currency, count: 0, amount: 0 };
        revenue[p.currency].count += 1; revenue[p.currency].amount += p.amount;
      });
      list.push({
        month: start.toISOString().slice(0, 7),
        signups: mockStores.filter((s) => inMonth(s.created_at)).length,
        first_payments: firstPaid.filter(inMonth).length,
        revenue: Object.values(revenue),
      });
    }
    res.json({ months: list });
  });

  app.get(`${base}/activity`, auth, (req, res) => {
    const { page: pageNumber, limit, offset } = page(req);
    res.json({ activity: mockAudit.slice(offset, offset + limit), pagination: { page: pageNumber, limit, total: mockAudit.length } });
  });

  app.get(`${base}/export/stores`, auth, (req, res) => {
    res.json({ stores: mockStores.filter((s) => storeMatches(s, req.query.search, req.query.status)).map(storeRow), truncated: false });
  });

  app.get(`${base}/export/payments`, auth, (req, res) => {
    res.json({ payments: paymentRows(req.query.search, req.query.status), truncated: false });
  });

  app.get(`${base}/stores/:id`, auth, (req, res) => {
    const store = mockStores.find((s) => s.id === Number(req.params.id));
    if (!store) return res.status(404).json({ error: 'Store not found' });
    const entries = mockAudit.filter((entry) => entry.store_id === store.id);
    res.json({
      store: {
        id: store.id, name: store.name, email: store.email, created_at: store.created_at, currency: store.currency,
        subscription_status: store.subscription.status, plan_code: store.subscription.plan_code,
        subscription_provider: store.subscription.provider, activation_fee_paid: store.subscription.activation_fee_paid,
        current_period_start: store.subscription.current_period_start, current_period_end: store.subscription.current_period_end,
      },
      users: [{ ...store.owner, last_login: store.created_at, created_at: store.created_at, is_platform_admin: false }],
      payments: paymentRows('', 'all').filter((p) => p.store_id === store.id),
      notes: entries.filter((entry) => entry.action === 'store_note_added'),
      activity: entries.filter((entry) => entry.action !== 'store_note_added').slice(0, 20),
    });
  });

  app.post(`${base}/stores/:id/notes`, auth, (req, res) => {
    const store = mockStores.find((s) => s.id === Number(req.params.id));
    if (!store) return res.status(404).json({ error: 'Store not found' });
    const note = String(req.body?.note || '').trim();
    if (!note) return res.status(400).json({ error: 'Validation failed', details: [{ field: 'body.note', message: 'Write a note first' }] });
    res.status(201).json({ note: audit(req, { storeId: store.id, action: 'store_note_added', newValues: { note: note.slice(0, 1000) } }) });
  });

  app.post(`${base}/stores/:id/extend`, auth, (req, res) => {
    const store = mockStores.find((s) => s.id === Number(req.params.id));
    if (!store) return res.status(404).json({ error: 'This store has no subscription record yet' });
    const days = Number(req.body?.days);
    const reason = String(req.body?.reason || '').trim();
    if (!Number.isInteger(days) || days < 1 || days > 366 || reason.length < 3) {
      return res.status(400).json({ error: 'Validation failed', details: [{ field: 'body.days', message: 'Choose 1 to 366 days and give a short reason' }] });
    }
    if (store.subscription.status === 'grandfathered') return res.status(400).json({ error: 'This store already has permanent access' });
    const old = { status: store.subscription.status, current_period_end: store.subscription.current_period_end };
    const from = Math.max(Date.now(), Date.parse(store.subscription.current_period_end || 0) || 0);
    if (!['active', 'past_due', 'cancelled'].includes(store.subscription.status)) store.subscription.status = 'active';
    store.subscription.current_period_start = store.subscription.current_period_start || new Date().toISOString();
    store.subscription.current_period_end = new Date(from + days * DAY).toISOString();
    audit(req, { storeId: store.id, action: 'subscription_extended', oldValues: old, newValues: { status: store.subscription.status, current_period_end: store.subscription.current_period_end, days, reason } });
    res.json({ subscription: { status: store.subscription.status, current_period_start: store.subscription.current_period_start, current_period_end: store.subscription.current_period_end } });
  });

  const lastSent = new Map();
  app.post(`${base}/stores/:id/emails`, auth, (req, res) => {
    const store = mockStores.find((s) => s.id === Number(req.params.id));
    if (!store) return res.status(404).json({ error: 'Store not found' });
    const type = req.body?.type;
    if (!['welcome', 'activation_reminder'].includes(type)) return res.status(400).json({ error: 'Validation failed' });
    if (type === 'activation_reminder' && store.subscription.activation_fee_paid) {
      return res.status(400).json({ error: 'This store has already activated, so it does not need an activation reminder.', reason: 'already_activated' });
    }
    const key = `${store.id}:${type}:${new Date().toISOString().slice(0, 13)}`;
    if (lastSent.has(key)) return res.status(409).json({ error: 'This email was already sent to this store in the last hour.', reason: 'duplicate' });
    lastSent.set(key, true);
    audit(req, { storeId: store.id, action: 'email_resent', newValues: { type, delivery_id: `mock_${Date.now()}` } });
    res.json({ sent: true, type });
  });

  app.patch(`${base}/users/:id/access`, auth, (req, res) => {
    const owner = mockStores.map((s) => s.owner).find((u) => u.id === Number(req.params.id));
    if (!owner) return res.status(404).json({ error: 'User not found' });
    const old = owner.is_active;
    owner.is_active = Boolean(req.body?.is_active);
    const store = mockStores.find((s) => s.owner === owner);
    audit(req, { storeId: store.id, userId: owner.id, action: 'user_access_changed', oldValues: { is_active: old }, newValues: { is_active: owner.is_active } });
    res.json({ user: { id: owner.id, store_id: store.id, name: owner.name, email: owner.email, is_active: owner.is_active } });
  });
}
