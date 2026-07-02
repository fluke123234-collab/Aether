/**
 * Aether · /api/create-checkout-session — Stripe checkout redirect
 * ------------------------------------------------------------
 * Creates a Stripe Checkout session for Echo or Presence subscription.
 * Redirects the user to Stripe's hosted payment page.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import Stripe from 'stripe'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2025-06-30.basil' as Stripe.LatestApiVersion,
})

const ECHO_PRICE_ID = process.env.STRIPE_ECHO_PRICE_ID || ''
const PRESENCE_PRICE_ID = process.env.STRIPE_PRESENCE_PRICE_ID || ''
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://aether-sigma-orpin.vercel.app'

export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get('authorization')?.startsWith('Bearer ') ? req.headers.get('authorization')!.slice(7) : null
    if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const { data: authData, error: authError } = await supabase.auth.getUser(token)
    if (authError || !authData.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const body = await req.json()
    const tier = body.tier as 'echo' | 'presence'

    const priceId = tier === 'presence' ? PRESENCE_PRICE_ID : ECHO_PRICE_ID
    if (!priceId) return NextResponse.json({ error: 'Price ID not configured' }, { status: 500 })

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${APP_URL}/?checkout=success&tier=${tier}`,
      cancel_url: `${APP_URL}/?checkout=cancelled`,
      client_reference_id: authData.user.id,
      customer_email: authData.user.email,
      metadata: {
        user_id: authData.user.id,
        tier: tier,
      },
    })

    return NextResponse.json({ url: session.url })
  } catch (err) {
    console.error('Aether · checkout session error:', err)
    return NextResponse.json({ error: 'Could not create checkout session' }, { status: 500 })
  }
}
