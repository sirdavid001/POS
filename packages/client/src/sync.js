import { api } from './api.js';
import { toast } from './utils.js';
import { canWriteBusinessData } from './entitlement.js';
import { getOfflineQueue, reconcileQueuedTempId, removeOfflineQueueItem } from './offline.js';

export async function attemptSync() {
  if (!canWriteBusinessData()) return;
  let queue = getOfflineQueue();
  if (!Array.isArray(queue) || queue.length === 0) return;

  try {
    console.log(`[Offline Sync] Attempting to sync ${queue.length} offline changes...`);
    const successful = [];

    // Process sequentially to maintain order and prevent server flood
    for (let i = 0; i < queue.length; i++) {
      const queued = queue[i];
      try {
        let result = null;
        if (queued.method === 'POST') result = await api.post(queued.path, queued.data, { skipOfflineQueue: true });
        if (queued.method === 'PATCH') result = await api.patch(queued.path, queued.data, { skipOfflineQueue: true });
        if (queued.method === 'DELETE') result = await api.delete(queued.path, { skipOfflineQueue: true });
        const serverEntity = result?.product || result?.customer || result?.category || result?.supplier || result?.order;
        if (queued.meta?.temp_id && serverEntity?.id) {
          queue = reconcileQueuedTempId(queued.meta.temp_id, serverEntity.id);
        }
        successful.push(queued.id);
        // Wait 100ms between calls to avoid rate limits
        await new Promise(r => setTimeout(r, 100));
      } catch (err) {
        if (err.code === 'SUBSCRIPTION_EXPIRED') {
          toast('Offline sync is paused until the store renews QuickPOS.', 'warning', 5000);
          break;
        }
        console.error('[Offline Sync] Failed to sync queued change', queued, err);
        // If it's a 4xx error (e.g. invalid data, insufficient stock), we might want to discard it or alert.
        // For now, only drop on 400s, keep retrying on 500s or network drops.
        if (err.status >= 400 && err.status < 500) {
           successful.push(queued.id); // Drop invalid changes so they don't block the queue forever
           toast('Dropped one invalid offline change during sync', 'warning');
        }
      }
    }

    if (successful.length > 0) {
      successful.forEach(removeOfflineQueueItem);
      toast(`Successfully synced ${successful.length} offline change${successful.length === 1 ? '' : 's'}!`, 'success');
    }
  } catch (err) {
    console.error('[Offline Sync] Sync engine failure', err);
  }
}
