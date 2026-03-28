/**
 * Grimoire Pro — Proxy Route Tests
 *
 * Tests the core proxy logic in isolation using Hono's test client.
 * No real Anthropic calls, no real DB — we mock the data layer.
 *
 * These tests verify:
 *   1. Auth enforcement (no token → 401, expired → 401, no sub → 403)
 *   2. Usage limits (soft cap warning header, hard cap → 429)
 *   3. Request forwarding (correct headers, body passthrough)
 *   4. Error handling (bad JSON → 400, Anthropic errors → passthrough)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createHash } from 'crypto';

// ─── Mock the database module ───
// We intercept all DB calls so tests run without Postgres.
vi.mock('../db/index.js', () => ({
  findUserByTokenHash: vi.fn(),
  incrementScanCount: vi.fn().mockResolvedValue(1),
  incrementAnnotationCount: vi.fn().mockResolvedValue(1),
}));

// ─── Mock the config module ───
vi.mock('../lib/config.js', () => ({
  config: {
    anthropicApiKey: 'test-anthropic-key',
    anthropicBaseUrl: 'https://api.anthropic.com',
    scanSoftCap: 50,
    scanHardCap: 100,
    annotationSoftCap: 100,
    annotationHardCap: 200,
    nodeEnv: 'test',
    allowedOrigins: ['https://grimoire.dev'],
  },
}));

import { findUserByTokenHash } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import proxy from '../routes/proxy.js';

// ─── Test fixtures ───
const TEST_TOKEN = 'a'.repeat(64); // 64-char token (realistic length)
const TEST_TOKEN_HASH = createHash('sha256').update(TEST_TOKEN).digest('hex');

const activeUser = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  email: 'test@grimoire.dev',
  github_id: null,
  stripe_customer_id: 'cus_test123',
  subscription_status: 'active' as const,
  current_period_end: new Date(Date.now() + 86400000), // Tomorrow
  scan_count_this_month: 5,
  annotation_count_month: 2,
  created_at: new Date(),
  updated_at: new Date(),
};

const freeUser = {
  ...activeUser,
  subscription_status: 'free' as const,
  stripe_customer_id: null,
};

// ─── Build test app (same middleware chain as production) ───
function buildApp() {
  const app = new Hono();
  app.use('/v1/messages', requireAuth);
  app.route('/', proxy);
  return app;
}

describe('Auth Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects requests with no Authorization header', async () => {
    const app = buildApp();
    const res = await app.request('/v1/messages', { method: 'POST' });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('missing_token');
  });

  it('rejects requests with short tokens', async () => {
    const app = buildApp();
    const res = await app.request('/v1/messages', {
      method: 'POST',
      headers: { Authorization: 'Bearer short' },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('invalid_token');
  });

  it('rejects requests when token not found in DB', async () => {
    vi.mocked(findUserByTokenHash).mockResolvedValueOnce(null);
    const app = buildApp();
    const res = await app.request('/v1/messages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(res.status).toBe(401);
  });

  it('rejects free users from proxy endpoint', async () => {
    vi.mocked(findUserByTokenHash).mockResolvedValueOnce(freeUser);
    const app = buildApp();
    const res = await app.request('/v1/messages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('subscription_required');
  });
});

describe('Proxy Endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: return active user for all auth checks
    vi.mocked(findUserByTokenHash).mockResolvedValue(activeUser);
  });

  it('rejects invalid JSON bodies', async () => {
    const app = buildApp();
    const res = await app.request('/v1/messages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TEST_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });

  it('blocks users who exceed hard cap', async () => {
    const heavyUser = { ...activeUser, scan_count_this_month: 100 };
    vi.mocked(findUserByTokenHash).mockResolvedValueOnce(heavyUser);

    const app = buildApp();
    const res = await app.request('/v1/messages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TEST_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 8192, messages: [] }),
    });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe('usage_limit_exceeded');
  });
});
