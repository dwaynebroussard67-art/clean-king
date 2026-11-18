// Used on both the form and server; the server still validates independently.
export function isValidPhone(value) {
  if (typeof value !== 'string') return false;
  const phone = value.trim();
  const digits = phone.replace(/\D/g, '').length;
  return phone.length <= 25 && /^\+?[0-9 ()-]+$/.test(phone) && digits >= 10 && digits <= 15;
}
