import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// Client service role — contourne le RLS, uniquement côté serveur (routes API)
// NE JAMAIS exposer SUPABASE_SERVICE_ROLE_KEY au browser
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
