import { api } from '../api.js';
import { getSubscription, saveSubscription } from '../entitlement.js';
import { renderLayout } from './layout.js';
import { formatCurrency, formatDate, toast } from '../utils.js';

function statusCopy(subscription) {
  if (!subscription) return 'Checking your subscription...';
  if (subscription.status === 'grandfathered') return 'Your store has grandfathered access.';
  if (subscription.status === 'trialing') {
    return `All features are included in your trial through ${formatDate(subscription.trial_ends_at)}.`;
  }
  if (subscription.status === 'expired') {
    return 'QuickPOS is read-only. Reports, exports, printing, statement email, and billing remain available.';
  }
  if (subscription.cancel_at_period_end) {
    return `Automatic renewal is cancelled. Access continues through ${formatDate(subscription.current_period_end)}.`;
  }
  return `Your ${subscription.plan_name || subscription.plan_code || ''} plan is active through ${formatDate(subscription.current_period_end)}.`;
}

function planDescription(plan) {
  if (plan.code === 'monthly') return 'Flexible monthly billing';
  if (plan.code === 'quarterly') return 'Save ₦1,500 every three months';
  if (plan.code === 'yearly') return 'Best value, save ₦10,000 each year';
  return 'First payment only, six months of access';
}

export async function renderBilling() {
  const content = renderLayout('billing');
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  if (user.role !== 'admin') {
    content.innerHTML = `
      <div class="glass-card" style="padding:2rem;max-width:680px;">
        <h2>Store subscription</h2>
        <p style="margin-top:0.75rem;color:var(--color-text-muted);">
          Only a store admin can manage billing. Your access follows the store's plan.
        </p>
      </div>
    `;
    return;
  }

  content.innerHTML = `
    <div class="animate-fade-in">
      <div class="page-header">
        <div>
          <h2>Billing</h2>
          <p style="color:var(--color-text-muted);margin-top:0.25rem;">One plan covers unlimited staff and store devices.</p>
        </div>
      </div>
      <div id="billing-status" class="glass-card billing-status-card"></div>
      <h3 style="margin:1.5rem 0 0.8rem;">Choose a plan</h3>
      <div id="billing-plans" class="billing-plan-grid">
        <div class="spinner" style="margin:2rem auto;"></div>
      </div>
      <div class="glass-card" style="padding:1.25rem;margin-top:1.5rem;">
        <h3 style="font-size:1rem;margin-bottom:0.8rem;">Payment history</h3>
        <div id="billing-transactions"><div class="spinner"></div></div>
      </div>
    </div>
  `;

  function renderStatus(subscription) {
    const status = document.getElementById('billing-status');
    if (!status) return;
    const badgeClass = subscription?.can_write ? 'badge-success' : 'badge-danger';
    status.innerHTML = `
      <div>
        <span class="badge ${badgeClass}">${subscription?.status || 'checking'}</span>
        <h3 style="margin-top:0.7rem;">${subscription?.plan_name || (subscription?.status === 'trialing' ? '7-day free trial' : 'QuickPOS subscription')}</h3>
        <p style="color:var(--color-text-muted);margin-top:0.35rem;">${statusCopy(subscription)}</p>
      </div>
      ${subscription?.provider && subscription?.recurring && !subscription?.cancel_at_period_end ? `
        <button class="btn btn-ghost" id="cancel-subscription">Cancel renewal</button>
      ` : ''}
    `;

    document.getElementById('cancel-subscription')?.addEventListener('click', async () => {
      if (!confirm('Cancel automatic renewal? Your access will continue through the current paid period.')) return;
      try {
        const result = await api.post('/billing/cancel', {});
        saveSubscription(result.subscription);
        renderStatus(result.subscription);
        toast('Automatic renewal cancelled', 'success');
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  }

  async function loadTransactions() {
    try {
      const { transactions } = await api.get('/billing/transactions');
      const target = document.getElementById('billing-transactions');
      if (!transactions.length) {
        target.innerHTML = '<p style="color:var(--color-text-muted);">No subscription payments yet.</p>';
        return;
      }
      target.innerHTML = `
        <div class="table-scroll-wrapper">
          <table class="data-table">
            <thead><tr><th>Date</th><th>Plan</th><th>Provider</th><th>Reference</th><th>Amount</th><th>Status</th></tr></thead>
            <tbody>
              ${transactions.map((transaction) => `
                <tr>
                  <td>${formatDate(transaction.paid_at || transaction.created_at)}</td>
                  <td>${transaction.plan_code}</td>
                  <td>${transaction.provider}</td>
                  <td><code>${transaction.provider_reference}</code></td>
                  <td>${formatCurrency(transaction.amount_ngn)}</td>
                  <td><span class="badge ${transaction.status === 'success' ? 'badge-success' : 'badge-warning'}">${transaction.status}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch (error) {
      document.getElementById('billing-transactions').textContent = error.message;
    }
  }

  function pollForActivation(planCode) {
    let attempts = 0;
    const timer = setInterval(async () => {
      if (window.location.hash !== '#/billing' || attempts++ >= 30) {
        clearInterval(timer);
        return;
      }
      try {
        const result = await api.get('/billing/status');
        saveSubscription(result.subscription);
        renderStatus(result.subscription);
        if (result.subscription.plan_code === planCode && result.subscription.status === 'active') {
          clearInterval(timer);
          toast('Payment confirmed. QuickPOS is active.', 'success', 5000);
          loadTransactions();
        }
      } catch {}
    }, 4000);
  }

  try {
    const [{ plans }, statusResult] = await Promise.all([
      api.get('/billing/plans'),
      api.get('/billing/status'),
    ]);
    saveSubscription(statusResult.subscription);
    renderStatus(statusResult.subscription);

    const visiblePlans = plans.filter((plan) =>
      plan.code !== 'launch_6m' || (plan.available && statusResult.launch_offer_eligible)
    );
    document.getElementById('billing-plans').innerHTML = visiblePlans.map((plan) => `
      <article class="glass-card billing-plan-card ${plan.code === 'yearly' ? 'featured' : ''}">
        ${plan.code === 'yearly' ? '<span class="billing-plan-label">Best value</span>' : ''}
        ${plan.code === 'launch_6m' ? '<span class="billing-plan-label launch">Launch offer</span>' : ''}
        <h3>${plan.name}</h3>
        <div class="billing-price">${formatCurrency(plan.price_ngn).replace('.00', '')}</div>
        <p>${planDescription(plan)}</p>
        <div class="billing-provider-actions">
          <button class="btn btn-primary" data-checkout-provider="paystack" data-plan="${plan.code}">Paystack</button>
          <button class="btn btn-ghost" data-checkout-provider="flutterwave" data-plan="${plan.code}">Flutterwave</button>
        </div>
      </article>
    `).join('');

    document.querySelectorAll('[data-checkout-provider]').forEach((button) => {
      button.addEventListener('click', async () => {
        const original = button.textContent;
        button.disabled = true;
        button.textContent = 'Opening...';
        try {
          const checkout = await api.post('/billing/checkout', {
            provider: button.dataset.checkoutProvider,
            plan_code: button.dataset.plan,
          });
          window.open(checkout.authorization_url, '_blank', 'noopener,noreferrer');
          toast('Complete payment in the secure provider page. QuickPOS will update automatically.', 'info', 7000);
          pollForActivation(button.dataset.plan);
        } catch (error) {
          toast(error.message, 'error', 5000);
        } finally {
          button.disabled = false;
          button.textContent = original;
        }
      });
    });
  } catch (error) {
    document.getElementById('billing-plans').innerHTML = `<p>${error.message}</p>`;
    renderStatus(getSubscription());
  }

  loadTransactions();
}
