// Searchable customer picker for checkout: type a name or phone, pick with the mouse or
// arrow keys, or add a new customer without leaving the sale.
import { api } from './api.js';
import { debounce, escapeHTML, toast } from './utils.js';

const RESULT_LIMIT = 8;

function isLinkable(customer) {
  // Customers created offline have temporary ids that queued sales cannot reference yet.
  return customer && !customer.offline && Number.isSafeInteger(Number(customer.id)) && Number(customer.id) > 0;
}

function looksLikePhone(value) {
  return /^[+\d][\d\s()-]{5,}$/.test(value.trim());
}

export function mountCustomerPicker(root) {
  root.innerHTML = `
    <label class="label" for="customer-search">Customer (optional)</label>
    <div class="customer-picker">
      <input class="input" id="customer-search" type="search" role="combobox" autocomplete="off" spellcheck="false"
        aria-autocomplete="list" aria-expanded="false" aria-controls="customer-results"
        placeholder="Walk-in. Search name or phone…">
      <ul class="customer-results" id="customer-results" role="listbox" aria-label="Matching customers" hidden></ul>
    </div>
    <p class="field-help" id="customer-selected" aria-live="polite">Walk-in customer</p>
    <div class="customer-add" id="customer-add" hidden>
      <div class="customer-add-fields">
        <label class="sr-only" for="new-customer-name">New customer name</label>
        <input class="input" id="new-customer-name" autocomplete="off" placeholder="Name">
        <label class="sr-only" for="new-customer-phone">New customer phone</label>
        <input class="input" id="new-customer-phone" type="tel" inputmode="tel" autocomplete="off" placeholder="Phone (optional)">
      </div>
      <div class="customer-add-actions">
        <button type="button" class="btn btn-ghost btn-sm" id="new-customer-cancel">Cancel</button>
        <button type="button" class="btn btn-primary btn-sm" id="new-customer-save">Save customer</button>
      </div>
    </div>
  `;

  const input = root.querySelector('#customer-search');
  const list = root.querySelector('#customer-results');
  const status = root.querySelector('#customer-selected');
  const addPanel = root.querySelector('#customer-add');
  const nameInput = root.querySelector('#new-customer-name');
  const phoneInput = root.querySelector('#new-customer-phone');
  const saveButton = root.querySelector('#new-customer-save');

  let selected = null;
  let results = [];
  let active = -1;
  let lastQuery = '';

  function setSelected(customer) {
    selected = customer && isLinkable(customer) ? customer : null;
    input.value = selected ? selected.name : '';
    status.textContent = selected
      ? `Sale linked to ${selected.name}${selected.phone ? ` · ${selected.phone}` : ''}`
      : 'Walk-in customer';
  }

  function close() {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  }

  function render() {
    const query = input.value.trim();
    const items = results.map((customer, index) => `
      <li role="option" id="customer-option-${index}" class="customer-option${index === active ? ' is-active' : ''}${isLinkable(customer) ? '' : ' is-pending'}"
        aria-selected="${index === active}" data-index="${index}">
        <span class="customer-option-name">${escapeHTML(customer.name)}</span>
        <span class="customer-option-meta">${escapeHTML(isLinkable(customer) ? (customer.phone || customer.email || '') : 'Syncing, link after sync')}</span>
      </li>`).join('');
    const addIndex = results.length;
    const addLabel = query ? `Add “${escapeHTML(query)}” as a new customer` : 'Add a new customer';
    list.innerHTML = `${items || (query ? '<li class="customer-empty" role="presentation">No matching customer</li>' : '')}
      <li role="option" id="customer-option-${addIndex}" class="customer-option customer-option-add${active === addIndex ? ' is-active' : ''}"
        aria-selected="${active === addIndex}" data-index="${addIndex}">+ ${addLabel}</li>`;
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    if (active >= 0) input.setAttribute('aria-activedescendant', `customer-option-${active}`);
    else input.removeAttribute('aria-activedescendant');
  }

  async function search() {
    const query = input.value.trim();
    lastQuery = query;
    try {
      const params = new URLSearchParams({ limit: String(RESULT_LIMIT) });
      if (query) params.set('search', query);
      const data = await api.get(`/customers?${params}`);
      if (query !== lastQuery) return;
      results = (data.customers || []).slice(0, RESULT_LIMIT);
    } catch {
      results = [];
    }
    active = -1;
    if (document.activeElement === input) render();
  }
  const debouncedSearch = debounce(search, 200);

  function openAdd() {
    const query = input.value.trim();
    close();
    addPanel.hidden = false;
    nameInput.value = looksLikePhone(query) ? '' : query;
    phoneInput.value = looksLikePhone(query) ? query : '';
    (nameInput.value ? phoneInput : nameInput).focus();
  }

  function choose(index) {
    if (index === results.length) {
      openAdd();
      return;
    }
    const customer = results[index];
    if (!customer) return;
    if (!isLinkable(customer)) {
      toast(`${customer.name} is still syncing. Link them to sales after the next sync.`, 'warning', 5000);
      return;
    }
    setSelected(customer);
    close();
  }

  input.addEventListener('focus', () => { if (!selected) search(); });
  input.addEventListener('input', () => {
    if (selected) {
      selected = null;
      status.textContent = 'Walk-in customer';
    }
    debouncedSearch();
  });
  input.addEventListener('keydown', (event) => {
    const count = results.length + 1;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (list.hidden) render();
      active = event.key === 'ArrowDown' ? (active + 1) % count : (active - 1 + count) % count;
      render();
      list.querySelector(`#customer-option-${active}`)?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter' && !list.hidden && active >= 0) {
      event.preventDefault();
      choose(active);
    } else if (event.key === 'Escape' && !list.hidden) {
      // Close only the list; the dialog stays open.
      event.preventDefault();
      close();
    }
  });
  input.addEventListener('blur', () => setTimeout(() => { if (!root.contains(document.activeElement)) close(); }, 120));
  list.addEventListener('mousedown', (event) => event.preventDefault());
  list.addEventListener('click', (event) => {
    const option = event.target.closest('[data-index]');
    if (option) choose(Number(option.dataset.index));
  });

  root.querySelector('#new-customer-cancel').addEventListener('click', () => {
    addPanel.hidden = true;
    input.focus();
  });
  saveButton.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) {
      toast('Enter the customer’s name', 'warning');
      nameInput.focus();
      return;
    }
    saveButton.disabled = true;
    try {
      const result = await api.post('/customers', { name, phone: phoneInput.value.trim() || null });
      addPanel.hidden = true;
      if (result.offline) {
        setSelected(null);
        toast(`${name} is saved on this device. Link them to sales after the next sync.`, 'warning', 5000);
      } else {
        setSelected(result.customer);
        toast(`Added ${name}`, 'success');
      }
    } catch (err) {
      toast(err.message || 'Could not add the customer', 'error');
    } finally {
      saveButton.disabled = false;
    }
  });

  return {
    get customerId() { return selected ? Number(selected.id) : null; },
    get customer() { return selected; },
  };
}
