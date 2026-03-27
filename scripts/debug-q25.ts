import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function main() {
  // 1. Embed the question
  const q = "Qu'est-ce qu'une clause de substitution dans un compromis de vente ?"
  console.log('Question:', q)

  const embRes = await fetch('https://api-atlas.nomic.ai/v1/embedding/text', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.NOMIC_API_KEY}`,
    },
    body: JSON.stringify({ model: 'nomic-embed-text-v1.5', texts: [q] }),
  })

  if (!embRes.ok) {
    console.error('Nomic error:', embRes.status, await embRes.text())
    process.exit(1)
  }

  const embData = (await embRes.json()) as { embeddings: number[][] }
  const embedding = embData.embeddings[0]
  console.log('Embedding dim:', embedding.length)

  // 2. Search via RPC
  const { data, error } = await sb.rpc('search_all_legal_context', {
    query_embedding: embedding,
    match_count: 20,
    boost_domains: ['vente_immobiliere'],
  })

  if (error) {
    console.error('RPC error:', error.message)
    process.exit(1)
  }

  console.log(`\n=== ${(data as any[]).length} résultats ===\n`)
  for (const row of (data as any[])) {
    const label = row.source === 'arret' ? 'ARRET' : 'ART'
    const isCurated = row.doc_id?.startsWith('curated-') ? ' [CURATED]' : ''
    console.log(
      `${label}${isCurated} | sim=${Number(row.similarity).toFixed(4)} | ${(row.title || row.doc_id || '???').slice(0, 90)}`
    )
  }

  // 3. Direct check: does the curated entry exist?
  const { data: curated, error: ce } = await sb
    .from('jurisprudence')
    .select('source_id, situation, embedding')
    .eq('source_id', 'curated-clause-substitution-compromis')
    .single()

  if (ce) console.error('\nCurated lookup error:', ce.message)
  else {
    console.log('\nCurated entry found:', curated.source_id)
    console.log('Has embedding:', !!curated.embedding)
    console.log('Situation:', curated.situation?.slice(0, 120))
  }
}

main().catch(e => { console.error(e); process.exit(1) })
