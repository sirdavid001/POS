import { api } from './api.js';
import { toast } from './utils.js';

const QUEUE_KEY = 'quickpos_offline_orders';

export async function attemptSync() {
  const queueJson = localStorage.getItem(QUEUE_KEY);
  if (!queueJson) return;

  try {
    const queue = JSON.parse(queueJson);
    if (!Array.isArray(queue) || queue.length === 0) return;

    console.log(`[Offline Sync] Attempting to sync ${queue.length} offline orders...`);
    const successful = [];
    
    // Process sequentially to maintain order and prevent server flood
    for (let i = 0; i < queue.length; i++) {
      const orderData = queue[i];
      try {
        await api.post('/orders', orderData);
        successful.push(i);
        // Wait 100ms between calls to avoid rate limits
        await new Promise(r => setTimeout(r, 100));
      } catch (err) {
        console.error('[Offline Sync] Failed to sync order', orderData, err);
        // If it's a 4xx error (e.g. invalid data, insufficient stock), we might want to discard it or alert.
        // For now, only drop on 400s, keep retrying on 500s or network drops.
        if (err.message && err.message.includes('400')) {
           successful.push(i); // Drop corrupt/invalid orders so they don't block the queue forever
           toast('Dropped invalid offline order', 'warning');
        }
      }
    }

    if (successful.length > 0) {
      const remaining = queue.filter((_, idx) => !successful.includes(idx));
      localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
      toast(`Successfully synced ${successful.length} offline orders!`, 'success');
    }
  } catch (err) {
    console.error('[Offline Sync] Sync engine failure', err);
  }
}
