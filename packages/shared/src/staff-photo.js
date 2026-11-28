export const STAFF_PHOTO_DATA_LIMIT = 180000;
const imagePattern = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

export function isStaffPhoto(value) {
  if (typeof value !== 'string' || value.length > STAFF_PHOTO_DATA_LIMIT) return false;
  const match = imagePattern.exec(value);
  if (!match) return false;
  const encoded = value.slice(value.indexOf(',') + 1);
  if (encoded.length < 16 || encoded.length % 4 !== 0) return false;
  const prefix = globalThis.atob(encoded.slice(0, 16));
  if (match[1] === 'jpeg') return prefix.startsWith('\u00ff\u00d8\u00ff');
  if (match[1] === 'png') return prefix.startsWith('\u0089PNG\r\n\u001a\n');
  return prefix.startsWith('RIFF') && prefix.slice(8, 12) === 'WEBP';
}
