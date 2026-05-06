import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import { loadEnvConfig } from '@next/env'

// Charge les variables d'environnement depuis .env.local
loadEnvConfig(process.cwd())

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("❌ Les variables d'environnement Supabase sont manquantes dans .env.local")
  process.exit(1)
}

// Initialise le client avec la clé Service Role (contourne la RLS)
const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function main() {
  const targetEmail = 'laurent@start-academy.fr'
  const newAgencyId = randomUUID() // Génère un faux UUID pour l'agence de Nice
  
  console.log(`🔍 Recherche de l'utilisateur ${targetEmail}...`)
  
  // 1. Chercher l'ID de l'utilisateur dans auth.users
  const { data: authData, error: authError } = await supabase.auth.admin.listUsers()
  
  if (authError) {
    console.error("❌ Erreur lors de la récupération des utilisateurs:", authError.message)
    process.exit(1)
  }

  const user = authData.users.find(u => u.email === targetEmail)
  
  if (!user) {
    console.error(`❌ Impossible de trouver l'utilisateur ${targetEmail}.`)
    process.exit(1)
  }
  
  console.log(`✅ Utilisateur trouvé (ID: ${user.id}). Mise à jour en cours...`)
  
  // 2. Créer l'agence fictive pour satisfaire la contrainte de clé étrangère
  console.log(`🏢 Création de l'agence fictive (ID: ${newAgencyId})...`)
  const { error: agencyError } = await supabase
    .from('agencies')
    .upsert({ id: newAgencyId, name: 'Agence de Nice', slug: 'agence-de-nice' })
    
  if (agencyError) {
    console.error(`❌ Erreur lors de la création de l'agence:`, agencyError.message)
    process.exit(1)
  }

  // 3. Mettre à jour son agency_id dans la table publique 'users'
  const { error: updateError } = await supabase
    .from('users')
    .update({ agency_id: newAgencyId })
    .eq('id', user.id)
    
  if (updateError) {
    console.error(`❌ Erreur lors de la mise à jour de la table users:`, updateError.message)
    process.exit(1)
  }
  
  console.log(`🎉 Succès !`)
  console.log(`   L'utilisateur ${targetEmail} a maintenant l'agency_id : ${newAgencyId}`)
  console.log(`   Vos tests de RLS peuvent commencer.`)
}

main()
