// Client-side mirror of functions/src/staffPasswordPolicy.ts's
// MIN_PASSWORD_LENGTH / validatePassword.
//
// This copy is UX ONLY: it lets the Reset-password dialog disable its button
// and show the reason before a round trip. The copy inside the Cloud Function
// is the one that actually decides — the callable re-validates every request,
// so nothing here can be bypassed into a weaker password. functions/ is a
// separate deployable package with no build-time access to this tree (see the
// header of functions/src/permissions.ts), which is why it's a mirror rather
// than a shared import; if you change one, change the other.

export const MIN_PASSWORD_LENGTH = 10;

/**
 * Returns a human-readable reason the candidate is unacceptable, or null when
 * it passes. Never echoes the candidate itself.
 */
export const validatePassword = (password: string): string | null => {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > 4096) return 'Password is too long.';
  if (password.trim().length !== password.length) {
    return 'Password cannot start or end with a space.';
  }
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(re => re.test(password)).length;
  if (classes < 2) {
    return 'Password must mix at least two of: lowercase, uppercase, numbers, symbols.';
  }
  return null;
};

/**
 * Which users an owner may reset a password for, given the acting user's role.
 *
 * Mirrors authorizeStaffPasswordReset in the Cloud Function: owner-only, and
 * never another owner (which also excludes the acting owner themselves — an
 * owner changes their own password through the normal reauthenticate flow).
 * Kept pure and separate from UsersView so the gate is testable without
 * rendering, and so the UI has exactly one place to ask.
 */
export const canResetPasswordFor = (
  actorRole: string | undefined,
  targetRole: string | undefined,
): boolean => actorRole === 'owner' && targetRole !== 'owner' && !!targetRole;
