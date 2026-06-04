// @ts-nocheck
/**
 * Grimoire — Anthropic API client (shared)
 *
 * One HTTP layer for both the description generator (scanner path) and the inline
 * annotator. Handles retry + exponential backoff on rate limits / transient errors,
 * cancellation, and tolerant JSON parsing of model responses.
 *
 * This module is intentionally free of any `vscode` dependency so it can be unit
 * tested in plain Node.
 */

const https = require('https');

// Status codes worth retrying: rate limit (429), overloaded (529), transient 5xx.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504, 529]);
const MAX_API_ATTEMPTS = 4;

// Cancellable sleep that disposes its cancellation listener when done.
function sleep(ms, token) {
  return new Promise((resolve, reject) => {
    let sub;
    const timer = setTimeout(() => { if (sub) sub.dispose(); resolve(); }, ms);
    if (token) {
      sub = token.onCancellationRequested(() => { clearTimeout(timer); if (sub) sub.dispose(); reject(new Error('Cancelled')); });
    }
  });
}

// Exponential backoff with jitter; honors a numeric Retry-After header (seconds) if present.
function backoffDelay(attempt, retryAfterHeader, token) {
  const retryAfter = parseInt(retryAfterHeader, 10);
  let ms;
  if (!Number.isNaN(retryAfter) && retryAfter > 0) {
    ms = Math.min(retryAfter * 1000, 60000);
  } else {
    ms = Math.min(1000 * 2 ** (attempt - 1), 16000) + Math.floor(Math.random() * 500);
  }
  return sleep(ms, token);
}

// Single request to the Anthropic Messages API. Resolves with { statusCode, headers, body }.
function requestOnce({ apiKey, model, prompt, maxTokens }, token) {
  return new Promise((resolve, reject) => {
    if (token?.isCancellationRequested) { reject(new Error('Cancelled')); return; }

    const data = JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });

    const options = {
      hostname: 'api.anthropic.com',
      port: 443,
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(data),
      },
    };

    let cancelSub;
    const cleanup = () => { if (cancelSub) cancelSub.dispose(); };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => { cleanup(); resolve({ statusCode: res.statusCode, headers: res.headers, body }); });
    });

    req.on('error', (err) => { cleanup(); reject(err); });
    req.setTimeout(180000, () => { req.destroy(); cleanup(); reject(new Error('Request timed out (3 min)')); });

    if (token) {
      cancelSub = token.onCancellationRequested(() => { req.destroy(); cleanup(); reject(new Error('Cancelled')); });
    }

    req.write(data);
    req.end();
  });
}

/**
 * Call the Anthropic Messages API, retrying on rate limits / transient errors with
 * exponential backoff. Resolves with the concatenated text content of the response.
 * Throws on non-retryable failures, when out of attempts, or on cancellation.
 */
async function callAnthropic({ apiKey, model, prompt, maxTokens = 8192 }, token) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_API_ATTEMPTS; attempt++) {
    if (token?.isCancellationRequested) throw new Error('Cancelled');

    let res;
    try {
      res = await requestOnce({ apiKey, model, prompt, maxTokens }, token);
    } catch (err) {
      if (err.message === 'Cancelled') throw err;
      lastErr = err; // network / timeout — retry
      if (attempt < MAX_API_ATTEMPTS) { await backoffDelay(attempt, null, token); continue; }
      throw err;
    }

    if (res.statusCode === 200) {
      let parsed;
      try { parsed = JSON.parse(res.body); }
      catch { throw new Error(`Invalid response: ${res.body.slice(0, 200)}`); }
      if (parsed.error) throw new Error(parsed.error.message || 'API error');
      const text = parsed.content?.map(b => b.text || '').join('') || '';
      if (!text) throw new Error('Empty response from Claude');
      return text;
    }

    if (RETRYABLE_STATUS.has(res.statusCode) && attempt < MAX_API_ATTEMPTS) {
      lastErr = new Error(`API returned status ${res.statusCode}`);
      await backoffDelay(attempt, res.headers && res.headers['retry-after'], token);
      continue;
    }

    // Non-retryable, or out of attempts: surface the API's error message if present.
    let msg = `API returned status ${res.statusCode}`;
    try { const p = JSON.parse(res.body); if (p.error && p.error.message) msg = p.error.message; } catch {}
    throw new Error(msg);
  }
  throw lastErr || new Error('API request failed');
}

/**
 * Parse a JSON object from a model response, tolerating ```json fences and stray
 * prose/preamble. Falls back to extracting the outermost { ... } block.
 * Throws if no JSON object can be recovered.
 */
function parseJsonResponse(text) {
  const clean = String(text == null ? '' : text).replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(clean);
  } catch {
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start !== -1 && end > start) {
      return JSON.parse(clean.slice(start, end + 1));
    }
    throw new Error('Could not parse JSON from model response');
  }
}

module.exports = {
  callAnthropic,
  parseJsonResponse,
  RETRYABLE_STATUS,
  MAX_API_ATTEMPTS,
};
