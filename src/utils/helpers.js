/**
 * Mask helpers for phone numbers and emails used in logs/responses.
 * Keeps a small portion visible and replaces the rest with asterisks.
 */

/**
 * Mask a phone number leaving first 2 and last 2 digits visible.
 * Non-digit characters are removed before masking.
 * Returns null for falsy input.
 * @param {string} phone
 * @returns {string|null}
 */
export const maskPhoneNumber = (phone) => {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length <= 4) return digits.replace(/.(?=.{2})/g, '*'); // minimal masking
  const first = digits.slice(0, 2);
  const last = digits.slice(-2);
  const middle = '*'.repeat(Math.max(0, digits.length - 4));
  return `${first}${middle}${last}`;
};

/**
 * Mask an email address by showing first and last char of the local part (when available)
 * and keeping the domain intact. Returns null for falsy input.
 * Examples:
 *  - "jdoe@example.com" -> "j**e@example.com"
 *  - "ab@d.co" -> "a*@d.co"
 * @param {string} email
 * @returns {string|null}
 */
export const maskEmail = (email) => {
  if (!email) return null;
  const parts = String(email).split('@');
  if (parts.length !== 2) return email; // not a standard email, return as-is
  const [local, domain] = parts;
  if (local.length <= 1) {
    return `*@${domain}`;
  }
  if (local.length === 2) {
    return `${local[0]}*@${domain}`;
  }
  const first = local[0];
  const last = local[local.length - 1];
  const middle = '*'.repeat(Math.max(1, local.length - 2));
  return `${first}${middle}${last}@${domain}`;
};

export default {
  maskPhoneNumber,
  maskEmail
};
