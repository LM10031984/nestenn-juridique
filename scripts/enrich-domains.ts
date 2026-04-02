// scripts/enrich-domains.ts
// Analyse mensuelle des questions sans domaine et des auto-indexations
// Usage : npx dotenv-cli -e .env.local -- npx tsx scripts/enrich-domains.ts

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function main() {
  console.log('\n=== RAPPORT AUTO-APPRENTISSAGE (30 jours) ===\n')

  const since = new Date()
  since.setDate(since.getDate() - 30)

  // 1. Questions sans domaine
  const { data: noDomain } = await supabase
    .from('messages')
    .select('content, sub_domain')
    .eq('role', 'user')
    .is('domain', null)
    .gte('created_at', since.toISOString())

  console.log(`📊 ${noDomain?.length ?? 0} questions sans domaine détecté\n`)

  if (noDomain?.length) {
    // Mots-clés fréquents
    const wordCount = new Map<string, number>()
    const STOP = new Set([
      'dans', 'avec', 'pour', 'quel', 'comment', 'peut', 'doit',
      'faut', 'sont', 'être', 'avoir', 'faire', 'tout', 'même', 'encore',
    ])
    for (const q of noDomain) {
      const words = (q.content ?? '').toLowerCase()
        .replace(/[^\w\sàâäéèêëîïôùûüç-]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 4 && !STOP.has(w))
      for (const w of words) wordCount.set(w, (wordCount.get(w) ?? 0) + 1)
    }

    console.log('Mots-clés récurrents :')
    for (const [word, count] of [...wordCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
      console.log(`  ${count}×  ${word}`)
    }

    // Sub-domains récurrents sans domaine parent
    const subCount = new Map<string, number>()
    for (const q of noDomain) {
      if (q.sub_domain) subCount.set(q.sub_domain, (subCount.get(q.sub_domain) ?? 0) + 1)
    }
    if (subCount.size > 0) {
      console.log('\nSous-domaines sans domaine parent :')
      for (const [sub, count] of [...subCount.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${count}×  ${sub}`)
      }
    }
  }

  // 2. Mots-clés auto-ajoutés au whitelist
  const { data: autoKw } = await supabase
    .from('filter_keywords')
    .select('keyword, created_at')
    .eq('added_by', 'auto')
    .order('created_at', { ascending: false })
    .limit(20)

  console.log(`\n📝 ${autoKw?.length ?? 0} mots-clés auto-ajoutés au whitelist :`)
  for (const kw of autoKw ?? []) {
    console.log(`  "${kw.keyword}" — ${new Date(kw.created_at).toLocaleDateString('fr-FR')}`)
  }

  // 3. Articles et jurisprudence auto-indexés
  const { data: alerts } = await supabase
    .from('quality_alerts')
    .select('alert_type, details, created_at')
    .in('alert_type', ['auto_indexed_article', 'auto_indexed_jurisprudence'])
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: false })
    .limit(20)

  const articles = (alerts ?? []).filter(a => a.alert_type === 'auto_indexed_article')
  const juris = (alerts ?? []).filter(a => a.alert_type === 'auto_indexed_jurisprudence')

  console.log(`\n📚 ${articles.length} articles auto-indexés :`)
  for (const a of articles) {
    const d = typeof a.details === 'string' ? JSON.parse(a.details) : a.details
    console.log(`  ${d.law} art. ${d.article} — ${new Date(a.created_at).toLocaleDateString('fr-FR')}`)
  }

  console.log(`\n⚖️ ${juris.length} arrêts auto-indexés :`)
  for (const a of juris) {
    const d = typeof a.details === 'string' ? JSON.parse(a.details) : a.details
    console.log(`  ${d.court ?? 'cass'} n° ${d.number} — ${new Date(a.created_at).toLocaleDateString('fr-FR')}`)
  }

  // 4. Historique cron update-corpus
  console.log('\n🔄 Dernières mises à jour cron :')
  const { data: cronAlerts } = await supabase
    .from('quality_alerts')
    .select('details, created_at')
    .eq('alert_type', 'corpus_update')
    .order('created_at', { ascending: false })
    .limit(5)

  if (cronAlerts?.length) {
    for (const a of cronAlerts) {
      const d = typeof a.details === 'string' ? JSON.parse(a.details) : a.details
      console.log(`  ${new Date(a.created_at).toLocaleDateString('fr-FR')} — vérifié: ${d.checked}, mis à jour: ${d.updated}`)
    }
  } else {
    console.log('  Aucune exécution enregistrée')
  }

  console.log('\n→ Ajouter les mots-clés récurrents au domain-detector.ts si pertinent')
  console.log('→ Les sous-domaines récurrents peuvent devenir de nouveaux domaines\n')
}

main().catch(console.error)
