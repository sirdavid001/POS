import { completePermissionSetup } from '../permissions.js';
import { renderLayout } from './layout.js';
import { toast } from '../utils.js';

function permissionStatusLabel(state) {
  if (state === 'granted') return 'Allowed';
  if (state === 'denied') return 'Blocked';
  if (state === 'prompt') return 'Needs approval';
  return 'Check required';
}

async function queryCameraPermission() {
  try {
    if (!navigator.permissions?.query) return 'unknown';
    const result = await navigator.permissions.query({ name: 'camera' });
    return result.state;
  } catch {
    return 'unknown';
  }
}

async function requestCameraAccess() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera access is not available on this device.');
  }

  const stream = await navigator.mediaDevices.getUserMedia({ video: true });
  stream.getTracks().forEach((track) => track.stop());
}

function localStorageAvailable() {
  try {
    const key = '__quickpos_storage_check__';
    localStorage.setItem(key, 'ok');
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export async function renderPermissionsPage() {
  const content = renderLayout('permissions');
  const cameraState = await queryCameraPermission();
  const storageReady = localStorageAvailable();

  content.innerHTML = `
    <div class="permission-setup animate-fade-in">
      <div class="permission-setup-header">
        <span class="badge badge-info">Device setup</span>
        <h2>Allow QuickPOS permissions</h2>
        <p>Set up this device before using the POS. Camera access is needed for barcode scanning, while local storage keeps offline sales safe until sync.</p>
      </div>

      <div class="permission-grid">
        <article class="permission-card" id="camera-permission-card">
          <div class="permission-card-top">
            <span class="permission-icon">📷</span>
            <span class="badge ${cameraState === 'granted' ? 'badge-success' : cameraState === 'denied' ? 'badge-danger' : 'badge-warning'}" id="camera-permission-status">
              ${permissionStatusLabel(cameraState)}
            </span>
          </div>
          <h3>Camera</h3>
          <p>Used to scan product barcodes from POS and product setup screens.</p>
          <button class="btn btn-primary" type="button" id="request-camera-access">Allow camera access</button>
        </article>

        <article class="permission-card">
          <div class="permission-card-top">
            <span class="permission-icon">💾</span>
            <span class="badge ${storageReady ? 'badge-success' : 'badge-danger'}">${storageReady ? 'Ready' : 'Blocked'}</span>
          </div>
          <h3>Offline storage</h3>
          <p>Saves products, customers, sales, and queued sync changes when internet is unavailable.</p>
          <span class="permission-note">${storageReady ? 'No extra approval needed on this device.' : 'Enable site/app storage before continuing.'}</span>
        </article>

        <article class="permission-card">
          <div class="permission-card-top">
            <span class="permission-icon">⌨️</span>
            <span class="badge badge-success">Ready</span>
          </div>
          <h3>USB scanner</h3>
          <p>Hardware barcode scanners work like keyboards. Connect the scanner, focus QuickPOS, and scan.</p>
          <span class="permission-note">No popup permission required.</span>
        </article>

        <article class="permission-card">
          <div class="permission-card-top">
            <span class="permission-icon">🖨️</span>
            <span class="badge badge-info">System dialog</span>
          </div>
          <h3>Receipt printing</h3>
          <p>Receipts use the operating system print dialog when a sale completes.</p>
          <span class="permission-note">Choose the receipt printer when macOS asks.</span>
        </article>
      </div>

      <div class="permission-actions">
        <button class="btn btn-primary btn-lg" type="button" id="finish-permission-setup" ${storageReady ? '' : 'disabled'}>Continue to QuickPOS</button>
        <button class="btn btn-ghost btn-lg" type="button" id="skip-camera-setup">Continue without camera</button>
      </div>
    </div>
  `;

  document.getElementById('request-camera-access').addEventListener('click', async () => {
    const button = document.getElementById('request-camera-access');
    const status = document.getElementById('camera-permission-status');
    button.disabled = true;
    button.textContent = 'Checking camera...';

    try {
      await requestCameraAccess();
      status.className = 'badge badge-success';
      status.textContent = 'Allowed';
      toast('Camera access allowed', 'success');
    } catch (error) {
      status.className = 'badge badge-danger';
      status.textContent = 'Blocked';
      toast(error.message || 'Camera access was blocked', 'error', 5000);
    } finally {
      button.disabled = false;
      button.textContent = 'Allow camera access';
    }
  });

  function finishSetup() {
    completePermissionSetup();
    window.location.hash = '#/dashboard';
  }

  document.getElementById('finish-permission-setup').addEventListener('click', finishSetup);
  document.getElementById('skip-camera-setup').addEventListener('click', () => {
    toast('Camera setup skipped. You can still use USB scanners.', 'info');
    finishSetup();
  });
}
