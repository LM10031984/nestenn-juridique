// scripts/reembed-pillars.ts
// Ré-indexation ciblée des pivots juridiques défaillants identifiés par le
// diagnostic debug-similarity.ts.
//
// Pour chaque article :
//   1. récupère title + content + domain actuels
//   2. re-génère un content_summary avec un prompt renforcé qui impose :
//      - langage terrain (agent, locataire, bailleur, acheteur)
//      - préservation exacte des chiffres (délais, montants, dates, seuils)
//   3. reconstruit un embedding_text enrichi :
//      title + situation + principe + consequence + paraphrases terrain + content
//   4. re-génère l'embedding via Nomic
//   5. update la row (content_summary, embedding, et domain si override)
//
// Usage :
//   npx tsx scripts/reembed-pillars.ts

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── Charger .env.local AVANT les imports dynamiques ──────────────────────────

try {
  const envPath = resolve(__dirname, '../.env.local')
  const envContent = readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch { /* .env.local absent */ }

for (const key of [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NOMIC_API_KEY',
  'OPENROUTER_API_KEY',
]) {
  if (!process.env[key]) {
    console.error(`❌  ${key} manquant dans .env.local`)
    process.exit(1)
  }
}

// ── Pivots à ré-indexer ──────────────────────────────────────────────────────

interface PillarUpdate {
  law_id:         string
  article_num:    string
  label:          string
  paraphrases:    string[]       // mots-clés terrain injectés dans l'embedding
  overrideDomain?: string        // si le domain actuel est incorrect
}

const PILLARS: PillarUpdate[] = [
  {
    law_id: 'LEGITEXT000006069108', article_num: '7-1',
    label:  'art. 7-1 loi 89-462 (prescription triennale)',
    paraphrases: [
      "prescription triennale 3 ans action dérivant d'un contrat de bail",
      "délai d'action du bailleur et du locataire prescrit par 3 ans",
      "recouvrement loyers impayés prescription 3 ans",
      "délai pour agir en justice contre le locataire ou le bailleur",
    ],
  },
  {
    law_id: 'LEGITEXT000006069108', article_num: '24',
    label:  'art. 24 loi 89-462 (clause résolutoire impayés)',
    paraphrases: [
      "locataire ne paie plus son loyer procédure",
      "commandement de payer huissier clause résolutoire loyer impayé",
      "délai légal après commandement de payer",
      "loyer impayé expulsion résiliation bail",
      "impayé locatif action bailleur tribunal judiciaire",
      "que faire si un locataire ne paie plus son loyer",
    ],
  },
  {
    law_id: 'LEGITEXT000006069108', article_num: '25-1',
    label:  'art. 25-1 loi 89-462 (scope meublés — Titre Ier bis)',
    paraphrases: [
      "location meublée à titre de résidence principale",
      "bail meublé régi par le Titre Ier bis de la loi 89-462",
      "règles spécifiques aux logements meublés",
      "s'applique uniquement aux locations meublées, pas aux locations vides",
      "champ d'application du régime du bail meublé",
      "distinction bail meublé / bail nu",
    ],
  },
  {
    law_id: 'LEGITEXT000006068387', article_num: '6',
    label:  'art. 6 Hoguet (mandat écrit obligatoire)',
    paraphrases: [
      "agent immobilier commission sans mandat écrit",
      "pas de commission si pas de mandat signé",
      "mandat de vente écrit préalable obligatoire",
      "réclamer une commission sans mandat signé impossible",
      "nullité du droit à commission en l'absence de mandat",
      "agent immobilier peut-il réclamer commission sans mandat signé",
    ],
  },
  {
    law_id: 'LEGITEXT000006068387', article_num: '14',
    label:  'art. 14 Hoguet (sanctions pénales)',
    paraphrases: [
      "sanctions pénales agent immobilier exercice sans carte sans mandat",
      "6 mois d'emprisonnement et 7 500 euros d'amende loi Hoguet",
      "infraction loi Hoguet exercice illégal activité agent immobilier",
      "sanctions pour agent immobilier sans mandat ou sans carte",
      "peines encourues par l'agent immobilier en violation de la loi Hoguet",
    ],
  },
  {
    law_id: 'LEGITEXT000006074096', article_num: 'L.173-1-1',
    label:  'art. L.173-1-1 CCH (calendrier passoires thermiques)',
    paraphrases: [
      "logement classé G interdiction de mise en location",
      "G lourd > 450 kWh/m²/an interdit depuis le 1er janvier 2023",
      "logements G interdits à la location à partir du 1er janvier 2025",
      "logements F interdits à partir du 1er janvier 2028",
      "logements E interdits à partir du 1er janvier 2034",
      "décence énergétique location passoire thermique",
      "DPE classe énergétique seuils kWh par mètre carré par an",
      "un logement classé G peut-il encore être mis en location",
    ],
    overrideDomain: 'baux_habitation',
  },
  {
    law_id: 'LEGITEXT000006069108', article_num: '15',
    label:  'art. 15 loi 89-462 (congé bailleur — reprise + vente préemption)',
    paraphrases: [
      // Q1 — congé pour reprise
      "congé pour loger son fils majeur enfant descendant",
      "congé pour reprise par le bailleur ou un proche (conjoint, PACS, concubin, ascendants, descendants)",
      "bénéficiaires autorisés du congé pour reprise",
      "résidence principale du bénéficiaire du congé",
      "préavis 6 mois logement vide, 3 mois meublé",
      // Q8 — congé pour vente + droit de préemption
      "congé pour vente droit de préemption du locataire",
      "obligation de notifier le nouveau prix si prix inférieur proposé à un tiers",
      "seconde offre au locataire si vente à un tiers à un prix plus bas",
      "congé pour vente est-il valable si le prix proposé à un tiers est plus bas",
      // Q9 — locataire âgé protégé
      "locataire âgé de plus de 65 ans protégé contre le congé sous conditions de ressources",
      "exception locataire protégé si bailleur également âgé ou à revenus modestes",
    ],
  },
  {
    law_id: 'LEGITEXT000006070721', article_num: '1112-1',
    label:  "art. 1112-1 Code civil (obligation précontractuelle d'information)",
    paraphrases: [
      "obligation d'information précontractuelle du vendeur envers l'acquéreur",
      "devoir d'information sur les éléments déterminants du consentement",
      "réforme des contrats 2016 nouvelle numérotation",
      "vendeur doit informer l'acquéreur d'une occupation, d'un litige, d'un vice important",
      "vendre un bien occupé sans l'indiquer à l'acquéreur",
      "informer l'acheteur d'un litige de voisinage en cours",
      "sanction : nullité du contrat ou dommages-intérêts si information cachée",
      "application à la vente immobilière (information précontractuelle)",
    ],
    overrideDomain: 'vente_immobiliere',
  },
  {
    law_id: 'LEGITEXT000006068256', article_num: '46',
    label:  'art. 46 loi 65-557 (loi Carrez — surface privative)',
    paraphrases: [
      "loi Carrez surface privative mesurage obligatoire",
      "obligation de mentionner la surface Carrez dans la promesse et l'acte authentique",
      "diminution du prix si surface réelle inférieure de plus de 5% à la surface annoncée",
      "erreur de surface dans un acte de vente copropriété",
      "annulation ou réfaction du prix en cas de surface minimisée",
      "distinction entre action dol (art. 1137 CC) et action Carrez en diminution de prix",
      "la surface a été volontairement minimisée par le vendeur",
    ],
    overrideDomain: 'vente_immobiliere',
  },
]

// ── Prompt summary renforcé (langage terrain + chiffres exacts) ──────────────

const SUMMARY_SYSTEM = `Tu es juriste expert en droit immobilier français, qui travaille avec des agents immobiliers.
Tu résumes un article de loi en 3 champs JSON stricts (pas de markdown).

- situation : décris EN LANGUE TERRAIN dans quel cas pratique cet article s'applique.
  ✓ "un locataire ne paie plus son loyer depuis plusieurs mois"
  ✗ "le preneur à bail manque à son obligation de paiement du loyer"

- principe : la règle juridique EXACTE, avec TOUS les chiffres clés repris textuellement : délais (en jours/semaines/mois/années), montants (en euros), dates d'entrée en vigueur, seuils, pourcentages. Ne paraphrase JAMAIS un chiffre. Si l'article dit "six semaines", écris "six semaines". Si l'article dit "trois ans", écris "trois ans". Si l'article prévoit plusieurs règles distinctes, liste-les toutes.

- consequence : les effets pratiques et sanctions, avec leurs valeurs exactes (amendes, peines d'emprisonnement, nullité, déchéance, etc.) telles qu'elles figurent dans l'article.

RÈGLES STRICTES :
- Ne JAMAIS inventer un délai, un montant, une date absente du texte.
- Ne JAMAIS paraphraser un chiffre en changeant sa valeur (3 ans ≠ 1 an).
- Si l'article contient plusieurs dispositions, reflète toutes les principales dans le principe.
- Utilise le vocabulaire que l'agent immobilier ou son client utiliserait.

Réponds UNIQUEMENT avec du JSON valide : {"situation":"...","principe":"...","consequence":"..."}`

// ── Embedding Nomic ──────────────────────────────────────────────────────────

const NOMIC_API_URL = 'https://api-atlas.nomic.ai/v1/embedding/text'

async function embedTextNomic(text: string): Promise<number[] | null> {
  try {
    const res = await fetch(NOMIC_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.NOMIC_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'nomic-embed-text-v1.5', texts: [text] }),
    })
    if (!res.ok) { console.warn(`   embedding HTTP ${res.status}`); return null }
    const data = await res.json() as { embeddings: number[][] }
    return data.embeddings?.[0] ?? null
  } catch (e) {
    console.error('   embedding error:', e)
    return null
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

interface SummaryJSON { situation: string; principe: string; consequence: string }

async function main(): Promise<void> {
  const { createClient } = await import('@supabase/supabase-js')
  const { openRouterChat, MODELS } = await import('../lib/openrouter')

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  console.log(`\n🔄  Re-indexation de ${PILLARS.length} pivots juridiques\n`)

  let updated = 0
  let failed  = 0

  for (const p of PILLARS) {
    console.log(`\n→ ${p.label}`)

    // 1. Fetch row existante
    const { data: row, error: fetchErr } = await supabase
      .from('legal_articles')
      .select('id, title, content, domain')
      .eq('law_id', p.law_id)
      .eq('article_num', p.article_num)
      .maybeSingle()

    if (fetchErr || !row) {
      console.warn(`   ❌ row introuvable (fetch error: ${fetchErr?.message ?? 'aucune'})`)
      failed++
      continue
    }

    const id      = row.id      as string
    const title   = row.title   as string
    const content = row.content as string
    const currentDomain = row.domain as string
    console.log(`   row trouvée : ${content.length} chars content, domain="${currentDomain}"`)

    // 2. Re-générer summary avec prompt renforcé
    let summary: SummaryJSON | null = null
    try {
      const raw = await openRouterChat(
        [
          { role: 'system', content: SUMMARY_SYSTEM },
          { role: 'user',   content: `Article ${p.article_num} — ${title}\n\n${content.slice(0, 4000)}` },
        ],
        MODELS.FILTER,
        900,
      )
      const parsed = JSON.parse(raw.trim()) as Partial<SummaryJSON>
      if (parsed.situation && parsed.principe && parsed.consequence) {
        summary = { situation: parsed.situation, principe: parsed.principe, consequence: parsed.consequence }
      }
    } catch (e) {
      console.error(`   summary error: ${e}`)
    }

    if (!summary) {
      console.warn(`   ❌ summary échec`)
      failed++
      continue
    }
    console.log(`   ✓ summary : "${summary.principe.slice(0, 100).replace(/\s+/g, ' ')}..."`)

    // 3. Embed text focalisé — court et ciblé (~600-900 chars)
    // Pas de content brut : dilue le signal sémantique (vu au diagnostic précédent)
    const embedText = [
      title,
      `Situation : ${summary.situation}`,
      `Règle : ${summary.principe}`,
      `Conséquence : ${summary.consequence}`,
      `Mots-clés : ${p.paraphrases.join(' | ')}`,
    ].join('\n')
    console.log(`   embed_text : ${embedText.length} chars`)

    // 4. Embedding Nomic
    const embedding = await embedTextNomic(embedText)
    if (!embedding?.length) {
      console.warn(`   ❌ embedding échec`)
      failed++
      continue
    }
    console.log(`   ✓ embedding (${embedding.length} dims)`)

    // 5. Update row (content_summary + embedding, et domain si override)
    const updatePayload: {
      content_summary: string
      embedding:       number[]
      domain?:         string
    } = {
      content_summary: JSON.stringify(summary),
      embedding,
    }
    if (p.overrideDomain && p.overrideDomain !== currentDomain) {
      updatePayload.domain = p.overrideDomain
      console.log(`   ⚙️  domain : "${currentDomain}" → "${p.overrideDomain}"`)
    }

    const { error: updErr } = await supabase
      .from('legal_articles')
      .update(updatePayload)
      .eq('id', id)

    if (updErr) {
      console.error(`   ❌ update échec : ${updErr.message}`)
      failed++
    } else {
      console.log(`   ✅ mis à jour`)
      updated++
    }
  }

  console.log(`\n${'═'.repeat(60)}`)
  console.log(`📊  Récap : ${updated} mis à jour  |  ${failed} échecs`)
  console.log(`${'═'.repeat(60)}\n`)
}

main().catch(err => { console.error(err); process.exit(1) })
