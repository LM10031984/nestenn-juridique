// lib/legal-gold-cases.ts
// Cas gold benchmark V2 — 3 cas pilotes en constantes TypeScript typées
// keyAuthorities : phrases conceptuelles (pas numéros d'articles bruts)
// → équitable pour V1 (citations directes) ET V2 (tags [Ax])

export type GoldBenchmarkCase = {
  id: string                     // 'Q1' | 'Q2' | 'Q3'
  playbookId: string
  question: string
  mustInclude: string[]          // concepts/phrases devant apparaître
  mustAvoid: string[]            // formulations interdites
  keyAuthorities: string[]       // références légales pivot (concept-level, pas numéros bruts)
  practicalExpectation: string[] // éléments de conduite pratique attendus
  comments: string[]
  /** Autorités qui pénalisent l'authorityScore si citées dans un mauvais contexte */
  wrongAuthorityContexts?: Array<{
    authority: string    // numéro ou concept à détecter dans la réponse
    contexts: string[]   // mots-clés qui signalent le mauvais usage
    penalty: number      // pénalité sur authorityScore (0-5)
  }>
}

// ─────────────────────────────────────────────────────────────────────────────
// Q1 — Offre d'achat contresignée
// ─────────────────────────────────────────────────────────────────────────────

const GOLD_Q1: GoldBenchmarkCase = {
  id: 'Q1',
  playbookId: 'vente_offre_contre_signee',
  question: "Une offre d'achat contresignée par le vendeur oblige-t-elle l'acquéreur à acheter ?",
  mustInclude: [
    'compromis de vente',
    'délai de rétractation',
    'exécution forcée',
    'conditions suspensives',
    'action en justice',
  ],
  mustAvoid: [
    "l'acquéreur est forcément tenu",
    'vente est définitivement parfaite',
    'exécution forcée immédiate',   // "immédiate" ne peut pas apparaître dans une réponse nuancée
  ],
  // Phrases conceptuelles : apparaissent dans V1 (citations) ET V2 (texte autour des tags)
  keyAuthorities: [
    'code civil',
    'droit de rétractation',
    'contrat synallagmatique',
  ],
  practicalExpectation: [
    'consulter un notaire',
    'vérifier la nature',    // V2 dit "Vérifier la nature du document" — "rédaction" était absent
    'prêt immobilier',
  ],
  comments: [
    "Q1 : enjeu = distinction offre simple vs compromis",
    "Délai de rétractation SRU (L271-1) pivot pratique clé",
    "Erreur principale : affirmer que l'acquéreur est forcément lié",
  ],
}

// ─────────────────────────────────────────────────────────────────────────────
// Q2 — Dépôt de garantie, état des lieux incomplet
// ─────────────────────────────────────────────────────────────────────────────

const GOLD_Q2: GoldBenchmarkCase = {
  id: 'Q2',
  playbookId: 'gestion_locative_depot_garantie',
  question:
    "Le propriétaire me demande de retenir une partie du dépôt de garantie pour des dégradations, mais l'état des lieux de sortie est incomplet. Que peut faire l'agence de gestion ?",
  mustInclude: [
    'charge de la preuve',
    'état des lieux incomplet',
    'délai de restitution',
    "rôle de l'agence",
    'justification des retenues',
  ],
  mustAvoid: [
    'toute retenue est illégale',
    'agence doit toujours restituer immédiatement',
  ],
  keyAuthorities: [
    'loi de 1989',
    'présomption de dégradation',
    'mandataire du bailleur',
  ],
  practicalExpectation: [
    'alerter le bailleur par écrit',
    'risque contentieux',
    'restituer dans les délais légaux',
  ],
  comments: [
    "Q2 : agence = mandataire, pas décideure finale",
    "État des lieux incomplet affaiblit mais n'invalide pas automatiquement toute retenue",
    "Délai légal de restitution (1 mois sans EDL; 2 mois avec EDL) est pivot",
  ],
}

// ─────────────────────────────────────────────────────────────────────────────
// Q3 — Fosse septique non conforme + dénonciation voisin
// ─────────────────────────────────────────────────────────────────────────────

const GOLD_Q3: GoldBenchmarkCase = {
  id: 'Q3',
  playbookId: 'environnement_immo_spanc',
  question:
    "Que faire si ma fosse septique n'est pas aux normes et que mon voisin m'a dénoncé ?",
  mustInclude: [
    'SPANC',
    'dénonciation',
    'mise en conformité',
    'risque sanitaire',
    'délai de mise en conformité',
  ],
  mustAvoid: [
    'dénonciation entraîne automatiquement sanction',
    'commune imposera forcément travaux',
  ],
  keyAuthorities: [
    'code de la santé publique',
    'assainissement non collectif',
    'contrôle SPANC',
  ],
  practicalExpectation: [
    'contact SPANC',              // "contact" est substring de "Contactez", "Prenez contact" — conjugaison-safe
    'rapport écrit',
    'diagnostic assainissement',  // V2 : "le diagnostic assainissement est obligatoire en cas de vente"
  ],
  comments: [
    "Q3 : le voisin n'a aucun pouvoir direct — dénonciation ≠ sanction automatique",
    "Distinction dénonciation vs contrôle SPANC = enjeu principal",
    "Risque sanitaire avéré peut accélérer les délais de mise en conformité",
  ],
  wrongAuthorityContexts: [
    {
      authority: 'L271-1',
      contexts: ['spanc', 'assainissement', 'fosse septique', 'contrôle'],
      penalty: 2.5,
    },
  ],
}

// ─────────────────────────────────────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────────────────────────────────────

export const GOLD_CASES: GoldBenchmarkCase[] = [GOLD_Q1, GOLD_Q2, GOLD_Q3]

export function getGoldCase(id: string): GoldBenchmarkCase | null {
  return GOLD_CASES.find((c) => c.id === id) ?? null
}
