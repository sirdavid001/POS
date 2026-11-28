import { isStaffPhoto } from '../../shared/src/staff-photo.js';

export function staffPhotoField(id, editing = false) {
  return `<div class="staff-portrait-field">
    <label for="${id}">Staff photo <span>(optional)</span></label>
    <p id="${id}-help">Use a clear face photo, like a passport portrait. JPG, PNG, or WebP, up to 5 MB. Do not upload the passport document itself.</p>
    <input type="file" id="${id}" accept="image/jpeg,image/png,image/webp" aria-describedby="${id}-help">
    <div class="staff-portrait-feedback">
      ${editing ? '<label><input type="checkbox" data-clear-staff-photo> Remove the saved photo</label>' : ''}
      <span role="status"></span>
    </div>
  </div>`;
}

export function bindStaffPhotoField(form) {
  const field = form.querySelector('.staff-portrait-field');
  if (!field) return;
  const input = field.querySelector('input[type=file]');
  const remove = field.querySelector('[data-clear-staff-photo]');
  const status = field.querySelector('[role=status]');
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (remove && file) remove.checked = false;
    input.setCustomValidity('');
    status.textContent = file ? 'Photo selected. It will be added when you save.' : '';
  });
  remove?.addEventListener('change', () => {
    if (!remove.checked) return;
    input.value = '';
    input.setCustomValidity('');
    status.textContent = 'The saved photo will be removed when you save.';
  });
}

export async function readStaffPhoto(form) {
  const input = form.querySelector('.staff-portrait-field input[type=file]');
  if (!input) return undefined;
  if (form.querySelector('[data-clear-staff-photo]')?.checked) return null;
  const file = input.files?.[0];
  if (!file) return undefined;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
    throw new Error('Choose a JPG, PNG or WebP portrait under 5 MB.');
  }
  try {
    const source = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const image = new Image();
    image.src = source;
    await image.decode();
    const scale = Math.min(1, 300 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    const photo = canvas.toDataURL('image/jpeg', .84);
    if (!isStaffPhoto(photo)) throw new Error('Choose a valid portrait.');
    return photo;
  } catch {
    throw new Error('That photo could not be read. Try a different JPG, PNG, or WebP.');
  }
}
