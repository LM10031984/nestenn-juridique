// lib/legal-brief.ts
// Builder déterministe du LegalBrief V2
// Construit sans LLM à partir des sources réellement résolues
// Phase 1 : format JSON propre, lisible, stable

import type { TaggedArticle, TaggedCase } from './post-treatment'
import type { LegalPlaybook, PlaybookAuthorityHint } from './legal-playbooks'
import type { AuthorityCard } from './authority-cards'
import type { PrecisionBudget } from './precision-budget'
import { articlesToAuthorityCards, jurisprudenceToAuthorityCards } from './authority-cards'

export type LegalBrief = {
  domain: string
  archetype: string
  userQuestion: string
  facts: string[]
  requiredDistinctions: string[]
  forbiddenAssertions: string[]
  authorityCards: AuthorityCard[]
  practicalOutcome: string[]
  precisionBudget: PrecisionBudget
  missingPieces: string[]
}

export interface BuildLegalBriefParams {
  userQuestion: string
  domain: string
  playbook: LegalPlaybook
  taggedArticles: TaggedArticle[]
  taggedLiveCases: TaggedCase[]
  precisionBudget: PrecisionBudget
}

// ─────────────────────────────────────────────────────────────────────────────
// buildLegalBrief — builder déterministe principal
// ─────────────────────────────────────────────────────────────────────────────

export function buildLegalBrief(params: BuildLegalBriefParams): LegalBrief {
  const {
    userQuestion,
    domain,
    playbook,
    taggedArticles,
    taggedLiveCases,
    precisionBudget,
  } = params

  // ── Authority cards depuis les sources effectivement résolues ──────────────
  const articleCards = articlesToAuthorityCards(taggedArticles)
  const juriCards = jurisprudenceToAuthorityCards(taggedLiveCases)
  const authorityCards: AuthorityCard[] = [...articleCards, ...juriCards]

  // ── Faits minimaux déduits de la question (déterministe, sans extrapolation) ─
  const facts = extractMinimalFacts(userQuestion, playbook)

  // ── Pièces manquantes : articles attendus non résolus + jurisprudence absente ─
  const missingPieces = detectMissingPieces(playbook, taggedArticles, taggedLiveCases)

  return {
    domain,
    archetype: playbook.id,
    userQuestion,
    facts,
    requiredDistinctions: playbook.requiredDistinctions,
    forbiddenAssertions: playbook.forbiddenAssertions,
    authorityCards,
    practicalOutcome: playbook.practicalOutcome,
    precisionBudget,
    missingPieces,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// extractMinimalFacts
// Dérive des faits minimalistes à partir de la question et du playbook
// Pas d'extrapolation — uniquement ce qui est explicitement dans la question
// ─────────────────────────────────────────────────────────────────────────────

function extractMinimalFacts(question: string, playbook: LegalPlaybook): string[] {
  const facts: string[] = []
  const normalized = question.toLowerCase()

  // Fait de base : le domaine et l'archétype identifiés
  facts.push(`Question portant sur le domaine : ${playbook.domain}`)
  facts.push(`Archétype identifié : ${playbook.id}`)
  facts.push(`Question posée : "${question.trim()}"`)

  // Indices factuels détectés dans la question (déterministe)
  const factualHints: Array<{ keywords: string[]; fact: string }> = [
    {
      keywords: ['contresignée', 'contresignee', 'signée par le vendeur', 'signee par le vendeur'],
      fact: "Mention d'une contresignature par le vendeur détectée dans la question.",
    },
    {
      keywords: ['condition suspensive', 'prêt', 'pret', 'crédit', 'credit', 'financement'],
      fact: "Mention possible d'une condition suspensive (prêt/financement) dans le contexte.",
    },
    {
      keywords: ['habitation', 'logement', 'résidence', 'residence', 'appartement', 'maison'],
      fact: "Bien à usage d'habitation potentiellement concerné — droit de rétractation L271-1 CCH applicable si confirmé.",
    },
    {
      keywords: ['état des lieux', 'etat des lieux', 'état de sortie'],
      fact: "État des lieux mentionné — valeur probatoire à apprécier selon son contenu.",
    },
    {
      keywords: ['incomplet', 'lacunaire', 'manquant'],
      fact: "Caractère incomplet d'un document mentionné — fragilisation probatoire potentielle.",
    },
    {
      keywords: ['dépôt de garantie', 'depot de garantie', 'caution'],
      fact: "Dépôt de garantie mentionné — règles de restitution (art. 22 loi 89-462) applicables.",
    },
    {
      keywords: ['fosse septique', 'assainissement', 'spanc'],
      fact: "Installation d'assainissement non collectif mentionnée — SPANC potentiellement compétent.",
    },
    {
      keywords: ['voisin', 'dénonciation', 'denonciation', 'signalement', 'plainte'],
      fact: "Dénonciation ou signalement par un voisin mentionné — à distinguer d'un contrôle officiel SPANC.",
    },
  ]

  for (const hint of factualHints) {
    if (hint.keywords.some((kw) => normalized.includes(kw))) {
      facts.push(hint.fact)
    }
  }

  return facts
}

// ─────────────────────────────────────────────────────────────────────────────
// detectMissingPieces
// Identifie les articles attendus non résolus et les lacunes de contexte
// ─────────────────────────────────────────────────────────────────────────────

function detectMissingPieces(
  playbook: LegalPlaybook,
  taggedArticles: TaggedArticle[],
  taggedLiveCases: TaggedCase[]
): string[] {
  const missing: string[] = []

  // Articles requis non taggés
  const resolvedKeys = new Set(
    taggedArticles.map((a) => normalizeArticleKey(a.sourceLaw, a.sourceArticle))
  )

  for (const hint of playbook.forcedArticles) {
    if (hint.required) {
      const key = normalizeArticleKey(hint.law, hint.artNum)
      if (!resolvedKeys.has(key)) {
        missing.push(`Article requis non résolu : ${hint.label} (${hint.law}, art. ${hint.artNum})`)
      }
    }
  }

  // Jurisprudence absente
  if (taggedLiveCases.length === 0) {
    missing.push('Aucune jurisprudence live disponible pour ce domaine.')
  }

  // Contexte factuel potentiellement manquant selon le playbook
  const contextualGaps = detectContextualGaps(playbook)
  missing.push(...contextualGaps)

  return missing
}

function normalizeArticleKey(law: string, artNum: string): string {
  return `${law.toLowerCase().trim()}__${artNum.toLowerCase().trim()}`
}

function detectContextualGaps(playbook: LegalPlaybook): string[] {
  const gaps: string[] = []

  if (playbook.id === 'vente_offre_contre_signee') {
    gaps.push("Contexte factuel manquant : nature exacte du document signé (offre simple, compromis, promesse synallagmatique) non précisée dans la question.")
    gaps.push("Contexte factuel manquant : existence ou absence de conditions suspensives non précisée.")
    gaps.push("Contexte factuel manquant : nature du bien (habitation vs professionnel) non confirmée.")
  }

  if (playbook.id === 'gestion_locative_depot_garantie') {
    gaps.push("Contexte factuel manquant : nature et étendue de l'incomplétude de l'état des lieux non précisées.")
    gaps.push("Contexte factuel manquant : montant du dépôt de garantie et montant des retenues envisagées non précisés.")
  }

  if (playbook.id === 'environnement_immo_spanc') {
    gaps.push("Contexte factuel manquant : nature et gravité de la non-conformité non précisées.")
    gaps.push("Contexte factuel manquant : commune concernée et politique SPANC locale inconnues.")
    gaps.push("Contexte factuel manquant : projet de vente ou exploitation normale non précisé — les obligations diffèrent.")
  }

  return gaps
}
