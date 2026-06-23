import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { logger } from './logger';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  logger.warn(
    'Aether · Supabase env vars are missing — running in offline demo mode. ' +
      'Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to enable auth + storage.'
  );
}

/**
 * Graceful Supabase client.
 *
 * If env vars are missing we still build a client (against a harmless
 * placeholder URL) so that importing this module never crashes the page.
 * Auth/data calls will simply fail with a clear error at runtime, which
 * the UI already handles via toast messages.
 */
export const supabase: SupabaseClient = createClient(
  supabaseUrl || 'https://placeholder.aether.local',
  supabaseAnonKey || 'placeholder-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);

/** True when real Supabase credentials are configured. */
export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
