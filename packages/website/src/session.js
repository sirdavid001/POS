export const SITE_KEYS = {
  accessToken: 'quickpos_site_access_token',
  refreshToken: 'quickpos_site_refresh_token',
  user: 'quickpos_site_user',
};

export const SITE_SESSION_EVENT = 'quickpos:session-change';

function notifySessionChange() {
  window.dispatchEvent(new Event(SITE_SESSION_EVENT));
}

export function readSiteSession() {
  let user = null;
  try {
    user = JSON.parse(localStorage.getItem(SITE_KEYS.user) || 'null');
  } catch {
    localStorage.removeItem(SITE_KEYS.user);
  }

  return {
    accessToken: localStorage.getItem(SITE_KEYS.accessToken),
    refreshToken: localStorage.getItem(SITE_KEYS.refreshToken),
    user,
  };
}

export function storeSiteSession(data) {
  localStorage.setItem(SITE_KEYS.accessToken, data.accessToken);
  localStorage.setItem(SITE_KEYS.refreshToken, data.refreshToken);
  localStorage.setItem(SITE_KEYS.user, JSON.stringify(data.user));
  notifySessionChange();
}

export function updateStoredSiteUser(user) {
  localStorage.setItem(SITE_KEYS.user, JSON.stringify(user));
  notifySessionChange();
}

export function clearStoredSiteSession() {
  localStorage.removeItem(SITE_KEYS.accessToken);
  localStorage.removeItem(SITE_KEYS.refreshToken);
  localStorage.removeItem(SITE_KEYS.user);
  notifySessionChange();
}
