/**
 * Barcode Scanner Module
 * Supports:
 * 1. USB/Bluetooth hardware scanners (keyboard emulation with rapid input + Enter)
 * 2. Camera-based scanning via html5-qrcode
 */

import { Html5Qrcode } from 'html5-qrcode';

// ===== USB / Bluetooth Hardware Scanner =====
// These scanners type characters very fast and press Enter at the end.
// We detect rapid input (< 50ms between keystrokes) followed by Enter.

let _usbBuffer = '';
let _usbTimeout = null;
let _usbCallback = null;
const USB_CHAR_TIMEOUT = 80; // ms between chars (scanners are < 50ms)
const USB_MIN_LENGTH = 4;    // minimum barcode length

export function startUSBScanner(onScan) {
  _usbCallback = onScan;
  document.addEventListener('keydown', _handleUSBKey);
}

export function stopUSBScanner() {
  _usbCallback = null;
  document.removeEventListener('keydown', _handleUSBKey);
  _usbBuffer = '';
  if (_usbTimeout) clearTimeout(_usbTimeout);
}

function _handleUSBKey(e) {
  // Ignore if user is typing in an input/textarea
  const tag = e.target.tagName.toLowerCase();
  const isTyping = (tag === 'input' || tag === 'textarea' || tag === 'select');

  if (e.key === 'Enter') {
    if (_usbBuffer.length >= USB_MIN_LENGTH && _usbCallback) {
      e.preventDefault();
      e.stopPropagation();
      _usbCallback(_usbBuffer.trim());
    }
    _usbBuffer = '';
    if (_usbTimeout) clearTimeout(_usbTimeout);
    return;
  }

  // Don't capture if user is manually typing in an input field slowly
  if (isTyping && _usbBuffer.length === 0) return;

  // Only buffer printable characters
  if (e.key.length === 1) {
    // If user is in a focused input but the scanner fires rapidly, still capture
    if (isTyping && _usbBuffer.length > 0) {
      e.preventDefault();
    }
    _usbBuffer += e.key;

    if (_usbTimeout) clearTimeout(_usbTimeout);
    _usbTimeout = setTimeout(() => {
      // If input stops for too long, it was manual typing, not a scanner
      _usbBuffer = '';
    }, USB_CHAR_TIMEOUT);
  }
}


// ===== Camera-Based Scanner =====

let _cameraScanner = null;

/**
 * Show a camera scanner modal overlay
 * @param {Function} onScan - callback with (barcodeValue: string)
 * @param {Object} options - { title?: string }
 */
export function openCameraScanner(onScan, options = {}) {
  const title = options.title || 'Scan Barcode';

  // Remove any existing scanner overlay first
  const existing = document.getElementById('camera-scanner-overlay');
  if (existing) existing.remove();
  if (_cameraScanner) {
    try { _cameraScanner.stop().catch(() => {}); } catch {}
    try { _cameraScanner.clear(); } catch {}
    _cameraScanner = null;
  }

  // Create modal overlay
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'camera-scanner-overlay';
  overlay.style.zIndex = '10000';
  overlay.innerHTML = `
    <div class="modal" style="max-width:480px;padding:1.5rem;position:relative;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;">
        <h3 style="font-weight:700;font-size:1rem;">${title}</h3>
        <button id="close-camera-scanner" class="btn btn-ghost btn-sm" style="font-size:1.2rem;padding:0.25rem 0.5rem;z-index:10001;position:relative;">✕</button>
      </div>
      <div id="camera-scanner-region" style="width:100%;border-radius:0.75rem;overflow:hidden;background:#000;min-height:280px;"></div>
      <p style="text-align:center;margin-top:0.75rem;font-size:0.8rem;color:var(--color-text-muted);">
        Point camera at barcode · Scanning automatically...
      </p>
      <div id="camera-scanner-result" style="text-align:center;margin-top:0.5rem;display:none;">
        <span class="badge badge-success" style="font-size:0.9rem;padding:0.5rem 1rem;">✓ Scanned: <span id="scanned-value"></span></span>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Robust cleanup — always removes overlay even if camera throws
  const cleanup = () => {
    if (_cameraScanner) {
      try {
        _cameraScanner.stop().catch(() => {});
      } catch {}
      try {
        _cameraScanner.clear();
      } catch {}
      _cameraScanner = null;
    }
    try { overlay.remove(); } catch {}
  };

  // Close button
  const closeBtn = document.getElementById('close-camera-scanner');
  closeBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    cleanup();
  });

  // Click outside modal
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) cleanup();
  });

  // Escape key
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      cleanup();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);

  // Start camera scanner
  _cameraScanner = new Html5Qrcode('camera-scanner-region');

  _cameraScanner.start(
    { facingMode: 'environment' },
    {
      fps: 10,
      qrbox: { width: 300, height: 150 },
      aspectRatio: 1.5,
    },
    (decodedText) => {
      // Show result briefly
      const resultDiv = document.getElementById('camera-scanner-result');
      const valueSpan = document.getElementById('scanned-value');
      if (resultDiv && valueSpan) {
        valueSpan.textContent = decodedText;
        resultDiv.style.display = 'block';
      }

      // Callback and close after short delay
      setTimeout(() => {
        onScan(decodedText);
        cleanup();
        document.removeEventListener('keydown', escHandler);
      }, 600);
    },
    () => {} // ignore errors (no barcode found in frame)
  ).catch((err) => {
    const region = document.getElementById('camera-scanner-region');
    if (region) {
      region.innerHTML = `
        <div style="padding:2rem;text-align:center;color:var(--color-danger);">
          <p style="font-size:1rem;margin-bottom:0.5rem;">📷 Camera access denied</p>
          <p style="font-size:0.8rem;color:var(--color-text-muted);">Please allow camera access in your browser settings, or use a USB barcode scanner instead.</p>
          <button class="btn btn-ghost btn-sm" style="margin-top:1rem;" onclick="this.closest('.modal-overlay').remove()">Close</button>
        </div>
      `;
    }
    console.error('Camera scanner error:', err);
  });
}

/**
 * Create a scan button element
 * @param {Function} onScan - callback with barcode value
 * @param {Object} options - { label?, size?, variant? }
 * @returns {string} HTML string for the button
 */
export function scanButtonHTML(id, options = {}) {
  const label = options.label || 'Scan';
  const variant = options.variant || 'btn-ghost';
  const size = options.size || '';
  return `<button id="${id}" class="btn ${variant} ${size}" type="button" title="Scan barcode with camera">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/>
      <line x1="7" y1="12" x2="17" y2="12"/><line x1="7" y1="8" x2="13" y2="8"/><line x1="7" y1="16" x2="15" y2="16"/>
    </svg>
    <span>${label}</span>
  </button>`;
}
