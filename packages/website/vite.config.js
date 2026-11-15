import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const staticHeader = `
  <a class="skip-link" href="#main-content">Skip to content</a>
  <header class="site-header" data-site-header>
    <div class="site-shell nav-shell">
      <a class="brand" href="/" aria-label="QuickPOS home">
        <img class="brand-mark" src="/brand/quickpos-mark.svg" width="34" height="34" alt="">
        <span translate="no">QuickPOS</span>
      </a>
      <button class="menu-button" type="button" aria-expanded="false" aria-controls="site-nav" aria-label="Open navigation menu">
        <span></span><span></span><span></span><b>Menu</b>
      </button>
      <nav id="site-nav" class="site-nav" aria-label="Primary navigation">
        <a href="/features">Features</a>
        <a href="/retail-pos-software">Solutions</a>
        <a href="/pricing">Pricing</a>
        <a href="/downloads">Downloads</a>
        <a href="/faq">FAQ</a>
        <a href="/support">Support</a>
        <a href="/account#signin" class="nav-signin">Sign in</a>
        <a href="/account#create" class="button button-small">Create account</a>
      </nav>
    </div>
  </header>`;

const staticFooter = `
  <footer class="site-footer" data-site-footer>
    <div class="site-shell footer-brand-row">
      <a class="brand" href="/" aria-label="QuickPOS home"><img class="brand-mark" src="/brand/quickpos-mark.svg" width="34" height="34" alt=""><span translate="no">QuickPOS</span></a>
      <p>Retail point of sale software for growing stores.</p>
    </div>
    <div class="site-shell footer-grid">
      <div>
        <strong>Product</strong>
        <a href="/features">Features</a>
        <a href="/pricing">Pricing</a>
        <a href="/downloads">Downloads</a>
        <a href="/retail-pos-software">Retail POS software</a>
      </div>
      <div>
        <strong>Help</strong>
        <a href="/account#signin">Store account</a>
        <a href="/faq">FAQ</a>
        <a href="/support">Support</a>
        <a href="/best-pos-software-nigeria">POS buying guide</a>
      </div>
      <div>
        <strong>Company</strong>
        <a href="/about">About QuickPOS</a>
        <a href="/terms">Terms of Service</a>
        <a href="/privacy">Privacy Policy</a>
        <a href="/refund">Refund Policy</a>
      </div>
    </div>
    <div class="site-shell footer-bottom">
      <span>© 2026 SIRDAVID MULTI-TRADE LTD. All rights reserved.</span>
      <span>RC 9387137</span>
    </div>
  </footer>`;

// Preload the product typeface so every device shows the same typography without a late swap.
const fontLinks = `
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Onest:wght@400..800&display=swap">`;

function staticSeoShell() {
  return {
    name: 'quickpos-static-seo-shell',
    transformIndexHtml(html) {
      return html
        .replace('</head>', `${fontLinks}\n</head>`)
        .replace('<header class="site-header" data-site-header></header>', staticHeader)
        .replace('<main id="main-content">', '<main id="main-content" tabindex="-1">')
        .replace(/<main(?![^>]*\bid=)(?=[\s>])/, '<main id="main-content" tabindex="-1"')
        .replace('<footer class="site-footer" data-site-footer></footer>', staticFooter);
    },
  };
}

export default defineConfig({
  plugins: [staticSeoShell()],
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
        about: resolve(import.meta.dirname, 'about.html'),
        posForSmallBusiness: resolve(import.meta.dirname, 'pos-for-small-business.html'),
        retailPosSoftware: resolve(import.meta.dirname, 'retail-pos-software.html'),
        inventoryAndSalesSoftware: resolve(
          import.meta.dirname,
          'inventory-and-sales-software.html',
        ),
        offlinePosSoftware: resolve(import.meta.dirname, 'offline-pos-software.html'),
        barcodePosSystem: resolve(import.meta.dirname, 'barcode-pos-system.html'),
        retailSalesReportingSoftware: resolve(
          import.meta.dirname,
          'retail-sales-reporting-software.html',
        ),
        supermarketPosSoftware: resolve(import.meta.dirname, 'supermarket-pos-software.html'),
        boutiquePosSoftware: resolve(import.meta.dirname, 'boutique-pos-software.html'),
        androidPosApp: resolve(import.meta.dirname, 'android-pos-app.html'),
        windowsPosSoftware: resolve(import.meta.dirname, 'windows-pos-software.html'),
        bestPosSoftwareNigeria: resolve(import.meta.dirname, 'best-pos-software-nigeria.html'),
        posMachineVsPosSoftwareNigeria: resolve(
          import.meta.dirname,
          'pos-machine-vs-pos-software-nigeria.html',
        ),
      },
    },
  },
});
