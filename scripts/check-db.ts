import { createClient } from '@supabase/supabase-js'

/**
 * Script de diagnostic dynamique pour vérifier l'existence des données SRU/SCI.
 * Node 20+ : npx tsx --env-file=.env.local scripts/check-db.ts
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
)

async function checkDatabase() {
  console.log('🚀 [Backend Debug] Recherche dynamique des données SCI + (SRU ou L.271-1)\n')

  const tablesToTest = ['legal_articles', 'jurisprudence', 'chunks', 'documents']
  const possibleTextColumns = ['content', 'holding', 'chunkText', 'text', 'principe']

  for (const table of tablesToTest) {
    console.log(`🔎 Test de la table : '${table}'...`)
    
    // 1. On vérifie d'abord si la table existe et quelles sont ses colonnes
    const { data: sample, error: tableErr } = await supabase.from(table).select('*').limit(1)
    
    if (tableErr || !sample) {
      console.log(`   ❌ Table inaccessible ou inexistante.\n`)
      continue
    }

    const availableCols = Object.keys(sample[0] || {})
    const textCol = possibleTextColumns.find(c => availableCols.includes(c))

    if (!textCol) {
      console.log(`   ⚠️ Table trouvée mais aucune colonne de texte connue (${possibleTextColumns.join(', ')}) n'est présente.\n`)
      continue
    }

    console.log(`   ✅ Colonne de texte détectée : '${textCol}'`)
    console.log(`   📡 Recherche de '%SCI%' AND ('%SRU%' OR '%271-1%')...`)

    // 2. Recherche par mot-clé (on commence par SCI)
    const { data, error: searchErr } = await supabase
      .from(table)
      .select('*')
      .ilike(textCol, '%SCI%')

    if (searchErr) {
      console.error(`   ❌ Erreur de recherche : ${searchErr.message}\n`)
      continue
    }

    // 3. Filtrage local pour le AND (SRU ou 271-1)
    const results = (data ?? []).filter(row => {
      const text = String(row[textCol] || '').toUpperCase()
      return text.includes('SRU') || text.includes('271-1')
    })

    console.log(`   📊 Résultats trouvés dans '${table}' : ${results.length}`)

    if (results.length > 0) {
      console.log(`\n   --- 📝 Top 3 des extraits dans ${table} ---`)
      results.slice(0, 3).forEach((res, i) => {
        // On affiche aussi le titre ou numéro si disponible
        const identifier = res.title || res.sourceLaw || res.number || 'Inconnu'
        console.log(`\n   [${i + 1}] Source : ${identifier}`)
        console.log(`   Texte : ${String(res[textCol]).substring(0, 300).replace(/\n/g, ' ')}...`)
      })
      console.log('\n' + '='.repeat(60) + '\n')
    } else {
      console.log(`   ℹ️ Aucun document combinant SCI et SRU/271-1 dans cette table.\n`)
    }
  }
}

checkDatabase().catch(console.error)
