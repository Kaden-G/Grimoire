/**
 * Grimoire Pro — Status Endpoint
 *
 * GET /v1/status — Returns the user's subscription and usage info.
 * Called by the extension on activation to determine Free vs Pro routing
 * and to display usage in the welcome panel.
 *
 * Uses `requireToken` (not `requireAuth`) because free/canceled users
 * also need to check their status — e.g., to see "subscription expired"
 * instead of a cryptic auth error.
 */

import { Hono } from 'hono';
import { config } from '../lib/config.js';

const status = new Hono();

status.get('/v1/status', async (c) => {
  const user = c.get('user');

  return c.json({
    user: {
      id: user.id,
      email: user.email,
      subscription_status: user.subscription_status,
      current_period_end: user.current_period_end?.toISOString() ?? null,
    },
    usage: {
      scans: {
        current: user.scan_count_this_month,
        soft_cap: config.scanSoftCap,
        hard_cap: config.scanHardCap,
      },
      annotations: {
        current: user.annotation_count_month,
        soft_cap: config.annotationSoftCap,
        hard_cap: config.annotationHardCap,
      },
    },
  });
});

export default status;
