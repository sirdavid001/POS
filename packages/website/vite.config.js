import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        home: resolve(import.meta.dirname, 'index.html'),
        features: resolve(import.meta.dirname, 'features.html'),
        pricing: resolve(import.meta.dirname, 'pricing.html'),
        downloads: resolve(import.meta.dirname, 'downloads.html'),
        account: resolve(import.meta.dirname, 'account.html'),
        faq: resolve(import.meta.dirname, 'faq.html'),
        support: resolve(import.meta.dirname, 'support.html'),
        legal: resolve(import.meta.dirname, 'legal.html'),
        privacy: resolve(import.meta.dirname, 'privacy.html'),
        accountDeletion: resolve(import.meta.dirname, 'account-deletion.html'),
        terms: resolve(import.meta.dirname, 'terms.html'),
        refund: resolve(import.meta.dirname, 'refund.html'),
      },
    },
  },
});
