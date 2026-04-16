// lib/domain-pack-builder.ts
// Builder déterministe : construit un LegalBrief à partir d'un DomainPack
// + overlay playbook optionnel + sources live résolues.
//
// Deux modes de fonctionnement :
//   1. Avec playbook overlay  → le playbook enrichit le domain pack (distinctions, assertions, pratique)
//   2. Sans playbook overlay  → le domain pack seul produit un cadre juridique via ses fallback rules
//
// Dans les deux cas, la sortie est un LegalBrief compatible avec le pipeline V2 existant.

import type { DomainPack, DomainPackFallbackRule } from './domain-packs'
import { matchFallbackRule } from './domain-packs'
import type { LegalPlaybook } from './legal-playbooks'
import type { LegalBrief } from './legal-brief'
import type { TaggedArticle, TaggedCase } from './post-treatment'
import type { PrecisionBudget } from './precision-budget'
import { articlesToAuthorityCards, jurisprudenceToAuthorityCards } from './authority-cards'
import type { AuthorityCard } from './authority-cards'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface DomainPackBriefParams {
  userQuestion: string
  domainPack: DomainPack
  /** Playbook V2 matché (enrichit le domain pack) — peut être absent */
  playbookOverlay?: LegalPlaybook
  /** Articles résolus live depuis Légifrance */
  taggedArticles: TaggedArticle[]
  /** Jurisprudence résolue live depuis Judilibre */
  taggedLiveCases: TaggedCase[]
  precisionBudget: PrecisionBudget
}

// ─────────────────────────────────────────────────────────────────────────────
// buildBriefFromDomainPack — builder principal
// ─────────────────────────────────────────────────────────────────────────────

export function buildBriefFromDomainPack(params: DomainPackBriefParams): LegalBrief {
  const {
    userQuestion,
    domainPack,
    playbookOverlay,
    taggedArticles,
    taggedLiveCases,
    precisionBudget,
  } = params

  // ── 1. Déterminer l'archétype actif ─────────────────────────────────────────
  const activeArchetypeId = resolveArchetypeId(domainPack, userQuestion, playbookOverlay)
  const fallbackRule = playbookOverlay
    ? null
    : matchFallbackRule(domainPack, userQuestion)

  // ── 2. Construire les authority cards ───────────────────────────────────────
  // Priorité : live articles > domain pack pivot articles (synthetic)
  const mergedArticles = mergeWithPivotArticles(domainPack, taggedArticles, fallbackRule)
  const articleCards = articlesToAuthorityCards(mergedArticles)
  const juriCards = jurisprudenceToAuthorityCards(taggedLiveCases)
  const authorityCards: AuthorityCard[] = [...articleCards, ...juriCards]

  // ── 3. Fusionner les distinctions ───────────────────────────────────────────
  // Domain pack recurring + fallback rule specific + playbook specific (si overlay)
  const requiredDistinctions = buildRequiredDistinctions(
    domainPack,
    fallbackRule,
    playbookOverlay,
  )

  // ── 4. Fusionner les assertions interdites ──────────────────────────────────
  const forbiddenAssertions = buildForbiddenAssertions(domainPack, playbookOverlay)

  // ── 5. Outcomes pratiques ───────────────────────────────────────────────────
  // Le playbook overlay est prioritaire (plus précis que les actions génériques du domain pack)
  const practicalOutcome = playbookOverlay
    ? playbookOverlay.practicalOutcome
    : domainPack.practicalActions

  // ── 6. Faits minimaux ───────────────────────────────────────────────────────
  const facts = extractDomainPackFacts(userQuestion, domainPack, activeArchetypeId, playbookOverlay)

  // ── 7. Pièces manquantes ────────────────────────────────────────────────────
  const missingPieces = detectDomainPackMissingPieces(
    domainPack,
    fallbackRule,
    playbookOverlay,
    taggedArticles,
    taggedLiveCases,
  )

  return {
    domain: domainPack.domain,
    archetype: activeArchetypeId,
    userQuestion,
    facts,
    requiredDistinctions,
    forbiddenAssertions,
    authorityCards,
    practicalOutcome,
    precisionBudget,
    missingPieces,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// resolveArchetypeId
// ─────────────────────────────────────────────────────────────────────────────

function resolveArchetypeId(
  domainPack: DomainPack,
  question: string,
  playbookOverlay?: LegalPlaybook,
): string {
  if (playbookOverlay) {
    return playbookOverlay.id
  }

  const fallbackRule = matchFallbackRule(domainPack, question)
  if (fallbackRule) {
    return `${domainPack.domain}/${fallbackRule.archetypeId}`
  }

  return `${domainPack.domain}/domain_pack_fallback`
}

// ─────────────────────────────────────────────────────────────────────────────
// mergeWithPivotArticles
// Ajoute les articles pivot non couverts par la résolution live comme articles
// synthétiques (tag A_N+1, A_N+2...) pour garantir un cadre de référence complet.
// ─────────────────────────────────────────────────────────────────────────────

function mergeWithPivotArticles(
  domainPack: DomainPack,
  liveArticles: TaggedArticle[],
  fallbackRule: DomainPackFallbackRule | null,
): TaggedArticle[] {
  // Identifier les articles déjà couverts par la résolution live
  const resolvedKeys = new Set(
    liveArticles.map((a) => normalizeArticleKey(a.sourceLaw, a.sourceArticle)),
  )

  // Sélectionner les pivot articles pertinents
  // Si une fallback rule est active, forcer les articles qu'elle exige
  // Sinon, inclure tous les pivot articles non-required qui ne surchargent pas
  const pivotCandidates = selectRelevantPivotArticles(domainPack, fallbackRule)

  const synthetic: TaggedArticle[] = []
  let nextTagIndex = liveArticles.length + 1

  for (const hint of pivotCandidates) {
    const key = normalizeArticleKey(hint.law, hint.artNum)
    if (!resolvedKeys.has(key)) {
      synthetic.push({
        tag: `A${nextTagIndex}`,
        title: hint.label,
        sourceLaw: hint.law,
        sourceArticle: hint.artNum,
        // pas de sourceUrl : article synthétique non résolu live
      })
      nextTagIndex++
    }
  }

  // Max 8 articles au total pour garder le brief lisible
  const merged = [...liveArticles, ...synthetic]
  return merged.slice(0, 8)
}

function selectRelevantPivotArticles(
  domainPack: DomainPack,
  fallbackRule: DomainPackFallbackRule | null,
) {
  if (!fallbackRule) {
    // Sans règle de repli, retourner les articles pivot génériques (required = false)
    // limités aux 4 premiers pour ne pas surcharger
    return domainPack.pivotArticles.slice(0, 4)
  }

  // Avec règle de repli : forcer les articles explicitement requis par la règle
  const forcedKeys = new Set(fallbackRule.forcedPivotArticleIds.map((id) => id.toLowerCase()))
  const forced = domainPack.pivotArticles.filter((a) =>
    forcedKeys.has(`${a.law.toLowerCase()}|${a.artNum.toLowerCase()}`),
  )

  // Compléter avec les articles génériques non forcés (jusqu'à 4 au total)
  const additional = domainPack.pivotArticles
    .filter((a) => !forcedKeys.has(`${a.law.toLowerCase()}|${a.artNum.toLowerCase()}`))
    .slice(0, Math.max(0, 4 - forced.length))

  return [...forced, ...additional]
}

// ─────────────────────────────────────────────────────────────────────────────
// buildRequiredDistinctions
// Fusionne : distinctions récurrentes du domain pack + règle de repli + overlay
// ─────────────────────────────────────────────────────────────────────────────

function buildRequiredDistinctions(
  domainPack: DomainPack,
  fallbackRule: DomainPackFallbackRule | null,
  playbookOverlay?: LegalPlaybook,
): string[] {
  const seen = new Set<string>()
  const distinctions: string[] = []

  const add = (items: string[]) => {
    for (const item of items) {
      if (!seen.has(item)) {
        seen.add(item)
        distinctions.push(item)
      }
    }
  }

  // Priorité 1 : distinctions spécifiques du playbook overlay (plus précises)
  if (playbookOverlay) {
    add(playbookOverlay.requiredDistinctions)
  }

  // Priorité 2 : distinctions de la règle de repli active
  if (fallbackRule) {
    add(fallbackRule.mandatoryDistinctions)
  }

  // Priorité 3 : distinctions récurrentes du domain pack (contexte général)
  add(domainPack.recurringDistinctions)

  // Limiter à 8 distinctions pour rester lisible dans le prompt
  return distinctions.slice(0, 8)
}

// ─────────────────────────────────────────────────────────────────────────────
// buildForbiddenAssertions
// Union domain pack + playbook overlay (sans doublon)
// ─────────────────────────────────────────────────────────────────────────────

function buildForbiddenAssertions(
  domainPack: DomainPack,
  playbookOverlay?: LegalPlaybook,
): string[] {
  const seen = new Set<string>()
  const assertions: string[] = []

  const add = (items: string[]) => {
    for (const item of items) {
      if (!seen.has(item)) {
        seen.add(item)
        assertions.push(item)
      }
    }
  }

  if (playbookOverlay) {
    add(playbookOverlay.forbiddenAssertions)
  }
  add(domainPack.forbiddenAssertions)

  return assertions
}

// ─────────────────────────────────────────────────────────────────────────────
// extractDomainPackFacts
// Dérive des faits minimaux à partir de la question et du domain pack
// ─────────────────────────────────────────────────────────────────────────────

function extractDomainPackFacts(
  question: string,
  domainPack: DomainPack,
  archetypeId: string,
  playbookOverlay?: LegalPlaybook,
): string[] {
  const facts: string[] = []
  const normalized = question.toLowerCase()

  facts.push(`Question portant sur le domaine : ${domainPack.domain}`)
  facts.push(`Archétype identifié : ${archetypeId}`)
  facts.push(`Source : ${playbookOverlay ? `playbook overlay (${playbookOverlay.id})` : 'domain pack fallback'}`)
  facts.push(`Question posée : "${question.trim()}"`)

  const domainHints: Array<{ keywords: string[]; fact: string }> = [
    {
      keywords: ['état des lieux', 'etat des lieux'],
      fact: "État des lieux mentionné — valeur probatoire à apprécier selon son contenu et sa complétude.",
    },
    {
      keywords: ['dépôt de garantie', 'depot de garantie', 'caution'],
      fact: "Dépôt de garantie mentionné — règles de restitution (art. 22 loi 89-462) applicables.",
    },
    {
      keywords: ['zone tendue', 'zones tendues'],
      fact: "Zone tendue mentionnée — vérifier l'appartenance de la commune à la liste réglementaire (décret).",
    },
    {
      keywords: ['meuble', 'meublé'],
      fact: "Bail meublé potentiellement concerné — règles de l'art. 25-3 loi 89-462 (durée 1 an, préavis 1 mois locataire).",
    },
    {
      keywords: ['treve hivernale', 'trêve hivernale', 'periode hivernale'],
      fact: "Trêve hivernale mentionnée — applicable du 1er novembre au 31 mars, suspend l'exécution mais pas la procédure.",
    },
    {
      keywords: ['commandement de payer', 'commandement payer'],
      fact: "Commandement de payer mentionné — acte de commissaire de justice, déclenche le délai de 2 mois (art. 24 loi 89-462).",
    },
    {
      keywords: ['sous-location', 'sous location', 'sous-louer'],
      fact: "Sous-location mentionnée — soumise à l'accord préalable et écrit du bailleur (art. 8 loi 89-462).",
    },
    {
      keywords: ['conge bailleur', 'congé bailleur', 'congé pour vente', 'conge pour reprise'],
      fact: "Congé du bailleur mentionné — trois cas limitatifs, préavis 6 mois minimum (art. 15 loi 89-462).",
    },
    {
      keywords: ['decence', 'décence', 'insalubre', 'indecent', 'indécent'],
      fact: "Problème de décence ou d'insalubrité mentionné — distinctions entre régimes (décret 2002-120 vs CSP) à clarifier.",
    },
    {
      keywords: ['colocataire', 'colocation', 'solidarité bail'],
      fact: "Colocation mentionnée — clause de solidarité, conséquences de la sortie d'un colocataire à analyser.",
    },
  ]

  for (const hint of domainHints) {
    if (hint.keywords.some((kw) => normalized.includes(kw))) {
      facts.push(hint.fact)
    }
  }

  return facts
}

// ─────────────────────────────────────────────────────────────────────────────
// detectDomainPackMissingPieces
// ─────────────────────────────────────────────────────────────────────────────

function detectDomainPackMissingPieces(
  domainPack: DomainPack,
  fallbackRule: DomainPackFallbackRule | null,
  playbookOverlay: LegalPlaybook | undefined,
  taggedArticles: TaggedArticle[],
  taggedLiveCases: TaggedCase[],
): string[] {
  const missing: string[] = []

  const resolvedKeys = new Set(
    taggedArticles.map((a) => normalizeArticleKey(a.sourceLaw, a.sourceArticle)),
  )

  // Vérifier les articles forcés par la règle de repli
  if (fallbackRule) {
    for (const id of fallbackRule.forcedPivotArticleIds) {
      const [law, artNum] = id.split('|')
      const key = normalizeArticleKey(law, artNum)
      if (!resolvedKeys.has(key)) {
        const hint = domainPack.pivotArticles.find(
          (a) =>
            normalizeArticleKey(a.law, a.artNum) === key,
        )
        const label = hint ? hint.label : `${law}, art. ${artNum}`
        missing.push(`Article pivot non résolu live : ${label}`)
      }
    }
  }

  // Vérifier les articles requis du playbook overlay
  if (playbookOverlay) {
    for (const hint of playbookOverlay.forcedArticles) {
      if (hint.required) {
        const key = normalizeArticleKey(hint.law, hint.artNum)
        if (!resolvedKeys.has(key)) {
          missing.push(`Article requis du playbook non résolu : ${hint.label}`)
        }
      }
    }
  }

  // Jurisprudence absente
  if (taggedLiveCases.length === 0) {
    missing.push("Aucune jurisprudence live disponible — le brief repose uniquement sur les articles résolus.")
  }

  // Absence de playbook overlay (cadre moins précis)
  if (!playbookOverlay) {
    const archetypeIds = domainPack.archetypesCovered
      .filter((a) => a.status === 'covered' && a.linkedPlaybookId)
      .map((a) => a.linkedPlaybookId!)
    if (archetypeIds.length > 0) {
      missing.push(
        `Aucun playbook overlay matché — cadre domain pack uniquement. Précision maximale disponible via playbooks : ${archetypeIds.join(', ')}.`,
      )
    }
  }

  return missing
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function normalizeArticleKey(law: string, artNum: string): string {
  return `${law.toLowerCase().trim()}__${artNum.toLowerCase().trim()}`
}
