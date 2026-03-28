/**
 * Grimoire Pro — Anthropic API Proxy
 *
 * This is the core money-making endpoint. Pro users hit POST /v1/messages
 * instead of calling Anthropic directly, and we:
 *   1. Authenticate the request (via auth middleware, already done before we get here)
 *   2. Check usage limits (soft cap warns, hard cap blocks)
 *   3. Forward the request body to Anthropic's /v1/messages
 *   4. Stream the response back to the client
 *   5. Increment usage counters
 *
 * Why proxy instead of giving users a shared API key?
 *   - Control: we can revoke access, enforce limits, switch models
 *   - Security: our API key never leaves the server
 *   - Metering: we know exactly how much each user costs us
 *   - Flexibility: we can add caching, request rewriting, model routing later
 *
 * SECURITY: User code passes through this server in transit but is NEVER
 * logged, stored, or cached. It's a passthrough pipe to Anthropic.
 * The only data we retain is request metadata (user_id, timestamp, model, token count).
 */

import { Hono } from 'hono';
import { config } from '../lib/config.js';
import { incrementScanCount, incrementAnnotationCount } from '../db/index.js';

const proxy = new Hono();

/**
 * POST /v1/messages — Proxy to Anthropic
 *
 * Accepts the exact same request body the Anthropic SDK sends.
 * The extension doesn't need to change its request format at all —
 * just the URL and auth header.
 */
proxy.post('/v1/messages', async (c) => {
  const user = c.get('user');

  // ─── Determine request type from the body ───
  // We peek at max_tokens to distinguish scans (8192) from annotations (16384).
  // This is a heuristic — not perfect, but good enough for usage tracking.
  // Alternative considered: custom header from extension, but that means client changes.
  let requestBody: any;
  try {
    requestBody = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_body', message: 'Request body must be valid JSON' }, 400);
  }

  const maxTokens = requestBody.max_tokens ?? 0;
  const isAnnotation = maxTokens > 12000; // Annotations use 16384, scans use 8192

  // ─── Check usage limits ───
  const currentCount = isAnnotation
    ? user.annotation_count_month
    : user.scan_count_this_month;
  const softCap = isAnnotation ? config.annotationSoftCap : config.scanSoftCap;
  const hardCap = isAnnotation ? config.annotationHardCap : config.scanHardCap;
  const usageType = isAnnotation ? 'annotation' : 'scan';

  if (currentCount >= hardCap) {
    return c.json(
      {
        error: 'usage_limit_exceeded',
        message: `Monthly ${usageType} limit reached (${hardCap}). Resets on the 1st.`,
        usage: { type: usageType, current: currentCount, limit: hardCap },
      },
      429
    );
  }

  // ─── Forward request to Anthropic ───
  // We rebuild the request rather than blindly forwarding to prevent
  // header injection or other shenanigans from the client.
  const anthropicUrl = `${config.anthropicBaseUrl}/v1/messages`;
  const isStreaming = requestBody.stream === true;

  const anthropicResponse = await fetch(anthropicUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.anthropicApiKey,
      'anthropic-version': '2023-06-01',
      // Pass through the anthropic-beta header if present (for features like prompt caching)
      ...(c.req.header('anthropic-beta')
        ? { 'anthropic-beta': c.req.header('anthropic-beta')! }
        : {}),
    },
    body: JSON.stringify(requestBody),
  });

  // ─── Increment usage counter (fire-and-forget) ───
  // We increment on request, not on success. Rationale: if Anthropic fails,
  // the user will retry and we'll count again. This slightly overcounts but
  // prevents gaming (send request, get response, somehow avoid the count).
  // For a soft cap system, slight overcounting is acceptable.
  //
  // The `void` prefix makes it explicit that we're not awaiting this.
  if (isAnnotation) {
    void incrementAnnotationCount(user.id);
  } else {
    void incrementScanCount(user.id);
  }

  // ─── Handle streaming responses ───
  // Anthropic supports SSE streaming. We pipe the response directly through
  // to the client — no buffering, no parsing. This keeps memory flat and
  // latency low (first token arrives as fast as Anthropic sends it).
  if (isStreaming && anthropicResponse.body) {
    // Build warning header if approaching soft cap
    const headers: Record<string, string> = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    };

    if (currentCount + 1 >= softCap * 0.8) {
      // X-Grimoire-Usage header lets the extension show a subtle warning
      // in the UI without parsing the response body
      headers['X-Grimoire-Usage'] = JSON.stringify({
        type: usageType,
        current: currentCount + 1,
        softCap,
        hardCap,
      });
    }

    return new Response(anthropicResponse.body, {
      status: anthropicResponse.status,
      headers,
    });
  }

  // ─── Handle non-streaming responses ───
  const responseBody = await anthropicResponse.text();
  const responseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Add usage warning header if approaching soft cap
  if (currentCount + 1 >= softCap * 0.8) {
    responseHeaders['X-Grimoire-Usage'] = JSON.stringify({
      type: usageType,
      current: currentCount + 1,
      softCap,
      hardCap,
    });
  }

  return c.body(responseBody, anthropicResponse.status as any, responseHeaders);
});

export default proxy;
