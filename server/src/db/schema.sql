-- Grimoire Pro — Database Schema
-- PostgreSQL 15+ (Railway default)
--
-- Design decisions:
--   - UUIDs as PKs: no sequential ID leakage, safe for public APIs
--   - subscription_status as enum: DB enforces valid states, not app code
--   - Separate usage counters for scans vs annotations: different cost profiles
--   - token_hash (not raw token): if DB is compromised, tokens are useless
--     (same pattern as GitHub PATs, Stripe API keys, etc.)
--   - created_at/updated_at on everything: invaluable for debugging billing issues
--
-- SECURITY: No user code is ever stored in this database. Only auth/billing metadata.

-- ─── Enable UUID generation ───
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Subscription status enum ───
-- Why an enum instead of varchar? Prevents typos like 'actve' from silently
-- breaking billing logic. Adding a new status requires a migration = intentional.
CREATE TYPE subscription_status AS ENUM (
  'free',       -- Never paid, or explicitly downgraded
  'active',     -- Stripe subscription active and current
  'past_due',   -- Payment failed, in grace period (Stripe retries for ~3 weeks)
  'canceled'    -- User canceled or payment permanently failed
);

-- ─── Users table ───
-- One row per Grimoire account. Ties together auth identity, Stripe customer,
-- and usage tracking. Intentionally lean — we don't need to know anything
-- about the user beyond what's required for auth and billing.
CREATE TABLE IF NOT EXISTS users (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                   VARCHAR(255) NOT NULL UNIQUE,
  github_id               VARCHAR(100) UNIQUE,           -- NULL if signed up via email
  stripe_customer_id      VARCHAR(100) UNIQUE,           -- NULL until first checkout
  subscription_status     subscription_status NOT NULL DEFAULT 'free',
  current_period_end      TIMESTAMPTZ,                   -- From Stripe webhook; NULL for free users
  scan_count_this_month   INTEGER NOT NULL DEFAULT 0,
  annotation_count_month  INTEGER NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Sessions table ───
-- Stateless JWT is tempting but we need server-side revocation (user changes
-- password, suspicious activity, etc.). This table lets us invalidate specific
-- sessions without rotating the JWT secret (which would nuke everyone).
--
-- token_hash stores SHA-256 of the session token. The raw token only ever
-- exists on the client (VS Code SecretStorage) and in transit (HTTPS).
CREATE TABLE IF NOT EXISTS sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    VARCHAR(64) NOT NULL UNIQUE,  -- SHA-256 hex digest
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Indexes ───
-- These cover the hot paths: auth lookup (every request) and billing queries.
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ─── Auto-update updated_at trigger ───
-- Standard Postgres pattern. Fires on any row update to users table.
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
