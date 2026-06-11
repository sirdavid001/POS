import { api } from '../api.js';
import { getSubscription, saveSubscription } from '../entitlement.js';
import { renderLayout } from './layout.js';
import { formatCurrency, formatDate, toast } from '../utils.js';

function statusCopy(subscription) {
  if (!subscription) return 'Checking your subscription...';
  if (subscription.status === 'grandfathered') return 'Your store has grandfathered access.';
  if (subscription.activation_required && subscription.status === 'pending_activation') {
    return 'Pay the one-time ₦20,000 activation fee to unlock every feature for five months.';
  }
  if (subscription.status === 'trialing') {
    return `Your existing trial remains active through ${formatDate(subscription.trial_ends_at)}. Initial activation is required afterward.`;
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
  if (plan.code === 'activation_5m') return 'Required once for new stores, with five months of access';
  if (plan.code === 'monthly') return 'Flexible monthly billing';
  if (plan.code === 'quarterly') return 'Save ₦1,500 every three months';
  if (plan.code === 'yearly') return 'Best value, save ₦10,000 each year';
  return 'All QuickPOS features included';
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
      <h3 id="billing-plan-heading" style="margin:1.5rem 0 0.8rem;">Choose a plan</h3>
      <p class="billing-legal-note">
        Before payment, review the
        <a href="https://quickpos.name.ng/terms" target="_blank" rel="noopener noreferrer">Terms of Service</a>
        and
        <a href="https://quickpos.name.ng/refund" target="_blank" rel="noopener noreferrer">Refund Policy</a>.
        Recurring subscriptions renew automatically at the end of each billing period until cancelled from this page.
        Payments are processed securely by Paystack or Flutterwave; QuickPOS does not store card details.
      </p>
      <label class="billing-legal-acknowledgement">
        <input type="checkbox" id="billing-legal-acknowledgement">
        <span>I agree to the Terms of Service and acknowledge the Refund Policy, including the no-prorated-refunds rule.</span>
      </label>
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
    const planName = subscription?.activation_required && subscription?.status === 'pending_activation'
      ? 'Initial activation required'
      : subscription?.plan_name || (subscription?.status === 'trialing' ? 'Existing free trial' : 'QuickPOS subscription');
    status.innerHTML = `
      <div>
        <span class="badge ${badgeClass}">${subscription?.status || 'checking'}</span>
        <h3 style="margin-top:0.7rem;">${planName}</h3>
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
      if (!window.location.hash.startsWith('#/billing') || attempts++ >= 30) {
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
          setTimeout(() => renderBilling(), 600);
        }
      } catch {}
    }, 4000);
  }

  try {
    const [{ plans, providers }, statusResult] = await Promise.all([
      api.get('/billing/plans'),
      api.get('/billing/status'),
    ]);
    saveSubscription(statusResult.subscription);
    renderStatus(statusResult.subscription);

    const needsActivation = Boolean(statusResult.subscription.activation_required);
    const activationPeriodActive =
      statusResult.subscription.plan_code === 'activation_5m' &&
      statusResult.subscription.can_write;
    const visiblePlans = plans.filter((plan) =>
      needsActivation ? plan.code === 'activation_5m' : plan.code !== 'activation_5m'
    );
    const planHeading = document.getElementById('billing-plan-heading');
    if (planHeading) {
      planHeading.textContent = needsActivation ? 'Activate your store' : 'Renewal plans';
    }
    const configuredProviderCount = Object.values(providers || {})
      .filter((provider) => provider.available).length;
    document.getElementById('billing-plans').innerHTML = `
      ${configuredProviderCount === 0 ? `
        <div class="glass-card billing-provider-notice">
          Online subscription checkout is temporarily unavailable. Contact
          <a href="mailto:support@quickpos.name.ng">support@quickpos.name.ng</a>
          for activation assistance.
        </div>
      ` : ''}
      ${activationPeriodActive ? `
        <div class="glass-card billing-provider-notice">
          Your five-month activation period is active through
          ${formatDate(statusResult.subscription.current_period_end)}.
          Renewal checkout becomes available after this period.
        </div>
      ` : ''}
      ${visiblePlans.map((plan) => `
      <article class="glass-card billing-plan-card ${plan.code === 'yearly' ? 'featured' : ''}">
        ${plan.code === 'yearly' ? '<span class="billing-plan-label">Best value</span>' : ''}
        ${plan.code === 'activation_5m' ? '<span class="billing-plan-label launch">Required once</span>' : ''}
        <h3>${plan.name}</h3>
        <div class="billing-price">${formatCurrency(plan.price_ngn).replace('.00', '')}</div>
        <p>${planDescription(plan)}</p>
        <div class="billing-provider-actions">
          <button class="btn btn-primary" data-checkout-provider="paystack" data-plan="${plan.code}"
            data-checkout-enabled="${Boolean(plan.provider_availability?.paystack && !activationPeriodActive)}"
            disabled title="Acknowledge the payment terms before checkout">
            ${plan.provider_availability?.paystack ? 'Paystack' : 'Paystack unavailable'}
          </button>
          <button class="btn btn-ghost" data-checkout-provider="flutterwave" data-plan="${plan.code}"
            data-checkout-enabled="${Boolean(plan.provider_availability?.flutterwave && !activationPeriodActive)}"
            disabled title="Acknowledge the payment terms before checkout">
            ${plan.provider_availability?.flutterwave ? 'Flutterwave' : 'Flutterwave unavailable'}
          </button>
        </div>
      </article>
      `).join('')}
    `;

    const legalAcknowledgement = document.getElementById('billing-legal-acknowledgement');
    const checkoutButtons = [...document.querySelectorAll('[data-checkout-provider]')];
    const syncCheckoutButtons = () => {
      checkoutButtons.forEach((button) => {
        const providerAvailable = button.dataset.checkoutEnabled === 'true';
        button.disabled = !providerAvailable || !legalAcknowledgement.checked;
        button.title = providerAvailable
          ? legalAcknowledgement.checked ? '' : 'Acknowledge the payment terms before checkout'
          : activationPeriodActive
            ? 'Available after the current activation period'
            : `${button.dataset.checkoutProvider === 'paystack' ? 'Paystack' : 'Flutterwave'} is not available for this plan`;
      });
    };
    legalAcknowledgement.addEventListener('change', syncCheckoutButtons);
    syncCheckoutButtons();

    document.querySelectorAll('[data-checkout-provider]').forEach((button) => {
      button.addEventListener('click', async () => {
        if (button.disabled) return;
        if (!legalAcknowledgement.checked) {
          toast('Acknowledge the Terms of Service and Refund Policy before payment.', 'error');
          return;
        }
        const original = button.textContent;
        button.disabled = true;
        button.textContent = 'Opening...';
        try {
          const checkout = await api.post('/billing/checkout', {
            provider: button.dataset.checkoutProvider,
            plan_code: button.dataset.plan,
            legal_acknowledged: true,
          });
          window.open(checkout.authorization_url, '_blank', 'noopener,noreferrer');
          toast('Complete payment in the secure provider page. QuickPOS will update automatically.', 'info', 7000);
          pollForActivation(button.dataset.plan);
        } catch (error) {
          toast(error.message, 'error', 5000);
        } finally {
          button.textContent = original;
          syncCheckoutButtons();
        }
      });
    });
  } catch (error) {
    document.getElementById('billing-plans').innerHTML = `<p>${error.message}</p>`;
    renderStatus(getSubscription());
  }

  loadTransactions();
}
