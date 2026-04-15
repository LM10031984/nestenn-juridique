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
    'agence mandataire',           // remplace "rôle de l'agence" — plus robuste sans apostrophe
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
// Q4 — Copropriété : travaux urgents par le syndic sans vote AG
// ─────────────────────────────────────────────────────────────────────────────

const GOLD_Q4: GoldBenchmarkCase = {
  id: 'Q4',
  playbookId: 'syndic_travaux_urgents',
  question:
    "Le syndic peut-il engager des travaux urgents sans vote préalable de l'assemblée générale ?",
  mustInclude: [
    'assemblée générale',
    'travaux urgents',
    'information',
    'charges',
    'urgence',
  ],
  mustAvoid: [
    'le syndic n\'a jamais le droit',
    'les copropriétaires ne doivent rien payer',
    'tout travaux urgent est forcément illégal',
  ],
  keyAuthorities: [
    'loi du 10 juillet 1965',
    'pouvoirs du syndic',
    'charges de copropriété',
  ],
  practicalExpectation: [
    'rapport d\'urgence',
    'informer l\'assemblée',
    'avocat',
  ],
  comments: [
    "Q4 : le syndic peut agir sans vote si urgence réelle (art. 18 loi 65-557)",
    "Obligation d'information de l'AG après coup (art. 37 décret 67-223)",
    "Charges réparties selon tantièmes même sans vote préalable",
    "Erreur principale : affirmer qu'aucun travaux ne peut être fait sans AG",
  ],
}

// ─────────────────────────────────────────────────────────────────────────────
// Q5 — DPE erroné : recours acheteur contre vendeur ou diagnostiqueur
// ─────────────────────────────────────────────────────────────────────────────

const GOLD_Q5: GoldBenchmarkCase = {
  id: 'Q5',
  playbookId: 'vente_dpe_errone',
  question:
    "Le vendeur peut-il être poursuivi si le DPE était erroné et que l'acheteur découvre après la vente une consommation bien plus élevée ?",
  mustInclude: [
    'diagnostiqueur',
    'opposable',
    'vice caché',
    'preuve',
    'délai',
  ],
  mustAvoid: [
    'nullité automatique de la vente',
    'vendeur toujours responsable',
    'indemnisation automatique',
  ],
  keyAuthorities: [
    'code civil',
    'loi Climat',
    'code de la construction',
  ],
  practicalExpectation: [
    'nouveau DPE',
    'avocat',
    'diagnostiqueur',
  ],
  comments: [
    "Q5 : DPE opposable depuis juillet 2021 (loi Climat-Résilience) — enjeu clé",
    "Recours principal = diagnostiqueur (art. 1240 Code civil), pas forcément vendeur",
    "Vendeur engageable si mauvaise foi / vice caché démontré",
    "Erreur principale : affirmer nullité automatique ou responsabilité automatique du vendeur",
  ],
  wrongAuthorityContexts: [
    {
      authority: 'L271-1',
      contexts: ['dpe', 'diagnostiqueur', 'consommation', 'energie'],
      penalty: 2.5,
    },
  ],
}

// ─────────────────────────────────────────────────────────────────────────────
// Q6 — Responsabilité agent immobilier pour problème connu non signalé
// ─────────────────────────────────────────────────────────────────────────────

const GOLD_Q6: GoldBenchmarkCase = {
  id: 'Q6',
  playbookId: 'agent_defaut_information',
  question:
    "L'agent immobilier peut-il être responsable s'il n'a pas signalé un problème connu sur le bien au moment de la vente ?",
  mustInclude: [
    'devoir',
    'preuve',
    'connaissance',
    'dommages-intérêts',
    'responsabilité',
  ],
  mustAvoid: [
    'agent automatiquement responsable',
    'contrat nul automatiquement',
    'toujours indemnisé',
  ],
  keyAuthorities: [
    'code civil',
    'loi Hoguet',
    'mandataire',
  ],
  practicalExpectation: [
    'avocat',
    'preuve',
    'mise en demeure',
  ],
  comments: [
    "Q6 : clé = preuve que l'agent connaissait le problème (devoir d'information loi Hoguet)",
    "Action distincte contre agent (responsabilité) vs vendeur (vice caché)",
    "Prescription 5 ans (art. 2224 Code civil)",
    "Erreur principale : affirmer responsabilité automatique sans exiger la preuve",
  ],
}

// ─────────────────────────────────────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────────────────────────────────────

export const GOLD_CASES: GoldBenchmarkCase[] = [GOLD_Q1, GOLD_Q2, GOLD_Q3, GOLD_Q4, GOLD_Q5, GOLD_Q6]

export function getGoldCase(id: string): GoldBenchmarkCase | null {
  return GOLD_CASES.find((c) => c.id === id) ?? null
}
