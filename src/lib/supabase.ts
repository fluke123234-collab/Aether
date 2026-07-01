import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { logger } from './logger';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

/**
 * Graceful client creation.
 *
 * If the env vars are missing we DO NOT crash the app — the Supabase SDK
 * throws `supabaseUrl is required` when given an empty string at eval time,
 * which would take down the whole page (page.tsx imports this module at
 * top level). Instead we build the client against a placeholder URL so
 * module evaluation always succeeds, and surface a clear warning. Real
 * auth / data calls will then fail at runtime with a friendly toast
 * handled by the calling code (the app runs in "offline demo mode").
 */
const PLACEHOLDER_URL = 'https://placeholder.supabase.co';
const PLACEHOLDER_KEY = 'placeholder-anon-key';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

if (!isSupabaseConfigured) {
  logger.warn(
    "Aether · Supabase env vars are missing — running in offline demo mode. " +
    "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to enable auth + storage."
  );
}

export const supabase: SupabaseClient = createClient(
  supabaseUrl || PLACEHOLDER_URL,
  supabaseAnonKey || PLACEHOLDER_KEY,
  isSupabaseConfigured ? {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      // When offline, don't try to refresh the token — use the cached session
      flowType: 'pkce',
    },
  } : { auth: { persistSession: false } }
);
