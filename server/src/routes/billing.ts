/**
 * Grimoire Pro — Stripe Billing Routes
 *
 * Handles the money side of Pro. Three endpoints:
 *   POST /billing/checkout  — Create a Stripe Checkout session (user → Stripe payment page)
 *   POST /billing/webhook   — Stripe → us: subscription lifecycle events
 *   GET  /billing/portal    — Redirect to Stripe Customer Portal (manage/cancel sub)
 *
 * Design philosophy: let Stripe handle as much as possible.
 *   - We don't build payment forms (Checkout handles it)
 *   - We don't build subscription management UI (Customer Portal handles it)
 *   - We don't handle refunds manually (Stripe dashboard)
 *   - We just listen to webhooks and update our DB accordingly
 *
 * SECURITY: Webhook endpoint verifies Stripe's signature on every request.
 * Without this, anyone could POST fake events to activate free subscriptions.
 */

import { Hono } from 'hono';
import Stripe from 'stripe';
import { config } from '../lib/config.js';
import { findUserByStripeCustomer, updateSubscription, setStripeCustomer } from '../db/index.js';
import { requireToken } from '../middleware/auth.js';

const billing = new Hono();
const stripe = new Stripe(config.stripeSecretKey);

/**
 * POST /billing/checkout — Create a Stripe Checkout session
 *
 * Called when a user clicks "Start Pro" in the extension or on grimoire.dev.
 * Returns a URL to Stripe's hosted payment page.
 *
 * Requires auth: we need the user's ID to associate the subscription.
 */
billing.post('/billing/checkout', requireToken, async (c) => {
  const user = c.get('user');

  // If user already has an active subscription, don't create another one
  if (user.subscription_status === 'active') {
    return c.json(
      { error: 'already_subscribed', message: 'You already have an active Pro subscription.' },
      400
    );
  }

  // Create or reuse Stripe customer
  let customerId = user.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { grimoire_user_id: user.id },
    });
    customerId = customer.id;
    await setStripeCustomer(user.id, customerId);
  }

  // Create Checkout session
  // success_url and cancel_url point to grimoire.dev pages that handle
  // the redirect back to VS Code via the URI handler
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ['card'],
    line_items: [{
      price: config.stripePriceId,
      quantity: 1,
    }],
    mode: 'subscription',
    success_url: 'https://grimoire.dev/checkout/success?session_id={CHECKOUT_SESSION_ID}',
    cancel_url: 'https://grimoire.dev/checkout/cancel',
    // Tie the session back to our user for webhook processing
    client_reference_id: user.id,
    metadata: { grimoire_user_id: user.id },
  });

  return c.json({ checkout_url: session.url });
});

/**
 * POST /billing/webhook — Stripe webhook handler
 *
 * Stripe sends events here when subscriptions change. We update our DB
 * to match. This is the source of truth for subscription_status.
 *
 * Events we care about:
 *   - checkout.session.completed → first-time activation
 *   - customer.subscription.updated → status changes (active, past_due)
 *   - customer.subscription.deleted → canceled or payment permanently failed
 *   - invoice.payment_failed → payment issue (subscription goes past_due)
 *
 * SECURITY: Every request is verified against Stripe's webhook signing secret.
 * This prevents attackers from forging events to grant themselves Pro access.
 */
billing.post('/billing/webhook', async (c) => {
  // ─── Verify Stripe signature ───
  // We need the raw body (not parsed JSON) for signature verification.
  const rawBody = await c.req.text();
  const signature = c.req.header('stripe-signature');

  if (!signature) {
    return c.json({ error: 'missing_signature' }, 400);
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, config.stripeWebhookSecret);
  } catch (err) {
    console.error('[BILLING] Webhook signature verification failed:', (err as Error).message);
    return c.json({ error: 'invalid_signature' }, 400);
  }

  // ─── Handle events ───
  console.log(`[BILLING] Received event: ${event.type}`);

  switch (event.type) {
    case 'checkout.session.completed': {
      // User just paid for the first time
      const session = event.data.object as Stripe.Checkout.Session;
      const customerId = session.customer as string;
      const userId = session.client_reference_id;

      if (userId && customerId) {
        // Ensure Stripe customer ID is linked (may already be from /checkout)
        await setStripeCustomer(userId, customerId);

        // Fetch the subscription to get period_end
        if (session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription as string);
          await updateSubscription(
            customerId,
            'active',
            new Date(sub.current_period_end * 1000)
          );
        }
      }
      break;
    }

    case 'customer.subscription.updated': {
      // Subscription status changed (active, past_due, etc.)
      const sub = event.data.object as Stripe.Subscription;
      const customerId = sub.customer as string;

      // Map Stripe status to our simplified enum
      // Stripe has many statuses; we collapse them into our 4.
      let status: 'active' | 'past_due' | 'canceled';
      switch (sub.status) {
        case 'active':
        case 'trialing':
          status = 'active';
          break;
        case 'past_due':
          status = 'past_due';
          break;
        default:
          // incomplete, incomplete_expired, canceled, unpaid, paused
          status = 'canceled';
      }

      await updateSubscription(
        customerId,
        status,
        new Date(sub.current_period_end * 1000)
      );
      break;
    }

    case 'customer.subscription.deleted': {
      // Subscription fully canceled (final state)
      const sub = event.data.object as Stripe.Subscription;
      const customerId = sub.customer as string;
      await updateSubscription(customerId, 'canceled', null);
      break;
    }

    case 'invoice.payment_failed': {
      // Payment failed — Stripe will retry, but we mark as past_due
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = invoice.customer as string;
      if (customerId) {
        await updateSubscription(customerId, 'past_due', null);
      }
      break;
    }

    default:
      // We don't care about other events — Stripe sends a lot of them
      console.log(`[BILLING] Unhandled event type: ${event.type}`);
  }

  // Always return 200 to acknowledge receipt.
  // Stripe retries on non-2xx, which would spam our logs.
  return c.json({ received: true });
});

/**
 * GET /billing/portal — Redirect to Stripe Customer Portal
 *
 * Lets users manage their subscription (update payment, cancel, view invoices)
 * without us building any of that UI. Stripe hosts the whole thing.
 */
billing.get('/billing/portal', requireToken, async (c) => {
  const user = c.get('user');

  if (!user.stripe_customer_id) {
    return c.json(
      { error: 'no_subscription', message: 'No billing history found.' },
      400
    );
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripe_customer_id,
    return_url: 'https://grimoire.dev/dashboard',
  });

  return c.json({ portal_url: session.url });
});

export default billing;
