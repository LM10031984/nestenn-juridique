// scripts/benchmark-domain-pack-baux.ts
// Benchmark go / no-go du domain pack baux_habitation
//
// Ce script compare 3 modes de production de briefs pour 30 questions baux :
//   Mode A : baseline — playbook seul (comportement prod actuel sans domain pack)
//   Mode B : domain pack seul — sans overlay playbook, même si un playbook existe
//   Mode C : domain pack + overlay playbook quand disponible
//
// Aucun appel LLM, aucun appel API prod. Purement déterministe.
// Usage : npx tsx scripts/benchmark-domain-pack-baux.ts [--save-json]

import { performance } from 'perf_hooks'
import { writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

import { BAUX_HABITATION_PACK, matchFallbackRule } from '../lib/domain-packs'
import { buildBriefFromDomainPack } from '../lib/domain-pack-builder'
import { buildLegalBrief } from '../lib/legal-brief'
import { detectLegalPlaybook } from '../lib/legal-playbooks'
import type { LegalBrief } from '../lib/legal-brief'
import type { TaggedArticle, TaggedCase } from '../lib/post-treatment'

// ─────────────────────────────────────────────────────────────────────────────
// Dataset — 30 questions baux_habitation
// ─────────────────────────────────────────────────────────────────────────────

export type BenchmarkCategory =
  | 'loyers_impayes_expulsion'
  | 'depot_garantie_etat_lieux'
  | 'conge_bailleur_locataire'
  | 'decence_insalubrite'
  | 'sous_location_colocation'
  | 'treve_hivernale'

export type BenchmarkQuestionProfile = 'well_covered' | 'fuzzy' | 'edge_case'

export type BenchmarkQuestion = {
  id: string
  question: string
  category: BenchmarkCategory
  profile: BenchmarkQuestionProfile
  expectedPlaybookMatch: boolean   // un playbook V2 devrait matcher
  expectedAbsorbableByDomainPack: boolean  // le domain pack seul devrait absorber
  goldExpectation: string          // ce qu'une bonne réponse doit contenir (résumé court)
}

export const BENCHMARK_DATASET: BenchmarkQuestion[] = [
  // ── Loyers impayés / procédure / expulsion (8) ──────────────────────────────
  {
    id: 'B01',
    question: "Mon locataire ne paie plus son loyer depuis 3 mois. Comment procéder à l'expulsion ?",
    category: 'loyers_impayes_expulsion',
    profile: 'well_covered',
    expectedPlaybookMatch: true,
    expectedAbsorbableByDomainPack: true,
    goldExpectation: 'Commandement de payer (commissaire de justice), délai 2 mois, clause résolutoire, saisine tribunal judiciaire, trêve hivernale si applicable.',
  },
  {
    id: 'B02',
    question: "J'ai envoyé un commandement de payer à mon locataire il y a 2 mois, quelle est la suite de la procédure ?",
    category: 'loyers_impayes_expulsion',
    profile: 'well_covered',
    expectedPlaybookMatch: true,
    expectedAbsorbableByDomainPack: true,
    goldExpectation: 'Après délai 2 mois sans régularisation : clause résolutoire peut jouer, saisine TJ, obtention titre exécutoire, puis expulsion via commissaire de justice.',
  },
  {
    id: 'B03',
    question: "La clause résolutoire du bail est-elle automatique quand mon locataire ne paye pas ?",
    category: 'loyers_impayes_expulsion',
    profile: 'well_covered',
    expectedPlaybookMatch: true,
    expectedAbsorbableByDomainPack: true,
    goldExpectation: 'Non automatique : nécessite commandement de payer + délai 2 mois infructueux. Le juge peut accorder des délais de grâce.',
  },
  {
    id: 'B04',
    question: "Mon locataire me doit 4 mois de loyer, puis-je changer les serrures ou couper l'électricité ?",
    category: 'loyers_impayes_expulsion',
    profile: 'edge_case',
    expectedPlaybookMatch: false,
    expectedAbsorbableByDomainPack: true,
    goldExpectation: 'Interdit absolument (voie de fait, sanctions pénales). Seule voie légale : procédure judiciaire via commandement de payer.',
  },
  {
    id: 'B05',
    question: "Comment faire partir un locataire qui ne paie pas ?",
    category: 'loyers_impayes_expulsion',
    profile: 'fuzzy',
    expectedPlaybookMatch: true,
    expectedAbsorbableByDomainPack: true,
    goldExpectation: 'Étapes : commandement de payer, délai 2 mois, saisine TJ, jugement, expulsion par commissaire de justice. Durée totale : 6-18 mois.',
  },
  {
    id: 'B06',
    question: "Que se passe-t-il si mon locataire ne règle pas son loyer mais continue d'occuper le logement ?",
    category: 'loyers_impayes_expulsion',
    profile: 'fuzzy',
    expectedPlaybookMatch: false,
    expectedAbsorbableByDomainPack: true,
    goldExpectation: 'Procédure commandement de payer → clause résolutoire → procédure judiciaire. Pas d\'expulsion directe possible sans décision de justice.',
  },
  {
    id: 'B07',
    question: "Mon locataire paie parfois, parfois non — quand peut-on parler d'impayé au sens légal ?",
    category: 'loyers_impayes_expulsion',
    profile: 'edge_case',
    expectedPlaybookMatch: false,
    expectedAbsorbableByDomainPack: true,
    goldExpectation: 'L\'art. 24 loi 89-462 vise le défaut de paiement d\'un seul terme — même partiel. Paiements irréguliers = impayés cumulatifs. Recommandation : tenir un relevé précis.',
  },
  {
    id: 'B08',
    question: "Mon locataire a payé partiellement le commandement de payer, le délai de 2 mois repart-il à zéro ?",
    category: 'loyers_impayes_expulsion',
    profile: 'edge_case',
    expectedPlaybookMatch: false,
    expectedAbsorbableByDomainPack: true,
    goldExpectation: 'Paiement partiel ne régularise pas l\'impayé. Le commandement de payer exige le règlement intégral (loyers + charges + frais). Vérifier montant exact visé dans l\'acte.',
  },

  // ── Dépôt de garantie / état des lieux / preuve (6) ──────────────────────
  {
    id: 'B09',
    question: "Le propriétaire refuse de restituer mon dépôt de garantie après mon départ. Quels sont mes recours ?",
    category: 'depot_garantie_etat_lieux',
    profile: 'well_covered',
    expectedPlaybookMatch: false,
    expectedAbsorbableByDomainPack: true,
    goldExpectation: 'Art. 22 loi 89-462 : délai 1 ou 2 mois selon état des lieux. Mise en demeure, commission départementale de conciliation, puis tribunal judiciaire.',
  },
  {
    id: 'B10',
    question: "L'état des lieux de sortie est incomplet. Cela joue-t-il en ma faveur en tant que locataire ?",
    category: 'depot_garantie_etat_lieux',
    profile: 'well_covered',
    expectedPlaybookMatch: false,
    expectedAbsorbableByDomainPack: true,
    goldExpectation: 'Oui : ELS incomplet renverse la présomption. Bailleur ne peut justifier retenues sans preuves concordantes. Art. 3-2 et 22 loi 89-462.',
  },
  {
    id: 'B11',
    question: "Mon propriétaire retient ma caution pour des dégradations que je conteste, que faire ?",
    category: 'depot_garantie_etat_lieux',
    profile: 'fuzzy',
    expectedPlaybookMatch: false,
    expectedAbsorbableByDomainPack: true,
    goldExpectation: 'Contester par LRAR + preuves (photos, ELS). Commission de conciliation. Si échec : tribunal judiciaire. Délai de prescription 3 ans.',
  },
  {
    id: 'B12',
    question: "Mon bailleur ne m'a pas rendu mon dépôt depuis 3 mois après mon départ, quelle majoration s'applique ?",
    category: 'depot_garantie_etat_lieux',
    profile: 'fuzzy',
    expectedPlaybookMatch: false,
    expectedAbsorbableByDomainPack: true,
    goldExpectation: 'Art. 22 loi 89-462 : 10 % du loyer mensuel hors charges par mois de retard au-delà du délai légal. Réclamation par LRAR.',
  },
  {
    id: 'B13',
    question: "Il n'y a pas eu d'état des lieux d'entrée dans mon logement. Le bailleur peut-il quand même retenir mon dépôt ?",
    category: 'depot_garantie_etat_lieux',
    profile: 'edge_case',
    expectedPlaybookMatch: false,
    expectedAbsorbableByDomainPack: true,
    goldExpectation: 'Absence d\'ELE : présomption de bon état au profit du locataire. Bailleur supporte la charge de la preuve des dégradations. Art. 3-2 loi 89-462.',
  },
  {
    id: 'B14',
    question: "Le délai de restitution du dépôt de garantie est-il le même pour un bail meublé et un bail nu ?",
    category: 'depot_garantie_etat_lieux',
    profile: 'edge_case',
    expectedPlaybookMatch: false,
    expectedAbsorbableByDomainPack: true,
    goldExpectation: 'Oui, même délai : 1 mois (ELS conforme) ou 2 mois (retenues). Mais montant maximum diffère : 1 mois HC pour nu, 2 mois HC pour meublé.',
  },

  // ── Congé bailleur / congé locataire (6) ──────────────────────────────────
  {
    id: 'B15',
    question: "Mon propriétaire m'a donné congé pour reprendre le logement, est-ce légal ?",
    category: 'conge_bailleur_locataire',
    profile: 'well_covered',
    expectedPlaybookMatch: false,
    expectedAbsorbableByDomainPack: true,
    goldExpectation: 'Art. 15 loi 89-462 : trois cas limitatifs. Reprise limitée aux personnes physiques pour eux-mêmes ou famille proche. Préavis 6 mois minimum.',
  },
  {
    id: 'B16',
    question: "Je veux quitter mon appartement, quel est mon délai de préavis ?",
    category: 'conge_bailleur_locataire',
    profile: 'well_covered',
    expectedPlaybookMatch: false,
    expectedAbsorbableByDomainPack: true,
    goldExpectation: 'Art. 15-I loi 89-462 : 3 mois pour bail nu en règle générale. Réduit à 1 mois en zone tendue, perte d\'emploi, mutation, état de santé.',
  },
  {
    id: 'B17',
    question: "Mon bailleur veut vendre mon appartement, doit-il me proposer en priorité ?",
    category: 'conge_bailleur_locataire',
    profile: 'fuzzy',
    expectedPlaybookMatch: false,
    expectedAbsorbableByDomainPack: true,
    goldExpectation: 'Oui : droit de préemption du locataire (art. 15-II loi 89-462). Offre de vente obligatoire dans le congé pour vente, à peine de nullité.',
  },
  {
    id: 'B18',
    question: "Puis-je réduire mon préavis à 1 mois car je perds mon emploi involontairement ?",
    category: 'conge_bailleur_locataire',
    profile: 'fuzzy',
    expectedPlaybookMatch: false,
    expectedAbsorbableByDomainPack: true,
    goldExpectation: 'Oui si perte d\'emploi involontaire (licenciement, rupture conventionnelle). Justificatif requis. Préavis réduit court dès réception du congé par le bailleur.',
  },
  {
    id: 'B19',
    question: "Mon propriétaire m'a donné congé pour un motif que je pense inventé, puis-je le contester ?",
    category: 'conge_bailleur_locataire',
    profile: 'edge_case',
    expectedPlaybookMatch: false,
    expectedAbsorbableByDomainPack: true,
    goldExpectation: 'Motif légitime et sérieux apprécié strictement par le juge. Congé frauduleux : nullité + dommages-intérêts. Recours : commission de conciliation puis TJ.',
  },
  {
    id: 'B20',
    question: "Je suis en zone tendue, quelles sont les conditions spécifiques pour un congé bailleur ?",
    category: 'conge_bailleur_locataire',
    profile: 'edge_case',
    expectedPlaybookMatch: false,
    expectedAbsorbableByDomainPack: true,
    goldExpectation: 'En zone tendue : conditions de forme supplémentaires pour congé pour vente (surface, prix), interdiction de récupérer pour louer à plus cher. Préavis identique (6 mois).',
  },

  // ── Décence / insalubrité / obligations bailleur (4) ──────────────────────
  {
    id: 'B21',
    question: "Mon logement est insalubre et le propriétaire refuse d'intervenir. Que puis-je faire ?",
    category: 'decence_insalubrite',
    profile: 'well_covered',
    expectedPlaybookMatch: false,
    expectedAbsorbableByDomainPack: true,
    goldExpectation: 'Art. 1719 CC + décret 2002-120. Distinction indécence / insalubrité (CSP L1331-26). Signalement mairie/ARS, mise en demeure, CDC, TJ. Ne pas cesser de payer sans jugement.',
  },
  {
    id: 'B22',
    question: "Mon logement loué est classé G au DPE. Le propriétaire peut-il toujours le louer en 2025 ?",
    category: 'decence_insalubrite',
    profile: 'edge_case',
    expectedPlaybookMatch: false,
    expectedAbsorbableByDomainPack: true,
    goldExpectation: 'Depuis le 1er janvier 2025 : gel des loyers DPE G. Interdiction de louer les nouvelles locations DPE G (calendrier loi Climat 2021). Situations en cours : différents régimes transitoires.',
  },
  {
    id: 'B23',
    question: "Je veux arrêter de payer mon loyer car mon logement est indécent. Est-ce légal ?",
    category: 'decence_insalubrite',
    profile: 'fuzzy',
    expectedPlaybookMatch: false,
    expectedAbsorbableByDomainPack: true,
    goldExpectation: 'Non sans décision judiciaire. Le locataire ne peut pas suspendre unilatéralement le loyer. Risque : commandement de payer. Voie correcte : mise en demeure + commission + TJ.',
  },
  {
    id: 'B24',
    question: "Il y a des moisissures importantes dans mon appartement depuis 6 mois malgré mes signalements.",
    category: 'decence_insalubrite',
    profile: 'fuzzy',
    expectedPlaybookMatch: false,
    expectedAbsorbableByDomainPack: true,
    goldExpectation: 'Décence (décret 2002-120 critères salubrité). Mise en demeure du bailleur, constat huissier, signalement mairie. Réduction de loyer possible via TJ si bailleur défaillant.',
  },

  // ── Sous-location / colocation / solidarité (4) ───────────────────────────
  {
    id: 'B25',
    question: "Mon locataire sous-loue son appartement sur Airbnb sans m'en informer. Quels sont mes droits ?",
    category: 'sous_location_colocation',
    profile: 'well_covered',
    expectedPlaybookMatch: false,
    expectedAbsorbableByDomainPack: true,
    goldExpectation: 'Art. 8 loi 89-462 : sous-location sans accord écrit = résiliation possible du bail. Bailleur peut réclamer les profits. Accord doit être préalable et écrit.',
  },
  {
    id: 'B26',
    question: "Un colocataire veut quitter le logement, les autres restent. Doit-il continuer à payer ?",
    category: 'sous_location_colocation',
    profile: 'edge_case',
    expectedPlaybookMatch: false,
    expectedAbsorbableByDomainPack: true,
    goldExpectation: 'Clause de solidarité : colocataire restant solidaire des loyers jusqu\'à 6 mois après résiliation de son bail individuel. Nouveau locataire peut remplacer si bailleur accepte.',
  },
  {
    id: 'B27',
    question: "Je veux sous-louer une chambre de mon appartement pendant mes vacances, le bailleur peut-il refuser ?",
    category: 'sous_location_colocation',
    profile: 'fuzzy',
    expectedPlaybookMatch: false,
    expectedAbsorbableByDomainPack: true,
    goldExpectation: 'Oui : accord préalable écrit du bailleur obligatoire (art. 8 loi 89-462). Le refus est son droit. Sans accord : résiliation du bail possible.',
  },
  {
    id: 'B28',
    question: "Qu'est-ce que la clause de solidarité dans un contrat de colocation et quelles sont ses limites ?",
    category: 'sous_location_colocation',
    profile: 'fuzzy',
    expectedPlaybookMatch: false,
    expectedAbsorbableByDomainPack: true,
    goldExpectation: 'Clause permettant au bailleur de demander l\'intégralité du loyer à n\'importe quel colocataire. Limite : elle cesse 6 mois après le départ du colocataire si un remplaçant est accepté.',
  },

  // ── Trêve hivernale / exécution (2) ──────────────────────────────────────
  {
    id: 'B29',
    question: "Peut-on expulser un locataire en décembre ?",
    category: 'treve_hivernale',
    profile: 'well_covered',
    expectedPlaybookMatch: false,
    expectedAbsorbableByDomainPack: true,
    goldExpectation: 'CPCE art. L412-6 : trêve hivernale du 1er nov. au 31 mars suspend l\'exécution de l\'expulsion. La procédure judiciaire peut continuer. Exceptions : logements dangereux, squatteurs.',
  },
  {
    id: 'B30',
    question: "Mon voisin squatte un appartement depuis 2 ans. La trêve hivernale le protège-t-il aussi ?",
    category: 'treve_hivernale',
    profile: 'edge_case',
    expectedPlaybookMatch: false,
    expectedAbsorbableByDomainPack: true,
    goldExpectation: 'Non pour un squatteur sans titre : exception légale à la trêve hivernale (CPCE art. L412-6). Procédure d\'expulsion différente (référé, voire procédure accélérée).',
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures partagées (pas d'appel live — benchmark déterministe)
// ─────────────────────────────────────────────────────────────────────────────

const EMPTY_ARTICLES: TaggedArticle[] = []
const EMPTY_CASES: TaggedCase[] = []

// ─────────────────────────────────────────────────────────────────────────────
// Types de résultats
// ─────────────────────────────────────────────────────────────────────────────

export type ModeResult = {
  mode: 'A' | 'B' | 'C'
  applicability: 'ok' | 'n_a'
  absorbed: boolean
  archetype: string | null
  briefGoldScore: number   // /20 — heuristique qualité du brief
  scopeErrorCount: number
  practicalScore: number   // /5
  latencyMs: number
  briefLength: number      // somme items du brief
  authorityCount: number
  hasPlaybookOverlay: boolean
  notes: string[]
}

export type QuestionResult = {
  questionId: string
  question: string
  category: BenchmarkCategory
  profile: BenchmarkQuestionProfile
  expectedPlaybookMatch: boolean
  expectedAbsorbableByDomainPack: boolean
  modeA: ModeResult
  modeB: ModeResult
  modeC: ModeResult
}

export type ModeMetrics = {
  mode: 'A' | 'B' | 'C'
  questionsRun: number
  absorbedCount: number
  absorbedRate: number          // 0–1
  avgGoldScore: number          // /20
  avgGoldScoreNoPlaybook: number | null  // /20, subset sans playbook attendu
  scopeErrorRate: number        // 0–1
  avgPracticalScore: number     // /5
  avgLatencyMs: number
  avgBriefLength: number
  avgAuthorityCount: number
}

// ─────────────────────────────────────────────────────────────────────────────
// scoreBriefQuality — score heuristique 0–20 à partir d'un LegalBrief
// Aucun LLM : basé sur richesse et spécificité du brief produit
// ─────────────────────────────────────────────────────────────────────────────

export function scoreBriefQuality(brief: LegalBrief | null, absorbed: boolean): {
  gold: number
  practical: number
  scopeErrors: number
} {
  if (!brief) return { gold: 0, practical: 0, scopeErrors: 0 }

  // ── Authority score (0–5) ──────────────────────────────────────────────────
  const n = brief.authorityCards.length
  const authorityScore =
    n >= 4 ? 5 :
    n === 3 ? 4.5 :
    n === 2 ? 3.5 :
    n === 1 ? 2 :
    0

  // ── Distinctions score (0–5) ───────────────────────────────────────────────
  // Bonus si brief absorbé par une règle de repli spécifique (distinctions cibles)
  const d = brief.requiredDistinctions.length
  const distinctionBase = Math.min(5, d * 0.85)
  const distinctionScore = absorbed ? Math.min(5, distinctionBase + 0.5) : distinctionBase

  // ── Practical score (0–5) ──────────────────────────────────────────────────
  const p = brief.practicalOutcome.length
  const practicalScore =
    p >= 4 ? 5 :
    p === 3 ? 4 :
    p === 2 ? 3 :
    p === 1 ? 1.5 :
    0

  // ── Safety score (0–5) ─────────────────────────────────────────────────────
  const s = brief.forbiddenAssertions.length
  const safetyScore =
    s >= 6 ? 5 :
    s >= 4 ? 4 :
    s >= 2 ? 3 :
    s === 1 ? 1.5 :
    0

  // ── Scope errors ───────────────────────────────────────────────────────────
  const scopeErrors = detectScopeErrors(brief)
  const scopePenalty = scopeErrors * 1.5

  const raw = authorityScore + distinctionScore + practicalScore + safetyScore - scopePenalty
  const gold = Math.max(0, Math.min(20, Math.round(raw * 2) / 2))

  return { gold, practical: Math.round(practicalScore * 2) / 2, scopeErrors }
}

// ─────────────────────────────────────────────────────────────────────────────
// detectScopeErrors — lois hors champ baux_habitation dans les authority cards
// ─────────────────────────────────────────────────────────────────────────────

const BAUX_HABITATION_ALLOWED_AUTHORITIES = new Set([
  'loi 89-462',
  'code civil',
  'code des procédures civiles d\'exécution',
  'cpce',
  'décret 2002-120',
  'decret 2002-120',
  'code de la santé publique',
  'csp',
  'code de la construction et de l\'habitation',
  'cch',
  'loi alur',
  'loi élan',
  'loi elan',
  'loi climat',
  'loi climat et résilience',
])

export function detectScopeErrors(brief: LegalBrief): number {
  let errors = 0
  for (const card of brief.authorityCards) {
    if (card.kind !== 'article') continue
    const sourceLower = card.source.toLowerCase()
    const hasAllowedAuthority = [...BAUX_HABITATION_ALLOWED_AUTHORITIES].some(
      (auth) => sourceLower.includes(auth),
    )
    if (!hasAllowedAuthority) {
      // Vérifier si la règle mentionne une autorité clairement hors domaine
      const ruleLower = (card.rule ?? '').toLowerCase()
      const clearlyOutOfScope =
        ruleLower.includes('bail commercial') ||
        ruleLower.includes('bail rural') ||
        ruleLower.includes('code de commerce') ||
        ruleLower.includes('code du travail') ||
        ruleLower.includes('statut des baux')
      if (clearlyOutOfScope) errors++
    }
  }
  return errors
}

// ─────────────────────────────────────────────────────────────────────────────
// briefLength — nombre total d'éléments dans le brief
// ─────────────────────────────────────────────────────────────────────────────

export function computeBriefLength(brief: LegalBrief | null): number {
  if (!brief) return 0
  return (
    brief.authorityCards.length +
    brief.requiredDistinctions.length +
    brief.forbiddenAssertions.length +
    brief.practicalOutcome.length +
    brief.facts.length
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Mode runners
// ─────────────────────────────────────────────────────────────────────────────

/** Mode A : baseline — playbook seul, sans domain pack */
export function runModeA(q: BenchmarkQuestion): ModeResult {
  const t0 = performance.now()
  const playbook = detectLegalPlaybook(q.question)
  let brief: LegalBrief | null = null
  const notes: string[] = []

  if (playbook) {
    brief = buildLegalBrief({
      userQuestion: q.question,
      domain: playbook.domain,
      playbook,
      taggedArticles: EMPTY_ARTICLES,
      taggedLiveCases: EMPTY_CASES,
      precisionBudget: 'medium',
    })
    notes.push(`playbook=${playbook.id}`)
  } else {
    notes.push('no_playbook_detected')
  }

  const latencyMs = Math.round((performance.now() - t0) * 100) / 100
  const absorbed = brief !== null
  const { gold, practical, scopeErrors } = scoreBriefQuality(brief, absorbed)

  return {
    mode: 'A',
    applicability: 'ok',
    absorbed,
    archetype: brief?.archetype ?? null,
    briefGoldScore: gold,
    scopeErrorCount: scopeErrors,
    practicalScore: practical,
    latencyMs,
    briefLength: computeBriefLength(brief),
    authorityCount: brief?.authorityCards.length ?? 0,
    hasPlaybookOverlay: false,
    notes,
  }
}

/** Mode B : domain pack seul, sans overlay, même si un playbook existe */
export function runModeB(q: BenchmarkQuestion): ModeResult {
  const t0 = performance.now()
  const fallbackRule = matchFallbackRule(BAUX_HABITATION_PACK, q.question)
  const notes: string[] = []

  const brief = buildBriefFromDomainPack({
    userQuestion: q.question,
    domainPack: BAUX_HABITATION_PACK,
    playbookOverlay: undefined,
    taggedArticles: EMPTY_ARTICLES,
    taggedLiveCases: EMPTY_CASES,
    precisionBudget: 'medium',
  })

  const latencyMs = Math.round((performance.now() - t0) * 100) / 100
  const absorbed = fallbackRule !== null

  if (fallbackRule) {
    notes.push(`fallback_rule=${fallbackRule.archetypeId}`)
  } else {
    notes.push('domain_pack_fallback_generic')
  }

  const { gold, practical, scopeErrors } = scoreBriefQuality(brief, absorbed)

  return {
    mode: 'B',
    applicability: 'ok',
    absorbed,
    archetype: brief.archetype,
    briefGoldScore: gold,
    scopeErrorCount: scopeErrors,
    practicalScore: practical,
    latencyMs,
    briefLength: computeBriefLength(brief),
    authorityCount: brief.authorityCards.length,
    hasPlaybookOverlay: false,
    notes,
  }
}

/** Mode C : domain pack + overlay playbook si disponible */
export function runModeC(q: BenchmarkQuestion): ModeResult {
  const t0 = performance.now()
  const playbook = detectLegalPlaybook(q.question)
  const fallbackRule = playbook ? null : matchFallbackRule(BAUX_HABITATION_PACK, q.question)
  const notes: string[] = []

  const brief = buildBriefFromDomainPack({
    userQuestion: q.question,
    domainPack: BAUX_HABITATION_PACK,
    playbookOverlay: playbook ?? undefined,
    taggedArticles: EMPTY_ARTICLES,
    taggedLiveCases: EMPTY_CASES,
    precisionBudget: 'medium',
  })

  const latencyMs = Math.round((performance.now() - t0) * 100) / 100
  const absorbed = playbook !== null || fallbackRule !== null

  if (playbook) {
    notes.push(`playbook_overlay=${playbook.id}`)
  } else if (fallbackRule) {
    notes.push(`fallback_rule=${fallbackRule.archetypeId}`)
  } else {
    notes.push('domain_pack_fallback_generic')
  }

  const { gold, practical, scopeErrors } = scoreBriefQuality(brief, absorbed)

  return {
    mode: 'C',
    applicability: 'ok',
    absorbed,
    archetype: brief.archetype,
    briefGoldScore: gold,
    scopeErrorCount: scopeErrors,
    practicalScore: practical,
    latencyMs,
    briefLength: computeBriefLength(brief),
    authorityCount: brief.authorityCards.length,
    hasPlaybookOverlay: playbook !== null,
    notes,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// computeModeMetrics — calcule les métriques agrégées pour un mode
// ─────────────────────────────────────────────────────────────────────────────

export function computeModeMetrics(
  results: QuestionResult[],
  mode: 'A' | 'B' | 'C',
): ModeMetrics {
  const modeResults = results.map((r) => (mode === 'A' ? r.modeA : mode === 'B' ? r.modeB : r.modeC))
  const applicable = modeResults.filter((r) => r.applicability === 'ok')
  const n = applicable.length

  if (n === 0) {
    return {
      mode,
      questionsRun: 0,
      absorbedCount: 0,
      absorbedRate: 0,
      avgGoldScore: 0,
      avgGoldScoreNoPlaybook: null,
      scopeErrorRate: 0,
      avgPracticalScore: 0,
      avgLatencyMs: 0,
      avgBriefLength: 0,
      avgAuthorityCount: 0,
    }
  }

  const absorbedCount = applicable.filter((r) => r.absorbed).length

  // Subset hors playbook attendu : mesure la couverture "native" du domain pack
  const noPlaybookExpectedResults = results
    .filter((q) => !q.expectedPlaybookMatch)
    .map((q) => (mode === 'A' ? q.modeA : mode === 'B' ? q.modeB : q.modeC))
    .filter((r) => r.applicability === 'ok')

  const avgGoldNoPlaybook =
    noPlaybookExpectedResults.length > 0
      ? avg(noPlaybookExpectedResults.map((r) => r.briefGoldScore))
      : null

  const scopeErrorCount = applicable.filter((r) => r.scopeErrorCount > 0).length

  return {
    mode,
    questionsRun: n,
    absorbedCount,
    absorbedRate: absorbedCount / n,
    avgGoldScore: avg(applicable.map((r) => r.briefGoldScore)),
    avgGoldScoreNoPlaybook: avgGoldNoPlaybook,
    scopeErrorRate: scopeErrorCount / n,
    avgPracticalScore: avg(applicable.map((r) => r.practicalScore)),
    avgLatencyMs: avg(applicable.map((r) => r.latencyMs)),
    avgBriefLength: avg(applicable.map((r) => r.briefLength)),
    avgAuthorityCount: avg(applicable.map((r) => r.authorityCount)),
  }
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100
}

// ─────────────────────────────────────────────────────────────────────────────
// evaluateGoNoGo — règle de décision go / no-go
// ─────────────────────────────────────────────────────────────────────────────

export type GoNoGoResult = {
  verdict: 'GO' | 'NO-GO'
  reasons: string[]
  warnings: string[]
  criteria: {
    absorptionOk: boolean       // >= 40% des questions sans playbook absorbées par Mode B
    goldScoreOk: boolean        // score gold Mode B sur sous-ensemble absorbé sans playbook >= 16.5/20
    noScopeCritical: boolean    // aucune erreur de portée critique (scopeErrorRate === 0)
    latencyOk: boolean          // pas plus de 20% d'augmentation de latence Mode B vs Mode A
    noPlaybookRegression: boolean  // Mode C >= Mode A sur les questions avec playbook attendu
  }
}

export function evaluateGoNoGo(
  results: QuestionResult[],
  modeAMetrics: ModeMetrics,
  modeBMetrics: ModeMetrics,
  modeCMetrics: ModeMetrics,
): GoNoGoResult {
  const reasons: string[] = []
  const warnings: string[] = []

  // ── Critère 1 : taux d'absorption sans playbook ──────────────────────────
  const noPlaybookQuestions = results.filter((q) => !q.expectedPlaybookMatch)
  const absorbedByBNoPlaybook = noPlaybookQuestions.filter((q) => q.modeB.absorbed).length
  const absorbedRateNoPlaybook =
    noPlaybookQuestions.length > 0 ? absorbedByBNoPlaybook / noPlaybookQuestions.length : 0

  const absorptionOk = absorbedRateNoPlaybook >= 0.4
  if (!absorptionOk) {
    reasons.push(
      `Absorption insuffisante : ${(absorbedRateNoPlaybook * 100).toFixed(1)}% des questions sans playbook absorbées (seuil : 40%). Requises : ${Math.ceil(noPlaybookQuestions.length * 0.4)} — obtenues : ${absorbedByBNoPlaybook}.`,
    )
  }

  // ── Critère 2 : score gold moyen >= 16.5/20 sur questions absorbées sans playbook ──
  const absorbedNoPlaybook = noPlaybookQuestions.filter((q) => q.modeB.absorbed)
  const goldAbsorbed =
    absorbedNoPlaybook.length > 0
      ? avg(absorbedNoPlaybook.map((q) => q.modeB.briefGoldScore))
      : 0

  const goldScoreOk = absorbedNoPlaybook.length === 0 || goldAbsorbed >= 16.5
  if (!goldScoreOk) {
    reasons.push(
      `Score gold insuffisant sur questions absorbées sans playbook : ${goldAbsorbed.toFixed(1)}/20 (seuil : 16.5/20).`,
    )
  } else if (absorbedNoPlaybook.length === 0) {
    warnings.push('Aucune question absorbée sans playbook — score gold sur ce sous-ensemble non évaluable.')
  }

  // ── Critère 3 : aucune erreur de portée critique ──────────────────────────
  const criticalScopeErrors = results.filter(
    (q) => q.modeB.scopeErrorCount > 0 || q.modeC.scopeErrorCount > 0,
  )
  const noScopeCritical = criticalScopeErrors.length === 0
  if (!noScopeCritical) {
    reasons.push(
      `Erreurs de portée détectées : ${criticalScopeErrors.length} question(s) avec autorités hors scope baux_habitation. IDs : ${criticalScopeErrors.map((q) => q.questionId).join(', ')}.`,
    )
  }

  // ── Critère 4 : latence < +20% ────────────────────────────────────────────
  const latencyIncrease =
    modeAMetrics.avgLatencyMs > 0
      ? (modeBMetrics.avgLatencyMs - modeAMetrics.avgLatencyMs) / modeAMetrics.avgLatencyMs
      : 0
  // Si Mode A est < 0.1ms (pas de playbook matché), la comparaison n'est pas significative
  const latencyOk = modeAMetrics.avgLatencyMs < 0.1 ? true : latencyIncrease <= 0.2
  if (modeAMetrics.avgLatencyMs < 0.1) {
    warnings.push('Latences Mode A proches de 0ms (pas de playbook) — comparaison de latence peu significative.')
  }
  if (!latencyOk) {
    reasons.push(
      `Augmentation de latence excessive : +${(latencyIncrease * 100).toFixed(1)}% (Mode B vs Mode A, seuil : 20%). Moy. A=${modeAMetrics.avgLatencyMs.toFixed(2)}ms | B=${modeBMetrics.avgLatencyMs.toFixed(2)}ms.`,
    )
  }

  // ── Critère 5 : pas de régression sur questions avec playbook overlay ──────
  const withPlaybookQuestions = results.filter((q) => q.expectedPlaybookMatch)
  const regressions = withPlaybookQuestions.filter(
    (q) => q.modeC.briefGoldScore < q.modeA.briefGoldScore - 1.0,
  )
  const noPlaybookRegression = regressions.length === 0
  if (!noPlaybookRegression) {
    reasons.push(
      `Régression détectée sur ${regressions.length} question(s) avec playbook overlay (Mode C < Mode A - 1pt). IDs : ${regressions.map((q) => q.questionId).join(', ')}.`,
    )
  }

  const criteria = { absorptionOk, goldScoreOk, noScopeCritical, latencyOk, noPlaybookRegression }
  const verdict: 'GO' | 'NO-GO' = Object.values(criteria).every(Boolean) ? 'GO' : 'NO-GO'

  return { verdict, reasons, warnings, criteria }
}

// ─────────────────────────────────────────────────────────────────────────────
// printHelpers
// ─────────────────────────────────────────────────────────────────────────────

function hr(char = '─', w = 74) {
  return char.repeat(w)
}
function pad(s: string | number, n: number) {
  return String(s).padEnd(n)
}

function printModeRow(mode: string, m: ModeMetrics) {
  const absorbed = `${m.absorbedCount}/${m.questionsRun} (${(m.absorbedRate * 100).toFixed(0)}%)`
  const gold     = m.avgGoldScore.toFixed(1) + '/20'
  const goldNoP  = m.avgGoldScoreNoPlaybook !== null ? m.avgGoldScoreNoPlaybook.toFixed(1) + '/20' : ' N/A  '
  const scope    = m.scopeErrorRate === 0 ? '0%' : `${(m.scopeErrorRate * 100).toFixed(0)}%`
  const prac     = m.avgPracticalScore.toFixed(1) + '/5'
  const lat      = m.avgLatencyMs.toFixed(2) + 'ms'
  const blen     = m.avgBriefLength.toFixed(1)
  const auth     = m.avgAuthorityCount.toFixed(1)
  console.log(
    `  ${pad(mode, 6)} | ${pad(absorbed, 16)} | ${pad(gold, 7)} | ${pad(goldNoP, 9)} | ${pad(scope, 7)} | ${pad(prac, 6)} | ${pad(lat, 8)} | ${pad(blen, 6)} | ${auth}`,
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const saveJson = process.argv.includes('--save-json')

  console.log('\n' + hr('═'))
  console.log('  BENCHMARK DOMAIN PACK — baux_habitation (go / no-go)')
  console.log(`  Date : ${new Date().toISOString()}`)
  console.log(`  Questions : ${BENCHMARK_DATASET.length}`)
  console.log(hr('═'))

  // ── Exécution des 3 modes par question ────────────────────────────────────
  const questionResults: QuestionResult[] = []

  for (const q of BENCHMARK_DATASET) {
    const modeA = runModeA(q)
    const modeB = runModeB(q)
    const modeC = runModeC(q)
    questionResults.push({
      questionId: q.id,
      question: q.question,
      category: q.category,
      profile: q.profile,
      expectedPlaybookMatch: q.expectedPlaybookMatch,
      expectedAbsorbableByDomainPack: q.expectedAbsorbableByDomainPack,
      modeA,
      modeB,
      modeC,
    })
  }

  // ── Métriques agrégées ────────────────────────────────────────────────────
  const metricsA = computeModeMetrics(questionResults, 'A')
  const metricsB = computeModeMetrics(questionResults, 'B')
  const metricsC = computeModeMetrics(questionResults, 'C')

  // ── Tableau synthétique par mode ──────────────────────────────────────────
  console.log('\n' + hr('═'))
  console.log('  TABLEAU SYNTHÉTIQUE PAR MODE')
  console.log(hr('═'))
  console.log(`\n  ${pad('Mode', 6)} | ${pad('Absorbées', 16)} | ${pad('Gold', 7)} | ${pad('Gold (¬PB)', 9)} | ${pad('Scope ERR', 7)} | ${pad('Prac', 6)} | ${pad('Latence', 8)} | ${pad('Taille', 6)} | Autors`)
  console.log('  ' + hr('─', 72))
  printModeRow('A', metricsA)
  printModeRow('B', metricsB)
  printModeRow('C', metricsC)
  console.log()
  console.log('  Gold (¬PB) = score gold sur le sous-ensemble sans playbook attendu')
  console.log('  Taille = longueur moyenne du brief (total items)')

  // ── Détail question par question ──────────────────────────────────────────
  console.log('\n' + hr('═'))
  console.log('  DÉTAIL QUESTION PAR QUESTION')
  console.log(hr('═'))
  console.log(`\n  ${pad('ID', 4)} ${pad('Cat.', 28)} ${pad('Profil', 12)} | A⬡ A🏅 | B⬡ B🏅 | C⬡ C🏅 | Delta B→C`)
  console.log('  ' + hr('─', 72))

  for (const r of questionResults) {
    const catShort = r.category.replace('loyers_impayes_expulsion', 'loyers_expulsion').replace('depot_garantie_etat_lieux', 'depot_garantie').replace('conge_bailleur_locataire', 'conge').replace('decence_insalubrite', 'decence').replace('sous_location_colocation', 'sous_location').replace('treve_hivernale', 'treve')
    const aAbs = r.modeA.absorbed ? '✓' : '✗'
    const aGold = r.modeA.briefGoldScore.toFixed(0)
    const bAbs = r.modeB.absorbed ? '✓' : '✗'
    const bGold = r.modeB.briefGoldScore.toFixed(0)
    const cAbs = r.modeC.absorbed ? '✓' : '✗'
    const cGold = r.modeC.briefGoldScore.toFixed(0)
    const delta = r.modeC.briefGoldScore - r.modeB.briefGoldScore
    const deltaStr = delta > 0 ? `+${delta.toFixed(0)}` : delta.toFixed(0)
    console.log(
      `  ${pad(r.questionId, 4)} ${pad(catShort, 28)} ${pad(r.profile.replace('well_covered', 'bien couvert').replace('edge_case', 'cas bord'), 12)} | ${aAbs}  ${pad(aGold, 4)} | ${bAbs}  ${pad(bGold, 4)} | ${cAbs}  ${pad(cGold, 4)} | ${deltaStr}`,
    )
  }

  // ── Résumé du dataset ─────────────────────────────────────────────────────
  console.log('\n' + hr('═'))
  console.log('  RÉSUMÉ DU DATASET')
  console.log(hr('═'))
  const profileCounts = {
    well_covered: BENCHMARK_DATASET.filter((q) => q.profile === 'well_covered').length,
    fuzzy: BENCHMARK_DATASET.filter((q) => q.profile === 'fuzzy').length,
    edge_case: BENCHMARK_DATASET.filter((q) => q.profile === 'edge_case').length,
  }
  const catCounts = {
    loyers_impayes_expulsion: BENCHMARK_DATASET.filter((q) => q.category === 'loyers_impayes_expulsion').length,
    depot_garantie_etat_lieux: BENCHMARK_DATASET.filter((q) => q.category === 'depot_garantie_etat_lieux').length,
    conge_bailleur_locataire: BENCHMARK_DATASET.filter((q) => q.category === 'conge_bailleur_locataire').length,
    decence_insalubrite: BENCHMARK_DATASET.filter((q) => q.category === 'decence_insalubrite').length,
    sous_location_colocation: BENCHMARK_DATASET.filter((q) => q.category === 'sous_location_colocation').length,
    treve_hivernale: BENCHMARK_DATASET.filter((q) => q.category === 'treve_hivernale').length,
  }
  console.log(`\n  Profils : bien couvert=${profileCounts.well_covered} | flou/naturel=${profileCounts.fuzzy} | cas bord=${profileCounts.edge_case}`)
  console.log(`  Catégories :`)
  for (const [cat, count] of Object.entries(catCounts)) {
    console.log(`    ${pad(cat, 32)} : ${count}`)
  }
  const expectedPB = BENCHMARK_DATASET.filter((q) => q.expectedPlaybookMatch).length
  const expectedDP = BENCHMARK_DATASET.filter((q) => q.expectedAbsorbableByDomainPack).length
  console.log(`\n  Playbook attendu      : ${expectedPB}/${BENCHMARK_DATASET.length}`)
  console.log(`  Domain pack attendu   : ${expectedDP}/${BENCHMARK_DATASET.length}`)

  // ── Go / No-Go ────────────────────────────────────────────────────────────
  const decision = evaluateGoNoGo(questionResults, metricsA, metricsB, metricsC)

  console.log('\n' + hr('═'))
  console.log('  CONCLUSION GO / NO-GO')
  console.log(hr('═'))
  console.log()

  const verdictLine = decision.verdict === 'GO'
    ? '  ✅  VERDICT : GO — le domain pack est validé pour rollout progressif'
    : '  ❌  VERDICT : NO-GO — conditions non remplies pour activation du domain pack'
  console.log(verdictLine)

  console.log('\n  Critères :')
  const { criteria } = decision
  console.log(`    ${criteria.absorptionOk ? '✓' : '✗'} Absorption >= 40% sans playbook`)
  console.log(`    ${criteria.goldScoreOk ? '✓' : '✗'} Score gold >= 16.5/20 sur questions absorbées sans playbook`)
  console.log(`    ${criteria.noScopeCritical ? '✓' : '✗'} Aucune erreur de portée critique`)
  console.log(`    ${criteria.latencyOk ? '✓' : '✗'} Latence Mode B <= +20% vs Mode A`)
  console.log(`    ${criteria.noPlaybookRegression ? '✓' : '✗'} Pas de régression sur questions avec playbook overlay`)

  if (decision.reasons.length > 0) {
    console.log('\n  Raisons du NO-GO :')
    for (const reason of decision.reasons) {
      console.log(`    • ${reason}`)
    }
  }

  if (decision.warnings.length > 0) {
    console.log('\n  Avertissements :')
    for (const warn of decision.warnings) {
      console.log(`    ⚠ ${warn}`)
    }
  }

  // ── Points forts / points faibles ────────────────────────────────────────
  console.log('\n  Points forts observés :')
  const strongPoints: string[] = []
  if (metricsB.absorbedRate >= 0.7) strongPoints.push(`Forte absorption Mode B : ${(metricsB.absorbedRate * 100).toFixed(0)}% des questions reconnues par les fallback rules.`)
  if (metricsC.avgGoldScore >= 17) strongPoints.push(`Score gold Mode C élevé : ${metricsC.avgGoldScore.toFixed(1)}/20 — le domain pack enrichit efficacement les playbooks.`)
  if (metricsB.scopeErrorRate === 0) strongPoints.push('Aucune erreur de portée — toutes les autorités injectées sont bien dans le scope baux_habitation.')
  if (metricsC.avgAuthorityCount >= 3) strongPoints.push(`Bonne densité d'autorités en Mode C : ${metricsC.avgAuthorityCount.toFixed(1)} cartes en moyenne.`)
  if (strongPoints.length === 0) strongPoints.push('Aucun point fort notable au-dessus des seuils.')
  for (const p of strongPoints) console.log(`    + ${p}`)

  console.log('\n  Points faibles observés :')
  const weakPoints: string[] = []
  if (metricsB.absorbedRate < 0.5) weakPoints.push(`Absorption Mode B modeste : ${(metricsB.absorbedRate * 100).toFixed(0)}% — les fallback rules ne couvrent pas tous les archétypes.`)
  if (metricsB.avgGoldScore < 14) weakPoints.push(`Score gold Mode B faible : ${metricsB.avgGoldScore.toFixed(1)}/20 — le domain pack seul produit des briefs peu riches.`)
  const noPlaybookAbsorbedCount = questionResults.filter((q) => !q.expectedPlaybookMatch && !q.modeB.absorbed).length
  if (noPlaybookAbsorbedCount > 5) weakPoints.push(`${noPlaybookAbsorbedCount} questions sans playbook non absorbées par Mode B — à couvrir avec de nouvelles fallback rules.`)
  if (weakPoints.length === 0) weakPoints.push('Aucun point faible notable.')
  for (const p of weakPoints) console.log(`    - ${p}`)

  console.log('\n' + hr('═') + '\n')

  // ── Sauvegarde JSON optionnelle ────────────────────────────────────────────
  if (saveJson) {
    const outputPath = resolve(__dirname, '../docs/coverage/domain-pack-baux-benchmark-results.json')
    const output = {
      date: new Date().toISOString(),
      dataset: BENCHMARK_DATASET,
      questionResults,
      metrics: { modeA: metricsA, modeB: metricsB, modeC: metricsC },
      goNoGo: decision,
    }
    writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8')
    console.log(`  JSON sauvegardé : ${outputPath}\n`)
  }
}

// Ne pas exécuter main() quand le module est importé dans un contexte de test
if (!process.env.VITEST) {
  main().catch(console.error)
}
