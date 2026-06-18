import { track } from '@vercel/analytics';
import { resolveApiBase } from '../../shared/src/api.js';

const SUPPORT_EMAIL = 'support@quickpos.com.ng';
const form = document.getElementById('support-form');
const alertTarget = document.querySelector('[data-support-alert]');
const chatMessages = document.querySelector('[data-chat-messages]');

const API_BASE = resolveApiBase(import.meta.env.VITE_API_URL, {
  development: import.meta.env.DEV,
});

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function setAlert(message, type = 'info', extraHtml = '') {
  if (!alertTarget) return;
  if (!message) {
    alertTarget.innerHTML = '';
    return;
  }
  alertTarget.innerHTML = `
    <div class="support-alert ${type}">
      <span>${escapeHtml(message)}</span>
      ${extraHtml}
    </div>
  `;
}

function formPayload() {
  const data = new FormData(form);
  const payload = {};
  data.forEach((value, key) => {
    if (key === 'contact_permission') {
      payload[key] = true;
      return;
    }
    payload[key] = typeof value === 'string' ? value.trim() : value;
  });
  return payload;
}

function buildMailto(payload) {
  const subject = `[QuickPOS Support] ${payload.category || 'support'}: ${payload.subject || 'Support request'}`;
  const body = [
    'QuickPOS support request',
    '',
    `Name: ${payload.name || ''}`,
    `Email: ${payload.email || ''}`,
    `Phone: ${payload.phone || ''}`,
    `Store: ${payload.store_name || ''}`,
    `Category: ${payload.category || ''}`,
    `Priority: ${payload.priority || ''}`,
    `Platform: ${payload.platform || ''}`,
    `App version: ${payload.app_version || ''}`,
    '',
    'Message:',
    payload.message || '',
    '',
    'I understand QuickPOS support will never ask for my password, card details, CVV, OTP, banking PIN, or full card number.',
  ].join('\n');
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

async function submitSupportRequest(payload) {
  const response = await fetch(`${API_BASE}/support/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (!response.ok) {
    const details = Array.isArray(data.details)
      ? ` ${data.details.map((item) => item.message).join(' ')}`
      : '';
    throw new Error(`${data.error || 'Could not send support request'}${details}`);
  }
  return data;
}

function openMailFallback(payload) {
  const href = buildMailto(payload);
  setAlert('Your email app should open with a prepared support request. Send it to complete the request.', 'info', `
    <a href="${href}">Open email draft again</a>
  `);
  window.location.href = href;
}

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = document.getElementById('support-submit');
  const payload = formPayload();

  button.disabled = true;
  button.textContent = 'Sending...';
  setAlert('', 'info');

  try {
    const result = await submitSupportRequest(payload);
    if (result.delivery?.skipped) {
      openMailFallback(payload);
      return;
    }
    setAlert(result.message || 'Support request sent. QuickPOS support will reply by email.', 'success');
    form.reset();
    track('support_form_submitted', {
      category: payload.category,
      priority: payload.priority,
      platform: payload.platform,
    });
  } catch (error) {
    setAlert(`${error.message || 'Could not send support request'} You can still send it by email.`, 'error', `
      <a href="${buildMailto(payload)}">Open email draft</a>
    `);
  } finally {
    button.disabled = false;
    button.textContent = 'Send support request';
  }
});

const botTopics = {
  billing: {
    category: 'billing',
    subject: 'Billing or activation help',
    answer: 'For billing or activation, please check that the payment was completed in Paystack or Flutterwave and wait a few minutes for verification. If activation does not update, send the provider, amount, payment date, store name, and transaction reference.',
  },
  downloads: {
    category: 'downloads',
    subject: 'Download access help',
    answer: 'Downloads are unlocked inside the website account portal after activation. Sign in as the store admin at /account, open Downloads, then choose the installer for your device. Managers and cashiers should use the installed app only.',
  },
  account: {
    category: 'account',
    subject: 'Account or login help',
    answer: 'For login issues, confirm you are using the same email used to create the store. Owners/admins can use the website account portal for billing and downloads. Staff should sign in through the installed POS app. Use Forgot password if the password is unknown.',
  },
  installation: {
    category: 'installation',
    subject: 'Installation help',
    answer: 'For installation issues, include your device platform, operating system version, installer type, and any exact error message. Windows users should download the official setup file; Android users should use the signed APK listed in the account portal.',
  },
  technical: {
    category: 'technical',
    subject: 'Technical issue',
    answer: 'For technical issues, write down the steps that reproduce the problem, the exact error message, your QuickPOS version, and whether the issue happens online, offline, or after login.',
  },
  security: {
    category: 'security',
    subject: 'Security concern',
    answer: 'If you suspect unauthorized access, contact support immediately from the registered owner email. Do not share passwords, OTPs, card details, CVV, or banking PINs. We may ask verification questions, but never secrets.',
  },
  reports: {
    category: 'technical',
    subject: 'Reports or export help',
    answer: 'For reports, exports, or store statements, include the date range, report type, export format, and whether printing, PDF, Excel, or email delivery is affected.',
  },
  inventory: {
    category: 'technical',
    subject: 'Products or inventory help',
    answer: 'For products or inventory, include the product name or SKU, the expected stock value, what changed, and the staff role used when the issue happened.',
  },
  privacy: {
    category: 'privacy',
    subject: 'Privacy or legal request',
    answer: 'For privacy or legal requests, use the registered owner email and describe the request clearly: access, correction, deletion, portability, account closure, or legal question. The Legal Centre has the full policy set.',
  },
};

function classifyMessage(message) {
  const value = message.toLowerCase();
  if (/bill|payment|paystack|flutterwave|activate|activation|refund|renew|subscription|expired|read.?only/.test(value)) return 'billing';
  if (/download|installer|apk|windows|android|mac|linux|iphone|ipad|device/.test(value)) return 'downloads';
  if (/login|password|account|register|sign.?in|admin|cashier|manager/.test(value)) return 'account';
  if (/install|setup|open|blocked|permission/.test(value)) return 'installation';
  if (/report|statement|export|pdf|excel|print|email/.test(value)) return 'reports';
  if (/stock|inventory|product|sku|barcode|supplier/.test(value)) return 'inventory';
  if (/security|hack|unauthorized|privacy|delete|legal|data/.test(value)) return 'security';
  return 'technical';
}

function addChatMessage(role, content, topic = null) {
  if (!chatMessages) return;
  const message = document.createElement('div');
  message.className = `chat-message ${role}`;
  message.innerHTML = `
    <div>${escapeHtml(content)}</div>
    ${role === 'bot' && topic ? `
      <button type="button" class="chat-escalate" data-escalate-topic="${topic}">Send this to support</button>
    ` : ''}
  `;
  chatMessages.appendChild(message);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function prepareForm(topicKey, userMessage = '') {
  const topic = botTopics[topicKey] || botTopics.technical;
  if (!form) return;
  form.elements.category.value = topic.category;
  form.elements.subject.value = topic.subject;
  form.elements.message.value = userMessage
    ? `${userMessage}\n\nChatbot guidance:\n${topic.answer}`
    : `I need help with: ${topic.subject}\n\nChatbot guidance:\n${topic.answer}`;
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  form.elements.name.focus({ preventScroll: true });
}

function answerChat(message, forcedTopic = null) {
  const topicKey = forcedTopic || classifyMessage(message);
  const topic = botTopics[topicKey] || botTopics.technical;
  if (message) addChatMessage('user', message);
  addChatMessage('bot', topic.answer, topicKey);
  track('support_chat_answered', { topic: topicKey });
}

document.querySelector('[data-chat-form]')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const input = event.target.elements.message;
  const message = input.value.trim();
  if (!message) return;
  input.value = '';
  answerChat(message);
});

document.querySelector('[data-chat-quick-actions]')?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-chat-topic]');
  if (!button) return;
  const topic = button.dataset.chatTopic;
  answerChat('', topic);
});

chatMessages?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-escalate-topic]');
  if (!button) return;
  const previousUserMessage = [...chatMessages.querySelectorAll('.chat-message.user')]
    .at(-1)
    ?.textContent
    ?.trim() || '';
  prepareForm(button.dataset.escalateTopic, previousUserMessage);
});

addChatMessage('bot', 'Hi, I can help with billing, activation, downloads, login, installation, reports, products, inventory, and security. Choose a topic or type your question.');
