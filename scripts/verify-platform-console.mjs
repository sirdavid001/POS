import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import jwt from 'jsonwebtoken';
import config from '../packages/server/src/config/index.js';
import { query } from '../packages/server/src/config/database.js';

const consoleUrl = process.argv[2] || 'https://m7q4-v2k9-r8p3.vercel.app';
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const debuggingPort = 9337;
const screenshotPath = join(tmpdir(), 'qp-control-phone.png');
const signInScreenshotPath = join(tmpdir(), 'qp-control-phone-signin.png');
const profileDirectory = await mkdtemp(join(tmpdir(), 'qp-control-chrome-'));

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForJson(url, attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {
      // Chrome may take a moment to expose the debugging endpoint.
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function cdpClient(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();

  const opened = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const handler = pending.get(message.id);
      if (!handler) return;
      pending.delete(message.id);
      if (message.error) handler.reject(new Error(message.error.message));
      else handler.resolve(message.result);
      return;
    }
    for (const listener of listeners.get(message.method) || []) listener(message.params);
  });

  return {
    async send(method, params = {}) {
      await opened;
      const id = nextId;
      nextId += 1;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    once(method) {
      return new Promise((resolve) => {
        const handler = (params) => {
          listeners.set(method, (listeners.get(method) || []).filter((item) => item !== handler));
          resolve(params);
        };
        listeners.set(method, [...(listeners.get(method) || []), handler]);
      });
    },
    on(method, handler) {
      listeners.set(method, [...(listeners.get(method) || []), handler]);
    },
    close() { socket.close(); },
  };
}

const adminResult = await query(
  `SELECT u.id, u.store_id, r.name AS role
   FROM platform_admins pa
   JOIN users u ON u.id = pa.user_id
   JOIN roles r ON r.id = u.role_id
   WHERE u.is_active = true
   ORDER BY pa.granted_at
   LIMIT 1`
);
const admin = adminResult.rows[0];
if (!admin) throw new Error('No active platform administrator is configured');

const token = jwt.sign(
  { userId: admin.id, storeId: admin.store_id, role: admin.role },
  config.jwt.secret,
  { expiresIn: '5m' }
);

const chrome = spawn(chromePath, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  `--remote-debugging-port=${debuggingPort}`,
  `--user-data-dir=${profileDirectory}`,
  'about:blank',
], { stdio: 'ignore' });

try {
  await waitForJson(`http://127.0.0.1:${debuggingPort}/json/version`);
  const target = await fetch(
    `http://127.0.0.1:${debuggingPort}/json/new?${encodeURIComponent(consoleUrl)}`,
    { method: 'PUT' }
  ).then((response) => response.json());
  const client = cdpClient(target.webSocketDebuggerUrl);
  const consoleErrors = [];
  const failedRequests = [];

  client.on('Runtime.consoleAPICalled', ({ type, args }) => {
    if (type === 'error') consoleErrors.push(args.map((arg) => arg.value || arg.description).join(' '));
  });
  client.on('Network.loadingFailed', ({ errorText, canceled }) => {
    if (!canceled) failedRequests.push(errorText);
  });

  await Promise.all([
    client.send('Page.enable'),
    client.send('Runtime.enable'),
    client.send('Network.enable'),
    client.send('Emulation.setDeviceMetricsOverride', {
      width: 375,
      height: 812,
      deviceScaleFactor: 2,
      mobile: true,
    }),
  ]);

  let loaded = client.once('Page.loadEventFired');
  await client.send('Page.navigate', { url: consoleUrl });
  await loaded;
  await delay(500);
  const signInResult = await client.send('Runtime.evaluate', {
    returnByValue: true,
    expression: `({
      innerWidth: window.innerWidth,
      bodyScrollWidth: document.body.scrollWidth,
      signInVisible: Boolean(document.querySelector('[data-signin-form]')),
      emailInputHeight: document.querySelector('#signin-email')?.getBoundingClientRect().height,
      submitHeight: document.querySelector('[data-signin-form] button')?.getBoundingClientRect().height
    })`,
  });
  const signInScreenshot = await client.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  await writeFile(signInScreenshotPath, Buffer.from(signInScreenshot.data, 'base64'));
  loaded = client.once('Page.loadEventFired');
  await client.send('Runtime.evaluate', {
    expression: `localStorage.setItem('qp_control_access_token', ${JSON.stringify(token)}); location.reload();`,
  });
  await loaded;
  await delay(2500);

  const result = await client.send('Runtime.evaluate', {
    returnByValue: true,
    expression: `({
      title: document.title,
      innerWidth: window.innerWidth,
      bodyScrollWidth: document.body.scrollWidth,
      pageTitle: document.querySelector('[data-page-title]')?.textContent,
      metrics: document.querySelectorAll('.metrics > div').length,
      storeRows: document.querySelectorAll('.store-row').length,
      bottomNavigationVisible: getComputedStyle(document.querySelector('.bottom-nav')).display !== 'none',
      signInVisible: Boolean(document.querySelector('[data-signin-form]')),
      activeNavigation: document.querySelectorAll('[data-view][aria-current="page"]').length
    })`,
  });

  const screenshot = await client.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));
  client.close();

  const evidence = {
    ...result.result.value,
    consoleErrors,
    failedRequests,
    screenshotPath,
    signIn: {
      ...signInResult.result.value,
      screenshotPath: signInScreenshotPath,
    },
  };
  const passed =
    evidence.signIn.innerWidth === 375 &&
    evidence.signIn.bodyScrollWidth <= evidence.signIn.innerWidth &&
    evidence.signIn.signInVisible &&
    evidence.signIn.emailInputHeight >= 44 &&
    evidence.signIn.submitHeight >= 44 &&
    evidence.innerWidth === 375 &&
    evidence.bodyScrollWidth <= evidence.innerWidth &&
    evidence.pageTitle === 'Overview' &&
    evidence.metrics === 4 &&
    evidence.bottomNavigationVisible &&
    !evidence.signInVisible &&
    evidence.activeNavigation >= 1 &&
    consoleErrors.length === 0 &&
    failedRequests.length === 0;

  console.log(JSON.stringify({ passed, ...evidence }, null, 2));
  if (!passed) process.exitCode = 1;
} finally {
  const closed = new Promise((resolve) => chrome.once('close', resolve));
  chrome.kill('SIGTERM');
  await Promise.race([closed, delay(2000)]);
  await rm(profileDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
