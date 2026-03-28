/**
 * Grimoire Pro — Environment Configuration
 *
 * Single source of truth for all env vars. Fails fast at startup if
 * required vars are missing — better to crash on deploy than serve
 * broken requests for hours before someone notices.
 *
 * SECURITY: All secrets come from env vars, never hardcoded.
 * Railway injects these automatically from the dashboard.
 */

// ─── Helper: require an env var or crash with a clear message ───
function required(key: string): string {
  const val = process.env[key];
  if (!val) {
    throw new Error(
      `Missing required env var: ${key}. ` +
      `Set it in Railway dashboard → Variables.`
    );
  }
  return val;
}

// ─── Helper: optional env var with a typed default ───
function optional(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

export const config = {
  // Server
  port: parseInt(optional('PORT', '3000'), 10),
  nodeEnv: optional('NODE_ENV', 'development'),

  // Our Anthropic API key — the one Pro users share via the proxy.
  // SECURITY: Never log this. Never return it in responses.
  // Stored as env var on Railway, rotated if compromised.
  anthropicApiKey: required('ANTHROPIC_API_KEY'),
  anthropicBaseUrl: optional('ANTHROPIC_BASE_URL', 'https://api.anthropic.com'),

  // PostgreSQL connection string — Railway provides this automatically
  // when you attach a Postgres plugin to your service.
  databaseUrl: required('DATABASE_URL'),

  // JWT signing secret — used to create and verify session tokens.
  // Generate with: openssl rand -hex 32
  // SECURITY: Must be ≥32 bytes of entropy. Rotate = invalidate all sessions.
  jwtSecret: required('JWT_SECRET'),

  // Stripe
  stripeSecretKey: required('STRIPE_SECRET_KEY'),
  stripeWebhookSecret: required('STRIPE_WEBHOOK_SECRET'),
  stripePriceId: required('STRIPE_PRICE_ID'),

  // Usage limits — soft cap, not hard. We warn users, not punish them.
  // Why 50? At ~$0.15/scan, 50 scans = $7.50 cost on a $5/mo plan.
  // We eat the loss on heavy users because they're our best advocates.
  // Hard cap at 100 prevents runaway costs from bugs or abuse.
  scanSoftCap: parseInt(optional('SCAN_SOFT_CAP', '50'), 10),
  scanHardCap: parseInt(optional('SCAN_HARD_CAP', '100'), 10),
  annotationSoftCap: parseInt(optional('ANNOTATION_SOFT_CAP', '100'), 10),
  annotationHardCap: parseInt(optional('ANNOTATION_HARD_CAP', '200'), 10),

  // Session token TTL in days
  sessionTtlDays: parseInt(optional('SESSION_TTL_DAYS', '30'), 10),

  // CORS — which origins can call this API.
  // VS Code extensions make requests from the `vscode-webview://` origin,
  // but the actual API calls come from the Node.js extension host (no origin).
  // We allow grimoire.dev for the landing page/dashboard.
  allowedOrigins: optional('ALLOWED_ORIGINS', 'https://grimoire.dev').split(','),
} as const;

// Freeze to prevent accidental mutation — config is read-only after startup
Object.freeze(config);
