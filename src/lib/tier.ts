import { createClient } from '@supabase/supabase-js'
import { logger } from './logger'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

export type Tier = 'mist' | 'echo' | 'presence'
export const TIER_LIMITS: Record<Tier, number> = { mist: 0, echo: 100, presence: Infinity }
export type TierInfo = { tier: Tier; usageCount: number; limit: number; remaining: number; resetAt: string; subscriptionPeriodEnd: string | null }

export async function getUserTier(userId: string, accessToken: string): Promise<TierInfo> {
  const userClient = createClient(SUPABASE_URL || 'https://placeholder.supabase.co', SUPABASE_ANON_KEY || 'placeholder-anon-key', { global: { headers: { Authorization: `Bearer ${accessToken}` } } })
  const { data, error } = await userClient.from('profiles').select('tier, usage_count, usage_reset_at, subscription_period_end').eq('user_id', userId).single()
  if (error || !data) {
    if (error?.code === 'PGRST116' || error?.message?.includes('no rows')) {
      const { data: newRow } = await userClient.from('profiles').insert({ user_id: userId, tier: 'mist', usage_count: 0 }).select('tier, usage_count, usage_reset_at, subscription_period_end').single()
      if (newRow) return parseTierInfo(newRow.tier as Tier, newRow.usage_count as number, newRow.usage_reset_at as string, newRow.subscription_period_end as string | null)
    }
    return { tier: 'mist', usageCount: 0, limit: 0, remaining: 0, resetAt: new Date().toISOString(), subscriptionPeriodEnd: null }
  }
  return parseTierInfo(data.tier as Tier, data.usage_count as number, data.usage_reset_at as string, data.subscription_period_end as string | null)
}

function parseTierInfo(tier: Tier, usageCount: number, resetAt: string, subscriptionPeriodEnd: string | null): TierInfo {
  if ((Date.now() - new Date(resetAt).getTime()) / (1000 * 60 * 60 * 24) >= 30) usageCount = 0
  const limit = TIER_LIMITS[tier]
  return { tier, usageCount, limit, remaining: limit === Infinity ? Infinity : Math.max(0, limit - usageCount), resetAt, subscriptionPeriodEnd }
}

export type ValidationResult = { allowed: boolean; tier: Tier; remaining: number; statusCode?: number; error?: string; message?: string; action?: string }

export async function checkCaptureAllowed(userId: string, accessToken: string): Promise<ValidationResult> {
  const info = await getUserTier(userId, accessToken)
  if (info.tier !== 'mist' && info.subscriptionPeriodEnd && new Date() > new Date(info.subscriptionPeriodEnd)) return { allowed: false, tier: info.tier, remaining: 0, statusCode: 402, error: 'Subscription expired', action: 'FORCE_CLOSE_AND_UPGRADE' }
  if (info.tier === 'mist') return { allowed: false, tier: 'mist', remaining: 0, statusCode: 403, error: 'Upgrade Required', message: 'Echo reads pixels, transcribes voices, and unpacks links. Upgrade to proceed.' }
  if (info.tier === 'echo' && info.remaining <= 0) return { allowed: false, tier: 'echo', remaining: 0, statusCode: 403, error: 'Usage Cap Exceeded', message: 'You have reached your 100 premium monthly captures. Upgrade to Presence for unlimited memory.' }
  return { allowed: true, tier: info.tier, remaining: info.remaining }
}

export async function incrementUsage(userId: string, accessToken: string): Promise<void> {
  const userClient = createClient(SUPABASE_URL || 'https://placeholder.supabase.co', SUPABASE_ANON_KEY || 'placeholder-anon-key', { global: { headers: { Authorization: `Bearer ${accessToken}` } } })
  const { data } = await userClient.from('profiles').select('usage_count, usage_reset_at').eq('user_id', userId).single()
  if (data) {
    if ((Date.now() - new Date(data.usage_reset_at).getTime()) / (1000 * 60 * 60 * 24) >= 30) await userClient.from('profiles').update({ usage_count: 1, usage_reset_at: new Date().toISOString() }).eq('user_id', userId)
    else await userClient.from('profiles').update({ usage_count: (data.usage_count as number) + 1 }).eq('user_id', userId)
  }
}
