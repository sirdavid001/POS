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

mockStores.unshift({
  id: 1,
  name: 'QuickPOS Demo Store',
  email: 'store@posapp.com',
  phone: '+234 800 000 0000',
  currency: 'NGN',
  created_at: iso(40 * DAY),
  owner: { id: 1, name: 'Demo Owner', email: 'owner@posapp.example', phone: null, is_active: true, role: 'admin' },
  subscription: { status: 'grandfathered', plan_code: null, provider: null, activation_fee_paid: true, current_period_start: null, current_period_end: null },
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

// ---- Live chat, announcements and admin tools (mock) ----

let conversationId = 1;
let messageId = 1;
const conversations = [];
const messages = [];
const announcements = [];
let announcementId = 1;
const admins = [{ user_id: null, granted_at: iso(90 * DAY), granted_by_name: null }];

function preview(body) {
  const text = String(body || '').replace(/\s+/g, ' ').trim();
  return text.length > 157 ? `${text.slice(0, 157)}…` : text;
}

function addMessage(conversation, senderType, body, senderName, senderUserId = null) {
  const message = { id: messageId++, conversation_id: conversation.id, sender_type: senderType, body, sender_name: senderName, sender_user_id: senderUserId, created_at: new Date().toISOString() };
  messages.push(message);
  Object.assign(conversation, { last_message_at: message.created_at, last_message_preview: preview(body), last_sender: senderType, updated_at: message.created_at });
  return message;
}

function newConversation(storeId, startedBy) {
  const conversation = { id: conversationId++, store_id: storeId, started_by: startedBy, status: 'open', last_message_at: new Date().toISOString(), last_message_preview: null, last_sender: startedBy, store_last_read_at: null, admin_last_read_at: null, closed_at: null, created_at: new Date().toISOString() };
  conversations.push(conversation);
  return conversation;
}

// Seed two chats so the inbox has something to show.
(() => {
  const lekki = newConversation(101, 'store');
  addMessage(lekki, 'store', 'Hello, I paid the activation by bank transfer this morning. Can you activate my store?', 'Tunde Bakare');
  const ibadan = newConversation(104, 'store');
  addMessage(ibadan, 'store', 'How do I connect my receipt printer?', 'Femi Adeyemi');
  addMessage(ibadan, 'admin', 'Open Settings, then Receipt, and choose Print test receipt. Which printer model do you have?', 'QuickPOS support');
  addMessage(ibadan, 'store', 'It is an Xprinter 58mm.', 'Femi Adeyemi');
  ibadan.admin_last_read_at = new Date(Date.now() - 60000).toISOString();
})();

const storeOf = (id) => mockStores.find((s) => s.id === Number(id));
const unreadForAdmin = (c) => c.last_sender === 'store' && (!c.admin_last_read_at || c.last_message_at > c.admin_last_read_at);
const shapeMessage = (m, forAdmin) => ({
  id: m.id, conversation_id: m.conversation_id, sender_type: m.sender_type, body: m.body, created_at: m.created_at,
  sender_name: m.sender_type === 'admin' ? (forAdmin ? m.sender_name : 'QuickPOS support') : m.sender_type === 'system' ? 'QuickPOS' : m.sender_name,
});

export function registerMockSupport(app, auth) {
  const current = (storeId) => conversations.filter((c) => c.store_id === storeId)
    .sort((a, b) => (a.status === 'open' ? -1 : 1) - (b.status === 'open' ? -1 : 1) || b.last_message_at.localeCompare(a.last_message_at))[0];
  const unread = (c) => (c ? messages.filter((m) => m.conversation_id === c.id && m.sender_type !== 'store' && (!c.store_last_read_at || m.created_at > c.store_last_read_at)).length : 0);

  app.get('/api/v1/support/chat', auth, (req, res) => {
    const c = current(req.user.store_id || 1);
    if (!c) return res.json({ conversation: null, messages: [], unread: 0 });
    const after = Number(req.query.after || 0);
    res.json({ conversation: c, messages: messages.filter((m) => m.conversation_id === c.id && m.id > after).map((m) => shapeMessage(m, false)), unread: unread(c) });
  });
  app.get('/api/v1/support/chat/unread', auth, (req, res) => {
    const c = current(req.user.store_id || 1);
    res.json({ unread: unread(c), status: c?.status || null });
  });
  app.post('/api/v1/support/chat/messages', auth, (req, res) => {
    const body = String(req.body?.body || '').trim();
    if (!body) return res.status(400).json({ error: 'Validation failed', details: [{ field: 'body.body', message: 'Write a message first' }] });
    const storeId = req.user.store_id || 1;
    const c = conversations.find((x) => x.store_id === storeId && x.status === 'open') || newConversation(storeId, 'store');
    const message = addMessage(c, 'store', body.slice(0, 4000), req.user.name, req.user.id);
    c.store_last_read_at = message.created_at;
    res.status(201).json({ conversation: c, message: shapeMessage(message, false) });
  });
  app.post('/api/v1/support/chat/read', auth, (req, res) => {
    const c = current(req.user.store_id || 1);
    if (c) c.store_last_read_at = new Date().toISOString();
    res.json({ unread: 0 });
  });
  app.get('/api/v1/support/announcements', auth, (req, res) => {
    const now = new Date().toISOString();
    res.json({ announcements: announcements.filter((a) => a.starts_at <= now && (!a.ends_at || a.ends_at > now)).slice(0, 5) });
  });
}

export function registerMockAdminTools(app, auth) {
  const base = '/api/v1/platform';
  const log = (req, fields) => audit(req, fields);

  app.get(`${base}/inbox/summary`, auth, (req, res) => res.json({
    open: conversations.filter((c) => c.status === 'open').length,
    unread: conversations.filter(unreadForAdmin).length,
    available: true,
  }));
  app.get(`${base}/inbox`, auth, (req, res) => {
    const status = ['open', 'closed', 'all'].includes(req.query.status) ? req.query.status : 'open';
    const rows = conversations.filter((c) => status === 'all' || c.status === status)
      .sort((a, b) => Number(unreadForAdmin(b)) - Number(unreadForAdmin(a)) || b.last_message_at.localeCompare(a.last_message_at))
      .map((c) => ({ ...c, store_name: storeOf(c.store_id)?.name, store_email: storeOf(c.store_id)?.email, owner_name: storeOf(c.store_id)?.owner.name, unread: unreadForAdmin(c), message_count: messages.filter((m) => m.conversation_id === c.id).length }));
    res.json({ conversations: rows, pagination: { page: 1, limit: 25, total: rows.length } });
  });
  app.get(`${base}/inbox/:id`, auth, (req, res) => {
    const c = conversations.find((x) => x.id === Number(req.params.id));
    if (!c) return res.status(404).json({ error: 'Conversation not found' });
    c.admin_last_read_at = new Date().toISOString();
    const store = storeOf(c.store_id);
    const after = Number(req.query.after || 0);
    res.json({
      conversation: { ...c, store_name: store?.name, store_email: store?.email, store_phone: store?.phone, subscription_status: store?.subscription.status, owner_name: store?.owner.name, owner_email: store?.owner.email },
      messages: messages.filter((m) => m.conversation_id === c.id && m.id > after).map((m) => shapeMessage(m, true)),
    });
  });
  app.post(`${base}/inbox/:id/messages`, auth, (req, res) => {
    const c = conversations.find((x) => x.id === Number(req.params.id));
    if (!c) return res.status(404).json({ error: 'Conversation not found' });
    const body = String(req.body?.body || '').trim();
    if (!body) return res.status(400).json({ error: 'Write a reply first' });
    if (c.status === 'closed' && conversations.some((x) => x.store_id === c.store_id && x.status === 'open')) {
      return res.status(409).json({ error: 'This store already has another open chat. Reply there instead.' });
    }
    Object.assign(c, { status: 'open', closed_at: null });
    const message = addMessage(c, 'admin', body, req.user.name, req.user.id);
    c.admin_last_read_at = message.created_at;
    res.status(201).json({ conversation: c, message: shapeMessage(message, true) });
  });
  app.patch(`${base}/inbox/:id`, auth, (req, res) => {
    const c = conversations.find((x) => x.id === Number(req.params.id));
    if (!c) return res.status(404).json({ error: 'Conversation not found' });
    const closing = req.body?.status === 'closed';
    c.status = closing ? 'closed' : 'open';
    c.closed_at = closing ? new Date().toISOString() : null;
    const message = addMessage(c, 'system', closing ? 'QuickPOS support closed this chat. Send a message any time to start a new one.' : 'QuickPOS support reopened this chat.', 'QuickPOS');
    c.admin_last_read_at = message.created_at;
    res.json({ conversation: c, message: shapeMessage(message, true) });
  });
  app.post(`${base}/stores/:id/chat`, auth, (req, res) => {
    const store = storeOf(req.params.id);
    if (!store) return res.status(404).json({ error: 'Store not found' });
    const body = String(req.body?.body || '').trim();
    if (!body) return res.status(400).json({ error: 'Write a message first' });
    const c = conversations.find((x) => x.store_id === store.id && x.status === 'open') || newConversation(store.id, 'admin');
    const message = addMessage(c, 'admin', body, req.user.name, req.user.id);
    c.admin_last_read_at = message.created_at;
    res.status(201).json({ conversation: c, message: shapeMessage(message, true) });
  });

  app.get(`${base}/attention`, auth, (req, res) => {
    const now = Date.now();
    const pack = (items) => ({ count: items.length, items: items.slice(0, 6) });
    const ref = (store, date, detail = null) => ({ store_id: store.id, store_name: store.name, owner_email: store.owner.email, date, detail });
    res.json({
      renewals_due: pack(mockStores.filter((s) => s.subscription.status === 'active' && Date.parse(s.subscription.current_period_end) > now && Date.parse(s.subscription.current_period_end) <= now + 7 * DAY).map((s) => ref(s, s.subscription.current_period_end))),
      recently_expired: pack(mockStores.filter((s) => s.subscription.activation_fee_paid && s.subscription.status !== 'grandfathered' && Date.parse(s.subscription.current_period_end) <= now && Date.parse(s.subscription.current_period_end) > now - 30 * DAY).map((s) => ref(s, s.subscription.current_period_end))),
      unpaid_signups: pack(mockStores.filter((s) => !s.subscription.activation_fee_paid && Date.parse(s.created_at) <= now - 2 * DAY && Date.parse(s.created_at) > now - 60 * DAY).map((s) => ref(s, s.created_at))),
      quiet_paid_stores: pack(mockStores.filter((s) => s.subscription.activation_fee_paid && s.subscription.status === 'active' && s.id % 4 === 0).map((s) => ref(s, null))),
      stuck_payments: pack(mockPayments.filter((p) => p.status === 'initialized' && Date.parse(p.created_at) <= now - 3600000 && Date.parse(p.created_at) > now - 14 * DAY).map((p) => ref(storeOf(p.store_id), p.created_at, `${p.provider} · ${p.provider_reference}`))),
      unanswered_chats: pack(conversations.filter((c) => c.status === 'open' && c.last_sender === 'store').map((c) => ({ ...ref(storeOf(c.store_id), c.last_message_at, c.last_message_preview), conversation_id: c.id }))),
    });
  });

  app.get(`${base}/search`, auth, (req, res) => {
    const term = String(req.query.q || '').trim().toLowerCase();
    if (term.length < 2) return res.json({ stores: [], people: [], payments: [] });
    const has = (...values) => values.some((v) => String(v || '').toLowerCase().includes(term));
    res.json({
      stores: mockStores.filter((s) => has(s.name, s.email, s.phone)).slice(0, 8).map((s) => ({ id: s.id, name: s.name, email: s.email, phone: s.phone, created_at: s.created_at })),
      people: mockStores.filter((s) => has(s.owner.name, s.owner.email)).slice(0, 8).map((s) => ({ id: s.owner.id, name: s.owner.name, email: s.owner.email, is_active: s.owner.is_active, role: 'admin', store_id: s.id, store_name: s.name })),
      payments: mockPayments.filter((p) => has(p.provider_reference)).slice(0, 8).map((p) => ({ id: p.id, store_id: p.store_id, store_name: storeOf(p.store_id)?.name, provider: p.provider, provider_reference: p.provider_reference, amount: p.amount, currency: p.currency, status: p.status, date: p.paid_at || p.created_at })),
    });
  });

  app.get(`${base}/stores/:id/usage`, auth, (req, res) => {
    const store = storeOf(req.params.id);
    if (!store) return res.status(404).json({ error: 'Store not found' });
    const seed = store.id % 7;
    res.json({ usage: {
      products: 20 + seed * 9, customers: 4 + seed * 6, staff: 1 + (seed % 3), orders_30d: store.subscription.activation_fee_paid ? 30 + seed * 11 : 0,
      sales_30d: store.subscription.activation_fee_paid ? 150000 + seed * 42500 : 0, last_order_at: store.subscription.activation_fee_paid ? iso(seed * 3600000) : null,
      last_login_at: iso((seed + 1) * 7200000), currency: store.currency,
    } });
  });

  app.post(`${base}/stores/:id/manual-payment`, auth, (req, res) => {
    const store = storeOf(req.params.id);
    if (!store) return res.status(404).json({ error: 'This store has no subscription record yet' });
    const plans = { activation_5m: ['Initial Activation', 5], monthly: ['Monthly', 1], quarterly: ['Quarterly', 3], yearly: ['Yearly', 12] };
    const plan = plans[req.body?.plan_code];
    if (!plan) return res.status(400).json({ error: 'Choose an active plan' });
    if (req.body.plan_code === 'activation_5m' && store.subscription.activation_fee_paid) return res.status(409).json({ error: 'This store has already paid the activation fee. Record a renewal plan instead.' });
    const reference = String(req.body?.reference || '').trim();
    if (reference.length < 3) return res.status(400).json({ error: 'Enter the bank or transfer reference' });
    if (mockPayments.some((p) => p.provider === 'manual' && p.provider_reference === reference)) return res.status(409).json({ error: 'That reference has already been recorded.' });
    const paidAt = req.body.paid_at || new Date().toISOString();
    const start = Math.max(Date.now(), Date.parse(store.subscription.current_period_end || 0) || 0);
    const old = { status: store.subscription.status, current_period_end: store.subscription.current_period_end };
    Object.assign(store.subscription, {
      plan_code: req.body.plan_code,
      status: store.subscription.status === 'grandfathered' ? 'grandfathered' : 'active',
      activation_fee_paid: store.subscription.activation_fee_paid || req.body.plan_code === 'activation_5m',
      current_period_start: new Date(start).toISOString(),
      current_period_end: new Date(start + plan[1] * 30 * DAY).toISOString(),
    });
    const amount = Math.round(Number(req.body.amount) || 0);
    const currency = req.body.currency === 'USD' ? 'USD' : 'NGN';
    mockPayments.push({ id: paymentId++, store_id: store.id, provider: 'manual', provider_reference: reference, provider_transaction_id: null, plan_code: req.body.plan_code, amount, currency, status: 'success', paid_at: paidAt, created_at: new Date().toISOString() });
    log(req, { storeId: store.id, action: 'manual_payment_recorded', oldValues: old, newValues: { plan_code: req.body.plan_code, plan_name: plan[0], amount, currency, reference, paid_at: paidAt, note: req.body.note || null, current_period_end: store.subscription.current_period_end } });
    res.status(201).json({ payment_id: paymentId - 1, subscription: { status: store.subscription.status, current_period_end: store.subscription.current_period_end } });
  });

  app.post(`${base}/stores/:id/permanent`, auth, (req, res) => {
    const store = storeOf(req.params.id);
    if (!store) return res.status(404).json({ error: 'This store has no subscription record yet' });
    const reason = String(req.body?.reason || '').trim();
    if (reason.length < 3) return res.status(400).json({ error: 'Give a short reason' });
    const granting = req.body?.permanent === true;
    if ((store.subscription.status === 'grandfathered') === granting) return res.status(400).json({ error: granting ? 'This store already has permanent access' : 'This store does not have permanent access' });
    const old = store.subscription.status;
    store.subscription.status = granting ? 'grandfathered' : (Date.parse(store.subscription.current_period_end || 0) > Date.now() ? 'active' : 'expired');
    log(req, { storeId: store.id, action: granting ? 'permanent_access_granted' : 'permanent_access_removed', oldValues: { status: old }, newValues: { status: store.subscription.status, reason } });
    res.json({ subscription: { status: store.subscription.status, current_period_end: store.subscription.current_period_end } });
  });

  app.post(`${base}/stores/:id/suspend`, auth, (req, res) => {
    const store = storeOf(req.params.id);
    if (!store) return res.status(404).json({ error: 'Store not found' });
    const reason = String(req.body?.reason || '').trim();
    if (reason.length < 3) return res.status(400).json({ error: 'Give a short reason' });
    if (req.body?.suspended) {
      if (!store.owner.is_active) return res.status(400).json({ error: 'Every sign-in for this store is already disabled' });
      store.owner.is_active = false;
      log(req, { storeId: store.id, action: 'store_suspended', oldValues: { user_ids: [store.owner.id] }, newValues: { reason } });
      return res.json({ suspended: true, users: 1 });
    }
    const last = mockAudit.find((entry) => entry.store_id === store.id && entry.action === 'store_suspended');
    if (!last) return res.status(400).json({ error: 'This store has no suspension to undo. Enable people one by one instead.' });
    store.owner.is_active = true;
    log(req, { storeId: store.id, action: 'store_restored', newValues: { user_ids: [store.owner.id], reason } });
    res.json({ suspended: false, users: 1 });
  });

  app.post(`${base}/users/:id/password-reset`, auth, (req, res) => {
    const store = mockStores.find((s) => s.owner.id === Number(req.params.id));
    if (!store) return res.status(404).json({ error: 'User not found' });
    if (!store.owner.is_active) return res.status(400).json({ error: 'Enable this person’s sign-in before sending a reset link' });
    log(req, { storeId: store.id, userId: store.owner.id, action: 'password_reset_sent' });
    res.json({ sent: true, email: store.owner.email });
  });

  app.post(`${base}/payments/:id/verify`, auth, (req, res) => {
    const payment = mockPayments.find((p) => p.id === Number(req.params.id));
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    if (payment.status !== 'initialized') return res.status(400).json({ error: 'Only payments still waiting at checkout can be checked' });
    // Demo rule: odd payment ids were paid, even ones were abandoned.
    if (payment.id % 2 === 0) return res.status(409).json({ error: `${payment.provider === 'paystack' ? 'Paystack' : 'Flutterwave'} says this payment was not completed.` });
    payment.status = 'success';
    payment.paid_at = new Date().toISOString();
    const store = storeOf(payment.store_id);
    Object.assign(store.subscription, { status: 'active', activation_fee_paid: true, plan_code: payment.plan_code, current_period_end: new Date(Date.now() + 150 * DAY).toISOString() });
    log(req, { storeId: store.id, action: 'payment_checked', newValues: { provider: payment.provider, reference: payment.provider_reference, status: 'success' } });
    res.json({ status: 'success' });
  });

  app.get(`${base}/announcements`, auth, (req, res) => {
    const now = new Date().toISOString();
    res.json({ announcements: announcements.slice().reverse().map((a) => ({ ...a, is_live: a.starts_at <= now && (!a.ends_at || a.ends_at > now) })) });
  });
  app.post(`${base}/announcements`, auth, (req, res) => {
    const title = String(req.body?.title || '').trim();
    const body = String(req.body?.body || '').trim();
    if (title.length < 3 || body.length < 3) return res.status(400).json({ error: 'Add a title and a message' });
    if (req.body.ends_at && Date.parse(req.body.ends_at) <= Date.now()) return res.status(400).json({ error: 'Choose an end date in the future, or leave it empty' });
    const row = { id: announcementId++, title, body, level: ['info', 'warning', 'success'].includes(req.body.level) ? req.body.level : 'info', starts_at: new Date().toISOString(), ends_at: req.body.ends_at || null, created_at: new Date().toISOString(), created_by_name: req.user.name };
    announcements.push(row);
    log(req, { action: 'announcement_published', newValues: { id: row.id, title, level: row.level, ends_at: row.ends_at } });
    res.status(201).json({ announcement: { ...row, is_live: true } });
  });
  app.post(`${base}/announcements/:id/end`, auth, (req, res) => {
    const row = announcements.find((a) => a.id === Number(req.params.id));
    if (!row || (row.ends_at && row.ends_at <= new Date().toISOString())) return res.status(404).json({ error: 'This announcement is not live' });
    row.ends_at = new Date().toISOString();
    log(req, { action: 'announcement_ended', newValues: { id: row.id, title: row.title } });
    res.json({ ended: true });
  });

  const extraAdmins = [];
  app.get(`${base}/admins`, auth, (req, res) => {
    admins[0].user_id = req.user.id;
    res.json({ admins: [
      { user_id: req.user.id, name: req.user.name, email: req.user.email, is_active: true, last_login: new Date().toISOString(), store_name: 'QuickPOS Demo Store', granted_at: admins[0].granted_at, granted_by_name: null, is_you: true },
      ...extraAdmins,
    ] });
  });
  app.post(`${base}/admins`, auth, (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const store = mockStores.find((s) => s.owner.email === email);
    if (!store) return res.status(404).json({ error: 'No QuickPOS account uses that email. The person must create an account first.' });
    if (extraAdmins.some((a) => a.email === email)) return res.status(409).json({ error: 'That person is already a platform admin' });
    extraAdmins.push({ user_id: store.owner.id, name: store.owner.name, email, is_active: true, last_login: null, store_name: store.name, granted_at: new Date().toISOString(), granted_by_name: req.user.name, is_you: false });
    log(req, { userId: store.owner.id, action: 'platform_admin_granted', newValues: { email } });
    res.status(201).json({ admin: { user_id: store.owner.id, name: store.owner.name, email } });
  });
  app.delete(`${base}/admins/:userId`, auth, (req, res) => {
    const index = extraAdmins.findIndex((a) => a.user_id === Number(req.params.userId));
    if (index < 0) return res.status(400).json({ error: 'You cannot remove your own platform access' });
    const [removed] = extraAdmins.splice(index, 1);
    log(req, { userId: removed.user_id, action: 'platform_admin_removed' });
    res.json({ removed: true });
  });

  app.get(`${base}/system`, auth, (req, res) => res.json({
    database: { ok: true, latency_ms: 3 },
    features: { live_chat: true, announcements: true },
    migrations: ['001_initial_schema', '002_subscriptions', '010_platform_admins', '012_support_chat_and_announcements'].map((name, index) => ({ name, applied_at: iso((40 - index * 10) * DAY) })),
    email: { configured: false },
    payments: { paystack: true, flutterwave: false },
    scheduled_jobs: { configured: true },
    version: 'mock',
    environment: 'development',
    plans: [
      { code: 'activation_5m', name: 'Initial Activation', price_ngn: 20000, duration_months: 5, recurring: false, is_active: true, active_stores: 6 },
      { code: 'monthly', name: 'Monthly', price_ngn: 5000, duration_months: 1, recurring: true, is_active: true, active_stores: 2 },
      { code: 'quarterly', name: 'Quarterly', price_ngn: 13500, duration_months: 3, recurring: true, is_active: true, active_stores: 1 },
      { code: 'yearly', name: 'Yearly', price_ngn: 50000, duration_months: 12, recurring: true, is_active: true, active_stores: 1 },
      { code: 'launch_6m', name: 'Launch Offer', price_ngn: 20000, duration_months: 6, recurring: false, is_active: false, active_stores: 0 },
    ],
    server_time: new Date().toISOString(),
  }));
}
