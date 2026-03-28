/**
 * scripts/index-judilibre-queries.ts
 * Indexation Judilibre à partir d'une liste de requêtes thématiques ciblées
 *
 * Usage :
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/index-judilibre-queries.ts
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/index-judilibre-queries.ts --dry-run
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/index-judilibre-queries.ts --domain baux_habitation
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/index-judilibre-queries.ts --reindex
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/index-judilibre-queries.ts --offset 50
 */

import { createClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args        = process.argv.slice(2)
const TARGET_DOMAIN = args.includes('--domain') ? args[args.indexOf('--domain') + 1] : null
const DRY_RUN       = args.includes('--dry-run')
const REINDEX       = args.includes('--reindex')
const OFFSET        = args.includes('--offset') ? parseInt(args[args.indexOf('--offset') + 1]) : 0
const CONCURRENCY   = 3

console.log(`Config : domain=${TARGET_DOMAIN ?? 'all'} dry-run=${DRY_RUN} reindex=${REINDEX} offset=${OFFSET}`)

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const JUDILIBRE_URL  = 'https://api.piste.gouv.fr/cassation/judilibre/v1.0'
const TOKEN_URL      = 'https://oauth.piste.gouv.fr/api/oauth/token'
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const SUMMARY_MODEL  = 'openai/gpt-4o-mini'

// ---------------------------------------------------------------------------
// Domaines — sous-thèmes disponibles pour la classification LLM
// ---------------------------------------------------------------------------

const DOMAIN_SUBTHEMES: Record<string, string[]> = {
  baux_habitation:    ['loyer', 'irl', 'depot_garantie', 'conge', 'impaye', 'clause_resolutoire', 'expulsion', 'decence', 'vetuste', 'edl', 'treve_hivernale', 'bail_meuble', 'bail_mobilite', 'encadrement_loyers', 'caution', 'sous_location', 'colocation', 'squat', 'discrimination', 'bail_precaire', 'permis_louer'],
  copropriete:        ['ag', 'charges', 'syndic', 'travaux', 'parties_communes', 'reglement', 'tantiemes', 'contestation_ag', 'fonds_travaux', 'accessibilite', 'location_saisonniere_copro'],
  agent_immobilier:   ['mandat', 'commission', 'honoraires', 'devoir_conseil', 'responsabilite', 'carte_t', 'mandat_exclusif', 'double_mandat', 'blanchiment', 'mandat_recherche', 'gestion_locative'],
  vente_immobiliere:  ['compromis', 'promesse', 'condition_suspensive', 'retractation', 'vice_cache', 'vefa', 'garanties', 'dol', 'caducite', 'lesion', 'indivision', 'sci', 'tutelle', 'succession', 'divorce', 'pacte_preference', 'garantie_eviction', 'notaire'],
  diagnostics:        ['dpe', 'amiante', 'plomb', 'termites', 'electricite', 'gaz', 'carrez', 'responsabilite_diagnostiqueur', 'audit_energetique', 'passoire_thermique', 'renovation_energetique'],
  urbanisme:          ['permis_construire', 'plu', 'preemption', 'droit_preference', 'recours_tiers', 'declaration_prealable', 'zan', 'lotissement', 'certificat_urbanisme'],
  construction:       ['decennale', 'biennale', 'parfait_achevement', 'vefa', 'reception', 'reserves', 'ccmi', 'architecte'],
  viager_demembrement:['usufruit', 'nue_propriete', 'rente_viagere', 'bouquet', 'clause_resolutoire_viager', 'reversion', 'demembrement', 'donation'],
  bail_commercial:    ['duree_369', 'renouvellement', 'revision_loyer', 'resiliation', 'droit_au_bail', 'indemnite_eviction', 'despecialisation', 'pas_de_porte', 'charges_travaux'],
  fiscalite:          ['plus_values', 'droits_mutation', 'ifi', 'revenus_fonciers', 'lmnp', 'sci_fiscal', 'tva_immo'],
  servitudes:         ['servitude_passage', 'servitude_vue', 'mitoyennete', 'trouble_voisinage', 'empietement', 'enclave'],
  litiges:            ['prescription', 'refere', 'mediation', 'expertise_judiciaire', 'saisie_immobiliere', 'hypotheque'],
  location_saisonniere: ['declaration_mairie', 'enregistrement', 'changement_usage', 'compensation', 'classement', 'taxe_sejour'],
}

// Alias : les domaines utilisés dans les requêtes → clé dans DOMAIN_SUBTHEMES
const DOMAIN_ALIAS: Record<string, string> = {
  transactions: 'vente_immobiliere',
  viager:       'viager_demembrement',
  construction: 'construction',
}

function resolveDomain(d: string): string {
  return DOMAIN_ALIAS[d] ?? d
}

function getSubThemes(d: string): string[] {
  const resolved = resolveDomain(d)
  return DOMAIN_SUBTHEMES[resolved] ?? ['general']
}

// ---------------------------------------------------------------------------
// Liste des requêtes thématiques
// ---------------------------------------------------------------------------

interface QueryConfig {
  query:      string
  domain:     string
  maxResults: number
}

const SEARCHES: QueryConfig[] = [

  // ═══════════════════════════════════════════════════════════════
  // BAUX D'HABITATION
  // ═══════════════════════════════════════════════════════════════

  { query: 'loyers impayés commandement payer clause résolutoire bail', domain: 'baux_habitation', maxResults: 3 },
  { query: 'expulsion locataire impayés procédure', domain: 'baux_habitation', maxResults: 3 },
  { query: 'clause résolutoire bail habitation acquisition', domain: 'baux_habitation', maxResults: 3 },
  { query: 'délai paiement loyer impayé sursis expulsion', domain: 'baux_habitation', maxResults: 3 },
  { query: 'dépôt garantie retenue vétusté état des lieux', domain: 'baux_habitation', maxResults: 3 },
  { query: 'restitution dépôt garantie délai deux mois pénalité', domain: 'baux_habitation', maxResults: 3 },
  { query: 'dépôt garantie dégradation preuve bailleur locataire', domain: 'baux_habitation', maxResults: 3 },
  { query: 'état des lieux sortie contradictoire opposabilité', domain: 'baux_habitation', maxResults: 3 },
  { query: 'congé bail habitation motif légitime sérieux', domain: 'baux_habitation', maxResults: 3 },
  { query: 'congé pour vente locataire droit préemption', domain: 'baux_habitation', maxResults: 3 },
  { query: 'congé pour reprise personnelle conditions', domain: 'baux_habitation', maxResults: 3 },
  { query: 'congé frauduleux bail nullité relogement', domain: 'baux_habitation', maxResults: 3 },
  { query: 'préavis locataire zone tendue un mois', domain: 'baux_habitation', maxResults: 3 },
  { query: 'logement indécent obligation bailleur mise en conformité', domain: 'baux_habitation', maxResults: 3 },
  { query: 'logement insalubre responsabilité bailleur réduction loyer', domain: 'baux_habitation', maxResults: 3 },
  { query: 'surface habitable minimum logement décent', domain: 'baux_habitation', maxResults: 3 },
  { query: 'révision loyer IRL indice référence annuelle', domain: 'baux_habitation', maxResults: 3 },
  { query: 'encadrement loyers complément loyer contestation', domain: 'baux_habitation', maxResults: 3 },
  { query: 'augmentation loyer renouvellement bail sous-évalué', domain: 'baux_habitation', maxResults: 3 },
  { query: 'sous-location interdite bail habitation nullité', domain: 'baux_habitation', maxResults: 3 },
  { query: 'usage habitation local commercial changement destination', domain: 'baux_habitation', maxResults: 3 },
  { query: 'décès locataire transfert bail conjoint concubin', domain: 'baux_habitation', maxResults: 3 },
  { query: 'abandon logement locataire procédure bailleur', domain: 'baux_habitation', maxResults: 3 },
  { query: 'travaux bailleur accès logement locataire refus', domain: 'baux_habitation', maxResults: 3 },
  { query: 'trouble jouissance locataire réduction loyer indemnisation', domain: 'baux_habitation', maxResults: 3 },
  { query: 'charges récupérables locataire régularisation annuelle', domain: 'baux_habitation', maxResults: 3 },
  { query: 'caution solidaire engagement durée bail', domain: 'baux_habitation', maxResults: 3 },
  { query: 'trêve hivernale expulsion exception squat', domain: 'baux_habitation', maxResults: 3 },
  { query: 'bail meublé durée résiliation préavis inventaire', domain: 'baux_habitation', maxResults: 3 },
  { query: 'location meublée tourisme airbnb copropriété interdiction', domain: 'baux_habitation', maxResults: 3 },
  { query: 'encadrement loyers ALUR zone tendue plafond référence', domain: 'baux_habitation', maxResults: 3 },
  { query: 'bail mobilité ELAN durée conditions résiliation', domain: 'baux_habitation', maxResults: 3 },
  { query: 'discrimination location refus locataire critères illicites', domain: 'baux_habitation', maxResults: 3 },
  { query: 'squat occupation illicite logement expulsion propriétaire', domain: 'baux_habitation', maxResults: 3 },
  { query: 'occupation sans droit ni titre expulsion procédure accélérée', domain: 'baux_habitation', maxResults: 3 },
  { query: 'meublé tourisme autorisation changement usage commune', domain: 'baux_habitation', maxResults: 3 },
  { query: 'numéro enregistrement meublé tourisme obligation', domain: 'baux_habitation', maxResults: 3 },
  { query: 'permis de louer autorisation préalable mise en location', domain: 'baux_habitation', maxResults: 3 },
  { query: 'colocation bail unique solidarité congé individuel', domain: 'baux_habitation', maxResults: 3 },
  { query: 'assurance loyers impayés GLI mise en jeu conditions', domain: 'baux_habitation', maxResults: 3 },

  // ═══════════════════════════════════════════════════════════════
  // AGENT IMMOBILIER
  // ═══════════════════════════════════════════════════════════════

  { query: 'commission agent immobilier mandat registre nullité', domain: 'agent_immobilier', maxResults: 3 },
  { query: 'commission agent immobilier mandat expiré absence', domain: 'agent_immobilier', maxResults: 3 },
  { query: 'commission agent immobilier acheteur défaillant conditions suspensives', domain: 'agent_immobilier', maxResults: 3 },
  { query: 'commission agent immobilier vente réalisée sans intermédiaire', domain: 'agent_immobilier', maxResults: 3 },
  { query: 'commission partage deux agences immobilières primo', domain: 'agent_immobilier', maxResults: 3 },
  { query: 'honoraires agent immobilier charge acquéreur vendeur', domain: 'agent_immobilier', maxResults: 3 },
  { query: 'mandat exclusif rupture période irrévocable dommages', domain: 'agent_immobilier', maxResults: 3 },
  { query: 'mandat exclusif durée reconduction tacite résiliation', domain: 'agent_immobilier', maxResults: 3 },
  { query: 'mandat simple concurrent agent immobilier', domain: 'agent_immobilier', maxResults: 3 },
  { query: 'mentions obligatoires mandat vente loi Hoguet nullité', domain: 'agent_immobilier', maxResults: 3 },
  { query: 'agent immobilier responsabilité devoir conseil information', domain: 'agent_immobilier', maxResults: 3 },
  { query: 'agent immobilier responsabilité vice caché information acquéreur', domain: 'agent_immobilier', maxResults: 3 },
  { query: 'agent immobilier faute négligence dommages intérêts', domain: 'agent_immobilier', maxResults: 3 },
  { query: 'agent immobilier vérification solvabilité acquéreur obligation', domain: 'agent_immobilier', maxResults: 3 },
  { query: 'agent immobilier double mandat conflit intérêts', domain: 'agent_immobilier', maxResults: 3 },
  { query: 'agent immobilier blanchiment tracfin obligation déclaration', domain: 'agent_immobilier', maxResults: 3 },
  { query: 'mandat recherche acquéreur agent immobilier commission', domain: 'agent_immobilier', maxResults: 3 },
  { query: 'mandat gestion locative agent responsabilité bailleur', domain: 'agent_immobilier', maxResults: 3 },
  { query: 'gestion locative agent immobilier faute négligence locataire', domain: 'agent_immobilier', maxResults: 3 },

  // ═══════════════════════════════════════════════════════════════
  // TRANSACTIONS IMMOBILIÈRES
  // ═══════════════════════════════════════════════════════════════

  { query: 'compromis vente promesse synallagmatique exécution forcée', domain: 'transactions', maxResults: 3 },
  { query: 'promesse unilatérale vente levée option délai', domain: 'transactions', maxResults: 3 },
  { query: 'clause de substitution compromis vente cessionnaire', domain: 'transactions', maxResults: 3 },
  { query: 'clause pénale compromis vente réduction judiciaire', domain: 'transactions', maxResults: 3 },
  { query: 'délai rétractation SRU dix jours acquéreur', domain: 'transactions', maxResults: 3 },
  { query: 'rétractation acquéreur compromis notification lettre recommandée', domain: 'transactions', maxResults: 3 },
  { query: 'condition suspensive prêt immobilier bonne foi diligences', domain: 'transactions', maxResults: 3 },
  { query: 'condition suspensive permis construire délai caducité', domain: 'transactions', maxResults: 3 },
  { query: 'condition suspensive défaillance caducité compromis', domain: 'transactions', maxResults: 3 },
  { query: 'refus prêt condition suspensive acquéreur plusieurs banques', domain: 'transactions', maxResults: 3 },
  { query: 'vices cachés vente immobilière vendeur acquéreur', domain: 'transactions', maxResults: 3 },
  { query: 'vices cachés délai action prescription deux ans', domain: 'transactions', maxResults: 3 },
  { query: 'vices cachés vendeur professionnel clause exonération', domain: 'transactions', maxResults: 3 },
  { query: 'vices cachés humidité fissures fondations maison', domain: 'transactions', maxResults: 3 },
  { query: 'dol réticence dolosive vente immobilière vendeur', domain: 'transactions', maxResults: 3 },
  { query: 'erreur substantielle vente immobilière annulation', domain: 'transactions', maxResults: 3 },
  { query: 'caducité compromis non-réitération acte authentique délai', domain: 'transactions', maxResults: 3 },
  { query: 'mise en demeure réitération acte authentique notaire', domain: 'transactions', maxResults: 3 },
  { query: 'lésion vente immobilière prix inférieur sept douzièmes', domain: 'transactions', maxResults: 3 },
  { query: 'obligation information vendeur sinistre antérieur déclaration', domain: 'transactions', maxResults: 3 },
  { query: 'servitude non déclarée vente immobilière acquéreur', domain: 'transactions', maxResults: 3 },
  { query: 'garantie éviction vendeur trouble jouissance acquéreur', domain: 'transactions', maxResults: 3 },
  { query: 'tutelle vente immobilière nullité majeur protégé', domain: 'transactions', maxResults: 3 },
  { query: 'tutelle acte disposition autorisation juge tutelles', domain: 'transactions', maxResults: 3 },
  { query: 'curatelle vente immobilière assistance curateur', domain: 'transactions', maxResults: 3 },
  { query: 'indivision vente bien immobilier unanimité partage', domain: 'transactions', maxResults: 3 },
  { query: 'indivision successorale vente accord indivisaires', domain: 'transactions', maxResults: 3 },
  { query: 'SCI vente bien immobilier autorisation associés gérant', domain: 'transactions', maxResults: 3 },
  { query: 'curatelle renforcée vente immobilière autorisation juge', domain: 'transactions', maxResults: 3 },
  { query: 'juge des tutelles autorisation vente prix immobilier', domain: 'transactions', maxResults: 3 },
  { query: 'sauvegarde justice vente immobilière capacité', domain: 'transactions', maxResults: 3 },
  { query: 'habilitation familiale vente immobilière majeur protégé', domain: 'transactions', maxResults: 3 },
  { query: 'mandat protection future vente immobilière', domain: 'transactions', maxResults: 3 },
  { query: 'nullité acte majeur protégé prescription cinq ans', domain: 'transactions', maxResults: 3 },
  { query: 'divorce vente bien immobilier commun indivision liquidation', domain: 'transactions', maxResults: 3 },
  { query: 'séparation concubins bien immobilier indivis partage', domain: 'transactions', maxResults: 3 },
  { query: 'succession vente bien immobilier héritiers accord unanimité', domain: 'transactions', maxResults: 3 },
  { query: 'succession indivision bien immobilier partage judiciaire', domain: 'transactions', maxResults: 3 },
  { query: 'donation immobilière réserve usufruit révocation', domain: 'transactions', maxResults: 3 },
  { query: 'notaire responsabilité faute devoir conseil vente immobilière', domain: 'transactions', maxResults: 3 },
  { query: 'notaire erreur acte authentique préjudice acquéreur', domain: 'transactions', maxResults: 3 },
  { query: 'hypothèque vente immobilière mainlevée purge', domain: 'transactions', maxResults: 3 },
  { query: 'pacte préférence vente immobilière violation substitution', domain: 'transactions', maxResults: 3 },
  { query: 'vendeur refuse signer acte authentique exécution forcée', domain: 'transactions', maxResults: 3 },

  // ═══════════════════════════════════════════════════════════════
  // COPROPRIÉTÉ
  // ═══════════════════════════════════════════════════════════════

  { query: 'assemblée générale copropriété convocation délai nullité', domain: 'copropriete', maxResults: 3 },
  { query: 'assemblée générale copropriété contestation décision deux mois', domain: 'copropriete', maxResults: 3 },
  { query: 'assemblée générale majorité article 25 passerelle article 25-1', domain: 'copropriete', maxResults: 3 },
  { query: 'assemblée générale copropriété vote par correspondance', domain: 'copropriete', maxResults: 3 },
  { query: 'syndic copropriété contrat révocation mise en concurrence', domain: 'copropriete', maxResults: 3 },
  { query: 'syndic copropriété responsabilité faute gestion', domain: 'copropriete', maxResults: 3 },
  { query: 'syndic bénévole copropriété responsabilité obligations', domain: 'copropriete', maxResults: 3 },
  { query: 'syndic travaux urgence copropriété sans vote assemblée', domain: 'copropriete', maxResults: 3 },
  { query: 'charges copropriété impayés recouvrement privilège', domain: 'copropriete', maxResults: 3 },
  { query: 'charges copropriété répartition tantièmes contestation', domain: 'copropriete', maxResults: 3 },
  { query: 'charges copropriété vendeur acquéreur mutation prorata', domain: 'copropriete', maxResults: 3 },
  { query: 'travaux parties communes copropriété majorité vote', domain: 'copropriete', maxResults: 3 },
  { query: 'travaux privatifs copropriété autorisation assemblée', domain: 'copropriete', maxResults: 3 },
  { query: 'parties communes spéciales copropriété jouissance privative', domain: 'copropriete', maxResults: 3 },
  { query: 'règlement copropriété clause habitation bourgeoise Airbnb', domain: 'copropriete', maxResults: 3 },
  { query: 'modification règlement copropriété unanimité majorité', domain: 'copropriete', maxResults: 3 },
  { query: 'fonds travaux copropriété cotisation obligation ALUR', domain: 'copropriete', maxResults: 3 },
  { query: 'location saisonnière copropriété règlement interdiction', domain: 'copropriete', maxResults: 3 },
  { query: 'accessibilité handicap copropriété travaux obligation', domain: 'copropriete', maxResults: 3 },
  { query: 'assurance propriétaire non occupant PNO obligation copropriété', domain: 'copropriete', maxResults: 3 },
  { query: 'copropriété dégradée administrateur provisoire plan sauvegarde', domain: 'copropriete', maxResults: 3 },

  // ═══════════════════════════════════════════════════════════════
  // DIAGNOSTICS IMMOBILIERS
  // ═══════════════════════════════════════════════════════════════

  { query: 'diagnostic immobilier DPE erroné responsabilité diagnostiqueur', domain: 'diagnostics', maxResults: 3 },
  { query: 'DPE opposable acquéreur recours erreur significative', domain: 'diagnostics', maxResults: 3 },
  { query: 'diagnostic amiante vente obligation vendeur', domain: 'diagnostics', maxResults: 3 },
  { query: 'diagnostic plomb CREP location obligation bailleur', domain: 'diagnostics', maxResults: 3 },
  { query: 'diagnostic erroné préjudice acquéreur indemnisation', domain: 'diagnostics', maxResults: 3 },
  { query: 'absence diagnostic vente immobilière sanction', domain: 'diagnostics', maxResults: 3 },
  { query: 'mesurage loi Carrez erreur superficie tolérance', domain: 'diagnostics', maxResults: 3 },
  { query: 'passoire thermique interdiction location DPE classe F G', domain: 'diagnostics', maxResults: 3 },
  { query: 'passoire énergétique climat résilience interdiction location', domain: 'diagnostics', maxResults: 3 },
  { query: 'rénovation énergétique obligation propriétaire bailleur', domain: 'diagnostics', maxResults: 3 },
  { query: 'audit énergétique obligatoire vente maison DPE F G', domain: 'diagnostics', maxResults: 3 },
  { query: 'rénovation énergétique obligation bailleur échéances 2025 2028', domain: 'diagnostics', maxResults: 3 },

  // ═══════════════════════════════════════════════════════════════
  // URBANISME
  // ═══════════════════════════════════════════════════════════════

  { query: 'préemption urbaine prix juge expropriation vendeur', domain: 'urbanisme', maxResults: 3 },
  { query: 'préemption urbaine annulation illégalité motivation', domain: 'urbanisme', maxResults: 3 },
  { query: 'permis construire recours tiers délai annulation', domain: 'urbanisme', maxResults: 3 },
  { query: 'permis construire refus contestation tribunal administratif', domain: 'urbanisme', maxResults: 3 },
  { query: 'certificat urbanisme engagement commune constructibilité', domain: 'urbanisme', maxResults: 3 },
  { query: 'déclaration préalable travaux opposition mairie', domain: 'urbanisme', maxResults: 3 },
  { query: 'division parcellaire lotissement autorisation urbanisme', domain: 'urbanisme', maxResults: 3 },
  { query: 'zéro artificialisation nette ZAN permis construire', domain: 'urbanisme', maxResults: 3 },

  // ═══════════════════════════════════════════════════════════════
  // CONSTRUCTION
  // ═══════════════════════════════════════════════════════════════

  { query: 'garantie décennale constructeur fissures infiltrations', domain: 'construction', maxResults: 3 },
  { query: 'garantie biennale équipement défaillant chaudière', domain: 'construction', maxResults: 3 },
  { query: 'parfait achèvement réserves réception travaux', domain: 'construction', maxResults: 3 },
  { query: 'VEFA retard livraison pénalités acquéreur', domain: 'construction', maxResults: 3 },
  { query: 'VEFA défauts conformité réception réserves', domain: 'construction', maxResults: 3 },
  { query: 'maître ouvrage responsabilité architecte constructeur', domain: 'construction', maxResults: 3 },
  { query: 'contrat construction maison individuelle CCMI garantie livraison', domain: 'construction', maxResults: 3 },

  // ═══════════════════════════════════════════════════════════════
  // VIAGER ET DÉMEMBREMENT
  // ═══════════════════════════════════════════════════════════════

  { query: 'viager résolution vente défaut paiement rente', domain: 'viager', maxResults: 3 },
  { query: 'viager décès rapproché vendeur nullité', domain: 'viager', maxResults: 3 },
  { query: 'usufruit location bail nu-propriétaire accord', domain: 'viager', maxResults: 3 },
  { query: 'démembrement propriété travaux réparations usufruitier', domain: 'viager', maxResults: 3 },
  { query: 'usufruit vente bien accord nu-propriétaire usufruitier', domain: 'viager', maxResults: 3 },

  // ═══════════════════════════════════════════════════════════════
  // BAIL COMMERCIAL
  // ═══════════════════════════════════════════════════════════════

  { query: 'bail commercial renouvellement refus indemnité éviction', domain: 'bail_commercial', maxResults: 3 },
  { query: 'bail commercial résiliation anticipée clause résolutoire', domain: 'bail_commercial', maxResults: 3 },
  { query: 'bail commercial révision loyer triennale plafonnement', domain: 'bail_commercial', maxResults: 3 },
  { query: 'bail commercial cession droit au bail cessionnaire', domain: 'bail_commercial', maxResults: 3 },
  { query: 'bail commercial déspécialisation activité locataire', domain: 'bail_commercial', maxResults: 3 },
  { query: 'pas-de-porte droit entrée bail commercial qualification', domain: 'bail_commercial', maxResults: 3 },
  { query: 'bail commercial charges travaux répartition bailleur', domain: 'bail_commercial', maxResults: 3 },

  // ═══════════════════════════════════════════════════════════════
  // SERVITUDES ET VOISINAGE
  // ═══════════════════════════════════════════════════════════════

  { query: 'servitude passage enclave désenclavement', domain: 'servitudes', maxResults: 3 },
  { query: 'servitude vue distance fenêtre mur voisin', domain: 'servitudes', maxResults: 3 },
  { query: 'mitoyenneté mur clôture acquisition forcée', domain: 'servitudes', maxResults: 3 },
  { query: 'trouble anormal voisinage bruit nuisance indemnisation', domain: 'servitudes', maxResults: 3 },
  { query: 'empiétement construction terrain voisin démolition', domain: 'servitudes', maxResults: 3 },

  // ═══════════════════════════════════════════════════════════════
  // FISCALITÉ IMMOBILIÈRE
  // ═══════════════════════════════════════════════════════════════

  { query: 'plus-value immobilière exonération résidence principale', domain: 'fiscalite', maxResults: 3 },
  { query: 'plus-value immobilière abattement durée détention', domain: 'fiscalite', maxResults: 3 },
  { query: 'SCI fiscalité imposition revenus fonciers associés', domain: 'fiscalite', maxResults: 3 },
  { query: 'droits mutation acquisition immobilière taux', domain: 'fiscalite', maxResults: 3 },

  // ═══════════════════════════════════════════════════════════════
  // LITIGES ET PROCÉDURE
  // ═══════════════════════════════════════════════════════════════

  { query: 'prescription action immobilière cinq ans droit commun', domain: 'litiges', maxResults: 3 },
  { query: 'référé immobilier urgence trouble manifestement illicite', domain: 'litiges', maxResults: 3 },
  { query: 'médiation immobilière obligatoire préalable tribunal', domain: 'litiges', maxResults: 3 },
  { query: 'expertise judiciaire immobilier désignation expert', domain: 'litiges', maxResults: 3 },
  { query: 'saisie immobilière procédure débiteur vente forcée', domain: 'litiges', maxResults: 3 },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  baseDelay = 1000,
  label = ''
): Promise<T | null> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (err: any) {
      if (attempt === retries) {
        console.error(`  [RETRY EXHAUSTED] ${label} — ${err.message}`)
        return null
      }
      const delay = baseDelay * Math.pow(2, attempt - 1)
      console.warn(`  [RETRY ${attempt}/${retries}] ${label} — attente ${delay}ms`)
      await sleep(delay)
    }
  }
  return null
}

function createSemaphore(limit: number) {
  let active = 0
  const queue: Array<() => void> = []
  return async function acquire(): Promise<() => void> {
    if (active < limit) {
      active++
      return () => { active--; queue.shift()?.() }
    }
    await new Promise<void>(resolve => queue.push(resolve))
    active++
    return () => { active--; queue.shift()?.() }
  }
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

let _token: string | null = null
let _tokenExpiry = 0

async function getToken(): Promise<string> {
  if (_token && Date.now() < _tokenExpiry) return _token
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     process.env.PISTE_CLIENT_ID!,
      client_secret: process.env.PISTE_CLIENT_SECRET!,
      scope:         'openid',
    }),
  })
  if (!res.ok) throw new Error(`Token OAuth échoué : ${res.status}`)
  const data = await res.json() as { access_token: string; expires_in: number }
  _token = data.access_token
  _tokenExpiry = Date.now() + (data.expires_in - 60) * 1000
  return _token
}

// ---------------------------------------------------------------------------
// Judilibre — search
// ---------------------------------------------------------------------------

async function searchJudilibre(token: string, query: string, maxResults: number): Promise<any[]> {
  const pageSize = Math.min(maxResults, 10)
  const results: any[] = []

  // CC en premier (arrêts de principe)
  const paramsCC = new URLSearchParams({
    query,
    page_size:         String(pageSize),
    page_number:       '1',
    operator:          'or',
    sort:              'scorepub',
    resolve_references: 'false',
  })
  paramsCC.append('publication', 'b')
  paramsCC.append('publication', 'r')
  paramsCC.append('field', 'summary')
  paramsCC.append('field', 'motivations')
  paramsCC.append('type', 'arret')

  const resCC = await fetch(`${JUDILIBRE_URL}/search?${paramsCC}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (resCC.ok) {
    const data = await resCC.json() as { results?: any[] }
    for (const r of (data.results ?? [])) results.push({ ...r, _court: 'cc' })
  }

  // CA si on n'a pas encore assez
  if (results.length < maxResults) {
    const paramsCA = new URLSearchParams({
      query,
      jurisdiction:      'ca',
      operator:          'and',
      page_size:         String(pageSize),
      page_number:       '1',
      sort:              'score',
      resolve_references: 'false',
    })
    paramsCA.append('field', 'summary')
    paramsCA.append('field', 'motivations')

    const resCA = await fetch(`${JUDILIBRE_URL}/search?${paramsCA}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (resCA.ok) {
      const data = await resCA.json() as { results?: any[] }
      for (const r of (data.results ?? [])) results.push({ ...r, _court: 'ca' })
    }
  }

  return results.slice(0, maxResults)
}

// ---------------------------------------------------------------------------
// Judilibre — décision complète
// ---------------------------------------------------------------------------

async function getDecision(token: string, id: string): Promise<any | null> {
  return withRetry(async () => {
    const res = await fetch(
      `${JUDILIBRE_URL}/decision?id=${encodeURIComponent(id)}&resolve_references=true`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!res.ok) throw new Error(`/decision ${id} → HTTP ${res.status}`)
    return res.json()
  }, 3, 800, `getDecision(${id})`)
}

// ---------------------------------------------------------------------------
// Extraction texte intégral
// ---------------------------------------------------------------------------

function extractFullText(decision: any, highlightFallback: string): { text: string; visaRefs: string[] } {
  const zones   = decision?.zones ?? {}
  const rawText = decision?.text ?? ''
  const zoneOrder = ['introduction', 'expose', 'expose_litige', 'moyens', 'motivations', 'dispositif', 'texte', 'resume']
  const parts: string[] = []

  for (const zoneName of zoneOrder) {
    const zone = zones[zoneName]
    if (!zone) continue
    const entries = Array.isArray(zone) ? zone : [zone]
    for (const entry of entries) {
      const directText = entry?.texte ?? entry?.text ?? (typeof entry === 'string' ? entry : null)
      if (directText && directText.length > 20) { parts.push(directText.trim()); continue }
      if (typeof entry?.start === 'number' && typeof entry?.end === 'number' && rawText) {
        const slice = rawText.slice(entry.start, entry.end).trim()
        if (slice.length > 20) parts.push(slice)
      }
    }
  }

  if (parts.length === 0) {
    const ts = decision?.titlesAndSummaries
    if (ts) {
      const summaryText = [ts.introduction, ts.decision].filter(Boolean).join('\n')
      if (summaryText.length > 50) parts.push(summaryText)
    }
  }

  if (parts.length === 0 && rawText.length > 100) {
    const annexeStart = zones.annexes?.[0]?.start ?? rawText.length
    parts.push(rawText.slice(0, Math.min(annexeStart, 6000)).trim())
  }

  const fullText = parts.join('\n\n').trim() || highlightFallback

  const visaRefs: string[] = []
  if (Array.isArray(decision?.visa)) {
    for (const v of decision.visa) {
      const ref = [v.titre ?? v.code ?? '', v.article ?? v.num ?? ''].filter(Boolean).join(' art. ').trim()
      if (ref && ref.length > 3) visaRefs.push(ref)
    }
  }
  if (Array.isArray(zones.visa)) {
    for (const entry of zones.visa) {
      const text = entry?.texte ?? entry?.text ?? ''
      if (text && text.length > 3 && !visaRefs.includes(text)) visaRefs.push(text.trim())
    }
  }

  return { text: fullText, visaRefs: [...new Set(visaRefs)] }
}

// ---------------------------------------------------------------------------
// LLM — résumé expert
// ---------------------------------------------------------------------------

interface LLMSummary {
  situation:   string
  principe:    string
  consequence: string
  sub_themes:  string[]
}

const SYSTEM_PROMPT = `Tu es un juriste expert en droit immobilier français.
Tu analyses des décisions de justice pour produire des fiches synthétiques destinées aux agents immobiliers.
Tes fiches sont précises juridiquement, accessibles et immédiatement actionnables.`

async function summarizeWithLLM(text: string, domainId: string): Promise<LLMSummary | null> {
  const subThemes = getSubThemes(domainId)
  const userPrompt = `Analyse cette décision de justice et réponds UNIQUEMENT avec un JSON valide, sans aucun texte avant ou après :

{
  "situation": "Contexte factuel en 2-3 phrases : les parties, les faits essentiels et le litige. Précis mais sans jargon inutile.",
  "principe": "La règle de droit posée ou confirmée par cette décision, en 1-2 phrases. Mentionner l'article de loi si cité. Formulation rigoureuse.",
  "consequence": "Ce que l'agent immobilier doit retenir et faire en pratique. Formulé en mode conseil direct, actionnable, 2-3 phrases.",
  "sub_themes": ["choisir 1 à 3 valeurs parmi : ${subThemes.join(', ')}"]
}

DÉCISION :
${text.slice(0, 6000)}`

  return withRetry(async () => {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer':  'https://nestenn.com',
        'X-Title':       'Nestenn Juridique - Indexation',
      },
      body: JSON.stringify({
        model:           SUMMARY_MODEL,
        messages:        [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user',   content: userPrompt },
        ],
        max_tokens:      600,
        temperature:     0.1,
        response_format: { type: 'json_object' },
      }),
    })
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`OpenRouter ${res.status}: ${err.slice(0, 200)}`)
    }
    const data    = await res.json()
    const content = data?.choices?.[0]?.message?.content
    if (!content) throw new Error('Réponse OpenRouter vide')
    const parsed  = JSON.parse(content) as LLMSummary
    if (!parsed.situation   || parsed.situation.length   < 20) throw new Error('situation trop courte')
    if (!parsed.principe    || parsed.principe.length    < 20) throw new Error('principe trop court')
    if (!parsed.consequence || parsed.consequence.length < 20) throw new Error('consequence trop courte')
    const validThemes = new Set(subThemes)
    parsed.sub_themes = (parsed.sub_themes ?? []).filter((t: string) => validThemes.has(t))
    if (parsed.sub_themes.length === 0) parsed.sub_themes = [subThemes[0]]
    return parsed
  }, 3, 1500, 'summarizeWithLLM')
}

// ---------------------------------------------------------------------------
// Embedding Nomic
// ---------------------------------------------------------------------------

async function embedWithNomic(text: string): Promise<number[] | null> {
  return withRetry(async () => {
    const res = await fetch('https://api-atlas.nomic.ai/v1/embedding/text', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${process.env.NOMIC_API_KEY}`,
      },
      body: JSON.stringify({ model: 'nomic-embed-text-v1.5', texts: [text] }),
    })
    if (!res.ok) throw new Error(`Nomic API embed HTTP ${res.status}`)
    const data = await res.json() as { embeddings: number[][] }
    if (!data.embeddings?.[0]?.length) throw new Error('Embedding vide')
    return data.embeddings[0]
  }, 3, 500, 'embedWithNomic')
}

// ---------------------------------------------------------------------------
// Supabase — upsert
// ---------------------------------------------------------------------------

async function upsertDecision(record: {
  source_id:       string
  court:           'cc' | 'ca'
  chamber:         string | null
  date:            string | null
  number:          string | null
  solution:        string | null
  situation:       string
  principle:       string
  consequence:     string
  visa_refs:       string[]
  domain:          string
  sub_themes:      string[]
  url:             string | null
  motivations_raw: string | null
  embedding:       number[]
}) {
  if (DRY_RUN) return { error: null }
  const { error } = await supabase
    .from('jurisprudence')
    .upsert(record, { onConflict: 'source_id' })
  return { error }
}

// ---------------------------------------------------------------------------
// Pipeline — traitement d'un résultat
// ---------------------------------------------------------------------------

const globalStats = { indexed: 0, skipped: 0, errors: 0 }
const seenIds     = new Set<string>()   // déduplication cross-requêtes

async function processResult(
  token:  string,
  result: any,
  domainId: string,
  court:  'cc' | 'ca',
): Promise<void> {
  const sourceId = result.id
  if (!sourceId) { globalStats.skipped++; return }

  // Déduplication cross-requêtes (dans la même session)
  if (seenIds.has(sourceId)) { globalStats.skipped++; return }
  seenIds.add(sourceId)

  // Skip si déjà en base (sauf --reindex)
  if (!REINDEX && !DRY_RUN) {
    const { data: existing } = await supabase
      .from('jurisprudence')
      .select('id')
      .eq('source_id', sourceId)
      .single()
    if (existing) { globalStats.skipped++; return }
  }

  const highlightFallback = (result.highlights?.motivations ?? [])
    .map((h: string) => h.replace(/<\/?em>/g, ''))
    .join(' ')
    .trim()

  const decision = await getDecision(token, sourceId)
  let fullText: string
  let visaRefs: string[]
  let motivationsRaw: string | null = null

  if (decision) {
    const extracted = extractFullText(decision, highlightFallback)
    fullText = extracted.text
    visaRefs = extracted.visaRefs
    const motivParts = (decision?.zones?.motivations ?? [])
      .map((z: any) => z?.texte ?? z?.text ?? '')
      .filter(Boolean)
      .join('\n')
    motivationsRaw = motivParts || null
  } else {
    fullText = highlightFallback
    visaRefs = []
  }

  if (!fullText || fullText.length < 50) {
    globalStats.skipped++
    return
  }

  const resolvedDomain = resolveDomain(domainId)
  const summary = await summarizeWithLLM(fullText, domainId)
  if (!summary) { globalStats.skipped++; return }

  const embeddingText = `${summary.situation} ${summary.principe} ${summary.consequence}`
  const embedding = await embedWithNomic(embeddingText)
  if (!embedding) { globalStats.skipped++; return }

  const url = court === 'cc'
    ? `https://www.courdecassation.fr/decision/${sourceId}`
    : (decision?.portalis ? `https://www.courdappel.fr/${decision.portalis}` : null)

  const { error } = await upsertDecision({
    source_id:       sourceId,
    court,
    chamber:         result.chamber ?? decision?.chamber ?? null,
    date:            result.decision_date ?? result.date ?? null,
    number:          result.number ?? null,
    solution:        result.solution ?? null,
    situation:       summary.situation,
    principle:       summary.principe,
    consequence:     summary.consequence,
    visa_refs:       visaRefs,
    domain:          resolvedDomain,
    sub_themes:      summary.sub_themes,
    url,
    motivations_raw: motivationsRaw,
    embedding,
  })

  if (error) {
    console.log(`  [ERROR] ${sourceId} — ${error.message}`)
    globalStats.errors++
  } else {
    globalStats.indexed++
    if (globalStats.indexed <= 3) {
      console.log(`\n  [EXEMPLE] ${result.number ?? sourceId} (${court.toUpperCase()}, ${result.decision_date ?? '?'})`)
      console.log(`    Situation  : ${summary.situation}`)
      console.log(`    Principe   : ${summary.principe}`)
      console.log(`    Consequence: ${summary.consequence}`)
      console.log(`    Sub-themes : ${summary.sub_themes.join(', ')}`)
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  let queries = SEARCHES
  if (TARGET_DOMAIN) {
    queries = queries.filter(q => q.domain === TARGET_DOMAIN || resolveDomain(q.domain) === TARGET_DOMAIN)
    if (!queries.length) {
      console.error(`Aucune requête pour le domaine "${TARGET_DOMAIN}"`)
      process.exit(1)
    }
  }
  if (OFFSET > 0) {
    console.log(`Offset ${OFFSET} : démarrage à la requête #${OFFSET + 1}`)
    queries = queries.slice(OFFSET)
  }

  console.log(`\nIndexation Judilibre (requêtes ciblées) — ${queries.length} requêtes`)
  if (DRY_RUN) console.log('MODE DRY-RUN — aucune écriture Supabase')
  if (REINDEX)  console.log('MODE REINDEX — re-traitement des arrêts existants')

  const token = await getToken()
  const sem   = createSemaphore(CONCURRENCY)
  const startTime = Date.now()

  for (let i = 0; i < queries.length; i++) {
    const { query, domain, maxResults } = queries[i]
    const queryNum = OFFSET + i + 1
    process.stdout.write(`[${queryNum}/${OFFSET + queries.length}] ${domain} — "${query.slice(0, 60)}"... `)

    const results = await withRetry(
      () => searchJudilibre(token, query, maxResults),
      3, 800, `search "${query.slice(0, 40)}"`
    ) ?? []

    process.stdout.write(`${results.length} résultats\n`)

    const jobs = results.map(r => async () => {
      const release = await sem()
      try { await processResult(token, r, domain, r._court as 'cc' | 'ca') }
      finally { release() }
    })
    await Promise.all(jobs.map(j => j()))

    // Throttle léger entre requêtes
    await sleep(200)
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000)
  console.log(`\n${'='.repeat(60)}`)
  console.log(`TERMINÉ — ${globalStats.indexed} indexés | ${globalStats.skipped} skippés | ${globalStats.errors} erreurs`)
  console.log(`Durée : ${elapsed}s | Décisions uniques vues : ${seenIds.size}`)
  console.log('='.repeat(60))
}

main().catch(err => {
  console.error('Erreur fatale :', err)
  process.exit(1)
})
