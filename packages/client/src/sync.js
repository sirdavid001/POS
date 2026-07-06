import { api } from './api.js';
import { toast } from './utils.js';
import { canWriteBusinessData } from './entitlement.js';
import {
  cacheBootstrapSnapshot,
  getLastSyncAt,
  getOfflineQueue,
  getOfflineQueueCount,
  isNetworkError,
  reconcileQueuedTempId,
  removeOfflineQueueItem,
  updateOfflineQueueItem,
} from './offline.js';

let activeSync = null;

function setSyncState(status, detail = {}) {
  window.dispatchEvent(new CustomEvent('sync-status-changed', {
    detail: { status, ...detail },
  }));
}

function recentlyRefreshed() {
  const lastSync = getLastSyncAt();
  return lastSync && Date.now() - new Date(lastSync).getTime() < 2 * 60 * 1000;
}

export async function refreshOfflineSnapshot({ force = false } = {}) {
  if (!localStorage.getItem('user') || !navigator.onLine) return false;
  if (!force && recentlyRefreshed()) return true;
  if (getOfflineQueueCount() > 0) return false;

  try {
    setSyncState('refreshing');
    const result = await api.get('/sync/bootstrap', { skipOfflineQueue: true });
    cacheBootstrapSnapshot(result.snapshot, result.synced_at);
    setSyncState('synced', { synced_at: result.synced_at });
    window.dispatchEvent(new CustomEvent('offline-data-refreshed', { detail: result }));
    return true;
  } catch (error) {
    setSyncState(isNetworkError(error) ? 'offline' : 'refresh-failed', {
      message: error.message,
    });
    return false;
  }
}

async function performSync({ manual = false } = {}) {
  if (!localStorage.getItem('user')) return { synced: 0, remaining: 0 };
  if (!navigator.onLine) {
    setSyncState('offline');
    return { synced: 0, remaining: getOfflineQueueCount() };
  }

  let queue = getOfflineQueue();
  if (!canWriteBusinessData() && queue.length) {
    setSyncState('paused', { remaining: queue.length });
    if (manual) toast('Sync is paused until the store subscription is active.', 'warning', 5000);
    await refreshOfflineSnapshot();
    return { synced: 0, remaining: queue.length };
  }

  let synced = 0;
  let needsAttention = 0;
  let connectionLost = false;
  setSyncState(queue.length ? 'syncing' : 'checking', { total: queue.length, completed: 0 });

  for (const queued of queue) {
    updateOfflineQueueItem(queued.id, {
      attempt_count: Number(queued.attempt_count || 0) + 1,
      last_attempted_at: new Date().toISOString(),
    });

    try {
      const options = {
        skipOfflineQueue: true,
        headers: { 'X-QuickPOS-Mutation-ID': queued.id },
      };
      let result = null;
      if (queued.method === 'POST') result = await api.post(queued.path, queued.data, options);
      if (queued.method === 'PATCH') result = await api.patch(queued.path, queued.data, options);
      if (queued.method === 'DELETE') result = await api.delete(queued.path, options);

      const serverEntity = result?.product || result?.customer || result?.category || result?.supplier || result?.order || result?.log;
      if (queued.meta?.temp_id && serverEntity?.id) {
        reconcileQueuedTempId(queued.meta.temp_id, serverEntity.id);
      }
      removeOfflineQueueItem(queued.id);
      synced += 1;
      setSyncState('syncing', {
        total: queue.length,
        completed: synced,
        remaining: getOfflineQueueCount(),
      });
    } catch (error) {
      if (error.code === 'SUBSCRIPTION_EXPIRED' || error.code === 'INITIAL_ACTIVATION_REQUIRED') {
        setSyncState('paused', { remaining: getOfflineQueueCount() });
        if (manual) toast('Offline changes are safe, but sync needs an active subscription.', 'warning', 6000);
        break;
      }
      if (isNetworkError(error)) {
        connectionLost = true;
        setSyncState('offline', { remaining: getOfflineQueueCount() });
        break;
      }

      const retryable = !error.status || error.status >= 500 || error.status === 409 || error.status === 429;
      updateOfflineQueueItem(queued.id, {
        last_error: retryable ? null : (error.message || 'This change needs attention before it can sync'),
        retry_after: retryable ? new Date(Date.now() + 30_000).toISOString() : null,
      });

      if (!retryable) {
        needsAttention += 1;
        continue;
      }
      setSyncState('retrying', { remaining: getOfflineQueueCount(), message: error.message });
      break;
    }
  }

  const remaining = getOfflineQueueCount();
  if (!connectionLost && remaining === 0) {
    await refreshOfflineSnapshot({ force: true });
  } else if (!connectionLost) {
    setSyncState(needsAttention ? 'attention' : 'pending', { remaining, needs_attention: needsAttention });
  }

  if (synced > 0) {
    toast(`${synced} offline change${synced === 1 ? '' : 's'} synced successfully.`, 'success');
  } else if (manual && remaining === 0 && !connectionLost) {
    toast('Everything is up to date.', 'success');
  }
  if (manual && needsAttention) {
    toast(`${needsAttention} saved change${needsAttention === 1 ? '' : 's'} need review before syncing.`, 'warning', 6000);
  }

  return { synced, remaining, needs_attention: needsAttention };
}

export function attemptSync(options = {}) {
  if (activeSync) return activeSync;
  activeSync = performSync(options).finally(() => {
    activeSync = null;
  });
  return activeSync;
}
