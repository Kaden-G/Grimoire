/**
 * Grimoire Pro — Database Connection
 *
 * Uses the `postgres` package (porsager/postgres) — not pg or knex.
 * Why: it's the fastest Postgres driver for Node, supports tagged template
 * queries (SQL injection protection by default), and has zero dependencies.
 *
 * Connection pooling is handled internally by the library.
 * Railway provides DATABASE_URL with SSL enabled automatically.
 */

import postgres from 'postgres';
import { config } from '../lib/config.js';

// ─── Connection pool ───
// max: 10 is conservative but safe for a single-service deploy.
// Railway's Postgres allows 100 connections; we leave headroom for
// migrations, cron jobs, and manual psql sessions.
export const sql = postgres(config.databaseUrl, {
  max: 10,
  idle_timeout: 20,       // Close idle connections after 20s
  connect_timeout: 10,    // Fail fast if DB is unreachable
  ssl: config.nodeEnv === 'production' ? 'require' : false,
});

// ─── User queries ───
// Centralized here so SQL lives in one place, not scattered across route handlers.
// Each function maps to exactly one DB operation — no magic, no ORM, no surprises.

export interface User {
  id: string;
  email: string;
  github_id: string | null;
  stripe_customer_id: string | null;
  subscription_status: 'free' | 'active' | 'past_due' | 'canceled';
  current_period_end: Date | null;
  scan_count_this_month: number;
  annotation_count_month: number;
  created_at: Date;
  updated_at: Date;
}

export interface Session {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  created_at: Date;
}

/** Find a user by their session token hash. Returns null if token is expired or doesn't exist. */
export async function findUserByTokenHash(tokenHash: string): Promise<User | null> {
  const rows = await sql<User[]>`
    SELECT u.* FROM users u
    JOIN sessions s ON s.user_id = u.id
    WHERE s.token_hash = ${tokenHash}
      AND s.expires_at > NOW()
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/** Find a user by email. Used during auth flows. */
export async function findUserByEmail(email: string): Promise<User | null> {
  const rows = await sql<User[]>`
    SELECT * FROM users WHERE email = ${email} LIMIT 1
  `;
  return rows[0] ?? null;
}

/** Find a user by Stripe customer ID. Used in webhook handlers. */
export async function findUserByStripeCustomer(stripeCustomerId: string): Promise<User | null> {
  const rows = await sql<User[]>`
    SELECT * FROM users WHERE stripe_customer_id = ${stripeCustomerId} LIMIT 1
  `;
  return rows[0] ?? null;
}

/** Create a new user. Returns the created user. */
export async function createUser(email: string, githubId?: string): Promise<User> {
  const rows = await sql<User[]>`
    INSERT INTO users (email, github_id)
    VALUES (${email}, ${githubId ?? null})
    RETURNING *
  `;
  return rows[0];
}

/** Create a session for a user. Returns the session row (caller provides the hash). */
export async function createSession(userId: string, tokenHash: string, expiresAt: Date): Promise<Session> {
  const rows = await sql<Session[]>`
    INSERT INTO sessions (user_id, token_hash, expires_at)
    VALUES (${userId}, ${tokenHash}, ${expiresAt})
    RETURNING *
  `;
  return rows[0];
}

/** Update a user's Stripe customer ID. Called after first Checkout session. */
export async function setStripeCustomer(userId: string, stripeCustomerId: string): Promise<void> {
  await sql`
    UPDATE users
    SET stripe_customer_id = ${stripeCustomerId}
    WHERE id = ${userId}
  `;
}

/** Update subscription status. Called from Stripe webhooks. */
export async function updateSubscription(
  stripeCustomerId: string,
  status: User['subscription_status'],
  periodEnd: Date | null
): Promise<void> {
  await sql`
    UPDATE users
    SET subscription_status = ${status},
        current_period_end = ${periodEnd}
    WHERE stripe_customer_id = ${stripeCustomerId}
  `;
}

/**
 * Increment scan count for a user. Returns the new count.
 * Uses atomic increment — no read-then-write race condition.
 */
export async function incrementScanCount(userId: string): Promise<number> {
  const rows = await sql<{ scan_count_this_month: number }[]>`
    UPDATE users
    SET scan_count_this_month = scan_count_this_month + 1
    WHERE id = ${userId}
    RETURNING scan_count_this_month
  `;
  return rows[0].scan_count_this_month;
}

/** Increment annotation count. Same atomic pattern as scans. */
export async function incrementAnnotationCount(userId: string): Promise<number> {
  const rows = await sql<{ annotation_count_month: number }[]>`
    UPDATE users
    SET annotation_count_month = annotation_count_month + 1
    WHERE id = ${userId}
    RETURNING annotation_count_month
  `;
  return rows[0].annotation_count_month;
}

/** Reset all monthly counters. Called by a cron job on the 1st of each month. */
export async function resetMonthlyCounters(): Promise<number> {
  const result = await sql`
    UPDATE users
    SET scan_count_this_month = 0,
        annotation_count_month = 0
    WHERE scan_count_this_month > 0
       OR annotation_count_month > 0
  `;
  return result.count;
}

/** Delete expired sessions. Housekeeping — run periodically. */
export async function cleanExpiredSessions(): Promise<number> {
  const result = await sql`
    DELETE FROM sessions WHERE expires_at < NOW()
  `;
  return result.count;
}
