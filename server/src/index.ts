/**
 * Grimoire Pro — Server Entry Point
 *
 * Hono app with middleware stack:
 *   1. CORS — allow requests from grimoire.dev and VS Code extension
 *   2. Request logging — minimal metadata, never user code
 *   3. Health check — for Railway's built-in health monitoring
 *   4. Auth routes — signup, verify, GitHub OAuth (Phase 3)
 *   5. Billing routes — Stripe Checkout, webhooks, portal (Phase 2)
 *   6. Status route — subscription + usage info (requireToken)
 *   7. Proxy route — forward to Anthropic (requireAuth = active sub only)
 *   8. Error handler — catch-all for unhandled errors
 *
 * SECURITY: Middleware order matters. Auth runs before proxy/status.
 * CORS runs before everything to reject bad origins early.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serve } from '@hono/node-server';
import { config } from './lib/config.js';
import { requireAuth, requireToken } from './middleware/auth.js';
import proxy from './routes/proxy.js';
import status from './routes/status.js';
import billing from './routes/billing.js';

const app = new Hono();

// ─── Global middleware ───

// CORS: VS Code extension host doesn't send Origin headers for API calls,
// but the webview and grimoire.dev landing page do.
app.use('*', cors({
  origin: config.allowedOrigins,
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'anthropic-beta', 'anthropic-version'],
  exposeHeaders: ['X-Grimoire-Usage'],
  maxAge: 86400, // Cache preflight for 24h
}));

// Request logging — method, path, status, latency. No bodies, no user code.
app.use('*', logger());

// ─── Health check ───
// Railway pings this to know if the service is up.
// Also useful for uptime monitoring (UptimeRobot, etc.)
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Public routes (no auth required) ───
// Stripe webhooks must be public — Stripe can't send a Bearer token.
// The webhook handler verifies the Stripe signature instead (see billing.ts).
app.route('/', billing);

// ─── Authenticated routes: token required (any subscription status) ───
// Status endpoint: free/canceled users need to check their status too
app.use('/v1/status', requireToken);
app.route('/', status);

// ─── Authenticated routes: active subscription required ───
// Proxy endpoint: only active/past_due subscribers can use the AI proxy
app.use('/v1/messages', requireAuth);
app.route('/', proxy);

// ─── Global error handler ───
// Catches unhandled errors so we return JSON instead of HTML stack traces.
// SECURITY: Never leak internal error details to the client in production.
app.onError((err, c) => {
  console.error(`[ERROR] ${c.req.method} ${c.req.path}:`, err.message);

  if (config.nodeEnv === 'development') {
    return c.json({ error: 'internal_error', message: err.message, stack: err.stack }, 500);
  }

  return c.json(
    { error: 'internal_error', message: 'Something went wrong. Please try again.' },
    500
  );
});

// ─── 404 handler ───
app.notFound((c) => {
  return c.json(
    { error: 'not_found', message: `${c.req.method} ${c.req.path} not found` },
    404
  );
});

// ─── Start server ───
console.log(`Grimoire Pro server starting on port ${config.port}...`);
console.log(`Environment: ${config.nodeEnv}`);

serve({
  fetch: app.fetch,
  port: config.port,
});

console.log(`Grimoire Pro server running at http://localhost:${config.port}`);

export default app;
