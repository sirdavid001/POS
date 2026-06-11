import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        home: resolve(__dirname, 'index.html'),
        features: resolve(__dirname, 'features.html'),
        pricing: resolve(__dirname, 'pricing.html'),
        downloads: resolve(__dirname, 'downloads.html'),
        account: resolve(__dirname, 'account.html'),
        faq: resolve(__dirname, 'faq.html'),
        support: resolve(__dirname, 'support.html'),
        legal: resolve(__dirname, 'legal.html'),
        privacy: resolve(__dirname, 'privacy.html'),
        terms: resolve(__dirname, 'terms.html'),
        refund: resolve(__dirname, 'refund.html'),
      },
    },
  },
});
