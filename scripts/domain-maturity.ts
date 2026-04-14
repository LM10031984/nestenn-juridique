#!/usr/bin/env tsx
// scripts/domain-maturity.ts
// Matrice de maturité des domaines — audit de profondeur métier
//
// Lancer : npx tsx scripts/domain-maturity.ts
// Lancer (JSON) : npx tsx scripts/domain-maturity.ts --json
//
// Ce script distingue 3 niveaux de préparation par domaine :
//   Niveau 1 — policy runtime déclarée (architecture)
//   Niveau 2 — shortlist métier réelle dans topic-articles.ts (outillage)
//   Niveau 3 — domaine couvert dans domain-detector.ts (détection active)

import { DOMAIN_POLICIES, type DomainPolicy } from '../lib/domain-policies'

// ─────────────────────────────────────────────────────────────────────────────
// Mapping topic-articles → domaines
// Dérivé manuellement de lib/topic-articles.ts (41 entrées)
// ─────────────────────────────────────────────────────────────────────────────

const TOPIC_TO_DOMAIN: Record<string, string> = {
  // Diagnostics — 8 topics
  dpe_fg_consequences:          'diagnostics',
  dpe_collectif_calendrier:     'diagnostics',
  amiante_diagnostic:           'diagnostics',
  dpe_validite_duree:           'diagnostics',
  dpe_erronne_responsabilite:   'diagnostics',
  erp_obligation:               'diagnostics',
  audit_energetique_vente:      'diagnostics',
  sinistre_anterieur_erp:       'diagnostics',

  // Baux habitation — 6 topics
  decence_logement:             'baux_habitation',
  droit_preference_locataire:   'baux_habitation',
  article_24_bail_modification: 'baux_habitation',
  treve_hivernale:              'baux_habitation',
  sous_location_bail:           'baux_habitation',
  loyers_impayes_procedure:     'baux_habitation',

  // Agent immobilier — 3 topics
  negociateur_salarie_mandats:  'agent_immobilier',
  mandat_exclusif_duree:        'agent_immobilier',
  mandat_honoraires_alur:       'agent_immobilier',

  // Responsabilité agent — 2 topics
  responsabilite_agent_vices:   'responsabilite_agent',
  devoir_conseil_jurisprudence: 'responsabilite_agent',

  // Vente immobilière — 4 topics
  responsabilite_notaire_condition_suspensive: 'vente_immobiliere',
  compromis_vente_general:      'vente_immobiliere',
  frais_notaire:                'vente_immobiliere',
  pret_immobilier_hypotheque:   'vente_immobiliere',

  // Fiscalité investisseurs — 1 topic
  denormandie:                  'fiscalite_investisseurs',

  // Copropriété — 6 topics
  copropriete_majorites_ag:           'copropriete',
  copropriete_syndic_travaux:         'copropriete',
  copropriete_charges_repartition:    'copropriete',
  copropriete_location_touristique:   'copropriete',
  travaux_parties_communes:           'copropriete',
  accessibilite_handicap_copropriete: 'copropriete',

  // Syndic copropriété — 1 topic
  copropriete_syndic_professionnel: 'syndic_copropriete',

  // Urbanisme — 2 topics
  permis_construire_delai:      'urbanisme',
  certificat_urbanisme:         'urbanisme',

  // SCI — 1 topic
  sci_cession_parts_fiscalite:  'sci_patrimoine',

  // Litiges — 1 topic
  assignation_procedure_judiciaire: 'litiges',

  // Conformité LCB-FT — 1 topic
  anti_blanchiment_agent:       'conformite_lcb_ft',

  // Bail commercial — 1 topic
  bail_commercial_general:      'bail_commercial',

  // Viager / démembrement — 2 topics
  viager_calcul_rente:          'viager_demembrement',
  demembrement_usufruit:        'viager_demembrement',

  // Servitudes — 1 topic
  servitudes_mitoyennete:       'servitudes',

  // Environnement — 1 topic
  spanc_anc_fosse:              'environnement_immo',

  // Sprint 2 — Construction
  decennale_garanties:          'construction',

  // Sprint 3 — nouveaux domaines
  gestion_locative_mandat:           'gestion_locative',
  location_touristique_obligations:  'location_touristique',
  droit_social_immo_statut:          'droit_social_immo',
  rgpd_agence_obligations:           'rgpd_agence',
}

// Domaines couverts par domain-detector.ts (DOMAIN_KEYWORDS — 19 entrées)
const DETECTOR_DOMAINS = new Set([
  // Entrées originales
  'baux_habitation',
  'copropriete',
  'agent_immobilier',
  'vente_immobiliere',
  'diagnostics',
  'urbanisme',
  'bail_commercial',
  'viager_demembrement',
  'litiges',
  'construction',
  'fiscalite_investisseurs',
  'servitudes',
  'location_touristique',
  'environnement_immo',
  // Sprint 1 — nouveaux domaines
  'gestion_locative',
  'responsabilite_agent',
  'syndic_copropriete',
  'sci_patrimoine',
  'conformite_lcb_ft',
])

// ─────────────────────────────────────────────────────────────────────────────
// Calcul de la matrice
// ─────────────────────────────────────────────────────────────────────────────

interface MaturityEntry {
  code: string
  // Niveau 1 — policy
  hasPolicy: boolean
  forceJurisprudence: boolean
  useLiveSync: boolean
  safetyLevel: string
  maxLiveArticles: number
  // Niveau 2 — shortlist métier
  topicCount: number
  hasShortlistStrategy: boolean
  // Niveau 3 — détection active
  hasDetector: boolean
  // Synthèse
  maturityLevel: 'fort' | 'moyen' | 'faible' | 'non outillé'
  gaps: string[]
  notes?: string
}

function buildTopicCountByDomain(): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const domain of Object.values(TOPIC_TO_DOMAIN)) {
    counts[domain] = (counts[domain] ?? 0) + 1
  }
  return counts
}

function computeMaturity(
  policy: DomainPolicy,
  topicCount: number,
): { level: MaturityEntry['maturityLevel']; gaps: string[] } {
  const gaps: string[] = []

  if (!policy.useLiveArticleSync) {
    gaps.push('live sync désactivé (legacy)')
  }
  if (topicCount === 0) {
    gaps.push('aucune shortlist métier dans topic-articles.ts')
  } else if (topicCount === 1) {
    gaps.push('shortlist métier minimale (1 topic)')
  }
  if (!DETECTOR_DOMAINS.has(policy.code)) {
    gaps.push('domaine absent de domain-detector.ts')
  }
  if (policy.forceJurisprudence && topicCount === 0) {
    gaps.push('jurisprudence obligatoire mais aucun topic métier — risque de réponse vide')
  }

  let level: MaturityEntry['maturityLevel']
  const score =
    (topicCount >= 3 ? 2 : topicCount >= 1 ? 1 : 0) +
    (DETECTOR_DOMAINS.has(policy.code) ? 2 : 0) +
    (policy.useLiveArticleSync ? 1 : 0)

  if (score >= 4) level = 'fort'
  else if (score >= 2) level = 'moyen'
  else if (score >= 1) level = 'faible'
  else level = 'non outillé'

  return { level, gaps }
}

function buildMatrix(): MaturityEntry[] {
  const topicCounts = buildTopicCountByDomain()
  const entries: MaturityEntry[] = []

  for (const policy of Object.values(DOMAIN_POLICIES)) {
    const topicCount = topicCounts[policy.code] ?? 0
    const { level, gaps } = computeMaturity(policy, topicCount)

    entries.push({
      code: policy.code,
      hasPolicy: true,
      forceJurisprudence: policy.forceJurisprudence,
      useLiveSync: policy.useLiveArticleSync,
      safetyLevel: policy.safetyLevel,
      maxLiveArticles: policy.maxLiveArticles,
      topicCount,
      hasShortlistStrategy: !!policy.shortlistStrategy,
      hasDetector: DETECTOR_DOMAINS.has(policy.code),
      maturityLevel: level,
      gaps,
      notes: policy.notes,
    })
  }

  // Trier : fort → moyen → faible → non outillé
  const order = { fort: 0, moyen: 1, faible: 2, 'non outillé': 3 }
  return entries.sort((a, b) => order[a.maturityLevel] - order[b.maturityLevel])
}

// ─────────────────────────────────────────────────────────────────────────────
// Affichage console
// ─────────────────────────────────────────────────────────────────────────────

const EMOJI_LEVEL: Record<string, string> = {
  fort:         '✅',
  moyen:        '🟡',
  faible:       '🟠',
  'non outillé':'🔴',
}

const BOOL = (v: boolean) => v ? '✓' : '–'

function printTable(matrix: MaturityEntry[]): void {
  const col = (s: string, w: number) => s.padEnd(w).slice(0, w)

  console.log('\n' + '─'.repeat(120))
  console.log('  MATRICE DE MATURITÉ DES DOMAINES NESTENN JURIDIQUE')
  console.log('  Généré le : ' + new Date().toLocaleDateString('fr-FR'))
  console.log('─'.repeat(120))
  console.log(
    col('Domaine', 28) +
    col('Maturité', 14) +
    col('Topics', 8) +
    col('Détect.', 9) +
    col('ForceJ', 8) +
    col('LiveSync', 10) +
    col('Safety', 10) +
    col('Shortlist', 12) +
    'Écarts identifiés'
  )
  console.log('─'.repeat(120))

  for (const e of matrix) {
    const level = EMOJI_LEVEL[e.maturityLevel] + ' ' + e.maturityLevel
    const gaps = e.gaps.length > 0 ? e.gaps.join(' | ') : '—'
    console.log(
      col(e.code, 28) +
      col(level, 14) +
      col(String(e.topicCount), 8) +
      col(BOOL(e.hasDetector), 9) +
      col(BOOL(e.forceJurisprudence), 8) +
      col(BOOL(e.useLiveSync), 10) +
      col(e.safetyLevel, 10) +
      col(e.hasShortlistStrategy ? 'oui' : '—', 12) +
      gaps
    )
    if (e.notes) {
      console.log(' '.repeat(28) + '  ↳ ' + e.notes)
    }
  }

  console.log('─'.repeat(120))
}

function printSummary(matrix: MaturityEntry[]): void {
  const counts = { fort: 0, moyen: 0, faible: 0, 'non outillé': 0 }
  for (const e of matrix) counts[e.maturityLevel]++

  console.log('\n  RÉSUMÉ')
  console.log('─'.repeat(50))
  for (const [level, count] of Object.entries(counts)) {
    console.log(`  ${EMOJI_LEVEL[level]}  ${level.padEnd(14)} : ${count} domaine(s)`)
  }

  const noDetector = matrix.filter(e => !e.hasDetector).map(e => e.code)
  const noTopics   = matrix.filter(e => e.topicCount === 0 && e.useLiveSync).map(e => e.code)
  const risky      = matrix.filter(e => e.forceJurisprudence && e.topicCount === 0).map(e => e.code)

  if (noTopics.length > 0) {
    console.log(`\n  ⚠️  Domaines actifs sans aucun topic métier (priorité enrichissement) :`)
    noTopics.forEach(d => console.log(`       – ${d}`))
  }
  if (noDetector.length > 0) {
    console.log(`\n  ⚠️  Domaines absents du détecteur de domaines :`)
    noDetector.forEach(d => console.log(`       – ${d}`))
  }
  if (risky.length > 0) {
    console.log(`\n  🔴  Domaines à risque (jurisprudence obligatoire mais aucun topic) :`)
    risky.forEach(d => console.log(`       – ${d}`))
  }

  console.log('─'.repeat(50) + '\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

const matrix = buildMatrix()

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(matrix, null, 2))
} else {
  printTable(matrix)
  printSummary(matrix)
}
