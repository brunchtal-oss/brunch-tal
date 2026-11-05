// A soft email check shared by every form that takes an email (the server
// or Auth decides). Pure.

// The longest address an email field accepts (RFC 5321, and join_complete).
export const MAX_EMAIL_LENGTH = 254

// One @, then a domain of dot-separated labels. A label cannot hold a dot,
// so no two parts can match the same characters: the check is linear on any
// input, however crafted.
const EMAIL_SHAPE = /^[^@\s]+@[^@\s.]+(?:\.[^@\s.]+)+$/

// The length is checked first, so a long input never reaches the regex.
export function isEmailShape(value: string): boolean {
  return value.length <= MAX_EMAIL_LENGTH && EMAIL_SHAPE.test(value)
}
