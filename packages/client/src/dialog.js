// Shared behaviour for every `.modal-overlay` dialog the pages append to <body>.
//
// Pages keep building their own markup; this module watches for overlays and adds what each
// dialog needs: focus moves in, the app behind becomes inert (no clicks, no Tab), Escape and
// route changes close the top dialog, and focus returns to where it was. Closing goes through
// the dialog's own `[data-dialog-close]` button when it has one, so its cleanup (stopping the
// camera, restoring state) still runs.

const OVERLAY = 'modal-overlay';
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const stack = [];
let lastFocusOutside = null;

function appRoot() {
  return document.getElementById('app');
}

function syncInert() {
  const root = appRoot();
  if (root) root.inert = stack.length > 0;
  stack.forEach((overlay, index) => {
    overlay.inert = index !== stack.length - 1;
  });
}

function focusInto(overlay) {
  if (overlay.contains(document.activeElement)) return;
  const dialog = overlay.querySelector('[role="dialog"]') || overlay;
  const target = dialog.querySelector('[autofocus]') || dialog.querySelector(FOCUSABLE);
  if (target) {
    target.focus();
  } else {
    if (!dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
    dialog.focus();
  }
}

const returnFocus = new WeakMap();

function opened(overlay) {
  if (stack.includes(overlay)) return;
  returnFocus.set(overlay, lastFocusOutside);
  stack.push(overlay);
  syncInert();
  focusInto(overlay);
}

function closed(overlay) {
  const index = stack.indexOf(overlay);
  if (index === -1) return;
  stack.splice(index, 1);
  overlay.inert = false;
  syncInert();
  const top = stack[stack.length - 1];
  const opener = returnFocus.get(overlay);
  if (top) {
    focusInto(top);
  } else if (opener?.isConnected) {
    opener.focus();
  }
}

/** Close one dialog the way its own Close/Cancel button would. */
export function closeDialog(overlay) {
  if (!overlay?.isConnected) return;
  const closeButton = overlay.querySelector('[data-dialog-close]');
  if (closeButton) {
    closeButton.click();
  }
  if (overlay.isConnected) overlay.remove();
}

/** Close every open dialog, newest first. Used when the route changes. */
export function closeAllDialogs() {
  [...stack].reverse().forEach(closeDialog);
}

function isOverlay(node) {
  return node instanceof HTMLElement && node.classList.contains(OVERLAY);
}

export function initDialogs() {
  if (initDialogs.done) return;
  initDialogs.done = true;

  document.addEventListener('focusin', (event) => {
    // Pages often focus a field inside a new dialog before it is registered here,
    // so test the DOM rather than the stack.
    if (!event.target.closest?.(`.${OVERLAY}`)) {
      lastFocusOutside = event.target;
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    const top = stack[stack.length - 1];
    if (!top || top.hasAttribute('data-dialog-own-escape')) return;
    event.preventDefault();
    closeDialog(top);
  });

  new MutationObserver((records) => {
    for (const record of records) {
      record.addedNodes.forEach((node) => { if (isOverlay(node)) opened(node); });
      record.removedNodes.forEach((node) => { if (isOverlay(node)) closed(node); });
    }
  }).observe(document.body, { childList: true });

  document.querySelectorAll(`body > .${OVERLAY}`).forEach(opened);
}
