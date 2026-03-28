/**
 * Grimoire Pro — Auth Middleware
 *
 * Validates session tokens on every proxied API request.
 *
 * Token flow:
 *   1. User authenticates (magic link or GitHub OAuth)
 *   2. Server generates a random token, stores SHA-256 hash in `sessions` table
 *   3. Raw token sent to client, stored in VS Code SecretStorage
 *   4. Client sends token as `Authorization: Bearer <token>` on each request
 *   5. This middleware hashes the token, looks up the session, loads the user
 *
 * Why hash-then-lookup instead of JWT?
 *   - Server-side revocation: we can invalidate individual sessions instantly
 *   - No JWT secret rotation headaches
 *   - Simpler mental model: token is a lookup key, not a signed claim
 *   - Tradeoff: one DB query per request (mitigated by connection pooling + index)
 *
 * SECURITY: The raw token never touches the database. If the DB leaks,
 * attackers get useless hashes. Same pattern used by GitHub, Stripe, etc.
 */

import { createMiddleware } from 'hono/factory';
import { createHash } from 'crypto';
import { findUserByTokenHash, type User } from '../db/index.js';

// ─── Extend Hono's context to carry the authenticated user ───
// This lets route handlers access `c.get('user')` with full type safety.
declare module 'hono' {
  interface ContextVariableMap {
    user: User;
  }
}

/** Hash a raw session token to match against the DB. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Auth middleware — requires a valid Bearer token.
 * Rejects with 401 if missing/invalid, 403 if subscription isn't active.
 *
 * Placed before any route that should only be accessible to Pro users.
 */
export const requireAuth = createMiddleware(async (c, next) => {
  // ─── Extract Bearer token ───
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json(
      { error: 'missing_token', message: 'Authorization header required. Format: Bearer <token>' },
      401
    );
  }

  const token = authHeader.slice(7); // Strip "Bearer " prefix
  if (!token || token.length < 32) {
    // Short tokens are obviously invalid — fail fast without hitting DB
    return c.json(
      { error: 'invalid_token', message: 'Token format is invalid' },
      401
    );
  }

  // ─── Look up user by token hash ───
  const tokenHash = hashToken(token);
  const user = await findUserByTokenHash(tokenHash);

  if (!user) {
    // Token doesn't exist or session expired
    return c.json(
      { error: 'invalid_token', message: 'Token is invalid or expired. Please re-authenticate.' },
      401
    );
  }

  // ─── Check subscription status ───
  // We allow 'active' and 'past_due' (Stripe is still retrying payment).
  // 'past_due' users get a grace period — cutting them off mid-work is hostile UX.
  // 'canceled' and 'free' users should use their own API key instead.
  if (user.subscription_status !== 'active' && user.subscription_status !== 'past_due') {
    return c.json(
      {
        error: 'subscription_required',
        message: 'Active Grimoire Pro subscription required.',
        status: user.subscription_status,
      },
      403
    );
  }

  // ─── Attach user to context for downstream handlers ───
  c.set('user', user);
  await next();
});

/**
 * Lighter auth middleware — validates token and loads user but doesn't
 * require active subscription. Used for status/billing endpoints where
 * free or canceled users still need access.
 */
export const requireToken = createMiddleware(async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json(
      { error: 'missing_token', message: 'Authorization header required.' },
      401
    );
  }

  const token = authHeader.slice(7);
  if (!token || token.length < 32) {
    return c.json({ error: 'invalid_token', message: 'Token format is invalid' }, 401);
  }

  const tokenHash = hashToken(token);
  const user = await findUserByTokenHash(tokenHash);

  if (!user) {
    return c.json(
      { error: 'invalid_token', message: 'Token is invalid or expired.' },
      401
    );
  }

  c.set('user', user);
  await next();
});
