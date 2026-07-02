/**
 * Aether · /api/stripe-webhook — upgrades user tier after payment
 * ------------------------------------------------------------
 * Listens for Stripe events:
 *   - checkout.session.completed → upgrade user to paid tier
 *   - customer.subscription.deleted → downgrade user to mist
 *   - customer.subscription.updated → update tier if changed
 *
 * Verifies the Stripe signature, then updates the user's profile
 * in Supabase using the service role key (bypasses RLS).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2025-06-30.basil' as Stripe.LatestApiVersion,
})

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || ''

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

// Use service role client to bypass RLS for webhook updates
function getAdminClient() {
  if (!SUPABASE_SERVICE_KEY) {
    // Fallback: use anon key (won't work for all operations, but better than crashing)
    return createClient(SUPABASE_URL || 'https://placeholder.supabase.co', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder')
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
}

export async function POST(req: NextRequest) {
  const body = await req.text()
  const signature = req.headers.get('stripe-signature')

  if (!signature) {
    return NextResponse.json({ error: 'No signature' }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
  } catch (err) {
    console.error('Aether · webhook signature verification failed:', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const adminClient = getAdminClient()

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const userId = session.metadata?.user_id || session.client_reference_id
        const tier = (session.metadata?.tier || 'echo').toLowerCase() as 'echo' | 'presence'

        if (!userId) {
          console.error('Aether · webhook: missing user_id')
          break
        }

        // Calculate subscription period end (30 days from now)
        const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

        // Update the user's profile
        const { error } = await adminClient
          .from('profiles')
          .upsert({
            user_id: userId,
            tier: tier,
            usage_count: 0,
            usage_reset_at: new Date().toISOString(),
            subscription_period_end: periodEnd,
          }, { onConflict: 'user_id' })

        if (error) {
          console.error('Aether · webhook: failed to update profile:', error.message)
        } else {
          console.log(`Aether · webhook: user ${userId} upgraded to ${tier}`)
        }
        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription
        const userId = subscription.metadata?.user_id

        if (!userId) break

        // Downgrade to free
        await adminClient
          .from('profiles')
          .update({ tier: 'mist', subscription_period_end: null })
          .eq('user_id', userId)

        console.log(`Aether · webhook: user ${userId} downgraded to mist (subscription deleted)`)
        break
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription
        const userId = subscription.metadata?.user_id
        const tier = subscription.metadata?.tier as 'echo' | 'presence' | undefined

        if (!userId || !tier) break

        // Only update if the subscription is active
        if (subscription.status === 'active') {
          const periodEnd = subscription.current_period_end
            ? new Date(subscription.current_period_end * 1000).toISOString()
            : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

          await adminClient
            .from('profiles')
            .update({
              tier: tier,
              subscription_period_end: periodEnd,
            })
            .eq('user_id', userId)

          console.log(`Aether · webhook: user ${userId} subscription updated to ${tier}`)
        }
        break
      }

      default:
        // Ignore other events
        break
    }

    return NextResponse.json({ received: true })
  } catch (err) {
    console.error('Aether · webhook error:', err)
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 })
  }
}
