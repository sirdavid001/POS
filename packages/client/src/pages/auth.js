import { api } from '../api.js';
import { saveSubscription } from '../entitlement.js';
import { toast } from '../utils.js';

const authBrand = `
  <div class="auth-brand">
    <img src="./brand/quickpos-mark.svg" alt="" width="48" height="48">
    <span>QuickPOS</span>
  </div>
`;

export function renderLoginPage() {
  const app = document.getElementById('app');

  app.innerHTML = `
    <div class="login-page">
      <div class="login-card glass-card animate-fade-in">
        ${authBrand}
        <p>Sign in to your point of sale system</p>

        <form id="login-form">
          <div class="form-group">
            <label class="label" for="login-email">Email Address</label>
            <input class="input" type="email" id="login-email" placeholder="owner@yourstore.com" required autocomplete="email">
          </div>
          <div class="form-group">
            <label class="label" for="login-password">Password</label>
            <input class="input" type="password" id="login-password" placeholder="Enter your password" required autocomplete="current-password">
            <div class="auth-field-link">
              <a href="#/forgot-password">Forgot password?</a>
            </div>
          </div>
          <button type="submit" class="btn btn-primary btn-lg" id="login-submit" style="width:100%;margin-top:0.5rem;">
            Sign In
          </button>
        </form>

        <p style="text-align:center;margin-top:1.5rem;font-size:0.8rem;color:var(--color-text-muted);line-height:1.5;">
          Need a store account?
          <a href="https://quickpos.name.ng/account#create" target="_blank" rel="noopener noreferrer" style="color:var(--color-primary-light);">
            Create it on the QuickPOS website
          </a>.
        </p>
      </div>
    </div>
  `;

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('login-submit');
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    btn.disabled = true;
    btn.innerHTML = '<div class="spinner" style="width:20px;height:20px;border-width:2px;"></div> Signing in...';

    try {
      const data = await api.post('/auth/login', { email, password });
      api.setTokens(data.accessToken, data.refreshToken);
      localStorage.setItem('user', JSON.stringify(data.user));
      saveSubscription(data.subscription);
      toast('Welcome back, ' + data.user.name + '!', 'success');
      window.location.hash = '#/dashboard';
    } catch (err) {
      toast(err.message || 'Login failed', 'error');
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  });
}

export function renderForgotPasswordPage() {
  const app = document.getElementById('app');

  app.innerHTML = `
    <div class="login-page">
      <div class="login-card glass-card animate-fade-in">
        ${authBrand}
        <p>Enter your login email and we will send a secure reset link.</p>

        <form id="forgot-password-form">
          <div class="form-group">
            <label class="label" for="forgot-email">Email Address</label>
            <input class="input" type="email" id="forgot-email" placeholder="owner@yourstore.com" required autocomplete="email">
          </div>
          <button type="submit" class="btn btn-primary btn-lg" id="forgot-submit" style="width:100%;margin-top:0.5rem;">
            Send Reset Link
          </button>
        </form>

        <p class="auth-footer">
          Remembered your password? <a href="#/login">Sign in</a>
        </p>
      </div>
    </div>
  `;

  document.getElementById('forgot-password-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = document.getElementById('forgot-submit');
    button.disabled = true;
    button.innerHTML = '<div class="spinner" style="width:20px;height:20px;border-width:2px;"></div> Sending...';

    try {
      const result = await api.post('/auth/forgot-password', {
        email: document.getElementById('forgot-email').value,
      });
      document.getElementById('forgot-password-form').innerHTML = `
        <div class="auth-success">
          <strong>Check your email</strong>
          <p>${result.message}</p>
        </div>
        <a class="btn btn-primary btn-lg" href="#/login" style="width:100%;">Back to Sign In</a>
      `;
    } catch (error) {
      toast(error.message || 'Could not request a password reset', 'error');
      button.disabled = false;
      button.textContent = 'Send Reset Link';
    }
  });
}

export function renderResetPasswordPage() {
  const app = document.getElementById('app');
  const query = window.location.hash.split('?')[1] || '';
  const token = new URLSearchParams(query).get('token') || '';

  app.innerHTML = `
    <div class="login-page">
      <div class="login-card glass-card animate-fade-in">
        ${authBrand}
        <p>Choose a new password for your account.</p>

        ${token ? `
          <form id="reset-password-form">
            <div class="form-group">
              <label class="label" for="reset-password">New Password</label>
              <input class="input" type="password" id="reset-password" placeholder="At least 8 characters" required minlength="8" autocomplete="new-password">
            </div>
            <div class="form-group">
              <label class="label" for="reset-password-confirm">Confirm Password</label>
              <input class="input" type="password" id="reset-password-confirm" placeholder="Enter it again" required minlength="8" autocomplete="new-password">
            </div>
            <button type="submit" class="btn btn-primary btn-lg" id="reset-submit" style="width:100%;margin-top:0.5rem;">
              Reset Password
            </button>
          </form>
        ` : `
          <div class="auth-error">
            This reset link is incomplete. Request a new password reset email.
          </div>
          <a class="btn btn-primary btn-lg" href="#/forgot-password" style="width:100%;">Request New Link</a>
        `}

        <p class="auth-footer">
          <a href="#/login">Back to sign in</a>
        </p>
      </div>
    </div>
  `;

  document.getElementById('reset-password-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = document.getElementById('reset-password').value;
    const confirmation = document.getElementById('reset-password-confirm').value;
    const button = document.getElementById('reset-submit');

    if (password !== confirmation) {
      toast('Passwords do not match', 'error');
      return;
    }

    button.disabled = true;
    button.innerHTML = '<div class="spinner" style="width:20px;height:20px;border-width:2px;"></div> Resetting...';

    try {
      const result = await api.post('/auth/reset-password', { token, password });
      api.clearTokens();
      toast(result.message, 'success');
      window.location.hash = '#/login';
    } catch (error) {
      toast(error.message || 'Could not reset password', 'error');
      button.disabled = false;
      button.textContent = 'Reset Password';
    }
  });
}
