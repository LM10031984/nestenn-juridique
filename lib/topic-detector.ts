// lib/topic-detector.ts
// Classification par thème juridique précis — keyword matching, 0ms, déterministe
// Permet d'identifier les pain points des agents (validité mandat, préemption, etc.)

export const TOPIC_LABELS: Record<string, string> = {
  // Transactions
  validite_mandat:         'Validité du mandat',
  mandat_exclusif:         'Mandat exclusif',
  honoraires_agent:        'Honoraires agent',
  compromis_vente:         'Compromis de vente',
  promesse_vente:          'Promesse de vente',
  conditions_suspensives:  'Conditions suspensives',
  retractation:            'Délai de rétractation',
  vice_cache:              'Vice caché',
  garantie_decennale:      'Garantie décennale',
  preemption:              'Droit de préemption',
  avant_contrat:           'Avant-contrat',

  // Baux habitation
  depot_garantie:          'Dépôt de garantie',
  delai_conge:             'Délai de congé',
  loyers_impayes:          'Loyers impayés',
  expulsion:               'Expulsion locataire',
  etat_lieux:              'État des lieux',
  sous_location:           'Sous-location',
  clause_resolutoire:      'Clause résolutoire',
  charges_locatives:       'Charges locatives',
  revision_loyer:          'Révision du loyer',
  bail_meuble:             'Bail meublé',
  bail_mobilite:           'Bail mobilité',
  colocation:              'Colocation',

  // Copropriété
  assemblee_generale:      'Assemblée générale',
  charges_copro:           'Charges de copropriété',
  travaux_copro:           'Travaux en copropriété',
  syndic:                  'Syndic',
  reglement_copro:         'Règlement de copropriété',
  parties_communes:        'Parties communes',

  // Loi Hoguet
  carte_t:                 'Carte T professionnelle',
  garantie_financiere:     'Garantie financière',
  loi_hoguet:              'Obligations Loi Hoguet',
  sequestre:               'Séquestre',

  // Urbanisme
  permis_construire:       'Permis de construire',
  declaration_travaux:     'Déclaration de travaux',
  plu:                     'PLU / Zone urbanisme',
  preemption_zad:          'Préemption ZAD / ZAP',

  // Fiscalité
  plus_value:              'Plus-value immobilière',
  sci:                     'SCI',
  droits_mutation:         'Droits de mutation',
  tva_immo:                'TVA immobilière',
  loi_pinel:               'Loi Pinel / Denormandie',

  // Diagnostics
  dpe:                     'DPE / Classe énergie',
  amiante:                 'Diagnostic amiante',
  plomb:                   'Diagnostic plomb',
  erp:                     'ERP / Risques',

  // Divers
  saisie_immobiliere:      'Saisie immobilière',
  servitude:               'Servitudes',
  mitoyennete:             'Mitoyenneté',
  viager:                  'Viager',
}

// Mots-clés par topic (ordre de spécificité décroissante)
const TOPIC_KEYWORDS: Array<{ topic: string; keywords: string[] }> = [
  // Transactions — topics précis en premier
  { topic: 'preemption_zad',        keywords: ['zad', 'zap', 'zone d\'aménagement différé', 'zone agricole protégée', 'préemption zad'] },
  { topic: 'preemption',            keywords: ['préemption', 'droit de préemption', 'purge', 'purger', 'dpu', 'préempter'] },
  { topic: 'retractation',          keywords: ['rétractation', 'délai de rétractation', '10 jours', 'délai légal', 'se rétracter'] },
  { topic: 'conditions_suspensives',keywords: ['condition suspensive', 'conditions suspensives', 'suspensif', 'prêt refusé', 'financement refusé'] },
  { topic: 'vice_cache',            keywords: ['vice caché', 'vices cachés', 'défaut caché', 'garantie des vices'] },
  { topic: 'garantie_decennale',    keywords: ['décennale', 'garantie décennale', 'garantie biennale', 'dommages-ouvrage', 'do assurance'] },
  { topic: 'promesse_vente',        keywords: ['promesse de vente', 'promesse unilatérale', 'pav', 'promesse synallagmatique'] },
  { topic: 'compromis_vente',       keywords: ['compromis', 'compromis de vente', 'sous seing privé', 'avant-contrat signé'] },
  { topic: 'avant_contrat',         keywords: ['avant-contrat', 'avant contrat', 'offre d\'achat', 'offre acceptée'] },
  { topic: 'mandat_exclusif',       keywords: ['mandat exclusif', 'exclusivité', 'clause d\'exclusivité'] },
  { topic: 'honoraires_agent',      keywords: ['honoraires', 'commission', 'rémunération agent', 'frais d\'agence', 'honnoraires'] },
  { topic: 'validite_mandat',       keywords: ['mandat', 'validité mandat', 'durée mandat', 'mandat de vente', 'mandat de recherche', 'mandat simple', 'renouvellement mandat'] },

  // Baux
  { topic: 'expulsion',             keywords: ['expulsion', 'expulser', 'trêve hivernale', 'commandement de quitter', 'huissier expulsion'] },
  { topic: 'loyers_impayes',        keywords: ['loyers impayés', 'impayé', 'impayés', 'loyer non payé', 'dette locative', 'commandement de payer'] },
  { topic: 'clause_resolutoire',    keywords: ['clause résolutoire', 'résiliation bail', 'résiliation de bail', 'résolution du bail'] },
  { topic: 'depot_garantie',        keywords: ['dépôt de garantie', 'caution', 'restitution caution', 'retenue caution', 'garantie locative'] },
  { topic: 'delai_conge',           keywords: ['congé', 'préavis', 'délai de préavis', 'délai de congé', 'donner congé', 'préavis réduit'] },
  { topic: 'etat_lieux',            keywords: ['état des lieux', 'état lieux', 'entrée état lieux', 'sortie état lieux', 'etat des lieux contradictoire'] },
  { topic: 'revision_loyer',        keywords: ['révision loyer', 'indexation loyer', 'irl', 'revalorisation loyer', 'augmentation loyer'] },
  { topic: 'sous_location',         keywords: ['sous-location', 'sous location', 'sous-louer', 'airbnb', 'location saisonnière non autorisée'] },
  { topic: 'colocation',            keywords: ['colocation', 'colocataire', 'bail solidaire', 'clause de solidarité'] },
  { topic: 'bail_meuble',           keywords: ['bail meublé', 'location meublée', 'meublé', 'lmnp', 'lmp'] },
  { topic: 'bail_mobilite',         keywords: ['bail mobilité', 'bail étudiant', 'bail de 10 mois', 'bail courte durée'] },
  { topic: 'charges_locatives',     keywords: ['charges locatives', 'charges récupérables', 'provisions charges', 'régularisation charges'] },

  // Copropriété
  { topic: 'assemblee_generale',    keywords: ['assemblée générale', 'ag ', ' ag,', 'ordre du jour', 'vote ag', 'résolution ag', 'convocation ag'] },
  { topic: 'travaux_copro',         keywords: ['travaux copropriété', 'travaux parties communes', 'ravalement', 'toiture copro', 'vote travaux'] },
  { topic: 'syndic',                keywords: ['syndic', 'conseil syndical', 'gestionnaire', 'syndic bénévole', 'changement syndic'] },
  { topic: 'charges_copro',         keywords: ['charges de copropriété', 'appel de fonds', 'quote-part', 'charges communes'] },
  { topic: 'reglement_copro',       keywords: ['règlement de copropriété', 'modificat règlement', 'clause règlement', 'état descriptif'] },
  { topic: 'parties_communes',      keywords: ['parties communes', 'parties privatives', 'lot', 'tantièmes'] },

  // Loi Hoguet
  { topic: 'carte_t',               keywords: ['carte t', 'carte professionnelle', 'habilitation', 'carte de transaction', 'renouvellement carte'] },
  { topic: 'garantie_financiere',   keywords: ['garantie financière', 'garantie cegc', 'caisse de garantie', 'fonds de garantie'] },
  { topic: 'sequestre',             keywords: ['séquestre', 'compte séquestre', 'fonds séquestrés', 'dépôt de séquestre'] },
  { topic: 'loi_hoguet',            keywords: ['loi hoguet', 'carte professionnelle', 'obligations agent', 'agent immobilier', 'mandataire'] },

  // Urbanisme
  { topic: 'permis_construire',     keywords: ['permis de construire', 'pc ', 'dépôt pc', 'obtention permis', 'recours permis'] },
  { topic: 'declaration_travaux',   keywords: ['déclaration préalable', 'dp travaux', 'autorisation travaux'] },
  { topic: 'plu',                   keywords: ['plu', 'plan local d\'urbanisme', 'zone constructible', 'zonage', 'coefficient occupation'] },

  // Fiscalité
  { topic: 'plus_value',            keywords: ['plus-value', 'plus value', 'imposition cession', 'exonération plus-value', 'abattement cession'] },
  { topic: 'sci',                   keywords: ['sci ', 'société civile immobilière', 'associé sci', 'parts sci', 'gérant sci'] },
  { topic: 'droits_mutation',       keywords: ['droits de mutation', 'frais de notaire', 'taxe publicité foncière', 'droits enregistrement'] },
  { topic: 'tva_immo',              keywords: ['tva', 'tva immobilière', 'tva sur marge', 'tva neuf'] },
  { topic: 'loi_pinel',             keywords: ['pinel', 'denormandie', 'malraux', 'déficit foncier', 'investissement locatif'] },

  // Diagnostics
  { topic: 'dpe',                   keywords: ['dpe', 'diagnostic performance', 'classe énergie', 'étiquette énergie', 'passoire thermique', 'gel loyer', 'logement décent'] },
  { topic: 'amiante',               keywords: ['amiante', 'diagnostic amiante', 'repérage amiante'] },
  { topic: 'plomb',                 keywords: ['plomb', 'crep', 'constat risque plomb', 'saturnisme'] },
  { topic: 'erp',                   keywords: ['erp', 'risques et pollutions', 'risques naturels', 'inondation', 'plan de prévention'] },

  // Divers
  { topic: 'saisie_immobiliere',    keywords: ['saisie immobilière', 'procédure saisie', 'vente aux enchères', 'folle enchère'] },
  { topic: 'servitude',             keywords: ['servitude', 'servitude de passage', 'droit de passage', 'servitude vue'] },
  { topic: 'mitoyennete',           keywords: ['mitoyen', 'mitoyenneté', 'mur mitoyen', 'clôture mitoyenne'] },
  { topic: 'viager',                keywords: ['viager', 'rente viagère', 'bouquet', 'débirentier', 'crédirentier', 'usufruit'] },
]

export function detectTopic(text: string): string | null {
  const lower = text.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // enlève les accents pour la comparaison
    .replace(/[\u0300-\u036f]/g, '')

  // Normalise aussi les keywords
  for (const { topic, keywords } of TOPIC_KEYWORDS) {
    for (const kw of keywords) {
      const kwNorm = kw.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      if (lower.includes(kwNorm)) {
        return topic
      }
    }
  }

  return null
}
