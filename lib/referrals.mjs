// Referral codes are opaque random bearer secrets, not identity or profile permissions.
export const referralCodePattern = /^[0-9a-f]{64}$/;
export function normalizeReferralCode(value) {
  if (typeof value !== 'string') return null;
  const code = value.trim().toLowerCase();
  return referralCodePattern.test(code) ? code : null;
}
