import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("CRITICAL: Supabase keys are missing. Please verify your environment configuration.");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
