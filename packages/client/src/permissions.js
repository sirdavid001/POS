const SETUP_KEY = 'quickpos_device_permissions_ready';

export function hasCompletedPermissionSetup() {
  return localStorage.getItem(SETUP_KEY) === 'true';
}

export function completePermissionSetup() {
  localStorage.setItem(SETUP_KEY, 'true');
}

export function resetPermissionSetup() {
  localStorage.removeItem(SETUP_KEY);
}
