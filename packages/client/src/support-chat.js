// Live chat with QuickPOS support, plus platform announcements, inside the POS app.
// The server is serverless, so "live" means polling: every 5 seconds while the chat
// is open, and a light unread check every minute otherwise.

import { api } from './api.js';
import { escapeHTML, icons } from './utils.js';

const OPEN_POLL_MS = 5000;
const BACKGROUND_POLL_MS = 60000;
const DISMISSED_KEY = 'quickpos_dismissed_announcements';
const ANNOUNCEMENT_TTL_MS = 10 * 60 * 1000;

const chat = {
  available: true,
  unread: 0,
  messages: [],
  conversation: null,
  backgroundTimer: null,
  openTimer: null,
  overlay: null,
  sending: false,
};

let announcementsCache = { at: 0, items: [] };

function readDismissed() {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

function saveDismissed(ids) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids].slice(-50)));
  } catch { /* Private mode: the banner simply comes back next session. */ }
}

function timeLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const sameDay = date.toDateString() === new Date().toDateString();
  return date.toLocaleString('en-NG', sameDay
    ? { hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function syncBadges() {
  document.querySelectorAll('[data-chat-badge]').forEach((badge) => {
    badge.hidden = chat.unread < 1;
    badge.textContent = chat.unread > 9 ? '9+' : String(chat.unread);
  });
  document.querySelectorAll('[data-open-support-chat]').forEach((button) => {
    button.hidden = !chat.available;
    button.setAttribute('aria-label', chat.unread
      ? `Chat with QuickPOS support, ${chat.unread} unread repl${chat.unread === 1 ? 'y' : 'ies'}`
      : 'Chat with QuickPOS support');
  });
}

async function checkUnread() {
  if (!navigator.onLine || document.hidden || !api.accessToken) return;
  try {
    const data = await api.get('/support/chat/unread');
    chat.available = data.available !== false;
    chat.unread = Number(data.unread || 0);
    syncBadges();
  } catch { /* A missed poll is harmless. */ }
}

function messageMarkup(message) {
  const mine = message.sender_type === 'store';
  if (message.sender_type === 'system') {
    return `<li class="chat-system" data-message-id="${message.id}"><span>${escapeHTML(message.body)}</span></li>`;
  }
  return `
    <li class="chat-message ${mine ? 'mine' : 'theirs'}" data-message-id="${message.id}">
      <div class="chat-bubble">${escapeHTML(message.body)}</div>
      <span class="chat-meta">${escapeHTML(mine ? message.sender_name || 'You' : 'QuickPOS support')} · ${escapeHTML(timeLabel(message.created_at))}</span>
    </li>`;
}

function renderMessages({ scroll = true } = {}) {
  const list = chat.overlay?.querySelector('[data-chat-log]');
  if (!list) return;
  if (!chat.messages.length) {
    list.innerHTML = `<li class="chat-empty"><strong>How can we help?</strong><span>Ask about billing, setup, devices or anything in QuickPOS. A real person on the QuickPOS team replies here.</span></li>`;
    return;
  }
  const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  list.innerHTML = chat.messages.map(messageMarkup).join('');
  if (scroll || nearBottom) list.scrollTop = list.scrollHeight;
}

function setStatus(text, tone = '') {
  const status = chat.overlay?.querySelector('[data-chat-status]');
  if (!status) return;
  status.textContent = text;
  status.dataset.tone = tone;
}

function lastMessageId() {
  return chat.messages.length ? chat.messages[chat.messages.length - 1].id : 0;
}

async function markRead() {
  if (!chat.unread && !chat.messages.some((message) => message.sender_type !== 'store')) return;
  try {
    await api.post('/support/chat/read', {}, { skipOfflineQueue: true });
  } catch { /* Read receipts are best effort. */ }
  chat.unread = 0;
  syncBadges();
}

async function loadThread({ initial = false } = {}) {
  if (!navigator.onLine) {
    setStatus('You are offline. Connect to the internet to chat with support.', 'warning');
    return;
  }
  try {
    const after = initial ? 0 : lastMessageId();
    const data = await api.get(`/support/chat${after ? `?after=${after}` : ''}`);
    chat.conversation = data.conversation;
    const known = new Set(chat.messages.map((message) => message.id));
    const fresh = (data.messages || []).filter((message) => !known.has(message.id));
    if (initial) chat.messages = data.messages || [];
    else chat.messages.push(...fresh);
    if (initial || fresh.length) renderMessages({ scroll: initial });
    if (initial || fresh.some((message) => message.sender_type !== 'store')) await markRead();
    setStatus(chat.conversation?.status === 'closed'
      ? 'This chat was closed. Send a message to start a new one.'
      : 'Messages go to the QuickPOS team. Replies appear here.');
  } catch (error) {
    if (error.details?.code === 'MIGRATION_REQUIRED') {
      chat.available = false;
      setStatus('Live chat is not switched on yet. Email support@quickpos.com.ng for help.', 'warning');
      return;
    }
    setStatus(initial ? `Could not load your chat. ${error.message}` : 'Reconnecting…', 'warning');
  }
}

async function sendMessage(form) {
  const field = form.querySelector('textarea');
  const body = field.value.trim();
  if (!body || chat.sending) return;
  if (!navigator.onLine) {
    setStatus('You are offline. Your message was not sent.', 'warning');
    return;
  }
  chat.sending = true;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const data = await api.post('/support/chat/messages', { body }, { skipOfflineQueue: true });
    chat.conversation = data.conversation;
    if (!chat.messages.some((message) => message.id === data.message.id)) chat.messages.push(data.message);
    field.value = '';
    renderMessages();
    setStatus('Sent. Replies appear here.');
  } catch (error) {
    setStatus(error.message || 'Your message was not sent. Try again.', 'warning');
  } finally {
    chat.sending = false;
    button.disabled = false;
    field.focus();
  }
}

function stopOpenPolling() {
  clearInterval(chat.openTimer);
  chat.openTimer = null;
}

export function openSupportChat() {
  if (chat.overlay?.isConnected) return;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay chat-overlay';
  overlay.innerHTML = `
    <section class="modal chat-panel" role="dialog" aria-modal="true" aria-labelledby="support-chat-title" aria-describedby="support-chat-status">
      <header class="chat-header">
        <span class="chat-avatar" aria-hidden="true">${icons.chat}</span>
        <div>
          <h2 id="support-chat-title">QuickPOS support</h2>
          <p id="support-chat-status" data-chat-status role="status">Loading your chat…</p>
        </div>
        <button class="btn btn-ghost btn-sm" type="button" data-dialog-close aria-label="Close chat">${icons.close}</button>
      </header>
      <ol class="chat-log" data-chat-log aria-label="Chat messages" aria-live="polite"></ol>
      <form class="chat-composer" data-chat-form>
        <label class="sr-only" for="support-chat-input">Message</label>
        <textarea id="support-chat-input" class="input" rows="2" maxlength="4000" placeholder="Type your message" autofocus></textarea>
        <button class="btn btn-primary" type="submit">Send</button>
        <p class="chat-hint">Enter to send, Shift+Enter for a new line. Never share passwords, card details or PINs.</p>
      </form>
    </section>
  `;
  document.body.appendChild(overlay);
  chat.overlay = overlay;
  renderMessages();

  const close = () => {
    stopOpenPolling();
    overlay.remove();
    chat.overlay = null;
  };
  overlay.querySelector('[data-dialog-close]').addEventListener('click', close);
  overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
  const form = overlay.querySelector('[data-chat-form]');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    sendMessage(form);
  });
  form.querySelector('textarea').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      sendMessage(form);
    }
  });
  // The router removes open dialogs on navigation; stop polling when that happens.
  const watcher = new MutationObserver(() => {
    if (!overlay.isConnected) {
      stopOpenPolling();
      chat.overlay = null;
      watcher.disconnect();
    }
  });
  watcher.observe(document.body, { childList: true });

  loadThread({ initial: true });
  stopOpenPolling();
  chat.openTimer = setInterval(() => {
    if (!document.hidden) loadThread();
  }, OPEN_POLL_MS);
}

export function supportChatButtonMarkup(variant = 'sidebar') {
  if (variant === 'topbar') {
    return `<button type="button" class="btn btn-ghost mobile-topbar-chat" data-open-support-chat aria-label="Chat with QuickPOS support">
      <span aria-hidden="true">${icons.chat}</span><span class="chat-badge" data-chat-badge hidden>0</span>
    </button>`;
  }
  return `<button type="button" class="nav-item support-chat-link" data-open-support-chat aria-label="Chat with QuickPOS support">
    <span class="nav-icon" aria-hidden="true">${icons.chat}</span>
    <span>Chat with support</span>
    <span class="chat-badge" data-chat-badge hidden>0</span>
  </button>`;
}

// Called by the layout after every render.
export function mountSupportChat(root = document) {
  root.querySelectorAll('[data-open-support-chat]').forEach((button) => {
    button.addEventListener('click', () => openSupportChat());
  });
  syncBadges();
  if (!chat.backgroundTimer) {
    checkUnread();
    chat.backgroundTimer = setInterval(checkUnread, BACKGROUND_POLL_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) checkUnread(); });
    window.addEventListener('online', checkUnread);
    window.addEventListener('quickpos-auth-changed', () => {
      chat.unread = 0;
      chat.messages = [];
      syncBadges();
    });
  }
}

function renderAnnouncements(container) {
  const dismissed = readDismissed();
  const visible = announcementsCache.items.filter((item) => !dismissed.has(item.id));
  container.innerHTML = visible.map((item) => `
    <div class="announcement-banner ${escapeHTML(item.level)}" role="${item.level === 'warning' ? 'alert' : 'status'}">
      <div><strong>${escapeHTML(item.title)}</strong><span>${escapeHTML(item.body)}</span></div>
      <button type="button" class="btn btn-ghost btn-sm" data-dismiss-announcement="${item.id}" aria-label="Dismiss announcement: ${escapeHTML(item.title)}">${icons.close}</button>
    </div>`).join('');
  container.querySelectorAll('[data-dismiss-announcement]').forEach((button) => {
    button.addEventListener('click', () => {
      const ids = readDismissed();
      ids.add(Number(button.dataset.dismissAnnouncement));
      saveDismissed(ids);
      renderAnnouncements(container);
    });
  });
}

export async function mountAnnouncements(container) {
  if (!container) return;
  renderAnnouncements(container);
  if (!navigator.onLine || Date.now() - announcementsCache.at < ANNOUNCEMENT_TTL_MS) return;
  try {
    const data = await api.get('/support/announcements');
    announcementsCache = { at: Date.now(), items: data.announcements || [] };
    if (container.isConnected) renderAnnouncements(container);
  } catch { /* Announcements are optional. */ }
}
