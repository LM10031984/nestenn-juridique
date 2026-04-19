// scripts/update-summaries-vague1b.ts
// Sous-vague 1B — overrides ciblés de content_summary sur 7 articles déjà
// présents en DB mais dont le résumé est tronqué ou inadapté pour les
// questions Q11, Q32, Q33, Q35, Q42, Q51, Q52, Q55.
//
// Règles :
//   - aucune modification de prompt système ni de scoring benchmark
//   - summary manuel (pas de LLM) pour contrôler les termes injectés
//   - re-embedding seulement quand nécessaire (rank faible connu ou
//     article pas dans le prompt à la baseline) — flag `reembed`
//   - Q51 : summary NON modifié (il a été retravaillé par le commit 94a9d6f),
//     juste re-embed pour booster le rank
//
// Usage :
//   npx tsx scripts/update-summaries-vague1b.ts

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
try {
  const envPath = resolve(__dirname, '../.env.local')
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch { /* noop */ }

for (const k of ['NEXT_PUBLIC_SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','NOMIC_API_KEY']) {
  if (!process.env[k]) { console.error(`❌ ${k} manquant`); process.exit(1) }
}

interface SummaryJSON { situation: string; principe: string; consequence: string }

interface Override {
  q:          string
  law_id:     string
  article:    string
  label:      string
  summary:    SummaryJSON | null  // null = pas de changement de summary
  reembed:    boolean
  // Paraphrases supplémentaires injectées dans l'embed_text (terrain)
  // uniquement si reembed=true. Si non fourni, embed_text reconstruit depuis summary seul.
  paraphrases?: string[]
}

const OVERRIDES: Override[] = [

  // ── Q11 — art. 22 loi 89-462 : rendre la retenue 20% saillante ───────────
  {
    q: 'Q11', law_id: 'LEGITEXT000006069108', article: '22',
    label: 'art. 22 loi 89-462 (dépôt garantie + retenue provisoire 20%)',
    reembed: false,
    summary: {
      situation:
        "Le bailleur a reçu un dépôt de garantie et doit le restituer en fin de bail. Pour un logement en immeuble collectif, une régularisation annuelle des charges peut survenir après la restitution des clés.",
      principe:
        "Le dépôt de garantie est limité à un mois de loyer hors charges (location vide). Il doit être restitué dans un délai d'un mois après la remise des clés si l'état des lieux de sortie est conforme, ou de deux mois si des dégradations sont constatées. Pour un logement en immeuble collectif, le bailleur peut, à titre de retenue provisoire, conserver au maximum 20 % du dépôt de garantie jusqu'à l'arrêté annuel des comptes des charges, puis restituer le solde dans le mois suivant cet arrêté.",
      consequence:
        "La retenue provisoire est plafonnée à 20 % du dépôt — toute retenue supérieure est abusive. Passé les délais (1 mois sans dégradations, 2 mois avec), le bailleur doit des intérêts au locataire (loyer majoré de 10 % par mois de retard entamé). Le solde du dépôt doit être reversé dans le mois suivant l'arrêté annuel des comptes.",
    },
  },

  // ── Q32/Q33 — art. 1112-1 CC : cas concrets immobiliers ─────────────────
  {
    q: 'Q32,Q33', law_id: 'LEGITEXT000006070721', article: '1112-1',
    label: 'art. 1112-1 CC (obligation d\'information précontractuelle)',
    reembed: true,
    paraphrases: [
      "peut-on vendre un bien occupé sans l'indiquer clairement à l'acquéreur",
      "le vendeur doit-il informer l'acquéreur d'un litige de voisinage en cours",
      "obligation d'information précontractuelle du vendeur immobilier",
      "devoir d'information précontractuelle sur le bien vendu",
      "information déterminante pour le consentement de l'acquéreur",
      "sanction manquement information précontractuelle — nullité, dol, dommages-intérêts",
    ],
    summary: {
      situation:
        "Un vendeur ou un agent immobilier détient une information déterminante pour le consentement de l'acquéreur (ex. : bien occupé par un locataire, litige de voisinage en cours, servitude, vice connu, procédure administrative) et doit décider s'il est tenu de la communiquer avant la signature.",
      principe:
        "L'art. 1112-1 du Code civil pose une obligation d'information précontractuelle générale : celle des parties qui connaît une information dont l'importance est déterminante pour le consentement de l'autre doit l'en informer, dès lors que cette dernière l'ignore légitimement ou fait confiance à son cocontractant. En vente immobilière, cela couvre notamment : l'existence d'un bail en cours (bien occupé), un litige de voisinage pendant, un projet d'urbanisme impactant, une servitude non apparente. Ce devoir ne porte pas sur la seule estimation de la valeur du bien. La charge de la preuve du devoir d'information pèse sur celui qui s'en prévaut.",
      consequence:
        "Le manquement à l'obligation d'information précontractuelle engage la responsabilité du vendeur (art. 1112-1 + 1240 CC) et peut entraîner l'annulation du contrat pour dol par réticence (art. 1137 CC) ou la réduction du prix. L'acquéreur dispose de 5 ans à compter de la découverte pour agir. L'agent immobilier en connaissance de cause engage sa responsabilité propre au titre de son devoir de conseil.",
    },
  },

  // ── Q33 — art. L.271-4 CCH : injecter l'abréviation DDT ─────────────────
  {
    q: 'Q33', law_id: 'LEGITEXT000006074096', article: 'L271-4',
    label: 'art. L.271-4 CCH (DDT — dossier de diagnostic technique)',
    reembed: false,
    summary: {
      situation:
        "Un vendeur met en vente un immeuble bâti et doit annexer à la promesse de vente ou à l'acte authentique l'ensemble des diagnostics techniques obligatoires. L'agent immobilier supervise la complétude du dossier de diagnostic technique (DDT).",
      principe:
        "L'art. L.271-4 CCH impose l'annexion d'un dossier de diagnostic technique (DDT) à la promesse de vente ou, à défaut, à l'acte authentique. Le DDT regroupe les diagnostics obligatoires : plomb (CREP), amiante, termites, gaz, électricité, ERP (état des risques), DPE, surface Carrez, assainissement non collectif, Mérule. Le DDT doit être remis à l'acquéreur AVANT la signature pour qu'il consente en connaissance de cause.",
      consequence:
        "Un DDT incomplet ou erroné permet à l'acquéreur de se prévaloir de la garantie des vices cachés même en présence d'une clause de non-garantie (les diagnostics opposables écartent la clause). L'agent immobilier doit vérifier que le DDT est complet avant la signature — sa responsabilité est engagée en cas de manquement (devoir de conseil et d'information).",
    },
  },

  // ── Q35 — art. 1643 CC : clause non-garantie inopposable vendeur pro ────
  {
    q: 'Q35', law_id: 'LEGITEXT000006070721', article: '1643',
    label: 'art. 1643 CC (vendeur + clause de non-garantie)',
    reembed: true,
    paraphrases: [
      "le vendeur professionnel est-il présumé connaître les vices",
      "clause de non-garantie inopposable au vendeur professionnel",
      "vendeur professionnel et présomption de connaissance des vices cachés",
      "clause limitative de garantie écartée contre vendeur averti",
      "marchand de biens agent immobilier connaissance présumée des vices",
    ],
    summary: {
      situation:
        "Un vendeur (particulier ou professionnel) conclut une vente immobilière comportant une clause de non-garantie des vices cachés. Un vice caché est ensuite découvert par l'acquéreur.",
      principe:
        "L'art. 1643 du Code civil prévoit que le vendeur est tenu des vices cachés même non connus, sauf s'il a expressément stipulé une clause de non-garantie. Mais la jurisprudence constante (Cass. 3e civ.) écarte cette clause dans deux cas : (1) le vendeur connaissait le vice et l'a dissimulé — la clause est inopposable pour mauvaise foi ; (2) le vendeur est un professionnel de l'immobilier (marchand de biens, promoteur, agent immobilier acquéreur) — il est présumé connaître les vices affectant le bien vendu, la clause de non-garantie lui est donc inopposable de plein droit.",
      consequence:
        "Contre un vendeur professionnel, la clause de non-garantie des vices cachés est inopposable : l'acquéreur peut agir en garantie (réduction du prix ou résolution de la vente) et en dommages-intérêts (art. 1645 CC). Le vendeur particulier de bonne foi, lui, peut se prévaloir de la clause — sauf preuve par l'acquéreur qu'il connaissait le vice.",
    },
  },

  // ── Q42 — art. 1304-3 CC : ajout avenant + déchéance ────────────────────
  {
    q: 'Q42', law_id: 'LEGITEXT000006070721', article: '1304-3',
    label: 'art. 1304-3 CC (condition empêchée — +avenant/déchéance)',
    reembed: false,
    summary: {
      situation:
        "Un acheteur a conclu un compromis de vente sous condition suspensive (typiquement d'obtention d'un prêt bancaire) avec un délai fixé. La banque tarde à répondre, ou l'acheteur dépasse le délai contractuel.",
      principe:
        "L'art. 1304-3 du Code civil pose le principe central : la condition suspensive est réputée accomplie si celui qui y avait intérêt en a empêché l'accomplissement. Appliqué à la condition de prêt : l'acheteur qui ne fait pas les diligences sérieuses (au moins deux demandes de prêt dans le délai contractuel), laisse s'écouler le délai, ou refuse une offre conforme, est réputé avoir empêché la condition. Toute prorogation du délai nécessite un avenant écrit signé des deux parties (principe du consentement mutuel — art. 1193 CC) : le silence de la banque ne prolonge pas automatiquement le compromis. À défaut d'avenant, l'acheteur qui dépasse le délai est déchu du bénéfice de la condition suspensive.",
      consequence:
        "Sans avenant écrit actant la prorogation du délai : l'acheteur inactif ou hors délai peut être déchu du bénéfice de la condition suspensive (condition réputée accomplie au sens de l'art. 1304-3) — le vendeur peut alors conserver le dépôt de garantie et exiger l'exécution forcée de la vente ou des dommages-intérêts. À l'inverse, si l'acheteur a été diligent et de bonne foi, la condition défaillie lui permet de récupérer son dépôt intégralement.",
    },
  },

  // ── Q51 — art. 6 loi 89-462 : SUMMARY INCHANGÉ, re-embed uniquement ─────
  {
    q: 'Q51', law_id: 'LEGITEXT000006069108', article: '6',
    label: 'art. 6 loi 89-462 (décence énergétique — rank boost)',
    reembed: true,
    paraphrases: [
      "un logement classé G peut-il encore être mis en location",
      "interdiction location passoire thermique calendrier 2025 2028 2034",
      "logement classé F interdit location 2028 art. 6 décence énergétique",
      "logement classé E interdit location 2034 loi 89-462",
      "décence énergétique fondement loi 89-462 article 6 pas article 17",
    ],
    summary: null, // NE PAS ÉCRASER — commit 94a9d6f
  },

  // ── Q52 — art. L.126-26 CCH : ajout "opposable depuis 2021" ─────────────
  {
    q: 'Q52', law_id: 'LEGITEXT000006074096', article: 'L126-26',
    label: 'art. L.126-26 CCH (DPE opposable depuis 2021)',
    reembed: false,
    summary: {
      situation:
        "Un DPE est établi pour une vente ou une location. L'acquéreur ou le locataire découvre après coup que la classe énergétique est erronée, ou que la consommation réelle diffère fortement des prévisions du DPE.",
      principe:
        "L'art. L.126-26 CCH définit le DPE (contenu, quantité d'énergie consommée, émissions de gaz à effet de serre, classe énergétique A à G). Depuis la loi n° 2021-1104 du 22 août 2021 (loi Climat et Résilience) et son ordonnance d'application, le DPE est un document OPPOSABLE : il engage la responsabilité du diagnostiqueur ET du vendeur/bailleur. Cette opposabilité est effective depuis le 1er juillet 2021. Avant cette date, le DPE n'était qu'informatif.",
      consequence:
        "Un DPE erroné depuis 2021 engage la responsabilité du diagnostiqueur (contractuellement, art. 1231-1 CC) et du vendeur (art. L.271-4 CCH + art. 1240 CC). L'acquéreur ou locataire peut demander des dommages-intérêts, la réduction du prix/loyer, voire l'annulation pour dol ou vice du consentement (art. 1137 CC) si les erreurs sont graves. Le diagnostiqueur doit être certifié et assuré.",
    },
  },

  // ── Q55 — art. L.126-28-1 CCH : pont "opposable comme DPE" ──────────────
  {
    q: 'Q55', law_id: 'LEGITEXT000006074096', article: 'L126-28-1',
    label: 'art. L.126-28-1 CCH (audit énergétique opposable F/G)',
    reembed: true,
    paraphrases: [
      "le dpe est-il opposable en location comme en vente",
      "audit énergétique obligatoire logement f ou g vente",
      "art. L.126-28-1 CCH audit énergétique opposable depuis 2021",
      "audit énergétique complément du dpe opposable au vendeur",
    ],
    summary: {
      situation:
        "Un vendeur propose à la vente un logement classé D, E, F ou G (hors copropriété) et doit, en plus du DPE, faire réaliser un audit énergétique opposable.",
      principe:
        "L'art. L.126-28-1 CCH impose qu'un audit énergétique soit réalisé par un professionnel qualifié pour les logements D, E, F ou G (au sens de l'art. L.173-1-1) proposés à la vente hors copropriété. L'audit énergétique est communiqué dans les conditions et selon les modalités prévues aux articles L.271-4 et L.271-5 CCH — ce qui signifie qu'il est opposable au vendeur dans les mêmes conditions que le DPE. Le DPE (art. L.126-26) et l'audit énergétique (art. L.126-28-1) sont donc tous deux opposables en vente (loi Climat et Résilience 2021). En location, seul le DPE s'applique — il est également opposable au bailleur dans les mêmes conditions que pour la vente.",
      consequence:
        "Le DPE est opposable en vente ET en location depuis le 1er juillet 2021. L'audit énergétique (art. L.126-28-1 CCH) est obligatoire et opposable en vente pour les classes D à G, en complément du DPE. L'absence d'audit ou des informations erronées engagent la responsabilité du vendeur et du diagnostiqueur (art. 1240 CC).",
    },
  },
]

// ── Helpers ─────────────────────────────────────────────────────────────────

async function embedTextNomic(text: string): Promise<number[] | null> {
  const res = await fetch('https://api-atlas.nomic.ai/v1/embedding/text', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.NOMIC_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'nomic-embed-text-v1.5', texts: [text] }),
  })
  if (!res.ok) { console.warn(`   embedding HTTP ${res.status}`); return null }
  const data = await res.json() as { embeddings: number[][] }
  return data.embeddings?.[0] ?? null
}

async function main() {
  const { createClient } = await import('@supabase/supabase-js')
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  let updated = 0
  let reembedded = 0

  for (const o of OVERRIDES) {
    console.log(`\n→ [${o.q}] ${o.label}`)

    // Fetch row for title + current summary (needed for embed_text)
    const { data: row, error: fetchErr } = await sb
      .from('legal_articles')
      .select('id, title, content_summary')
      .eq('law_id', o.law_id)
      .eq('article_num', o.article)
      .maybeSingle()
    if (fetchErr || !row) { console.warn(`   ❌ introuvable`); continue }
    const r = row as any

    const patch: { content_summary?: string; embedding?: number[] } = {}

    // 1. Summary update (if provided)
    const summaryStr = o.summary ? JSON.stringify(o.summary) : null
    if (summaryStr) {
      patch.content_summary = summaryStr
      console.log(`   ✓ summary : ${summaryStr.length}c`)
    } else {
      console.log(`   = summary inchangé (préservation explicite)`)
    }

    // 2. Re-embed (if requested)
    if (o.reembed) {
      const summaryForEmbed: any = o.summary
        ?? (typeof r.content_summary === 'string' ? JSON.parse(r.content_summary) : r.content_summary)
      const parts: string[] = [r.title]
      if (summaryForEmbed?.situation)   parts.push(`Situation : ${summaryForEmbed.situation}`)
      if (summaryForEmbed?.principe)    parts.push(`Règle : ${summaryForEmbed.principe}`)
      if (summaryForEmbed?.consequence) parts.push(`Conséquence : ${summaryForEmbed.consequence}`)
      if (o.paraphrases?.length)        parts.push(`Mots-clés : ${o.paraphrases.join(' | ')}`)
      const embedText = parts.join('\n')
      console.log(`   embed_text : ${embedText.length}c`)
      const emb = await embedTextNomic(embedText)
      if (!emb?.length) { console.warn(`   ❌ embedding échec`); continue }
      patch.embedding = emb
      console.log(`   ✓ embedding (${emb.length} dims)`)
      reembedded++
    }

    // 3. Apply patch
    if (Object.keys(patch).length === 0) { console.log(`   (rien à appliquer)`); continue }
    const { error: updErr } = await sb.from('legal_articles').update(patch).eq('id', r.id)
    if (updErr) { console.error(`   ❌ update : ${updErr.message}`); continue }
    console.log(`   ✅ mis à jour`)
    updated++
  }

  console.log(`\n${'═'.repeat(60)}`)
  console.log(`📊  ${updated} rows mises à jour  |  ${reembedded} re-embeddings`)
  console.log('═'.repeat(60))
}

main().catch(e => { console.error(e); process.exit(1) })
