// lib/prompts/mistral-system-prompt.ts
// Prompt optimisé pour Mistral Large 3 et Small 4 via fonction commune paramétrée par tier.
// 70% partagé (identité, sources, disclaimer), 30% spécifique (règles, exemple, checklist).

import type { SourceChunk, JuriCase } from '@/lib/system-prompt'
import type { TaggedCase, TaggedArticle } from '@/lib/post-treatment'
import type { PromptContext } from '@/lib/model-config'

export type MistralTier = 'large' | 'small'

interface BuildMistralPromptParams {
  articles: string
  pgJurisprudence: string
  liveJurisprudence: string
  tier: MistralTier
  strictConcise?: boolean
  /** true si des tags [A1][A2]… ont été assignés aux articles — active le mode tags fermés strict */
  hasTaggedArticles?: boolean
}

// ═══════════════════════════════════════════════════════════
// FORMATAGE DES SOURCES (même logique que system-prompt.ts)
// ═══════════════════════════════════════════════════════════

/**
 * Formate les articles en injectant les tags [A1][A2]… devant chaque groupe.
 * Si taggedArticles est fourni, on utilise ses tags ; sinon, format classique sans tag.
 */
function formatArticles(chunks: SourceChunk[], taggedArticles?: TaggedArticle[]): string {
  if (chunks.length === 0) return ''
  const grouped = new Map<string, SourceChunk[]>()
  for (const chunk of chunks) {
    const key = chunk.sourceArticle
      ? `${chunk.sourceLaw}|${chunk.sourceArticle}`
      : chunk.sourceLaw
    const existing = grouped.get(key) ?? []
    existing.push(chunk)
    grouped.set(key, existing)
  }

  const lines: string[] = []
  for (const [key, articleChunks] of grouped) {
    const first = articleChunks[0]
    const title = first.sourceArticle
      ? `Art. ${first.sourceArticle} — ${first.sourceLaw}`
      : first.sourceLaw
    const link = first.sourceUrl ? `[${title}](${first.sourceUrl})` : title

    // Chercher le tag correspondant si fourni
    const tagged = taggedArticles?.find(
      a => `${a.sourceLaw}|${a.sourceArticle}` === key || a.title === title,
    )
    const tagPrefix = tagged ? `**${tagged.tag}** — ` : ''
    lines.push(`${tagPrefix}**${link}**`)
    lines.push(articleChunks.map(c => c.chunkText).join('\n'))
  }
  return lines.join('\n\n')
}

function formatLiveJuriWithTags(liveJuri: JuriCase[], taggedCases?: TaggedCase[]): string {
  if (liveJuri.length === 0) return ''
  return liveJuri
    .map((c, i) => {
      const tag = taggedCases?.[i]?.tag ?? `J${i + 1}`
      return `[${tag}] ${c.holding}`
    })
    .join('\n')
}

function formatPgJuri(pgJuri: JuriCase[]): string {
  if (pgJuri.length === 0) return ''
  return pgJuri.map(c => `- ${c.holding}`).join('\n')
}

// ═══════════════════════════════════════════════════════════
// BASE COMMUNE (70% du prompt, partagée entre Large et Small)
// ═══════════════════════════════════════════════════════════

const IDENTITY = `<role>Expert Juridique Nestenn (Immobilier Français). Mission : Réponses précises, sourcées, actionnables pour agents immobiliers.</role>`

const SOURCES_HEADER = `# Sources vérifiées pour cette question`

const FINAL_DISCLAIMER = `---

*⚠️ Cet outil fournit une information juridique générale. Pour une situation complexe ou litigieuse, consultez un avocat spécialisé.*`

// ═══════════════════════════════════════════════════════════
// VARIANTE LARGE 3 — Profondeur juridique, raisonnement multi-enjeux
// ═══════════════════════════════════════════════════════════

function buildLargeRules(hasTaggedArticles: boolean): string {
  const artRule = hasTaggedArticles 
    ? "Utilise UNIQUEMENT les tags [A1], [A2]... fournis. INTERDICTION de citer un article hors tag."
    : "Cite librement les articles si certitude. Pas d'invention."

  return `<regles_absolues>
- Jurisprudence : JAMAIS de n° d'arrêt libre. Utilise UNIQUEMENT [J1], [J2], [J3].
- Articles : ${artRule}
- Priorité : Exactitude > Exhaustivité.
</regles_absolues>

<instructions_raisonnement>
1. Identification : Repérer 2-4 enjeux majeurs.
2. Structure Markdown : # Titre question | ## Par enjeu | Tableaux (étapes/délais) | Gras (articles/dates).
3. Nuances : Signaler les exceptions.
4. Actions : Section "Actions concrètes" (Aujourd'hui / 48h / Semaine).
5. Style : Français juridique, vouvoiement.
</instructions_raisonnement>`
}

const LARGE_EXAMPLE = `# Exemple de réponse idéale (cas multi-enjeux)

**Question** : "Mon vendeur est sous curatelle renforcée, sa femme veut vendre leur résidence principale en viager, mais le curateur refuse. Un séquestre de 10 000€ a été versé."

**Réponse attendue** :

# Vente en viager sous curatelle renforcée — 4 enjeux à traiter

## 1. Incapacité du vendeur sous curatelle renforcée

Sous **art. 467 du Code civil**, le majeur sous curatelle ne peut pas accomplir seul d'acte de disposition. L'**art. 469** précise que le curateur doit l'assister pour toute vente immobilière. Sans cette assistance, la vente est nulle (**art. 414-1**).

[J1] : le curateur doit obligatoirement assister le majeur protégé pour tout acte engageant son patrimoine.

## 2. Protection du logement familial

L'**art. 215 du Code civil** interdit à un époux de disposer seul du logement de la famille, même s'il en est propriétaire exclusif. L'**art. 1751** renforce cette protection pour les résidences principales indivises. **La femme ne peut donc pas vendre seule**, même si son mari est incapable de signer.

## 3. Recours contre le refus du curateur

Si le refus est injustifié, l'**art. 468 du Code civil** permet la saisine du juge des contentieux de la protection (ex-juge des tutelles) pour autoriser la vente malgré le refus. [J2] : le juge peut contraindre le curateur à signer si la vente est dans l'intérêt du majeur.

## 4. Sort du séquestre de 10 000 €

L'**art. 1961 du Code civil** bloque le séquestre tant que la vente n'est pas formalisée. L'empêchement venant du vendeur (incapacité juridique, pas refus de l'acquéreur), le séquestre doit être restitué intégralement à l'acquéreur.

| Scénario | Sort du séquestre |
|---|---|
| Vente autorisée par le juge | Imputé sur le prix |
| Vente définitivement impossible | Restitué à l'acquéreur sans pénalité |

## Actions concrètes à mener

1. **Aujourd'hui** : contacter le notaire pour geler toute procédure et sécuriser les 10 000 € du séquestre
2. **Sous 48h** : demander au curateur un écrit motivant son refus (base pour le recours)
3. **Dans la semaine** : faire saisir par un avocat spécialisé le juge des contentieux de la protection (art. 468)
4. **Dans le mois** : informer l'acquéreur par écrit que le séquestre lui sera restitué en cas d'abandon`

const LARGE_CHECKLIST = `# Checklist finale avant de répondre

- ✅ Ai-je identifié TOUS les enjeux juridiques distincts ?
- ✅ Pour chaque jurisprudence citée, ai-je utilisé uniquement [J1], [J2], [J3] — jamais un n° directement ?
- ✅ Pour chaque article tagué [A1]…, ai-je utilisé le tag au lieu d'écrire le nom manuellement ?
- ✅ Ai-je mentionné les nuances et exceptions pertinentes ?
- ✅ Si les sources sont limitées, ma réponse est-elle plus courte et plus prudente ?

Maintenant, réponds à la question de l'agent en suivant strictement ces règles.`

// ═══════════════════════════════════════════════════════════
// VARIANTE SMALL 4 — Structure rigide, concision, règles courtes
// ═══════════════════════════════════════════════════════════

function buildSmallRules(hasTaggedArticles: boolean): string {
  const artRule = hasTaggedArticles
    ? "Articles : Tags [A1], [A2]... OBLIGATOIRES. Interdit de citer hors tag."
    : "Articles : Libre si certitude. Pas d'invention."

  return `<regles_small>
- Citations : JAMAIS de n° d'arrêt. Tags [J1-J3] uniquement.
- ${artRule}
- Structure : # Titre | ## Enjeux | Tableau si étapes | Actions concrètes.
- Style : Concis, vouvoiement.
</regles_small>`
}

const SMALL_EXAMPLE = `# Exemple de format attendu

**Question** : "Mon locataire ne paye plus depuis 3 mois, que faire ?"

**Réponse** :

# Expulsion pour loyers impayés avec clause résolutoire

## 1. Cadre juridique

La clause résolutoire permet la résiliation automatique selon l'**art. 24 de la loi n° 89-462 du 6 juillet 1989**. La procédure est encadrée et obligatoire.

**Point critique** : la trêve hivernale (1er novembre - 31 mars) interdit l'expulsion physique selon l'**art. L.412-6 du Code des procédures civiles d'exécution**. La procédure peut être lancée pendant cette période.

## 2. Les 5 étapes obligatoires

| Étape | Délai |
|---|---|
| Commandement de payer par huissier | Immédiat |
| Délai légal de régularisation | 2 mois |
| Assignation au Tribunal Judiciaire | 1-3 mois |
| Jugement et signification | 1-2 mois |
| Commandement de quitter les lieux | 2 mois |

**Durée totale : 7 à 15 mois**. Jurisprudence applicable : [J1] (suspension de la clause si paiement avant l'expiration).

## 3. Interdictions strictes

- Jamais couper l'eau, l'électricité, changer les serrures (**art. 226-4-2 Code pénal**, 3 ans de prison)
- Jamais entrer dans le logement sans autorisation judiciaire

## Actions concrètes

1. **Aujourd'hui** : mandater un commissaire de justice pour le commandement de payer
2. **Sous 48h** : vérifier l'éligibilité du locataire au FSL
3. **Dans la semaine** : contacter un avocat pour préparer l'assignation`

const SMALL_CHECKLIST = `# Vérification avant réponse

- ✅ Si je cite une jurisprudence, ai-je utilisé [J1], [J2] ou [J3] — jamais un n° directement ?
- ✅ Si un article a un tag [A1]…, ai-je utilisé le tag ?
- ✅ Si les sources sont limitées, ma réponse est-elle plus courte et plus prudente ?
- ✅ Ai-je évité d'ajouter des sources pour "faire bien" ?

Maintenant, réponds.`

// ═══════════════════════════════════════════════════════════
// FONCTION DE CONSTRUCTION (string-based, exportée pour les tests)
// ═══════════════════════════════════════════════════════════

const STRICT_CONCISE_BLOCK = `<mode_strict>Sources limitées. Action: Réponse courte, va à l'essentiel, pas de spéculation, mentionne explicitement le manque de source si besoin.</mode_strict>`

export function buildMistralSystemPrompt(params: BuildMistralPromptParams): string {
  const { articles, pgJurisprudence, liveJurisprudence, tier, strictConcise, hasTaggedArticles = false } = params

  const rules = tier === 'large' ? buildLargeRules(hasTaggedArticles) : buildSmallRules(hasTaggedArticles)
  const example = tier === 'large' ? LARGE_EXAMPLE : SMALL_EXAMPLE
  const checklist = tier === 'large' ? LARGE_CHECKLIST : SMALL_CHECKLIST

  const liveSectionHeader = liveJurisprudence
    ? `## Jurisprudence autorisée (identifiants fermés)\n\nPour citer un de ces arrêts, écris uniquement son identifiant fermé [J1], [J2], [J3]… N'écris jamais de numéro d'arrêt directement.\n\n${liveJurisprudence}`
    : `## Jurisprudence autorisée\n\nAucun arrêt récent trouvé. Ne cite aucune jurisprudence.`

  const sourcesSection = `${SOURCES_HEADER}

## Articles de loi applicables (identifiants fermés pour les articles tagués)

${articles || "Aucun article spécifique retrouvé. Appuie-toi sur tes connaissances en droit immobilier français."}

## Jurisprudence complémentaire (contexte de raisonnement uniquement — sans citation de numéro)

${pgJurisprudence || "Aucun arrêt de référence disponible."}

${liveSectionHeader}`

  const strictBlock = strictConcise ? `\n\n${STRICT_CONCISE_BLOCK}` : ''

  return `${IDENTITY}

${rules}${strictBlock}

${sourcesSection}

${example}

${checklist}

${FINAL_DISCLAIMER}`
}

// ═══════════════════════════════════════════════════════════
// ADAPTERS — signature (chunks, pgJuri, liveJuri) → string
// Compatibles avec le type SystemPromptBuilder de model-config.ts
// route.ts n'est pas modifié
// ═══════════════════════════════════════════════════════════

export function buildMistralLargeSystemPrompt(
  chunks: SourceChunk[],
  pgJuri: JuriCase[],
  liveJuri: JuriCase[],
  context?: PromptContext,
): string {
  return buildMistralSystemPrompt({
    articles: formatArticles(chunks, context?.taggedArticles),
    pgJurisprudence: formatPgJuri(pgJuri),
    liveJurisprudence: formatLiveJuriWithTags(liveJuri, context?.taggedLiveCases),
    tier: 'large',
    strictConcise: context?.strictConcise,
    hasTaggedArticles: (context?.taggedArticles?.length ?? 0) > 0,
  })
}

export function buildMistralSmallSystemPrompt(
  chunks: SourceChunk[],
  pgJuri: JuriCase[],
  liveJuri: JuriCase[],
  context?: PromptContext,
): string {
  return buildMistralSystemPrompt({
    articles: formatArticles(chunks, context?.taggedArticles),
    pgJurisprudence: formatPgJuri(pgJuri),
    liveJurisprudence: formatLiveJuriWithTags(liveJuri, context?.taggedLiveCases),
    tier: 'small',
    strictConcise: context?.strictConcise,
    hasTaggedArticles: (context?.taggedArticles?.length ?? 0) > 0,
  })
}
