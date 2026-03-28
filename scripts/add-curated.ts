/**
 * scripts/add-curated.ts
 * Ajout manuel d'un curated dans pgvector (legal_articles ou jurisprudence)
 *
 * Usage :
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/add-curated.ts
 */

import * as readline from 'readline'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const NOMIC_API_URL  = 'https://api-atlas.nomic.ai/v1/embedding/text'
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

// ── Helpers I/O ───────────────────────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

function ask(question: string): Promise<string> {
  return new Promise(resolve => rl.question(question, answer => resolve(answer.trim())))
}

async function readMultilineText(label: string): Promise<string> {
  console.log(`\n${label} (terminez avec une ligne vide) :`)
  const lines: string[] = []
  for await (const line of rl) {
    if (line === '') break
    lines.push(line)
  }
  return lines.join('\n').trim()
}

// ── Embedding ─────────────────────────────────────────────────────────────────

async function embed(text: string): Promise<number[]> {
  const res = await fetch(NOMIC_API_URL, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${process.env.NOMIC_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'nomic-embed-text-v1.5', texts: [text] }),
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`Nomic error: ${res.status}`)
  const data = await res.json() as { embeddings: number[][] }
  return data.embeddings[0]
}

// ── LLM Summarize ─────────────────────────────────────────────────────────────

interface Summary { situation: string; principe: string; consequence: string }

async function summarize(text: string, isJuri: boolean): Promise<Summary> {
  const systemPrompt = isJuri
    ? `Tu es juriste spécialisé en droit immobilier français.
Résume cet arrêt en 3 champs JSON stricts (pas de markdown) :
- situation : les faits et le contexte procédural
- principe : la règle de droit dégagée par la juridiction
- consequence : l'effet pratique pour un agent immobilier ou praticien
Réponds UNIQUEMENT avec du JSON valide : {"situation":"...","principe":"...","consequence":"..."}`
    : `Tu es juriste spécialisé en droit immobilier français.
Résume cet article en 3 champs JSON stricts (pas de markdown) :
- situation : quand cet article s'applique (agent, acheteur, locataire, etc.)
- principe : la règle ou obligation principale
- consequence : ce qui se passe si non-respecté ou l'effet pratique
Réponds UNIQUEMENT avec du JSON valide : {"situation":"...","principe":"...","consequence":"..."}`

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://nestenn.com',
      'X-Title':      'Nestenn Juridique',
    },
    body: JSON.stringify({
      model:      'openai/gpt-4o-mini',
      max_tokens: 300,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: text.slice(0, 3000) },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`OpenRouter error: ${res.status}`)
  const data = await res.json() as { choices?: Array<{ message: { content: string } }> }
  const raw = data.choices?.[0]?.message?.content?.trim() ?? ''
  return JSON.parse(raw) as Summary
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n=== AJOUT CURATED MANUEL ===\n')

  const typeRaw = await ask('Type (article_loi / jurisprudence_cc / jurisprudence_ca) : ')
  const isJuri = typeRaw.startsWith('jurisprudence')
  const court  = typeRaw === 'jurisprudence_ca' ? 'ca' : 'cc'

  const law    = await ask(isJuri ? 'Juridiction (ex: Cour de cassation, Cour d\'appel Paris) : '
                                   : 'Loi (ex: Code civil, loi 89-462) : ')
  const ref    = await ask(isJuri ? 'Numéro d\'arrêt (ex: 19-14.531, ou entrée si inconnu) : '
                                   : 'Numéro d\'article (ex: 505, L271-1) : ')
  const domain = await ask('Domaine (ex: transactions, baux_habitation, copropriete, agent_immobilier) : ')
  const url    = await ask('URL Légifrance/Judilibre (entrée pour skip) : ')

  const text = await readMultilineText('Collez le texte juridique')
  if (!text) { console.log('❌ Texte vide — abandon'); rl.close(); process.exit(1) }

  console.log('\n⏳ Résumé LLM...')
  let summary: Summary
  try {
    summary = await summarize(text, isJuri)
    console.log('  situation  :', summary.situation.slice(0, 80), '...')
    console.log('  principe   :', summary.principe.slice(0, 80), '...')
    console.log('  consequence:', summary.consequence.slice(0, 80), '...')
  } catch (err) {
    console.error('❌ Erreur LLM :', err)
    rl.close(); process.exit(1)
  }

  console.log('\n⏳ Embedding...')
  const embeddingText = `${summary.situation} ${summary.principe} ${summary.consequence}`
  let embedding: number[]
  try {
    embedding = await embed(embeddingText)
  } catch (err) {
    console.error('❌ Erreur Nomic :', err)
    rl.close(); process.exit(1)
  }

  if (isJuri) {
    // ── Insertion jurisprudence ──────────────────────────────────────────────
    const sourceId = `curated-${law.replace(/\s+/g, '-').toLowerCase()}-${ref || 'sans-numero'}-${Date.now()}`
    const { error } = await supabase.from('jurisprudence').insert({
      source_id:      sourceId,
      court,
      number:         ref || null,
      situation:      summary.situation,
      principle:      summary.principe,
      consequence:    summary.consequence,
      domain,
      url:            url || null,
      motivations_raw: text,
      embedding,
      curated:        true,
    })

    if (error) {
      console.error('\n❌ Erreur insertion :', error.message)
    } else {
      console.log(`\n✅ Arrêt curated inséré : ${sourceId}`)
      console.log(`   Table : jurisprudence | court : ${court} | domain : ${domain}`)
    }
  } else {
    // ── Insertion legal_articles ─────────────────────────────────────────────
    const lawId = `CURATED-${law.replace(/\s+/g, '-').toUpperCase()}`
    const { error } = await supabase.from('legal_articles').upsert({
      law_id:          lawId,
      article_num:     ref,
      title:           `Art. ${ref} — ${law} (curated)`,
      content:         text,
      content_summary: JSON.stringify(summary),
      date_version:    new Date().toISOString().slice(0, 10),
      url:             url || null,
      domain,
      sub_themes:      [],
      in_force:        true,
      embedding,
    }, { onConflict: 'law_id,article_num' })

    if (error) {
      console.error('\n❌ Erreur insertion :', error.message)
    } else {
      console.log(`\n✅ Article curated inséré : ${lawId} art. ${ref}`)
      console.log(`   Table : legal_articles | domain : ${domain}`)
    }
  }

  rl.close()
}

main().catch(err => { console.error(err); rl.close(); process.exit(1) })
