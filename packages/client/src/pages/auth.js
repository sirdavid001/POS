import { api } from '../api.js';
import { toast } from '../utils.js';

export function renderLoginPage() {
  const app = document.getElementById('app');

  app.innerHTML = `
    <div class="login-page">
      <div class="login-card glass-card animate-fade-in">
        <h1>⚡ QuickPOS</h1>
        <p>Sign in to your point of sale system</p>

        <form id="login-form">
          <div class="form-group">
            <label class="label" for="login-email">Email Address</label>
            <input class="input" type="email" id="login-email" placeholder="admin@posapp.com" required autocomplete="email">
          </div>
          <div class="form-group">
            <label class="label" for="login-password">Password</label>
            <input class="input" type="password" id="login-password" placeholder="Enter your password" required autocomplete="current-password">
          </div>
          <button type="submit" class="btn btn-primary btn-lg" id="login-submit" style="width:100%;margin-top:0.5rem;">
            Sign In
          </button>
        </form>

        <p style="text-align:center;margin-top:1.5rem;font-size:0.8rem;color:var(--color-text-muted);">
          Don't have an account? <a href="#/register" style="color:var(--color-primary-light);">Register</a>
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
      toast('Welcome back, ' + data.user.name + '!', 'success');
      window.location.hash = '#/dashboard';
    } catch (err) {
      toast(err.message || 'Login failed', 'error');
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  });
}

export function renderRegisterPage() {
  const app = document.getElementById('app');

  app.innerHTML = `
    <div class="login-page">
      <div class="login-card glass-card animate-fade-in">
        <h1>⚡ QuickPOS</h1>
        <p>Create a new account</p>

        <form id="register-form">
          <div class="form-group">
            <label class="label" for="reg-name">Full Name</label>
            <input class="input" type="text" id="reg-name" placeholder="Your name" required>
          </div>
          <div class="form-group">
            <label class="label" for="reg-email">Email Address</label>
            <input class="input" type="email" id="reg-email" placeholder="you@email.com" required>
          </div>
          <div class="form-group">
            <label class="label" for="reg-password">Password</label>
            <input class="input" type="password" id="reg-password" placeholder="Min 6 characters" required minlength="6">
          </div>
          <button type="submit" class="btn btn-primary btn-lg" id="reg-submit" style="width:100%;margin-top:0.5rem;">
            Create Account
          </button>
        </form>

        <p style="text-align:center;margin-top:1.5rem;font-size:0.8rem;color:var(--color-text-muted);">
          Already have an account? <a href="#/login" style="color:var(--color-primary-light);">Sign in</a>
        </p>
      </div>
    </div>
  `;

  document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('reg-submit');

    btn.disabled = true;
    btn.innerHTML = '<div class="spinner" style="width:20px;height:20px;border-width:2px;"></div> Creating...';

    try {
      await api.post('/auth/register', {
        name: document.getElementById('reg-name').value,
        email: document.getElementById('reg-email').value,
        password: document.getElementById('reg-password').value,
      });
      toast('Account created! Please sign in.', 'success');
      window.location.hash = '#/login';
    } catch (err) {
      toast(err.message || 'Registration failed', 'error');
      btn.disabled = false;
      btn.textContent = 'Create Account';
    }
  });
}
