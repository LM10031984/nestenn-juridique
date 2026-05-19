/**
 * Bootstrap des comptes utilisateurs sur Supabase (admin/conseiller).
 *
 * Deux modes :
 *  - LIST : lance le script sans BOOTSTRAP_USERS_JSON → liste les agences disponibles
 *  - CREATE : set BOOTSTRAP_USERS_JSON dans l'env, lance → crée/met à jour les comptes
 *
 * Format BOOTSTRAP_USERS_JSON :
 *   [
 *     {"email":"laurent@...","password":"...","fullName":"...","role":"super_admin","agencyId":null},
 *     {"email":"djiogo...","password":"...","fullName":"...","role":"conseiller","agencyId":"uuid"}
 *   ]
 *
 * Le trigger handle_new_user (migration 016) crée la ligne public.users via user_metadata.
 * On force ensuite status='active' pour skip la file d'attente d'approbation.
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import { resolve } from 'path'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant dans .env.local')
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
})

type Role = 'super_admin' | 'responsable_agence' | 'conseiller'

interface UserSpec {
  email: string
  password: string
  fullName: string
  role: Role
  agencyId: string | null
}

async function listAgencies() {
  const { data, error } = await admin.from('agencies').select('id, name, is_active').order('name')
  if (error) throw new Error(`Lecture agencies : ${error.message}`)
  return data ?? []
}

async function findUserByEmail(email: string): Promise<string | null> {
  let page = 1
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 50 })
    if (error) throw new Error(`listUsers : ${error.message}`)
    const found = data.users.find(u => u.email?.toLowerCase() === email.toLowerCase())
    if (found) return found.id
    if (data.users.length < 50) return null
    page += 1
  }
}

async function upsertUser(spec: UserSpec): Promise<void> {
  const existing = await findUserByEmail(spec.email)
  let userId: string

  if (existing) {
    console.log(`  ↻ ${spec.email} : compte existant, mise à jour du mot de passe…`)
    const { error } = await admin.auth.admin.updateUserById(existing, {
      password: spec.password,
      email_confirm: true,
      user_metadata: { full_name: spec.fullName, role: spec.role, agency_id: spec.agencyId },
    })
    if (error) throw new Error(`updateUserById : ${error.message}`)
    userId = existing
  } else {
    console.log(`  + ${spec.email} : création du compte Auth…`)
    const { data, error } = await admin.auth.admin.createUser({
      email: spec.email,
      password: spec.password,
      email_confirm: true,
      user_metadata: { full_name: spec.fullName, role: spec.role, agency_id: spec.agencyId },
    })
    if (error || !data.user) throw new Error(`createUser : ${error?.message ?? 'inconnu'}`)
    userId = data.user.id
  }

  // Force status=active + applique role/agency_id même si le trigger a déjà tourné
  const { error: upsertError } = await admin
    .from('users')
    .upsert(
      {
        id: userId,
        full_name: spec.fullName,
        role: spec.role,
        agency_id: spec.agencyId,
        status: 'active',
      },
      { onConflict: 'id' },
    )

  if (upsertError) throw new Error(`upsert public.users : ${upsertError.message}`)

  console.log(`  ✓ ${spec.email} prêt — role=${spec.role}, status=active${spec.agencyId ? `, agency_id=${spec.agencyId}` : ''}`)
}

async function main() {
  const raw = process.env.BOOTSTRAP_USERS_JSON

  if (!raw) {
    // Mode LIST : affiche les agences pour aider à construire le payload
    console.log('Aucun BOOTSTRAP_USERS_JSON fourni → mode liste agences\n')
    const agencies = await listAgencies()
    if (agencies.length === 0) {
      console.log('Aucune agence en base.')
    } else {
      console.log('Agences disponibles :')
      for (const a of agencies) {
        console.log(`  ${a.id}  ${a.name}${a.is_active ? '' : '  (inactive)'}`)
      }
    }
    console.log('\nPuis relance avec BOOTSTRAP_USERS_JSON=...')
    return
  }

  let specs: UserSpec[]
  try {
    specs = JSON.parse(raw)
    if (!Array.isArray(specs)) throw new Error('BOOTSTRAP_USERS_JSON doit être un tableau')
  } catch (e: any) {
    throw new Error(`BOOTSTRAP_USERS_JSON invalide : ${e.message}`)
  }

  console.log(`Bootstrap de ${specs.length} compte(s)…`)
  for (const spec of specs) {
    if (!spec.email || !spec.password || !spec.fullName || !spec.role) {
      throw new Error(`Spec incomplète : ${JSON.stringify(spec)}`)
    }
    if (spec.password.length < 8) {
      throw new Error(`Mot de passe trop court pour ${spec.email} (min 8 chars)`)
    }
    await upsertUser(spec)
  }
  console.log('\n✅ Terminé.')
}

main().catch(err => {
  console.error('\n❌ Erreur :', err.message ?? err)
  process.exit(1)
})
