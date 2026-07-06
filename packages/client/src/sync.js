import { api } from './api.js';
import { toast } from './utils.js';
import { canWriteBusinessData } from './entitlement.js';
import {
  getOfflineQueue,
  reconcileQueuedTempId,
  removeOfflineQueueItem,
  updateOfflineQueueItem,
} from './offline.js';

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
        if (err.status >= 400 && err.status < 500) {
          updateOfflineQueueItem(queued.id, {
            last_error: err.message || 'This change needs attention before it can sync',
            last_attempted_at: new Date().toISOString(),
          });
          toast('One offline change needs attention and was kept safely on this device', 'warning', 6000);
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
