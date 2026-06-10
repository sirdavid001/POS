const STORAGE_KEY = 'quickpos_subscription';

export function saveSubscription(subscription) {
  if (!subscription) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(subscription));
  window.dispatchEvent(new CustomEvent('subscription-updated', { detail: subscription }));
}

export function clearSubscription() {
  localStorage.removeItem(STORAGE_KEY);
}

export function getSubscription() {
  try {
    const subscription = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!subscription) return null;

    const now = Date.now();
    const offlineLimit = subscription.offline_valid_until
      ? new Date(subscription.offline_valid_until).getTime()
      : 0;
    const entitlementEnd = subscription.entitlement_ends_at
      ? new Date(subscription.entitlement_ends_at).getTime()
      : Infinity;
    const locallyValid = now <= offlineLimit && now <= entitlementEnd;

    return {
      ...subscription,
      can_write: Boolean(subscription.can_write && locallyValid),
      offline_expired: Boolean(subscription.can_write && !locallyValid),
    };
  } catch {
    return null;
  }
}

export function canWriteBusinessData() {
  return Boolean(getSubscription()?.can_write);
}
