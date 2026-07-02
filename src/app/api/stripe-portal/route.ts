/**
 * Aether · /api/stripe-portal — redirect to Stripe Customer Portal
 * ------------------------------------------------------------
 * Lets users manage their subscription: upgrade, downgrade, cancel.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import Stripe from 'stripe'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2025-06-30.basil' as Stripe.LatestApiVersion,
})

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://aether-sigma-orpin.vercel.app'

export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get('authorization')?.startsWith('Bearer ') ? req.headers.get('authorization')!.slice(7) : null
    if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const { data: authData, error: authError } = await supabase.auth.getUser(token)
    if (authError || !authData.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    // Find the customer by email
    const customers = await stripe.customers.list({ email: authData.user.email || '', limit: 1 })
    if (customers.data.length === 0) {
      return NextResponse.json({ error: 'No subscription found' }, { status: 404 })
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customers.data[0].id,
      return_url: `${APP_URL}/`,
    })

    return NextResponse.json({ url: session.url })
  } catch (err) {
    console.error('Aether · portal session error:', err)
    return NextResponse.json({ error: 'Could not open billing portal' }, { status: 500 })
  }
}
