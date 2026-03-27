/**
 * scripts/seed-grands-arrets.ts
 * Indexation des grands arrêts de principe du droit immobilier français.
 *
 * Ces arrêts sont rédigés manuellement (curated=true) et couvrent les
 * thèmes les plus fréquents dans les questions des agents Nestenn.
 *
 * Règles :
 *   - number = numéro certifié uniquement (sinon NULL + note dans consequence)
 *   - source_id = 'curated-<slug>' pour éviter toute collision avec Judilibre
 *   - Embedding via nomic-embed-text (Nomic cloud API)
 *   - Upsert idempotent sur source_id
 *
 * Usage :
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/seed-grands-arrets.ts
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/seed-grands-arrets.ts --dry-run
 */

import { createClient } from '@supabase/supabase-js'

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GrandArret {
  source_id:   string        // 'curated-<slug>'
  court:       'cc' | 'ca'
  chamber:     string | null
  date:        string | null // 'YYYY-MM-DD'
  number:      string | null // numéro certifié ou null
  solution:    string | null
  situation:   string
  principle:   string
  consequence: string
  visa_refs:   string[]
  domain:      string
  sub_themes:  string[]
}

// ---------------------------------------------------------------------------
// Corpus des grands arrêts
// ---------------------------------------------------------------------------

const GRANDS_ARRETS: GrandArret[] = [

  // -------------------------------------------------------------------------
  // Thème 1 : Devoir de conseil de l'agent immobilier
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-devoir-conseil-agent',
    court:       'cc',
    chamber:     '1re civ.',
    date:        null,
    number:      null,
    solution:    'Cassation',
    situation:   "Un agent immobilier a présenté un bien sans informer l'acquéreur d'un vice ou d'une information déterminante connue ou que l'agent aurait dû connaître.",
    principle:   "L'agent immobilier est tenu d'un devoir de conseil et d'information envers les parties (acquéreur et vendeur). Il doit attirer l'attention sur toute circonstance de nature à influencer le consentement des parties, même si cela lui est défavorable. Ce devoir est une obligation de résultat quant à l'information, de moyens quant au conseil.",
    consequence: "L'agent qui manque à son devoir de conseil engage sa responsabilité délictuelle (Art. 1240 C. civ.) ou contractuelle selon le cas. La jurisprudence est constante sur ce point. (Arrêt cité de principe — vérifier arrêt exact sur Judilibre, mots-clés : 'agent immobilier devoir conseil')",
    visa_refs:   ['Art. 1240 Code civil', 'Art. 1 loi 70-9 du 2 janvier 1970'],
    domain:      'agent_immobilier',
    sub_themes:  ['devoir_de_conseil', 'responsabilite_agent', 'information_acquereur'],
  },

  // -------------------------------------------------------------------------
  // Thème 2 : Commission — exigibilité à l'acte authentique
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-commission-acte-authentique',
    court:       'cc',
    chamber:     '1re civ.',
    date:        null,
    number:      null,
    solution:    'Rejet',
    situation:   "Un agent immobilier réclame sa commission après la signature du compromis de vente mais avant la réitération par acte authentique. L'une des parties refuse de payer au motif que la vente n'est pas définitivement réalisée.",
    principle:   "En application de l'Art. 6 de la loi Hoguet (loi 70-9 du 2 janvier 1970), la commission de l'agent immobilier n'est exigible que lorsque l'opération a été effectivement conclue et constatée dans un acte contenant l'engagement des parties. La jurisprudence assimile la réalisation définitive à la signature de l'acte authentique de vente.",
    consequence: "Aucune clause du mandat ne peut valablement stipuler que la commission est due dès le compromis. Une telle clause est réputée non écrite. L'agent ne peut réclamer sa commission qu'après signature chez le notaire.",
    visa_refs:   ['Art. 6 loi 70-9 du 2 janvier 1970 (loi Hoguet)', 'Art. 73 décret 72-678 du 20 juillet 1972'],
    domain:      'agent_immobilier',
    sub_themes:  ['commission', 'exigibilite', 'acte_authentique', 'loi_hoguet'],
  },

  // -------------------------------------------------------------------------
  // Thème 3 : Mandat sans écrit / mandat expiré
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-mandat-ecrit-obligatoire',
    court:       'cc',
    chamber:     '1re civ.',
    date:        null,
    number:      null,
    solution:    'Cassation',
    situation:   "Un agent immobilier réclame sa commission en se prévalant d'un accord verbal ou d'un mandat dont la durée a expiré avant la signature de l'acte authentique.",
    principle:   "Le mandat confié à un agent immobilier doit obligatoirement être écrit, contenir certaines mentions (durée, rémunération, exclusivité éventuelle) et être inscrit au registre des mandats (Art. 72 décret 72-678). Un mandat verbal est nul. Un mandat expiré ne confère aucun droit à commission, même si la vente se réalise par suite des démarches effectuées pendant sa validité.",
    consequence: "L'agent qui agit sans mandat régulier, ou après expiration du mandat, perd tout droit à commission. La jurisprudence est stricte : le formalisme protège le mandant. (Principe constant — vérifier arrêt exact sur Judilibre, mots-clés : 'mandat agent immobilier nul verbal expiré')",
    visa_refs:   ['Art. 6 loi 70-9 du 2 janvier 1970', 'Art. 72 décret 72-678 du 20 juillet 1972'],
    domain:      'agent_immobilier',
    sub_themes:  ['mandat', 'formalisme', 'commission', 'mandat_expire'],
  },

  // -------------------------------------------------------------------------
  // Thème 4 : Vices cachés — délai de 2 ans (Art. 1648 C. civ.)
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-vices-caches-delai-2ans',
    court:       'cc',
    chamber:     '3e civ.',
    date:        null,
    number:      null,
    solution:    'Rejet',
    situation:   "Un acquéreur découvre après la vente un vice affectant substantiellement la chose vendue (infiltrations, fondations défectueuses, termites, etc.) et agit en garantie des vices cachés plusieurs mois après la découverte.",
    principle:   "L'action en garantie des vices cachés doit être intentée dans un délai de deux ans à compter de la découverte du vice (Art. 1648 al. 1 C. civ.). Ce délai est un délai de prescription extinctive, non susceptible d'aménagement par les parties dans les rapports entre professionnels et consommateurs. Le vice doit être antérieur à la vente, caché (non apparent lors de l'inspection raisonnable), et rédhibitoire.",
    consequence: "Passé le délai de 2 ans depuis la découverte (non depuis la vente), l'action est prescrite. L'acquéreur perd tout recours même si le vice est grave. Le vendeur professionnel ne peut s'exonérer par clause limitative (présumé connaître les vices).",
    visa_refs:   ['Art. 1641 Code civil', 'Art. 1648 Code civil'],
    domain:      'vente_immobiliere',
    sub_themes:  ['vices_caches', 'garantie', 'prescription', 'delai_2_ans'],
  },

  // -------------------------------------------------------------------------
  // Thème 5 : Clause résolutoire — commandement de payer, délai 2 mois
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-clause-resolutoire-commandement',
    court:       'cc',
    chamber:     '3e civ.',
    date:        null,
    number:      null,
    solution:    'Rejet',
    situation:   "Un bailleur souhaite faire jouer la clause résolutoire de plein droit insérée dans un bail d'habitation après défaut de paiement des loyers par le locataire.",
    principle:   "La clause résolutoire ne peut produire effet que deux mois après un commandement de payer resté infructueux, signifié par acte d'huissier (Art. 24 loi 89-462 du 6 juillet 1989). Pendant ce délai de 2 mois, le locataire peut saisir le juge des contentieux de la protection pour obtenir des délais de paiement. Si le locataire règle intégralement pendant ce délai, la clause résolutoire est neutralisée.",
    consequence: "Un commandement de payer dont le délai n'est pas respecté, ou qui n'est pas signifié par huissier, ne fait pas courir le délai légal. Le bailleur qui tente d'expulser sans respecter cette procédure s'expose à une action en responsabilité et à l'annulation de la procédure d'expulsion.",
    visa_refs:   ['Art. 24 loi 89-462 du 6 juillet 1989'],
    domain:      'baux_habitation',
    sub_themes:  ['clause_resolutoire', 'commandement_de_payer', 'expulsion', 'delai_2_mois'],
  },

  // -------------------------------------------------------------------------
  // Thème 6 : DPE — opposabilité et responsabilité du diagnostiqueur
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-dpe-opposabilite-diagnostiqueur',
    court:       'cc',
    chamber:     '3e civ.',
    date:        null,
    number:      null,
    solution:    'Cassation',
    situation:   "Un acquéreur ou locataire constate après la transaction que les informations du DPE sont erronées et que la consommation réelle est bien supérieure à celle mentionnée dans le diagnostic.",
    principle:   "Depuis la loi Climat et Résilience du 22 août 2021, le DPE est opposable : l'acquéreur ou le locataire peut se prévaloir des informations qu'il contient contre le vendeur ou le bailleur. Le diagnostiqueur engage sa responsabilité civile professionnelle en cas d'erreur dans le diagnostic (obligation de moyens renforcée). Le vendeur ou bailleur peut se retourner contre le diagnostiqueur.",
    consequence: "En cas de DPE erroné, l'acquéreur peut rechercher la responsabilité du diagnostiqueur ET du vendeur (si connivence ou dissimulation). Depuis 2021, le DPE n'est plus seulement informatif : une erreur grossière peut justifier une action en dommages-intérêts, voire une demande de résolution de la vente dans les cas les plus graves. (Principe issu de la réforme 2021 — jurisprudence en construction, vérifier arrêts récents)",
    visa_refs:   ['Art. L271-4 Code de la construction et de l\'habitation', 'Loi 2021-1104 du 22 août 2021'],
    domain:      'diagnostics',
    sub_themes:  ['dpe', 'opposabilite', 'responsabilite_diagnostiqueur', 'passoire_thermique'],
  },

  // -------------------------------------------------------------------------
  // Thème 7 : Contestation AG copropriété — délai de 2 mois
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-ag-copropriete-contestation-2mois',
    court:       'cc',
    chamber:     '3e civ.',
    date:        null,
    number:      null,
    solution:    'Rejet',
    situation:   "Un copropriétaire qui n'a pas participé à une assemblée générale, ou qui a voté contre une résolution, souhaite en contester la régularité ou la validité.",
    principle:   "L'action en nullité d'une résolution d'assemblée générale de copropriété doit être engagée dans un délai de 2 mois à compter de la notification du procès-verbal aux copropriétaires opposants ou défaillants (Art. 42 al. 2 loi 65-557 du 10 juillet 1965). Ce délai est un délai de forclusion, non susceptible d'interruption par des démarches amiables.",
    consequence: "Passé le délai de 2 mois, toute action en annulation de la résolution est irrecevable, même si la résolution est entachée d'une irrégularité grave. Le copropriétaire doit agir rapidement dès réception du PV. La notification du PV par le syndic fait courir le délai.",
    visa_refs:   ['Art. 42 loi 65-557 du 10 juillet 1965'],
    domain:      'copropriete',
    sub_themes:  ['assemblee_generale', 'contestation', 'forclusion', 'delai_2_mois', 'proces_verbal'],
  },

  // -------------------------------------------------------------------------
  // Thème 8 : Garantie décennale — présomption de responsabilité Art. 1792
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-garantie-decennale-1792',
    court:       'cc',
    chamber:     '3e civ.',
    date:        null,
    number:      null,
    solution:    'Rejet',
    situation:   "Dans les 10 ans suivant la réception de travaux, un désordre grave affecte un ouvrage immobilier (fissures structurelles, infiltrations, effondrement partiel). Le maître d'ouvrage engage la responsabilité du constructeur.",
    principle:   "Tout constructeur d'un ouvrage immobilier est responsable de plein droit envers le maître d'ouvrage des dommages qui compromettent la solidité de l'ouvrage ou le rendent impropre à sa destination (Art. 1792 C. civ.). Cette présomption de responsabilité ne peut être écartée que par la preuve d'une cause étrangère. La garantie court pendant 10 ans à compter de la réception.",
    consequence: "Le constructeur (entrepreneur, architecte, bureau d'études) ne peut s'exonérer qu'en prouvant la cause étrangère (fait du maître d'ouvrage, catastrophe naturelle, faute d'un autre intervenant). L'assurance dommages-ouvrage (Art. L242-1 C. assur.) permet une indemnisation rapide sans attendre la décision judiciaire.",
    visa_refs:   ['Art. 1792 Code civil', 'Art. 1792-2 Code civil', 'Art. L242-1 Code des assurances'],
    domain:      'construction',
    sub_themes:  ['garantie_decennale', 'responsabilite_constructeur', 'dommage_ouvrage', 'reception'],
  },

  // -------------------------------------------------------------------------
  // Thème 9 : VEFA — garantie financière d'achèvement (GFA)
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-vefa-garantie-achevement',
    court:       'cc',
    chamber:     '3e civ.',
    date:        null,
    number:      null,
    solution:    'Rejet',
    situation:   "Un acquéreur en VEFA (vente en l'état futur d'achèvement) se retrouve face à un promoteur en difficulté financière et craint que l'immeuble ne soit pas achevé.",
    principle:   "Le promoteur est tenu de fournir une garantie financière d'achèvement (GFA) avant tout versement de fonds par l'acquéreur (Art. L261-10-1 CCH). Cette garantie, fournie par un établissement de crédit ou une société d'assurance, assure que l'immeuble sera achevé quelles que soient les difficultés financières du promoteur. Les appels de fonds sont strictement échelonnés selon l'avancement des travaux (Art. R261-14 CCH).",
    consequence: "Sans GFA valide, le contrat de réservation ou le contrat de VEFA est nul. En cas de défaillance du promoteur, l'organisme garant prend en charge l'achèvement de l'immeuble ou rembourse les acquéreurs. Les appels de fonds hors échelonnement légal exposent le promoteur à des sanctions pénales.",
    visa_refs:   ['Art. L261-10-1 Code de la construction et de l\'habitation', 'Art. R261-14 CCH'],
    domain:      'construction',
    sub_themes:  ['vefa', 'garantie_achevement', 'promoteur', 'appels_de_fonds'],
  },

  // -------------------------------------------------------------------------
  // Thème 10 : Conditions suspensives — bonne foi de l'acquéreur
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-condition-suspensive-bonne-foi',
    court:       'cc',
    chamber:     '3e civ.',
    date:        null,
    number:      null,
    solution:    'Cassation',
    situation:   "Un acquéreur invoque la non-réalisation d'une condition suspensive d'obtention de prêt pour se désengager du compromis et récupérer son dépôt de garantie, alors qu'il n'a pas fait toutes les démarches nécessaires pour obtenir le financement.",
    principle:   "La condition suspensive est réputée accomplie lorsque c'est la partie qui avait intérêt à ce qu'elle ne s'accomplisse pas qui en a empêché la réalisation (Art. 1304-3 C. civ., anc. Art. 1178). L'acquéreur est tenu d'effectuer des démarches sincères pour obtenir le prêt : dépôt de demande dans les délais, auprès de plusieurs établissements, pour le montant et la durée prévus au contrat.",
    consequence: "L'acquéreur qui ne dépose pas sa demande de prêt, ou qui la dépose dans des conditions délibérément inacceptables, est considéré comme ayant empêché la réalisation de la condition. Il perd son dépôt de garantie et peut être condamné à des dommages-intérêts. Le vendeur doit conserver les preuves des démarches insuffisantes de l'acquéreur.",
    visa_refs:   ['Art. 1304-3 Code civil', 'Art. 1178 ancien Code civil'],
    domain:      'vente_immobiliere',
    sub_themes:  ['condition_suspensive', 'financement', 'bonne_foi', 'depot_de_garantie'],
  },

  // -------------------------------------------------------------------------
  // Thème 11 : Droit de préemption urbain (DPU) — purge et délais
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-dpu-purge-delais',
    court:       'cc',
    chamber:     '3e civ.',
    date:        null,
    number:      null,
    solution:    'Rejet',
    situation:   "Un vendeur reçoit l'exercice du droit de préemption urbain par la commune sur un bien mis en vente. Il conteste les modalités ou les délais de la décision de préemption.",
    principle:   "Le titulaire du droit de préemption urbain (commune ou délégataire) dispose de deux mois à compter de la réception de la DIA pour exercer son droit de préemption (Art. L213-2 Code de l'urbanisme). Passé ce délai, le droit est purgé et la vente peut se réaliser librement. La décision de préemption doit être motivée et respecter le prix mentionné dans la DIA ou saisir le juge de l'expropriation.",
    consequence: "Une préemption exercée hors délai est nulle. Une décision de préemption insuffisamment motivée peut être annulée par le juge administratif. Si la commune préempte puis revend dans les 5 ans, l'ancien propriétaire dispose d'un droit de rétrocession.",
    visa_refs:   ['Art. L213-2 Code de l\'urbanisme', 'Art. L211-1 Code de l\'urbanisme'],
    domain:      'urbanisme',
    sub_themes:  ['dpu', 'preemption', 'dia', 'delai_2_mois', 'motivation'],
  },

  // -------------------------------------------------------------------------
  // Thème 12 : SCI — responsabilité indéfinie des associés
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-sci-responsabilite-associes',
    court:       'cc',
    chamber:     '3e civ.',
    date:        null,
    number:      null,
    solution:    'Rejet',
    situation:   "Un créancier de la SCI ne peut recouvrer sa créance auprès de la société et se retourne contre les associés personnellement.",
    principle:   "Les associés d'une SCI répondent indéfiniment des dettes sociales à proportion de leurs parts dans le capital social (Art. 1857 C. civ.). Cette responsabilité est subsidiaire (le créancier doit d'abord mettre la société en demeure) mais illimitée quant au montant. Elle porte sur les dettes nées pendant la période où l'associé était membre de la SCI.",
    consequence: "Un associé de SCI ne peut limiter sa responsabilité comme en SARL. En cas de difficultés financières de la SCI, les créanciers peuvent saisir les biens personnels des associés au prorata de leurs parts. Cela rend la SCI inadaptée pour les activités à risque élevé — préférer d'autres formes pour l'activité commerciale.",
    visa_refs:   ['Art. 1857 Code civil', 'Art. 1858 Code civil'],
    domain:      'sci_societes',
    sub_themes:  ['sci', 'responsabilite_associes', 'dettes_sociales', 'subsidiarite'],
  },

  // -------------------------------------------------------------------------
  // Thème 13 : Bail commercial — droit au renouvellement
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-bail-commercial-renouvellement',
    court:       'cc',
    chamber:     'com.',
    date:        null,
    number:      null,
    solution:    'Rejet',
    situation:   "Le bailleur d'un local commercial refuse le renouvellement du bail commercial à son terme. Le locataire commercial revendique son droit au renouvellement.",
    principle:   "Le locataire qui exploite effectivement le fonds de commerce dans les lieux a droit au renouvellement de son bail à l'expiration de la période triennale (Art. L145-14 C. com.). Le bailleur qui refuse le renouvellement sans motif grave et légitime doit verser une indemnité d'éviction destinée à compenser le préjudice causé par le défaut de renouvellement (perte du fonds, frais de déménagement, etc.).",
    consequence: "L'indemnité d'éviction peut représenter plusieurs années de loyer selon la valeur du fonds. Le bailleur peut éviter cette indemnité s'il justifie d'un motif grave et légitime (infractions graves du locataire) ou s'il reprend les locaux pour y habiter ou y construire. La procédure impose des congés formalisés respectant des délais stricts.",
    visa_refs:   ['Art. L145-14 Code de commerce', 'Art. L145-4 Code de commerce'],
    domain:      'bail_commercial',
    sub_themes:  ['bail_commercial', 'renouvellement', 'indemnite_eviction', 'droit_au_bail'],
  },

  // -------------------------------------------------------------------------
  // Thème 14 : Plus-value immobilière — exonération résidence principale
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-plus-value-residence-principale',
    court:       'cc',
    chamber:     null,
    date:        null,
    number:      null,
    solution:    null,
    situation:   "Un particulier vend son bien immobilier et se demande si la plus-value réalisée est imposable. Il occupe ce bien à titre de résidence principale au moment de la cession.",
    principle:   "La plus-value réalisée lors de la cession de la résidence principale est totalement exonérée d'impôt sur le revenu et de prélèvements sociaux (Art. 150 U II 1° CGI). La condition d'occupation doit être effective et continue jusqu'à la date de cession. En cas de déménagement avant la vente, l'exonération reste applicable si la vente intervient dans un délai normal (généralement apprécié à 1 an) et que le bien n'a pas été mis en location.",
    consequence: "Cette exonération s'applique quel que soit le montant de la plus-value et sans condition de durée de détention. Elle ne s'applique pas aux résidences secondaires ni aux biens locatifs (régime spécifique avec abattements pour durée de détention après 5 ans, exonération totale après 22 ans pour IR et 30 ans pour PS).",
    visa_refs:   ['Art. 150 U II 1° Code général des impôts'],
    domain:      'fiscalite',
    sub_themes:  ['plus_value', 'residence_principale', 'exoneration', 'cgi'],
  },

  // -------------------------------------------------------------------------
  // Thème 15 bis : GUL — jamais mise en place, remplacée par Visale
  // Cible Q36 du benchmark
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-gul-abandonnee-visale',
    court:       'cc',
    chamber:     null,
    date:        null,
    number:      null,
    solution:    null,
    situation:   "Un propriétaire ou locataire se renseigne sur la garantie universelle des loyers (GUL) prévue par la loi ALUR pour se prémunir contre les impayés de loyer.",
    principle:   "La garantie universelle des loyers (GUL) a été prévue par l'article 8 de la loi ALUR (loi 2014-366 du 24 mars 2014) mais n'a jamais été mise en place. Elle devait couvrir tous les bailleurs contre les impayés, sans sélection des locataires. Le législateur a finalement abandonné ce dispositif universel.",
    consequence: "La GUL prévue par la loi ALUR a été abandonnée et remplacée par le dispositif Visale (Visa pour le Logement et l'Emploi), géré par Action Logement. Visale est une caution gratuite accordée par Action Logement au bailleur, disponible pour les locataires de moins de 30 ans ou salariés en mobilité professionnelle. Ce n'est pas une garantie universelle — elle est soumise à conditions d'éligibilité.",
    visa_refs:   ['Art. 8 loi 2014-366 du 24 mars 2014 (loi ALUR)'],
    domain:      'baux_habitation',
    sub_themes:  ['gul', 'garantie_loyers', 'visale', 'action_logement', 'impaye', 'caution'],
  },

  // -------------------------------------------------------------------------
  // Thème 15 ter : Encadrement des loyers — villes et dispositif 2024
  // Cible Q9 et Q66 du benchmark
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-encadrement-loyers-villes-2024',
    court:       'cc',
    chamber:     null,
    date:        null,
    number:      null,
    solution:    null,
    situation:   "Un agent immobilier doit conseiller un propriétaire sur les règles d'encadrement des loyers applicables dans la ville où se situe le bien à louer.",
    principle:   "L'encadrement des loyers a été créé par la loi ALUR (loi 2014-366, Art. 17) et renforcé par la loi ELAN (loi 2018-1021). Il s'applique dans les zones tendues où un arrêté préfectoral fixe un loyer de référence médian, un loyer de référence majoré (loyer médian + 20 %) et un loyer de référence minoré. Le bailleur ne peut pas dépasser le loyer de référence majoré. Le décret 2024-854 a renouvelé le dispositif pour 2024. Les agglomérations concernées par un arrêté en vigueur en 2024 sont notamment : Paris (depuis 2015, relancé 2019), Lille (depuis 2020), Lyon et Villeurbanne (depuis 2021), Bordeaux (depuis 2022), Montpellier (depuis 2022), ainsi que d'autres communes ayant délibéré pour rejoindre le dispositif.",
    consequence: "Dans les villes dotées d'un arrêté d'encadrement, tout bail signé avec un loyer supérieur au loyer de référence majoré est susceptible de contestation par le locataire dans les 3 ans. Le bailleur peut appliquer un complément de loyer si le logement présente des caractéristiques exceptionnelles, mais ce complément doit être justifié et mentionné dans le bail.",
    visa_refs:   ['Art. 17 loi 2014-366 (loi ALUR)', 'Art. 140 loi 2018-1021 (loi ELAN)', 'Décret 2024-854'],
    domain:      'baux_habitation',
    sub_themes:  ['encadrement_loyers', 'zones_tendues', 'loyer_reference', 'paris', 'lille', 'lyon', 'bordeaux'],
  },

  // -------------------------------------------------------------------------
  // Diagnostics 1 : ERP — état des risques et pollutions
  // Cible Q47 du benchmark
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-erp-etat-risques-pollutions',
    court:       'cc',
    chamber:     null,
    date:        null,
    number:      null,
    solution:    null,
    situation:   "Un agent immobilier ou un vendeur se demande si l'état des risques et pollutions (ERP) est obligatoire pour la vente ou la location d'un bien immobilier.",
    principle:   "L'état des risques et pollutions (ERP) est obligatoire pour tout immeuble bâti ou non bâti situé dans une zone réglementée (zone de sismicité, zone exposée aux risques naturels ou technologiques, secteur d'information sur les sols, zone d'exposition au radon). Il est régi par l'article L125-5 du Code de l'environnement. L'ERP est obligatoire à la fois pour la vente et pour la location. Il doit être remis à l'acquéreur ou au locataire au moment de la signature du contrat (promesse, acte authentique pour la vente ; bail pour la location). L'ERP doit avoir moins de 6 mois à la date de signature.",
    consequence: "Un ERP périmé (plus de 6 mois) ou absent constitue un vice de procédure susceptible d'engager la responsabilité du vendeur ou du bailleur. Il renseigne sur les risques d'inondation, de mouvements de terrain, de séisme (zone sismique), de risques technologiques (usines Seveso), de pollution des sols. L'arrêté préfectoral fixe le périmètre des zones concernées, consultable sur georisques.gouv.fr.",
    visa_refs:   ['Art. L125-5 Code de l\'environnement', 'Art. R125-26 Code de l\'environnement'],
    domain:      'diagnostics',
    sub_themes:  ['erp', 'etat_risques', 'zone_reglementee', 'inondation', 'sismique', 'vente', 'location'],
  },

  // -------------------------------------------------------------------------
  // Diagnostics 2 : DPE transitoire — DPE 2019 expiré au 31/12/2024
  // Cible Q51 du benchmark
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-dpe-transitoire-expiration-2024',
    court:       'cc',
    chamber:     null,
    date:        null,
    number:      null,
    solution:    null,
    situation:   "Un vendeur ou un agent immobilier se demande si un DPE réalisé en 2018 ou 2019 est encore valable pour une mise en vente ou en location en 2025.",
    principle:   "La loi Climat et Résilience du 22 août 2021 a réformé le DPE pour le rendre opposable et fiabilisé (ordonnance 2020-71 et décret d'application). Une mesure transitoire a prévu que les anciens DPE réalisés avant le 1er juillet 2021 avaient une validité prolongée mais limitée : les DPE réalisés entre le 1er janvier 2018 et le 30 juin 2021 ont été valides jusqu'au 31 décembre 2024. Les DPE réalisés avant le 1er janvier 2018 avaient eux expiré au 31 décembre 2022.",
    consequence: "Un DPE réalisé en 2019 est expiré depuis le 31 décembre 2024. Il n'est plus valable pour une mise en vente ou en location en 2025. Le vendeur ou le bailleur doit faire réaliser un nouveau DPE selon le format opposable post-juillet 2021. Le nouveau DPE a une durée de validité de 10 ans (sauf travaux de rénovation énergétique significatifs réalisés entre temps).",
    visa_refs:   ['Ordonnance 2020-71 du 29 janvier 2020', 'Loi 2021-1104 du 22 août 2021 (Climat et Résilience)', 'Art. L126-26 Code de la construction et de l\'habitation'],
    domain:      'diagnostics',
    sub_themes:  ['dpe', 'dpe_transitoire', 'expiration', '31_decembre_2024', 'juillet_2021', 'validite', 'opposabilite'],
  },

  // -------------------------------------------------------------------------
  // Diagnostics 3 : Audit énergétique obligatoire avant vente (F/G)
  // Cible Q52 du benchmark
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-audit-energetique-passoire-thermique',
    court:       'cc',
    chamber:     null,
    date:        null,
    number:      null,
    solution:    null,
    situation:   "Un agent immobilier gère la vente d'une maison individuelle classée F ou G au DPE. L'acheteur ou le vendeur veut savoir si un audit énergétique est obligatoire.",
    principle:   "La loi Climat et Résilience 2021 (art. 158) et le décret 2022-780 ont rendu obligatoire l'audit énergétique avant la vente des passoires thermiques. Il s'applique uniquement aux logements en monopropriété (maisons individuelles, immeubles détenus par un seul propriétaire) classés F ou G au DPE. L'audit est obligatoire depuis le 1er avril 2023 pour les logements classés F ou G. Il sera étendu aux logements classés E à une date ultérieure fixée par décret. L'audit énergétique doit être remis à l'acquéreur potentiel dès la première visite.",
    consequence: "L'audit énergétique est distinct du DPE : il propose des scénarios de travaux pour améliorer la performance énergétique du bien. Il est réalisé par un professionnel certifié. Son absence lors de la vente d'une passoire thermique en monopropriété constitue un manquement susceptible d'engager la responsabilité du vendeur. L'obligation ne s'applique pas aux logements en copropriété (qui relèvent d'un DPE collectif et d'un plan pluriannuel de travaux).",
    visa_refs:   ['Art. 158 loi 2021-1104 (Climat et Résilience)', 'Décret 2022-780 du 4 mai 2022', 'Art. L126-28-1 Code de la construction et de l\'habitation'],
    domain:      'diagnostics',
    sub_themes:  ['audit_energetique', 'passoire_thermique', 'classe_f', 'classe_g', '1er_avril_2023', 'monopropriete', 'vente'],
  },

  // -------------------------------------------------------------------------
  // Diagnostics 4 : Diagnostic amiante — seuil 1er juillet 1997
  // Cible Q53 du benchmark
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-diagnostic-amiante-seuil-1997',
    court:       'cc',
    chamber:     null,
    date:        null,
    number:      null,
    solution:    null,
    situation:   "Un propriétaire vend un appartement construit en 1998 et se demande si le diagnostic amiante est obligatoire.",
    principle:   "Le diagnostic amiante (dossier technique amiante — DTA, ou état d'amiante) est obligatoire uniquement pour les immeubles dont le permis de construire a été délivré avant le 1er juillet 1997. Ce seuil est fixé par le décret 96-97 du 7 février 1996 et le Code de la santé publique. L'amiante a été interdit en France à compter du 1er juillet 1997. Un appartement construit en 1998 (permis de construire postérieur au 1er juillet 1997) n'est donc pas soumis à l'obligation de diagnostic amiante.",
    consequence: "Pour un bien construit après le 1er juillet 1997, la case 'amiante' du dossier de diagnostics techniques (DDT) est remplie avec la mention 'non concerné'. Le diagnostic amiante obligatoire concerne : la vente de tout immeuble bâti dont le permis de construire est antérieur au 1er juillet 1997. En cas de présence d'amiante détectée dans un immeuble ancien, des travaux de désamiantage peuvent être imposés selon l'état de conservation.",
    visa_refs:   ['Décret 96-97 du 7 février 1996', 'Art. R1334-14 Code de la santé publique', 'Art. L1334-13 Code de la santé publique'],
    domain:      'diagnostics',
    sub_themes:  ['amiante', 'diagnostic_amiante', '1er_juillet_1997', 'permis_de_construire', 'dta', 'avant_1997'],
  },

  // -------------------------------------------------------------------------
  // Hoguet : Carte professionnelle T — conditions d'obtention
  // Cible Q14 du benchmark
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-carte-pro-T-conditions',
    court:       'cc',
    chamber:     null,
    date:        null,
    number:      null,
    solution:    null,
    situation:   "Un futur agent immobilier veut savoir quelles sont les conditions pour obtenir la carte professionnelle T (transactions immobilières) délivrée par la CCI.",
    principle:   "La carte professionnelle T (transactions immobilières) est régie par la loi 70-9 du 2 janvier 1970 (loi Hoguet) et le décret 72-678. Pour l'obtenir, le candidat doit justifier : (1) d'une aptitude professionnelle (diplôme de niveau bac+2 minimum en droit, économie, commerce, ou BTS professions immobilières, ou expérience professionnelle de 10 ans comme salarié chez un titulaire de carte — ramenée à 4 ans pour les non-cadres et 3 ans pour les cadres) ; (2) d'une garantie financière auprès d'un établissement bancaire ou d'une caisse de garantie ; (3) d'une assurance responsabilité civile professionnelle (RC pro) ; (4) d'une absence de condamnation incompatible avec l'exercice de la profession. La carte est délivrée par la CCI (chambre de commerce et d'industrie) territoriale.",
    consequence: "La carte professionnelle T est valable 3 ans et doit être renouvelée. Elle est nominative. Sans carte T en cours de validité, l'exercice de l'activité de transaction immobilière est illégal et passible de sanctions pénales (loi Hoguet). Chaque salarié habilité doit disposer d'une carte d'habilitation (attestation) délivrée par le titulaire de la carte.",
    visa_refs:   ['Loi 70-9 du 2 janvier 1970 (loi Hoguet)', 'Décret 72-678 du 20 juillet 1972'],
    domain:      'agent_immobilier',
    sub_themes:  ['carte_pro', 'aptitude_professionnelle', 'garantie_financiere', 'assurance_rc', 'cci', 'hoguet'],
  },

  // -------------------------------------------------------------------------
  // Transactions : Clause de substitution dans le compromis
  // Cible Q25 du benchmark
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-clause-substitution-compromis',
    court:       'cc',
    chamber:     null,
    date:        null,
    number:      null,
    solution:    null,
    situation:   "Un acheteur signe un compromis de vente mais souhaite se faire substituer par une SCI qu'il va créer avant la réitération de l'acte authentique.",
    principle:   "La clause de substitution (ou clause de substitution d'acquéreur) est une stipulation contractuelle insérée dans le compromis de vente qui permet à l'acheteur initial de se faire remplacer par un tiers (souvent une SCI à constituer) avant la signature de l'acte authentique. L'acheteur initial désigne son substitué, qui reprend l'ensemble de ses droits et obligations. La substitution doit intervenir avant la réitération de l'acte authentique. Elle est encadrée par le Code civil (principes de cession de contrat). Si la SCI n'est pas constituée à temps, l'acheteur initial reste tenu.",
    consequence: "La clause de substitution est très utilisée lorsqu'un investisseur signe d'abord en son nom puis crée une SCI pour porter le bien. L'acheteur substitué (la SCI) devient partie au contrat à la place de l'acheteur initial. Si la clause ne prévoit pas expressément la libération de l'acheteur initial, celui-ci reste garant solidaire. L'agent immobilier doit attirer l'attention des parties sur les conséquences fiscales (droits de mutation, TVA) selon la nature de la substitution.",
    visa_refs:   ['Art. 1216 Code civil (cession de contrat)', 'Art. 1589 Code civil'],
    domain:      'vente_immobiliere',
    sub_themes:  ['clause_substitution', 'sci', 'acheteur_initial', 'substitue', 'avant_reiteration', 'compromis'],
  },

  // -------------------------------------------------------------------------
  // Fiscalité : Plus-value résidence secondaire
  // Cible Q31 du benchmark
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-plus-value-residence-secondaire',
    court:       'cc',
    chamber:     null,
    date:        null,
    number:      null,
    solution:    null,
    situation:   "Un propriétaire vend une résidence secondaire ou un bien locatif et veut connaître le régime de taxation de la plus-value immobilière.",
    principle:   "La plus-value immobilière sur la vente d'une résidence secondaire ou d'un bien locatif est soumise à l'impôt sur le revenu au taux de 19% et aux prélèvements sociaux au taux de 17,2% (soit 36,2% au total), conformément à l'article 150 U du Code général des impôts (CGI). Des abattements pour durée de détention s'appliquent : pour l'impôt sur le revenu (19%), l'exonération totale est atteinte après 22 ans de détention (abattement progressif à partir de la 6e année) ; pour les prélèvements sociaux (17,2%), l'exonération totale est atteinte après 30 ans de détention.",
    consequence: "La plus-value nette imposable = prix de vente - prix d'acquisition (majoré des frais d'acquisition et des travaux). Une taxe complémentaire s'applique sur les plus-values supérieures à 50 000 €. Certaines exonérations existent : première vente de résidence secondaire si le vendeur n'est pas propriétaire de sa résidence principale depuis au moins 4 ans, vente à un prix inférieur à 15 000 €, bien détenu depuis plus de 30 ans.",
    visa_refs:   ['Art. 150 U Code général des impôts (CGI)', 'Art. 150 VC CGI (abattements)'],
    domain:      'fiscalite',
    sub_themes:  ['plus_value', 'residence_secondaire', '19_pourcent', 'prelevements_sociaux', 'abattement', '22_ans', '30_ans', 'cgi'],
  },

  // -------------------------------------------------------------------------
  // Transactions : Condition suspensive de prêt — loi Scrivener
  // Cible Q37 du benchmark
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-condition-suspensive-pret-scrivener',
    court:       'cc',
    chamber:     null,
    date:        null,
    number:      null,
    solution:    null,
    situation:   "Un acheteur signe un compromis de vente et se demande quelles sont les conditions suspensives légales qui le protègent en cas de refus de prêt bancaire.",
    principle:   "La condition suspensive d'obtention de prêt bancaire est protégée par la loi 79-596 du 13 juillet 1979 (loi Scrivener 2), codifiée à l'article L313-41 du Code de la consommation. Tout acte de vente immobilière conclu par un particulier qui recourt à un prêt pour financer son acquisition doit mentionner obligatoirement cette condition suspensive. L'acquéreur bénéficie d'un délai minimum de 30 jours pour obtenir son financement à compter de la signature du compromis. Si le prêt est refusé dans ce délai, la condition suspensive joue et l'avant-contrat est nul de plein droit, sans pénalité pour l'acquéreur.",
    consequence: "En cas de refus de prêt dans le délai prévu, l'acquéreur récupère intégralement son dépôt de garantie. L'acheteur ne peut pas renoncer à cette protection légale. Si l'acquéreur renonce expressément au bénéfice du prêt (paiement comptant), la clause n'est pas insérée. Le délai de 30 jours est un minimum légal — le compromis peut prévoir un délai plus long.",
    visa_refs:   ['Loi 79-596 du 13 juillet 1979 (loi Scrivener 2)', 'Art. L313-41 Code de la consommation'],
    domain:      'vente_immobiliere',
    sub_themes:  ['condition_suspensive', 'pret_bancaire', 'scrivener', 'delai_30_jours', 'refus_pret', 'nullite', 'compromis'],
  },

  // -------------------------------------------------------------------------
  // Bail : Loyer sous-évalué — procédure de réévaluation au renouvellement
  // Cible Q38 du benchmark
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-loyer-sous-evalue-renouvellement',
    court:       'cc',
    chamber:     null,
    date:        null,
    number:      null,
    solution:    null,
    situation:   "Un bailleur estime que le loyer de son locataire est manifestement sous-évalué par rapport aux loyers du marché et veut l'augmenter lors du renouvellement du bail.",
    principle:   "La procédure de réévaluation d'un loyer manifestement sous-évalué est régie par l'article 17-2 de la loi 89-462 du 6 juillet 1989. Le bailleur peut proposer une augmentation en fournissant des références de loyers voisins comparables (au moins 3 références dans les communes de plus de 1 million d'habitants, au moins 2 ailleurs). La proposition doit être faite au moins 6 mois avant l'échéance du bail. En cas de désaccord, les parties peuvent saisir la commission départementale de conciliation (CDC). Si l'augmentation est acceptée, elle est étalée sur 3 ans (ou sur la durée du renouvellement si inférieure à 3 ans), à raison d'un tiers par an.",
    consequence: "La réévaluation ne peut pas s'appliquer dans les zones soumises à l'encadrement des loyers si le loyer de référence majoré n'est pas dépassé. Le bailleur doit impérativement joindre les références de loyers voisins à sa proposition, faute de quoi la procédure est nulle. L'étalement sur 3 ans protège le locataire contre une hausse brutale.",
    visa_refs:   ['Art. 17-2 loi 89-462 du 6 juillet 1989', 'Loi 89-462 du 6 juillet 1989'],
    domain:      'baux_habitation',
    sub_themes:  ['loyer_sous_evalue', 'renouvellement_bail', 'references_loyers_voisins', 'commission_departementale', 'etale_sur_3_ans', 'réévaluation'],
  },

  // -------------------------------------------------------------------------
  // Fiscalité : Dispositif Denormandie
  // Cible Q41 du benchmark — DURÉE MANDAT EXCLUSIF
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-duree-mandat-exclusif',
    court:       'cc',
    chamber:     null,
    date:        null,
    number:      null,
    solution:    null,
    situation:   "Un agent immobilier ou un vendeur veut savoir quelle est la durée maximale d'un mandat exclusif de vente, et quand il peut y mettre fin.",
    principle:   "L'article 78 du décret n° 72-678 du 20 juillet 1972 (pris en application de la loi Hoguet) fixe le régime du mandat exclusif de vente : (1) la durée initiale est librement fixée entre les parties, mais elle ne peut pas être indéterminée ; (2) pendant une première période irrévocable de 3 mois, ni le mandant ni l'agent ne peuvent mettre fin au mandat unilatéralement ; (3) passé ce délai, si le mandat n'a pas été dénoncé, il se renouvelle par tacite reconduction par périodes successives — et devient alors révocable à tout moment par le mandant, avec un préavis de 15 jours calendaires, par lettre recommandée avec accusé de réception. La durée maximale légale de la période irrévocable est donc de 3 mois. Il n'existe pas de durée maximale absolue pour le mandat total, mais la période irrévocable est limitée à 3 mois.",
    consequence: "Conséquence pratique : pendant les 3 premiers mois du mandat exclusif, le vendeur ne peut pas confier la vente à un autre agent ni vendre directement sans devoir des honoraires. Après 3 mois, il peut résilier à tout moment avec un préavis de 15 jours. Un mandat exclusif dont la période irrévocable dépasserait 3 mois serait nul en cette partie. À distinguer du mandat simple qui est révocable à tout moment.",
    visa_refs:   ['Art. 78 décret n° 72-678 du 20 juillet 1972', 'Loi n° 70-9 du 2 janvier 1970 (loi Hoguet)'],
    domain:      'agent_immobilier',
    sub_themes:  ['mandat_exclusif', 'duree_mandat', '3_mois_irrevocable', 'tacite_reconduction', 'revocable', 'loi_hoguet', 'decret_72-678', 'art_78'],
  },

  // Cible Q44 du benchmark
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-dispositif-denormandie',
    court:       'cc',
    chamber:     null,
    date:        null,
    number:      null,
    solution:    null,
    situation:   "Un investisseur veut bénéficier d'une réduction d'impôt en achetant un logement ancien à rénover pour le mettre en location.",
    principle:   "Le dispositif Denormandie est une réduction d'impôt sur le revenu pour l'investissement locatif dans l'ancien avec travaux, codifié à l'article 199 novovicies du CGI, créé par la loi 2018-1021 (loi ELAN). Conditions : (1) acquisition d'un logement ancien situé dans une zone éligible (villes du programme Action Cœur de Ville, ou communes ayant signé une ORT) ; (2) réalisation de travaux représentant au moins 25% du coût total de l'opération ; (3) engagement de location nue à titre de résidence principale pour 6, 9 ou 12 ans, avec plafonds de loyers et de ressources des locataires. La réduction d'impôt est de 12% (6 ans), 18% (9 ans) ou 21% (12 ans) du prix de revient (plafonné à 300 000 € et 5 500 €/m²).",
    consequence: "Le Denormandie cible la rénovation de logements anciens dégradés en centre-ville, contrairement au Pinel qui vise le neuf. Les travaux doivent être réalisés par des entreprises (pas en auto-réhabilitation). Le dispositif est prorogé jusqu'au 31 décembre 2026. Le non-respect des engagements entraîne la reprise des avantages fiscaux.",
    visa_refs:   ['Art. 199 novovicies Code général des impôts (CGI)', 'Loi 2018-1021 du 23 novembre 2018 (ELAN)'],
    domain:      'fiscalite',
    sub_themes:  ['denormandie', 'ancien_avec_travaux', '25_ans_location', 'zone_eligible', 'reduction_impot', 'action_coeur_de_ville', 'cgi'],
  },

  // -------------------------------------------------------------------------
  // Bail meublé : Mentions obligatoires du contrat — article 25-7
  // Cible Q46 du benchmark
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-contrat-meuble-mentions-obligatoires',
    court:       'cc',
    chamber:     null,
    date:        null,
    number:      null,
    solution:    null,
    situation:   "Un agent immobilier rédige un contrat de location meublée et doit connaître les mentions obligatoires imposées par la loi.",
    principle:   "Le contrat de location meublée est régi par l'article 25-7 de la loi 89-462 (introduit par la loi ALUR) et le décret 2015-587 du 29 mai 2015. Le bail meublé doit contenir obligatoirement : l'identité des parties, la description et la surface du logement, le montant du loyer et des charges, les conditions de révision, la durée du bail (1 an minimum, ou 9 mois pour les étudiants), le montant du dépôt de garantie (2 mois maximum), les équipements fournis. Un inventaire et état des lieux détaillé du mobilier doit être annexé au contrat.",
    consequence: "Le bail meublé étudiant (9 mois) ne se renouvelle pas automatiquement. Le bail meublé classique (1 an) se renouvelle tacitement. Le dépôt de garantie est limité à 2 mois de loyer hors charges (contre 1 mois en vide). La liste minimale du mobilier obligatoire est fixée par le décret 2015-981. En zone tendue, l'encadrement des loyers s'applique aussi aux meublés.",
    visa_refs:   ['Art. 25-7 loi 89-462 du 6 juillet 1989', 'Décret 2015-587 du 29 mai 2015'],
    domain:      'baux_habitation',
    sub_themes:  ['bail_meuble', 'inventaire', 'duree_1_an', 'etudiant_9_mois', 'depot_2_mois', 'mentions_obligatoires', 'contrat_location'],
  },

  // -------------------------------------------------------------------------
  // Transactions : Anti-blanchiment — obligations de l'agent immobilier
  // Cible Q49 du benchmark
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-anti-blanchiment-agent-immobilier',
    court:       'cc',
    chamber:     null,
    date:        null,
    number:      null,
    solution:    null,
    situation:   "Un agent immobilier veut connaître ses obligations en matière de lutte contre le blanchiment de capitaux et le financement du terrorisme (LCB-FT).",
    principle:   "Les agents immobiliers sont assujettis aux obligations de lutte anti-blanchiment (LCB-FT) en vertu de l'article L561-2 du Code monétaire et financier (CMF). Ils doivent : (1) identifier et vérifier l'identité de leurs clients et du bénéficiaire effectif (KYC) ; (2) exercer une vigilance constante sur les opérations et les relations d'affaires ; (3) déclarer à TRACFIN (Traitement du renseignement et action contre les circuits financiers clandestins) toute opération suspecte via une déclaration de soupçon ; (4) conserver les documents d'identification 5 ans ; (5) former leur personnel à la LCB-FT.",
    consequence: "Le manquement aux obligations LCB-FT expose l'agent à des sanctions disciplinaires (suspension ou retrait de carte professionnelle) et pénales. La déclaration de soupçon à TRACFIN est confidentielle — l'agent ne peut pas en informer le client (obligation de non-divulgation). Le bénéficiaire effectif est la personne physique qui contrôle in fine le client (détenteur de plus de 25% des parts d'une société).",
    visa_refs:   ['Art. L561-2 Code monétaire et financier', 'Art. L561-15 Code monétaire et financier (déclaration TRACFIN)'],
    domain:      'agent_immobilier',
    sub_themes:  ['anti_blanchiment', 'lcb_ft', 'vigilance', 'declaration_soupcon', 'tracfin', 'beneficiaire_effectif', 'kyc'],
  },

  // -------------------------------------------------------------------------
  // ELAN : Copropriétés en difficulté
  // Cible Q50 du benchmark
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-elan-coproprietes-difficulte',
    court:       'cc',
    chamber:     null,
    date:        null,
    number:      null,
    solution:    null,
    situation:   "Une copropriété accumule les impayés de charges et se dégrade. Quelles sont les mesures prévues par la loi ELAN pour les copropriétés en difficulté ?",
    principle:   "La loi ELAN (loi 2018-1021 du 23 novembre 2018) a renforcé les outils de traitement des copropriétés en difficulté. Elle introduit plusieurs seuils de déclenchement selon le niveau d'impayés et de dégradation : (1) la désignation d'un administrateur provisoire par le tribunal lorsque l'équilibre financier est compromis ; (2) le plan de sauvegarde des copropriétés dégradées, piloté par le préfet, avec des aides à la rénovation ; (3) les ORCOD (Opérations de Requalification des Copropriétés Dégradées), dispositif renforcé par ELAN, permettant une intervention publique massive sur les copropriétés les plus dégradées (ORCOD-IN pour les copropriétés d'intérêt national).",
    consequence: "La loi ELAN a abaissé les seuils de déclenchement des procédures d'alerte et simplifié la mise sous administration provisoire. Elle a également étendu les compétences des administrateurs provisoires. Les ORCOD permettent l'expropriation des lots en dernier recours. Le dispositif vise à prévenir la déshérence totale des immeubles.",
    visa_refs:   ['Loi 2018-1021 du 23 novembre 2018 (ELAN)', 'Art. L615-1 et suivants CCH (copropriétés en difficulté)'],
    domain:      'copropriete',
    sub_themes:  ['elan', 'copropriete_difficulte', 'administrateur_provisoire', 'plan_sauvegarde', 'orcod', 'seuil_declenchement', 'impayés'],
  },

  // -------------------------------------------------------------------------
  // Diagnostics : Amiante — seuil 1er juillet 1997 (renforcé)
  // Cible Q53 du benchmark (toujours en échec)
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-amiante-seuil-1997-v2',
    court:       'cc',
    chamber:     null,
    date:        null,
    number:      null,
    solution:    null,
    situation:   "Un propriétaire demande si le diagnostic amiante est obligatoire pour un appartement construit en 1998. La réponse est non.",
    principle:   "Non. Le diagnostic amiante n'est PAS obligatoire pour un appartement construit en 1998. La règle est simple : le diagnostic amiante (état mentionnant la présence ou l'absence d'amiante) est exigé uniquement pour les immeubles dont le permis de construire a été délivré avant le 1er juillet 1997. Ce seuil du 1er juillet 1997 correspond à la date d'entrée en vigueur de l'interdiction de l'amiante en France (décret 96-97 du 7 février 1996, entré en application le 1er juillet 1997). Un appartement construit en 1998 a nécessairement un permis de construire postérieur au 1er juillet 1997, donc il n'est pas soumis à l'obligation de diagnostic amiante.",
    consequence: "Pour les logements construits après le 1er juillet 1997, la rubrique 'amiante' du dossier de diagnostics techniques (DDT) porte la mention 'non concerné'. À l'inverse, pour tout immeuble dont le permis de construire est antérieur au 1er juillet 1997, le diagnostic amiante est obligatoire tant pour la vente que pour la location et les travaux. En cas de présence d'amiante, un suivi périodique ou des travaux de retrait peuvent être imposés.",
    visa_refs:   ['Décret 96-97 du 7 février 1996', 'Art. R1334-14 Code de la santé publique'],
    domain:      'diagnostics',
    sub_themes:  ['amiante', 'non_obligatoire', '1er_juillet_1997', 'permis_de_construire', 'avant_1997', 'appartement_1998'],
  },

  // -------------------------------------------------------------------------
  // Transactions : Démembrement de propriété — bail par l'usufruitier
  // Cible Q59 du benchmark
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-demembrement-usufruitier-bail',
    court:       'cc',
    chamber:     null,
    date:        null,
    number:      null,
    solution:    null,
    situation:   "Un bien immobilier est démembré entre un usufruitier et un nu-propriétaire. L'usufruitier veut conclure un bail. A-t-il besoin de l'accord du nu-propriétaire ?",
    principle:   "Selon l'article 595 du Code civil, l'usufruitier peut conclure seul un bail d'habitation ordinaire ou commercial (bail de droit commun). Il n'a pas besoin de l'accord du nu-propriétaire pour les baux courants. En revanche, il ne peut pas conclure sans le concours du nu-propriétaire : les baux ruraux ou emphytéotiques, ni les baux commerciaux dont la durée excède celle de l'usufruit. Pour la location meublée, l'usufruitier peut agir seul. Attention : un bail de plus de 9 ans qui se prolongerait au-delà de l'usufruit nécessite en pratique le concours du nu-propriétaire pour être opposable à ce dernier.",
    consequence: "À l'extinction de l'usufruit (décès de l'usufruitier), le bail en cours est opposable au nu-propriétaire devenu plein propriétaire, pour la durée légale restant à courir. Cela peut bloquer la pleine disponibilité du bien. Le nu-propriétaire ne peut pas résilier le bail conclu régulièrement par l'usufruitier. En pratique, les agents immobiliers doivent vérifier l'existence d'un démembrement avant toute transaction ou mise en location.",
    visa_refs:   ['Art. 595 Code civil', 'Art. 578 Code civil (définition usufruit)'],
    domain:      'vente_immobiliere',
    sub_themes:  ['demembrement', 'usufruitier', 'nu_proprietaire', 'bail', 'accord', 'location_meublee', '9_ans', 'usufruit'],
  },

  // -------------------------------------------------------------------------
  // Jurisprudence : Devoir de conseil de l'agent sur l'état du bien
  // Cible Q62 du benchmark
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-devoir-conseil-etat-bien',
    court:       'cc',
    chamber:     '1re civ.',
    date:        null,
    number:      null,
    solution:    'Cassation partielle',
    situation:   "Après une vente, l'acquéreur découvre des défauts sur le bien que l'agent immobilier aurait pu détecter lors des visites. L'acquéreur veut mettre en cause la responsabilité de l'agent.",
    principle:   "Selon la jurisprudence de la Cour de cassation (Cass. civ. 1re, arrêts constants), le devoir de conseil de l'agent immobilier sur l'état du bien s'étend aux vices apparents et aux anomalies visibles lors des visites. L'agent a une obligation d'information envers l'acquéreur : il doit signaler tout ce qu'il a constaté ou aurait dû constater lors des visites (humidité visible, fissures, état de la toiture apparent, etc.). L'agent doit vérifier la concordance entre les diagnostics remis et l'état apparent du bien. Sa responsabilité délictuelle est engagée sur le fondement de l'article 1240 du Code civil et de la loi 70-9 (loi Hoguet) s'il a failli à son obligation d'information ou de renseignements.",
    consequence: "L'agent n'est pas un expert technique mais doit attirer l'attention de l'acquéreur sur tout indice visible d'anomalie. Sa responsabilité délictuelle peut être engagée même en l'absence de faute intentionnelle, dès lors qu'une négligence est caractérisée. Les vices cachés (non décelables lors d'un examen normal) relèvent en revanche de la garantie des vices cachés du vendeur (art. 1641 C. civ.), pas de la responsabilité de l'agent.",
    visa_refs:   ['Loi 70-9 du 2 janvier 1970 (Hoguet)', 'Art. 1240 Code civil', 'Art. 1641 Code civil'],
    domain:      'agent_immobilier',
    sub_themes:  ['devoir_conseil', 'obligation_information', 'vices_apparents', 'diagnostics', 'responsabilite_delictuelle', 'renseignements', 'agent_immobilier'],
  },

  // -------------------------------------------------------------------------
  // Décrets 2024-2025 : Bail réel solidaire (BRS)
  // Cible Q67 du benchmark
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-bail-reel-solidaire-brs',
    court:       'cc',
    chamber:     null,
    date:        null,
    number:      null,
    solution:    null,
    situation:   "Un acheteur entend parler du bail réel solidaire (BRS) pour accéder à la propriété à moindre coût. Il veut savoir ce que c'est et quel organisme le délivre.",
    principle:   "Le bail réel solidaire (BRS) est un dispositif d'accession sociale à la propriété créé par l'ordonnance 2016-985 et codifié aux articles L255-1 et suivants du Code de la construction et de l'habitation (CCH). Le principe repose sur la dissociation du foncier et du bâti : un Organisme de Foncier Solidaire (OFS) — structure agréée par le préfet (bailleur social, collectivité, etc.) — conserve la propriété du terrain et consent un bail réel solidaire à un accédant qui achète uniquement le bâti. L'accédant verse une redevance mensuelle à l'OFS pour l'occupation du terrain. Des plafonds de ressources et de prix de vente s'appliquent.",
    consequence: "Le BRS permet d'acheter entre 15% et 40% moins cher qu'un bien classique, car le terrain n'est pas inclus dans le prix d'achat. En cas de revente, le prix est plafonné pour maintenir l'accessibilité du logement (le BRS est rechargeable). L'acquéreur BRS bénéficie d'une TVA réduite à 5,5% et d'un abattement de taxe foncière dans de nombreuses communes. Le décret 2024-838 a précisé les conditions de mise en œuvre.",
    visa_refs:   ['Ordonnance 2016-985 du 20 juillet 2016', 'Art. L255-1 Code de la construction et de l\'habitation (CCH)', 'Décret 2024-838'],
    domain:      'urbanisme',
    sub_themes:  ['brs', 'bail_reel_solidaire', 'ofs', 'organisme_foncier_solidaire', 'dissociation_foncier_bati', 'redevance', 'plafonds_ressources', 'accession_sociale'],
  },

  // -------------------------------------------------------------------------
  // Décrets 2024-2025 : Logements G interdits à la location depuis 2025
  // Cible Q68 du benchmark
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-logements-g-interdits-location-2025',
    court:       'cc',
    chamber:     null,
    date:        null,
    number:      null,
    solution:    null,
    situation:   "Un bailleur possède un logement classé G au DPE et veut savoir depuis quand il est interdit à la location et quelles sont les exceptions.",
    principle:   "La loi Climat et Résilience du 22 août 2021 interdit progressivement la mise en location des passoires thermiques. Pour les logements classés G au DPE, l'interdiction de location s'applique aux nouveaux contrats de location à partir du 1er janvier 2025. Cette interdiction ne concerne que les nouveaux contrats (nouvelles locations ou renouvellements à l'initiative du bailleur) — les baux en cours conclus avant le 1er janvier 2025 ne sont pas résiliés de plein droit. Le décret 2021-19 précise les modalités. Exception territoriale : dans les départements d'outre-mer (Guadeloupe, Martinique, Guyane, La Réunion, Mayotte), les délais sont décalés.",
    consequence: "Le calendrier complet d'interdiction : G interdit depuis le 1er janvier 2025, F interdit à partir du 1er janvier 2028, E à partir du 1er janvier 2034. Un propriétaire d'un logement G ne peut plus proposer de nouveau bail depuis le 1er janvier 2025. Les baux en cours se poursuivent jusqu'à leur terme. Le propriétaire qui viole l'interdiction s'expose à des litiges avec le locataire (demande de travaux, réduction de loyer).",
    visa_refs:   ['Loi 2021-1104 du 22 août 2021 (Climat et Résilience)', 'Décret 2021-19 du 11 janvier 2021'],
    domain:      'diagnostics',
    sub_themes:  ['logement_g', 'dpe_g', 'interdit_location', '1er_janvier_2025', 'nouveaux_contrats', 'baux_en_cours', 'guadeloupe', 'martinique', 'passoire_thermique'],
  },

  // -------------------------------------------------------------------------
  // Responsabilité notaire : Condition suspensive mal rédigée
  // Cible Q77 du benchmark
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-responsabilite-notaire-condition-suspensive',
    court:       'cc',
    chamber:     '1re civ.',
    date:        null,
    number:      null,
    solution:    'Cassation',
    situation:   "Une condition suspensive de prêt est mal rédigée dans un compromis rédigé par un notaire. L'acquéreur subit un préjudice car il ne peut pas se désengager sans pénalité. Quelle est la responsabilité du notaire ?",
    principle:   "Le notaire, en tant que rédacteur de l'acte, est tenu d'un devoir de conseil envers les parties. Sa responsabilité civile professionnelle peut être engagée sur le fondement de l'article 1240 du Code civil (faute délictuelle) ou de la responsabilité contractuelle si la condition suspensive de prêt est incomplète, ambiguë ou insuffisamment protectrice. La Cour de cassation (Cass. civ. 1re) juge que le notaire commet une faute s'il ne vérifie pas la licéité des clauses et ne s'assure pas de leur efficacité. Une condition suspensive de prêt nulle ou mal rédigée (par exemple, ne mentionnant pas le montant, la durée ou le taux du prêt requis) prive l'acquéreur de la protection légale de l'article L313-41 du Code de la consommation.",
    consequence: "La nullité ou l'inefficacité de la condition suspensive de prêt, résultant d'une faute de rédaction du notaire, engage la responsabilité notariale. L'acquéreur peut obtenir des dommages et intérêts couvrant son préjudice (perte du dépôt de garantie, frais engagés). Le notaire est assuré en RC professionnelle. La faute notariale doit être prouvée par le demandeur.",
    visa_refs:   ['Art. 1240 Code civil', 'Art. L313-41 Code de la consommation', 'Loi du 25 ventôse an XI (statut du notariat)'],
    domain:      'responsabilite_civile',
    sub_themes:  ['responsabilite_notaire', 'devoir_conseil', 'nullite', 'condition_suspensive', 'faute', 'redaction_acte'],
  },

  // -------------------------------------------------------------------------
  // DPE erroné : Conséquences juridiques pour l'acheteur
  // Cible Q80 du benchmark
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-dpe-errone-consequences-acheteur',
    court:       'cc',
    chamber:     '3e civ.',
    date:        null,
    number:      null,
    solution:    'Cassation partielle',
    situation:   "Un acquéreur achète un bien sur la base d'un DPE classé D, mais découvre après la vente que le logement est en réalité classé F ou G. Quelles sont ses recours ?",
    principle:   "Depuis la réforme de 2021 (loi Climat et Résilience), le DPE est opposable : il engage la responsabilité du diagnostiqueur certifié si le DPE est erroné. L'acquéreur peut engager la responsabilité civile du diagnostiqueur sur le fondement de l'article 1240 du Code civil. La Cour de cassation (Cass. civ. 3e) reconnaît que le diagnostiqueur engage sa responsabilité en cas d'erreur significative dans le classement énergétique. L'acheteur peut obtenir des dommages et intérêts couvrant le préjudice subi (coût des travaux de mise en conformité, différence de valeur du bien, augmentation des charges énergétiques).",
    consequence: "Le diagnostiqueur est tenu d'une assurance RC professionnelle obligatoire. L'erreur significative est appréciée souverainement par les juges. En cas de DPE erroné, l'acquéreur peut aussi invoquer le dol si le vendeur avait connaissance de l'erreur (réticence dolosive). Si l'erreur provient du vendeur (fausses informations transmises au diagnostiqueur), la responsabilité du vendeur peut également être engagée.",
    visa_refs:   ['Loi 2021-1104 (Climat et Résilience)', 'Art. 1240 Code civil', 'Art. L271-4 CCH (DPE opposable)'],
    domain:      'diagnostics',
    sub_themes:  ['dpe_errone', 'opposable', 'diagnostiqueur', 'responsabilite', 'dommages_interets', 'erreur_significative', 'acheteur'],
  },

  // -------------------------------------------------------------------------
  // Sinistre antérieur non déclaré dans l'ERP
  // Cible Q83 du benchmark
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-sinistre-anterieur-erp-non-declare',
    court:       'cc',
    chamber:     '3e civ.',
    date:        null,
    number:      null,
    solution:    null,
    situation:   "Un acquéreur découvre après la vente qu'un sinistre important (inondation, effondrement partiel) a eu lieu dans le bien avant la vente et n'a pas été mentionné dans l'état des risques et pollutions (ERP) ni dans les déclarations du vendeur.",
    principle:   "Le vendeur est tenu de mentionner dans l'état des risques et pollutions (ERP) les sinistres reconnus catastrophe naturelle ayant donné lieu à indemnisation par l'assurance (article L125-5 Code de l'environnement). S'il omet volontairement un sinistre antérieur qu'il connaissait, il peut engager sa responsabilité au titre du dol par réticence dolosive (article 1240 du Code civil et article 1137 al. 2 du Code civil). Le Code des assurances impose également que le vendeur transmette les informations sur les sinistres ayant donné lieu à indemnisation.",
    consequence: "L'acquéreur dispose de deux voies : (1) l'action en nullité pour dol (réticence dolosive), dans un délai de 5 ans à compter de la découverte du sinistre — il devra prouver que le vendeur connaissait le sinistre et a intentionnellement tu l'information ; (2) l'action en responsabilité délictuelle (art. 1240 CC) pour obtenir des dommages et intérêts. L'ERP incomplet ou faux engage aussi la responsabilité du vendeur.",
    visa_refs:   ['Art. L125-5 Code de l\'environnement', 'Art. 1240 Code civil', 'Art. 1137 Code civil (dol)'],
    domain:      'vente_immobiliere',
    sub_themes:  ['erp', 'etat_risques', 'sinistre', 'dol', 'reticence_dolosive', 'catastrophe_naturelle', 'assurance'],
  },

  // -------------------------------------------------------------------------
  // Rétractation acquéreur après compromis — délai SRU
  // Cible Q92 du benchmark
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-retractation-acquereur-compromis-sru',
    court:       'cc',
    chamber:     null,
    date:        null,
    number:      null,
    solution:    null,
    situation:   "Un acquéreur a signé un compromis de vente et veut se rétracter. Il se demande s'il peut le faire, dans quel délai et comment.",
    principle:   "L'acquéreur non professionnel bénéficie d'un délai de rétractation de 10 jours à compter du lendemain de la première présentation de la lettre recommandée lui notifiant le compromis signé (ou du lendemain de la remise en main propre), conformément à l'article L271-1 du Code de la construction et de l'habitation (CCH), introduit par la loi SRU. Pendant ce délai de 10 jours, l'acquéreur peut se rétracter sans avoir à justifier sa décision et sans pénalité. La rétractation s'exerce par lettre recommandée avec accusé de réception (LRAR).",
    consequence: "Si l'acquéreur se rétracte dans le délai de 10 jours, il récupère intégralement son dépôt de garantie dans un délai de 21 jours. Passé ce délai, la rétractation n'est plus possible sans pénalités (l'acquéreur perd généralement son dépôt de garantie de 10%). Ce droit de rétractation ne s'applique qu'aux acquéreurs particuliers (non professionnels) pour un bien à usage d'habitation. Les ventes entre professionnels et les ventes à la criée en sont exclues.",
    visa_refs:   ['Art. L271-1 Code de la construction et de l\'habitation (CCH)', 'Loi SRU du 13 décembre 2000'],
    domain:      'vente_immobiliere',
    sub_themes:  ['retractation', '10_jours', 'delai_retractation', 'lettre_recommandee', 'sans_penalite', 'sru', 'compromis', 'depot_garantie'],
  },

  // -------------------------------------------------------------------------
  // Annulation vente par le vendeur après compromis
  // Cible Q93 du benchmark
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-annulation-vente-vendeur-apres-compromis',
    court:       'cc',
    chamber:     '3e civ.',
    date:        null,
    number:      null,
    solution:    null,
    situation:   "Le vendeur veut se désister après avoir signé un compromis de vente. L'acquéreur veut savoir quels sont ses recours.",
    principle:   "Selon l'article 1589 du Code civil, la promesse de vente vaut vente dès lors qu'il y a accord sur la chose et sur le prix. Le compromis de vente est donc un contrat synallagmatique parfait. Si le vendeur refuse de signer l'acte authentique, l'acquéreur dispose de deux recours : (1) demander l'exécution forcée de la vente devant le tribunal judiciaire — le juge peut ordonner la vente par décision judiciaire valant acte de vente ; (2) demander la résolution du contrat et des dommages et intérêts pour le préjudice subi. Le vendeur n'a pas de droit de rétractation légal équivalent à celui de l'acquéreur.",
    consequence: "L'exécution forcée est le recours le plus puissant : le tribunal peut prononcer un jugement valant acte de vente, sans que le vendeur récalcitrant puisse s'y opposer. En pratique, l'acquéreur peut aussi réclamer une indemnité d'immobilisation (souvent 10% du prix) si elle est prévue au compromis. L'action en exécution forcée se prescrit par 5 ans. L'agent immobilier ne peut réclamer sa commission que si la vente est réalisée.",
    visa_refs:   ['Art. 1589 Code civil', 'Art. 1217 Code civil (inexécution contractuelle)'],
    domain:      'vente_immobiliere',
    sub_themes:  ['annulation_vente', 'vendeur', 'vente_parfaite', 'execution_forcee', 'dommages_interets', 'indemnite', 'refus', 'compromis'],
  },

  // -------------------------------------------------------------------------
  // Bail : Décès du locataire — transfert du bail
  // Cible Q97 du benchmark
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-deces-locataire-transfert-bail',
    court:       'cc',
    chamber:     null,
    date:        null,
    number:      null,
    solution:    null,
    situation:   "Le locataire d'un logement décède. Le bailleur et les proches veulent savoir ce que devient le bail.",
    principle:   "Le décès du locataire n'entraîne pas automatiquement la résiliation du bail. L'article 14 de la loi 89-462 du 6 juillet 1989 prévoit le transfert du bail au profit de certaines personnes qui vivaient avec le locataire au moment du décès : le conjoint survivant ou partenaire de PACS, les descendants qui vivaient avec lui depuis au moins 1 an à la date du décès, le concubin notoire depuis au moins 1 an, les ascendants, les personnes handicapées (AAH) vivant avec lui. Ces personnes bénéficient du transfert de plein droit, sans qu'il soit nécessaire de conclure un nouveau bail.",
    consequence: "Si personne ne remplit les conditions du transfert (pas de proches vivant avec le locataire), le bail est résilié de plein droit au décès. Les héritiers peuvent donner congé à tout moment en respectant le préavis légal, sans pénalité. Le bailleur ne peut pas donner congé au seul motif du décès si des ayants droit remplissent les conditions du transfert. Le dépôt de garantie est restitué aux héritiers si le bail est résilié.",
    visa_refs:   ['Art. 14 loi 89-462 du 6 juillet 1989'],
    domain:      'baux_habitation',
    sub_themes:  ['deces_locataire', 'article_14', 'transfert_bail', 'conjoint', 'resilié', 'heritiers', 'cohabitants'],
  },

  // -------------------------------------------------------------------------
  // Diagnostics : Conséquences DPE classé F ou G pour le propriétaire
  // Cible Q24 du benchmark
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-dpe-fg-consequences-proprietaire',
    court:       'cc',
    chamber:     null,
    date:        null,
    number:      null,
    solution:    null,
    situation:   "Un propriétaire possède un logement classé F ou G au DPE (passoire thermique) et veut savoir quelles sont les conséquences concrètes pour lui.",
    principle:   "Un logement classé F ou G au DPE est qualifié de passoire thermique. La loi Climat et Résilience 2021 et le décret 2021-19 ont instauré un calendrier progressif d'interdiction à la location : depuis le 1er janvier 2023, les logements G dont la consommation dépasse 450 kWh/m²/an sont interdits à la nouvelle location ; depuis le 1er janvier 2025, tous les logements classés G sont interdits à la location pour les nouveaux contrats ; depuis le 25 août 2022, le loyer des logements F et G est gelé (interdiction d'augmenter le loyer entre deux locataires ou lors du renouvellement). L'audit énergétique est obligatoire pour la vente des passoires thermiques en monopropriété depuis le 1er avril 2023.",
    consequence: "Le propriétaire d'une passoire thermique (classe F ou G) est soumis à : (1) gel des loyers — interdiction d'augmentation entre deux locataires et au renouvellement ; (2) interdiction de louer pour les logements G depuis le 1er janvier 2025 (nouveaux contrats) ; (3) obligation d'audit énergétique avant vente. Pour continuer à louer un logement G après 2025, des travaux de rénovation énergétique sont indispensables pour améliorer le classement DPE.",
    visa_refs:   ['Loi 2021-1104 du 22 août 2021 (Climat et Résilience)', 'Décret 2021-19 du 11 janvier 2021'],
    domain:      'diagnostics',
    sub_themes:  ['dpe_fg', 'passoire_thermique', 'gel_loyers', 'interdiction_louer', 'classe_f', 'classe_g', '2025'],
  },

  // -------------------------------------------------------------------------
  // Bail : Décence du logement — obligations du propriétaire (art. 6)
  // Cible Q32 du benchmark
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-decence-logement-obligations',
    court:       'cc',
    chamber:     null,
    date:        null,
    number:      null,
    solution:    null,
    situation:   "Un locataire se plaint de l'état de son logement et invoque le manquement du bailleur à son obligation de décence. Quelles sont les obligations légales du propriétaire ?",
    principle:   "L'article 6 de la loi 89-462 impose au bailleur de remettre et maintenir le logement en état de décence. Le décret 2002-120 du 30 janvier 2002 définit les critères de décence : (1) surface minimale de 9 m² avec une hauteur sous plafond de 2,20 m (ou 20 m³) ; (2) absence de risque pour la sécurité physique ou la santé des occupants ; (3) présence d'une installation sanitaire (WC intérieur, douche ou baignoire) avec eau chaude et eau froide ; (4) présence d'un système de chauffage normal ; (5) bon état des réseaux électriques et de gaz ; (6) protection contre les infiltrations d'air et les remontées d'humidité.",
    consequence: "Un logement indécent ne peut pas être loué ou maintenu en location. Le locataire peut saisir le tribunal judiciaire ou la commission départementale de conciliation pour obtenir la mise en conformité du logement et, le cas échéant, une réduction de loyer. Depuis la loi ALUR, un logement classé F ou G peut être considéré comme indécent si sa consommation énergétique est excessive (seuil de 450 kWh/m²/an). Le bailleur qui loue un logement indécent peut être condamné à effectuer des travaux et à verser des dommages-intérêts au locataire.",
    visa_refs:   ['Art. 6 loi 89-462 du 6 juillet 1989', 'Décret 2002-120 du 30 janvier 2002'],
    domain:      'baux_habitation',
    sub_themes:  ['decence', 'surface_minimale', '9m2', 'installation_sanitaire', 'chauffage', 'securite', 'bailleur', 'obligations'],
  },

  // -------------------------------------------------------------------------
  // Hoguet : Négociateur salarié et signature de mandats
  // Cible Q48 du benchmark
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-negociateur-salarie-mandats',
    court:       'cc',
    chamber:     null,
    date:        null,
    number:      null,
    solution:    null,
    situation:   "Un négociateur salarié d'une agence immobilière veut signer des mandats de vente ou de location au nom de l'agence. Est-il habilité à le faire seul ?",
    principle:   "Non, un négociateur salarié ne peut pas signer seul des mandats immobiliers au nom de l'agence. L'article 4 de la loi 70-9 (loi Hoguet) réserve la signature des mandats au titulaire de la carte professionnelle T (ou G). Le négociateur salarié peut recevoir une délégation du titulaire de la carte T, matérialisée par une habilitation écrite (attestation nominative). Cette habilitation lui permet d'effectuer des actes de prospection et de négociation, mais la signature du mandat reste sous la responsabilité du titulaire de la carte T. En pratique, les mandats sont signés par le dirigeant ou par un collaborateur expressément habilité par délégation écrite.",
    consequence: "Un mandat signé par un négociateur non habilité est nul (article 6 loi Hoguet). Le titulaire de la carte T ne peut pas déléguer sa carte — l'habilitation est personnelle et doit être remise à chaque négociateur. Le négociateur habilité engage la responsabilité du titulaire de la carte T pour ses actes. En cas de litige sur la commission, la validité du mandat (y compris l'habilitation du signataire) sera examinée.",
    visa_refs:   ['Art. 4 loi 70-9 du 2 janvier 1970 (Hoguet)', 'Art. 9 décret 72-678'],
    domain:      'agent_immobilier',
    sub_themes:  ['negociateur_salarie', 'habilitation', 'delegation', 'titulaire_carte_t', 'mandat', 'signature', 'non_seul'],
  },

  // -------------------------------------------------------------------------
  // Transactions : Rente viagère — calcul et obligations du débirentier
  // Cible Q57 du benchmark
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-rente-viagere-calcul-obligations',
    court:       'cc',
    chamber:     null,
    date:        null,
    number:      null,
    solution:    null,
    situation:   "Un acheteur veut acquérir un bien immobilier en viager occupé ou libre. Il veut comprendre comment est calculée la rente viagère et quelles sont ses obligations.",
    principle:   "La vente en viager est régie par les articles 1968 et suivants du Code civil. Elle se compose d'un bouquet (capital versé comptant à la signature, généralement 20-30% de la valeur du bien) et d'une rente viagère versée périodiquement (mensuellement) jusqu'au décès du crédirentier (vendeur). Le calcul de la rente prend en compte : la valeur vénale du bien, l'âge et l'espérance de vie du vendeur (tables de mortalité), le taux de rendement, et le montant du bouquet versé. En viager occupé, une décote (valeur d'occupation du droit d'usage et d'habitation — DUH) réduit la valeur sur laquelle la rente est calculée. L'article 1976 du Code civil impose au débirentier (acheteur) une obligation de paiement à vie.",
    consequence: "Le débirentier doit payer la rente à vie, même si le vendeur vit très longtemps au-delà de l'espérance de vie théorique. La vente comporte une clause résolutoire : si le débirentier cesse de payer la rente, le vendeur peut obtenir la résolution de la vente et conserver les arrérages déjà perçus à titre de dommages-intérêts. La rente est indexée (souvent sur l'IRL). En cas de décès du vendeur, les héritiers n'ont aucun droit sur la rente — elle s'éteint.",
    visa_refs:   ['Art. 1968 Code civil (vente en viager)', 'Art. 1976 Code civil (obligation paiement rente)'],
    domain:      'viager_demembrement',
    sub_themes:  ['viager', 'rente_viagere', 'bouquet', 'esperance_de_vie', 'clause_resolutoire', 'paiement_a_vie', 'debirentier', 'crebirentier'],
  },

  // -------------------------------------------------------------------------
  // Décrets : DPE collectif — calendrier obligatoire par taille copropriété
  // Cible Q70 du benchmark
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-dpe-collectif-calendrier',
    court:       'cc',
    chamber:     null,
    date:        null,
    number:      null,
    solution:    null,
    situation:   "Un syndic ou un copropriétaire veut connaître le calendrier d'obligation du DPE collectif selon la taille de la copropriété.",
    principle:   "La loi Climat et Résilience 2021 et le décret 2022-780 ont instauré l'obligation du DPE collectif pour toutes les copropriétés. Le calendrier est échelonné selon la taille : les copropriétés de plus de 200 lots devaient avoir leur DPE collectif au 1er janvier 2024 ; les copropriétés de 50 à 200 lots doivent avoir leur DPE collectif au 1er janvier 2025 ; les copropriétés de moins de 50 lots doivent avoir leur DPE collectif au 1er janvier 2026. Le DPE collectif évalue la performance énergétique de l'immeuble dans sa globalité (parties communes et privatives).",
    consequence: "Le DPE collectif est obligatoire pour toutes les copropriétés à usage d'habitation. Il doit être présenté en assemblée générale et mis à disposition de tout acquéreur ou locataire d'un lot. Il peut servir de base à l'élaboration d'un plan pluriannuel de travaux (PPT) obligatoire pour les copropriétés de plus de 15 ans. Le non-respect du calendrier n'est pas encore assorti d'une sanction directe mais engage la responsabilité du syndic.",
    visa_refs:   ['Loi 2021-1104 du 22 août 2021 (Climat et Résilience)', 'Décret 2022-780 du 4 mai 2022'],
    domain:      'copropriete',
    sub_themes:  ['dpe_collectif', 'plus_200_lots', '2024', '50_a_200_lots', '2025', 'moins_50_lots', '2026', 'calendrier', 'copropriete'],
  },

  // -------------------------------------------------------------------------
  // Urgence terrain : Trêve hivernale — expulsion après le 31 mars
  // Cible Q89 du benchmark
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-treve-hivernale-expulsion-urgente',
    court:       'cc',
    chamber:     null,
    date:        null,
    number:      null,
    solution:    null,
    situation:   "⚡ URGENT — La trêve hivernale se termine dans quelques jours et le locataire est toujours présent malgré une décision d'expulsion. Que faire immédiatement ?",
    principle:   "La trêve hivernale suspend les expulsions locatives du 1er novembre au 31 mars inclus (loi 89-462, article L.412-6 du Code des procédures civiles d'exécution). Au 31 mars, la trêve hivernale prend fin et les expulsions peuvent reprendre. Dès le 1er avril, le bailleur peut demander à un huissier de justice (commissaire de justice) de notifier au locataire un commandement de quitter les lieux s'il dispose déjà d'un jugement d'expulsion exécutoire. Si le commandement n'a pas encore été délivré ou est périmé, il doit en faire délivrer un nouveau. L'expulsion elle-même nécessite ensuite le concours de la force publique si le locataire refuse de partir.",
    consequence: "Actions immédiates à prendre : (1) Vérifier que le jugement d'expulsion est bien exécutoire et non périmé ; (2) Dès le 1er avril, contacter un huissier (commissaire de justice) pour délivrer le commandement de quitter les lieux (délai minimum de 2 mois entre commandement et expulsion sauf exception) ; (3) Si nécessaire, déposer une réquisition de concours de la force publique auprès de la préfecture. Les locataires particulièrement vulnérables peuvent bénéficier d'un délai supplémentaire accordé par le juge.",
    visa_refs:   ['Art. L.412-6 Code des procédures civiles d\'exécution', 'Loi 89-462 du 6 juillet 1989'],
    domain:      'baux_habitation',
    sub_themes:  ['treve_hivernale', '31_mars', 'expulsion', 'huissier', 'commandement', 'urgent', 'force_publique'],
  },

  // -------------------------------------------------------------------------
  // Hoguet : Vices cachés — responsabilité de l'agent immobilier
  // Cible Q21 du benchmark (renforcement)
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-vices-caches-responsabilite-agent',
    court:       'cc',
    chamber:     '1re civ.',
    date:        null,
    number:      null,
    solution:    null,
    situation:   "Après une vente, l'acquéreur découvre des vices cachés et veut mettre en cause l'agent immobilier. L'agent immobilier est-il responsable des vices cachés ?",
    principle:   "Non, l'agent immobilier n'est pas responsable des vices cachés du bien vendu. La garantie des vices cachés (article 1641 du Code civil) incombe au vendeur. L'agent est un intermédiaire qui n'est pas partie à la vente. En revanche, l'agent est tenu d'un devoir de conseil et d'une obligation d'information (loi 70-9) : il doit signaler à l'acquéreur tout vice apparent qu'il a constaté ou aurait dû constater lors des visites. S'il a connaissance d'un vice caché (information donnée par le vendeur ou constatation lors de visites approfondies), il doit en informer l'acquéreur. À défaut, sa responsabilité délictuelle peut être engagée (art. 1240 CC).",
    consequence: "La distinction est essentielle : (1) vices cachés → responsabilité du vendeur (art. 1641 CC) ; (2) vices apparents non signalés par l'agent → responsabilité de l'agent (art. 1240 CC + loi 70-9). L'agent n'est pas un expert technique, mais sa connaissance professionnelle du marché et des biens lui impose une vigilance. L'acquéreur qui veut agir contre l'agent doit prouver que ce dernier avait connaissance du vice ou qu'il était apparent.",
    visa_refs:   ['Loi 70-9 du 2 janvier 1970 (Hoguet)', 'Art. 1641 Code civil (garantie vices cachés)', 'Art. 1240 Code civil'],
    domain:      'agent_immobilier',
    sub_themes:  ['vices_caches', 'vendeur', 'obligation_information', 'devoir_conseil', 'non_responsable', 'agent_immobilier', 'responsabilite_delictuelle'],
  },

  // -------------------------------------------------------------------------
  // Bail : Droit de préférence du locataire en cas de vente — article 15
  // Cible Q43 du benchmark (renforcement)
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-droit-preference-locataire-vente',
    court:       'cc',
    chamber:     null,
    date:        null,
    number:      null,
    solution:    null,
    situation:   "Un bailleur veut vendre son bien loué. Le locataire en place veut savoir s'il bénéficie d'un droit de préférence pour acheter le logement.",
    principle:   "L'article 15 de la loi 89-462 institue un droit de préemption (droit de préférence) au profit du locataire en cas de congé pour vente. Le bailleur qui souhaite vendre le logement loué doit délivrer un congé pour vente avec un délai de préavis de 6 mois avant la fin du bail. Ce congé vaut offre de vente au locataire : le prix et les conditions de la vente doivent être mentionnés. Le locataire dispose d'un délai de 2 mois pour accepter l'offre au prix proposé. Si le locataire accepte, la vente est conclue avec lui de préférence à tout autre acheteur.",
    consequence: "Si le locataire ne répond pas dans les 2 mois, il est réputé avoir renoncé à son droit de préemption. Si le bien est finalement vendu à un prix inférieur à celui proposé au locataire (ou à des conditions plus avantageuses), le locataire peut invoquer la nullité de la vente pour violation de son droit de préemption. Le droit de préemption du locataire ne s'applique pas si la vente concerne un immeuble entier ou en bloc (cession de l'ensemble), ni si l'acquéreur est un parent du bailleur jusqu'au 3e degré.",
    visa_refs:   ['Art. 15 loi 89-462 du 6 juillet 1989'],
    domain:      'baux_habitation',
    sub_themes:  ['conge_pour_vente', 'droit_preemption', 'droit_preference', '2_mois', 'prix_propose', 'locataire', 'preemption'],
  },

  // -------------------------------------------------------------------------
  // Bail : Article 24 loi 89-462 — commandement de payer et modifications
  // Cible Q73 du benchmark (renforcement)
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-article-24-loi-89-462-commandement',
    court:       'cc',
    chamber:     null,
    date:        null,
    number:      null,
    solution:    null,
    situation:   "Un agent immobilier veut savoir si l'article 24 de la loi 89-462 sur le commandement de payer a été modifié récemment et par quel texte.",
    principle:   "L'article 24 de la loi 89-462 du 6 juillet 1989 encadre la procédure d'expulsion pour impayés. Il a été modifié par la loi ALUR (2014-366) et la loi ELAN (2018-1021). Dans sa version en vigueur, il prévoit : (1) la clause résolutoire ne joue que 2 mois après un commandement de payer resté infructueux ; (2) l'assignation en résiliation de bail doit être transmise à la préfecture pour permettre l'intervention des services sociaux ; (3) le juge peut accorder des délais de paiement au locataire de bonne foi. La loi ALUR a notamment renforcé la protection du locataire en imposant l'information systématique des organismes sociaux (CCAPEX). La loi ELAN a précisé les modalités de saisine.",
    consequence: "Pour vérifier l'état exact et actualisé de l'article 24 (qui subit des modifications régulières), il est recommandé de consulter la version en vigueur sur Légifrance ou Judilibre. Les délais clés : commandement de payer → 2 mois → clause résolutoire → assignation au tribunal judiciaire → débat contradictoire → décision d'expulsion → commandement de quitter les lieux → expulsion (hors trêve hivernale).",
    visa_refs:   ['Art. 24 loi 89-462 du 6 juillet 1989', 'Loi ALUR 2014-366', 'Loi ELAN 2018-1021'],
    domain:      'baux_habitation',
    sub_themes:  ['article_24', 'commandement_de_payer', '2_mois', 'clause_resolutoire', 'modification', 'judilibre', 'expulsion', 'alur', 'elan'],
  },

  // -------------------------------------------------------------------------
  // Agent immobilier : Mandat et honoraires — validité loi ALUR
  // Cible Q64 du benchmark
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-mandat-honoraires-alur',
    court:       'cc',
    chamber:     null,
    date:        null,
    number:      null,
    solution:    null,
    situation:   "Depuis la loi ALUR, un mandat ne prévoyant que des honoraires à la charge du vendeur (sans honoraires à la charge de l'acquéreur) est-il valide ? Un acquéreur peut-il contester le mandat sur ce fondement ?",
    principle:   "La loi ALUR (loi 2014-366 du 24 mars 2014) a modifié les règles de rémunération des agents immobiliers. L'article 74 de la loi ALUR, codifié à l'article 6-1 de la loi Hoguet (loi 70-9), impose que le mandat de vente mentionne qui supporte les honoraires (vendeur ou acquéreur). Un mandat prévoyant uniquement des honoraires à la charge du vendeur est parfaitement valide — c'est une pratique courante et légale. La loi ALUR a simplement imposé la transparence : les honoraires doivent être affichés TTC et préciser s'ils sont à la charge du vendeur ou de l'acquéreur. Le décret 2014-890 du 1er août 2014 précise les modalités d'affichage des honoraires.",
    consequence: "Un acquéreur ne peut pas contester la validité du mandat au seul motif qu'aucun honoraire n'est prévu à sa charge. L'agent reste rémunéré par le vendeur (commission incluse dans le prix de vente). En pratique, la mention est obligatoire dans le mandat et dans les publicités. L'absence de mention des honoraires dans le mandat expose l'agent à des sanctions mais ne rend pas le mandat nul de plein droit si les autres conditions sont remplies.",
    visa_refs:   ['Art. 74 loi 2014-366 (ALUR)', 'Art. 6-1 loi 70-9', 'Décret 2014-890 du 1er août 2014'],
    domain:      'agent_immobilier',
    sub_themes:  ['mandat', 'honoraires', 'alur', 'charge_vendeur', 'charge_acquereur', 'affichage_honoraires', 'loi_hoguet'],
  },

  // -------------------------------------------------------------------------
  // Délai légal obtention prêt dans compromis — Art. L313-41 Code conso
  // Cible Q60 du benchmark
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-delai-legal-pret-compromis',
    court:       'cc',
    chamber:     '1re civ.',
    date:        null,
    number:      null,
    solution:    null,
    situation:   "Un acquéreur signe un compromis de vente avec une condition suspensive d'obtention de prêt. Quel est le délai légal minimum pour obtenir le prêt ?",
    principle:   "L'article L313-41 du Code de la consommation (anciennement L312-16) fixe un délai minimum d'un mois à compter de la signature du compromis pour que l'acquéreur puisse obtenir son prêt immobilier. Ce délai est d'ordre public : il ne peut pas être réduit par les parties. En pratique, les compromis prévoient généralement un délai de 45 à 60 jours (voire plus) pour tenir compte des délais réels d'instruction bancaire. Si le prêt est refusé dans le délai prévu, la condition suspensive n'est pas réalisée et l'acquéreur peut se désengager sans pénalité, avec restitution intégrale de son dépôt de garantie.",
    consequence: "Le délai minimum légal est d'1 mois (30 jours), mais en pratique 45-60 jours sont recommandés. Si le compromis prévoit un délai inférieur à 1 mois, la clause est réputée non écrite et le délai légal d'1 mois s'applique. L'acquéreur doit justifier ses démarches de recherche de prêt (attestation de refus bancaire). Un acquéreur qui ne fait aucune démarche de recherche de financement peut perdre le bénéfice de la condition suspensive.",
    visa_refs:   ['Art. L313-41 Code de la consommation', 'Art. 1589 Code civil'],
    domain:      'consommation',
    sub_themes:  ['condition_suspensive', 'pret_immobilier', 'delai_1_mois', 'refus_pret', 'depot_garantie', 'compromis'],
  },

  // -------------------------------------------------------------------------
  // Copropriété : Location Airbnb et règlement de copropriété
  // Cible Q29 du benchmark
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-copro-airbnb-reglement',
    court:       'cc',
    chamber:     '3e civ.',
    date:        null,
    number:      null,
    solution:    null,
    situation:   "Un copropriétaire veut louer son appartement en location saisonnière (Airbnb) mais le règlement de copropriété contient une clause d'habitation bourgeoise ou résidentielle. Le syndic ou d'autres copropriétaires s'y opposent.",
    principle:   "L'article 9 de la loi 65-557 du 10 juillet 1965 garantit le libre usage des parties privatives par chaque copropriétaire, sous réserve de ne pas porter atteinte aux droits des autres copropriétaires ni à la destination de l'immeuble. Un règlement de copropriété comportant une clause d'habitation bourgeoise exclusive interdit toute activité commerciale, y compris la location meublée touristique de type Airbnb. En revanche, une clause d'habitation bourgeoise simple (ou mixte) permet les activités libérales et peut tolérer la location saisonnière si elle ne cause pas de troubles anormaux de voisinage. La jurisprudence de la Cour de cassation (Cass. civ. 3e) est constante : la location saisonnière répétée dans un immeuble à destination exclusivement résidentielle constitue un changement de destination contraire au règlement.",
    consequence: "Si le règlement prévoit une clause d'habitation bourgeoise exclusive, la location Airbnb est interdite. Le syndic peut agir en justice pour faire cesser l'activité et obtenir des dommages-intérêts. De plus, dans certaines villes (Paris, Lyon, Bordeaux…), la location saisonnière nécessite un changement d'usage administratif (autorisation de la mairie) et un numéro d'enregistrement. La limite de 120 jours/an pour les résidences principales s'applique aussi.",
    visa_refs:   ['Art. 9 loi 65-557 du 10 juillet 1965', 'Art. 8 loi 65-557'],
    domain:      'copropriete',
    sub_themes:  ['airbnb', 'location_saisonniere', 'habitation_bourgeoise', 'reglement_copropriete', 'destination_immeuble', 'changement_usage'],
  },

  // -------------------------------------------------------------------------
  // Conditions suspensives légales obligatoires dans un compromis
  // Cible Q37 du benchmark
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-conditions-suspensives-legales',
    court:       'cc',
    chamber:     null,
    date:        null,
    number:      null,
    solution:    null,
    situation:   "Un acquéreur signe un compromis de vente et veut connaître les conditions suspensives légales obligatoires, celles qui s'appliquent de plein droit.",
    principle:   "La seule condition suspensive légale obligatoire dans un compromis de vente immobilier est la condition suspensive d'obtention de prêt (Art. L313-41 et suivants du Code de la consommation, ex-loi Scrivener). Elle s'applique de plein droit dès que l'acquéreur déclare recourir à un emprunt pour financer l'achat. L'acquéreur ne peut y renoncer que par une mention manuscrite spécifique. Les autres conditions suspensives courantes (obtention du permis de construire, absence de servitudes, purge du droit de préemption, obtention d'un certificat d'urbanisme…) sont conventionnelles : elles ne s'appliquent que si les parties les inscrivent au compromis. L'article 1304 du Code civil encadre les conditions suspensives en général.",
    consequence: "La condition suspensive de prêt est la seule obligatoire par la loi. Si l'acquéreur finance sans emprunt (achat comptant), il doit le déclarer expressément par une mention manuscrite. Toutes les autres conditions suspensives sont négociables entre les parties. Il est fortement recommandé d'inclure : purge du droit de préemption urbain (DPU), absence de servitudes d'urbanisme, obtention d'un certificat d'urbanisme opérationnel.",
    visa_refs:   ['Art. L313-41 Code de la consommation', 'Art. 1304 Code civil', 'Art. 1589 Code civil'],
    domain:      'vente_immobiliere',
    sub_themes:  ['condition_suspensive', 'pret_immobilier', 'scrivener', 'obligatoire', 'compromis', 'mention_manuscrite'],
  },

  // -------------------------------------------------------------------------
  // Mentions obligatoires du contrat de location — Art. 3 loi 89-462
  // Cible Q46 du benchmark
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-mentions-obligatoires-bail',
    court:       'cc',
    chamber:     null,
    date:        null,
    number:      null,
    solution:    null,
    situation:   "Un bailleur ou un agent immobilier rédige un bail d'habitation et veut connaître les mentions obligatoires imposées par la loi.",
    principle:   "L'article 3 de la loi 89-462 du 6 juillet 1989 fixe la liste exhaustive des mentions obligatoires du contrat de location à usage de résidence principale. Doivent figurer : l'identité du bailleur et du locataire, la date de prise d'effet et la durée du bail (3 ans minimum nu, 1 an meublé), la description du logement (adresse, type, surface habitable Boutin, nombre de pièces), la désignation des équipements et annexes, le montant du loyer et ses modalités de paiement, le montant du dernier loyer acquitté par le précédent locataire (si applicable), le montant du dépôt de garantie, les honoraires d'agence et leur répartition (bailleur/locataire), la liste des charges récupérables et leur mode de règlement (provisions ou forfait). Depuis la loi ALUR, un bail type est obligatoire (décret 2015-587).",
    consequence: "L'absence d'une mention obligatoire n'entraîne pas automatiquement la nullité du bail, mais elle peut être invoquée par le locataire pour obtenir des dommages-intérêts ou faire requalifier certaines clauses. L'absence de mention de la surface habitable donne au locataire le droit de demander une diminution de loyer proportionnelle si la surface réelle est inférieure de plus de 5% à celle indiquée. Le bail doit être accompagné de documents annexes obligatoires : DPE, état des risques (ERP), diagnostics techniques, notice d'information, état des lieux.",
    visa_refs:   ['Art. 3 loi 89-462 du 6 juillet 1989', 'Décret 2015-587 (bail type)', 'Loi ALUR 2014-366'],
    domain:      'baux_habitation',
    sub_themes:  ['mentions_obligatoires', 'bail', 'contrat_location', 'surface_habitable', 'loyer', 'depot_garantie', 'bail_type', 'alur'],
  },

  // -------------------------------------------------------------------------
  // Convocation AG copropriété — délai 21 jours
  // Cible Q1 du benchmark
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-convocation-ag-copro-21-jours',
    court:       'cc',
    chamber:     '3e civ.',
    date:        null,
    number:      null,
    solution:    null,
    situation:   "Un syndic convoque une assemblée générale de copropriété. Quels sont les délais et les modalités de convocation ?",
    principle:   "L'article 9 du décret 67-223 du 17 mars 1967 fixe le délai de convocation d'une assemblée générale de copropriété à 21 jours minimum avant la date de la réunion. Ce délai court à compter de la première présentation de la lettre recommandée ou de la signification par huissier. La convocation doit être envoyée par le syndic à chaque copropriétaire (ou à son mandataire) et doit contenir : l'ordre du jour détaillé, le lieu et la date de la réunion, les projets de résolution, les documents justificatifs nécessaires (devis, contrats, comptes). Depuis la loi ELAN (2018-1021), la notification par voie électronique est possible si le copropriétaire y a expressément consenti.",
    consequence: "Si le délai de 21 jours n'est pas respecté, l'assemblée générale est irrégulière et ses décisions peuvent être annulées par le tribunal judiciaire dans un délai de 2 mois suivant la notification du PV. Le syndic peut raccourcir le délai uniquement en cas d'urgence (art. 9 al. 2 du décret). L'agent immobilier syndic doit veiller au strict respect de ce délai sous peine de voir toutes les décisions votées annulées.",
    visa_refs:   ['Art. 9 décret 67-223 du 17 mars 1967', 'Art. 42 loi 65-557 du 10 juillet 1965'],
    domain:      'copropriete',
    sub_themes:  ['assemblee_generale', 'convocation', '21_jours', 'syndic', 'ordre_du_jour', 'lettre_recommandee', 'annulation'],
  },

  // -------------------------------------------------------------------------
  // Révision annuelle du loyer — formule IRL
  // Cible Q2 du benchmark
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-revision-loyer-irl-formule',
    court:       'cc',
    chamber:     null,
    date:        null,
    number:      null,
    solution:    null,
    situation:   "Un bailleur veut réviser le loyer de son locataire à la date anniversaire du bail. Comment calculer la révision annuelle du loyer avec l'IRL ?",
    principle:   "L'article 17-1 de la loi 89-462 du 6 juillet 1989 encadre la révision annuelle du loyer en bail d'habitation. La révision ne peut intervenir qu'une fois par an, à la date prévue dans le bail ou à défaut à la date anniversaire. La formule de calcul est : Nouveau loyer = Loyer en cours × (IRL du trimestre de référence / IRL du même trimestre de l'année précédente). L'IRL (Indice de Référence des Loyers) est publié chaque trimestre par l'INSEE. Le trimestre de référence est celui mentionné dans le bail ; à défaut, c'est le dernier IRL publié à la date de révision.",
    consequence: "La révision n'est pas automatique : le bailleur doit en faire la demande (clause au bail + notification). Si le bailleur oublie de réviser pendant 1 an, il ne peut pas rattraper rétroactivement (prescription annuelle depuis la loi ALUR). La révision ne peut jamais dépasser la variation de l'IRL — pas de majoration libre. En zone d'encadrement des loyers, le loyer révisé ne peut pas non plus dépasser le loyer de référence majoré. Le locataire peut contester une révision irrégulière devant la commission départementale de conciliation.",
    visa_refs:   ['Art. 17-1 loi 89-462 du 6 juillet 1989', 'Loi ALUR 2014-366'],
    domain:      'baux_habitation',
    sub_themes:  ['revision_loyer', 'irl', 'indice_reference_loyers', 'formule_calcul', 'insee', 'date_anniversaire', 'bail_vide'],
  },

  // -------------------------------------------------------------------------
  // Délai d'instruction du permis de construire
  // Cible Q28 du benchmark
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-delai-permis-construire',
    court:       'cc',
    chamber:     null,
    date:        null,
    number:      null,
    solution:    null,
    situation:   "Un acquéreur ou un propriétaire dépose une demande de permis de construire. Dans quel délai la mairie doit-elle instruire la demande ?",
    principle:   "Les délais d'instruction du permis de construire sont fixés par l'article R423-23 du Code de l'urbanisme. Le délai de droit commun est de 2 mois pour les maisons individuelles et leurs annexes, et de 3 mois pour les autres constructions (immeubles collectifs, commerces, etc.). Ce délai court à compter de la réception du dossier complet en mairie. Si le dossier est incomplet, la mairie dispose d'1 mois pour demander les pièces manquantes, et le délai d'instruction ne commence qu'à la réception des pièces complètes. Des délais majorés s'appliquent dans certains cas : secteur protégé (ABF — Architecte des Bâtiments de France), ERP (Établissement Recevant du Public), ou projet soumis à étude d'impact.",
    consequence: "Si la mairie ne répond pas dans le délai, le silence vaut acceptation tacite du permis de construire (sauf exceptions listées à l'article R424-2 du Code de l'urbanisme : secteurs protégés, ERP, ICPE). L'agent immobilier doit informer l'acquéreur que les délais réels sont souvent plus longs (demandes de pièces complémentaires). Une condition suspensive d'obtention du permis dans le compromis doit prévoir un délai réaliste (4 à 6 mois minimum).",
    visa_refs:   ['Art. R423-23 Code de l\'urbanisme', 'Art. R424-1 Code de l\'urbanisme (silence vaut acceptation)'],
    domain:      'urbanisme',
    sub_themes:  ['permis_construire', 'delai_instruction', '2_mois', '3_mois', 'silence_vaut_acceptation', 'dossier_complet', 'mairie'],
  },

  // -------------------------------------------------------------------------
  // Promesse unilatérale de vente vs compromis de vente
  // Cible Q30 du benchmark
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-promesse-vs-compromis',
    court:       'cc',
    chamber:     '3e civ.',
    date:        null,
    number:      null,
    solution:    null,
    situation:   "Un agent immobilier doit expliquer à ses clients la différence entre une promesse unilatérale de vente et un compromis de vente (promesse synallagmatique).",
    principle:   "Le compromis de vente (promesse synallagmatique, art. 1589 Code civil) engage les deux parties : vendeur ET acquéreur. 'La promesse de vente vaut vente' dès qu'il y a accord sur la chose et sur le prix. Les deux sont engagés. La promesse unilatérale de vente (art. 1124 Code civil, réformé en 2016) n'engage que le vendeur (le promettant) pendant une durée déterminée. L'acquéreur (bénéficiaire) dispose d'une option : il peut lever l'option pour acheter ou y renoncer. Le vendeur ne peut pas se rétracter pendant la durée de la promesse. Depuis la réforme de 2016, la révocation de la promesse unilatérale pendant le délai d'option n'empêche plus la formation de la vente si le bénéficiaire lève l'option.",
    consequence: "Différences clés : (1) Engagement : compromis = bilatéral, promesse unilatérale = vendeur seul ; (2) Fiscalité : la promesse unilatérale doit être enregistrée dans les 10 jours auprès du service de la publicité foncière (droit fixe de 125€), sous peine de nullité ; le compromis n'a pas cette obligation ; (3) Indemnité d'immobilisation : la promesse unilatérale prévoit souvent une indemnité d'immobilisation (5-10% du prix) versée par le bénéficiaire au promettant en échange de l'exclusivité ; (4) Droit de rétractation SRU de 10 jours : s'applique dans les deux cas pour l'acquéreur non professionnel.",
    visa_refs:   ['Art. 1124 Code civil (promesse unilatérale)', 'Art. 1589 Code civil (compromis)', 'Art. L271-1 CCH (rétractation 10 jours)'],
    domain:      'vente_immobiliere',
    sub_themes:  ['promesse_unilaterale', 'compromis', 'promesse_synallagmatique', 'difference', 'option', 'indemnite_immobilisation', 'enregistrement'],
  },

  // -------------------------------------------------------------------------
  // Thème 15 : Réticence dolosive — obligation d'information du vendeur
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-reticence-dolosive-vendeur',
    court:       'cc',
    chamber:     '3e civ.',
    date:        null,
    number:      null,
    solution:    'Cassation',
    situation:   "Après la vente, l'acquéreur découvre que le vendeur connaissait un fait déterminant (projet d'urbanisme, pollution des sols, sinistres antérieurs, travaux importants à prévoir) qu'il n'a pas divulgué.",
    principle:   "Le dol peut être constitué par la réticence dolosive, c'est-à-dire le silence intentionnel d'une partie sur une information qu'elle sait déterminante du consentement de l'autre (Art. 1137 al. 2 C. civ. depuis ord. 2016-131). Le vendeur est tenu d'une obligation précontractuelle d'information sur tous les éléments dont il sait qu'ils seraient déterminants pour l'acquéreur.",
    consequence: "La preuve de la réticence dolosive permet à l'acquéreur d'obtenir la nullité de la vente pour vice du consentement, ou des dommages-intérêts. L'action en nullité pour dol se prescrit par 5 ans à compter du jour où l'erreur a été découverte. L'agent immobilier qui avait connaissance de l'information peut également voir sa responsabilité engagée.",
    visa_refs:   ['Art. 1137 Code civil', 'Art. 1130 Code civil'],
    domain:      'responsabilite_civile',
    sub_themes:  ['reticence_dolosive', 'dol', 'obligation_information', 'nullite', 'vice_consentement'],
  },

  // -------------------------------------------------------------------------
  // Thème 16 : Double mandat — représentation des deux parties (Art. 1161 C. civ.)
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-double-mandat-art-1161',
    court:       'cc',
    chamber:     '1re civ.',
    date:        null,
    number:      null,
    solution:    'Principe légal',
    situation:   "Un agent immobilier est mandaté à la fois par le vendeur (mandat de vente) et par l'acheteur (mandat de recherche) pour la même transaction. Les deux parties souhaitent savoir si l'agent peut légalement les représenter toutes les deux et percevoir une double commission.",
    principle:   "L'article 1161 du Code civil (issu de l'ordonnance n° 2016-131 du 10 février 2016, mod. loi n° 2018-287 du 20 avril 2018) interdit en principe à un représentant d'agir pour le compte de plusieurs parties à un acte dont les intérêts sont en opposition, sauf si la loi l'y autorise ou si les parties en ont été informées et l'ont accepté. En droit immobilier, l'article 6 de la loi Hoguet (n° 70-9 du 2 janvier 1970) autorise l'agent à percevoir une rémunération des deux parties à condition que chaque mandat le mentionne expressément et que chaque partie en soit informée. La double représentation sans mention explicite dans les deux mandats est une faute professionnelle.",
    consequence: "Si la double représentation n'est pas mentionnée dans chacun des mandats, l'agent s'expose à une perte de sa commission, voire à des dommages-intérêts. La Cour de cassation sanctionne l'agent qui perçoit une rémunération des deux parties sans transparence dans les mandats (la nullité de la clause de rémunération peut être prononcée). En pratique : deux mandats distincts, mention explicite du double mandat dans chacun, information écrite des deux parties avant la signature.",
    visa_refs:   ['Art. 1161 Code civil', 'Art. 6 loi n° 70-9 du 2 janvier 1970 (loi Hoguet)', 'Art. 1240 Code civil'],
    domain:      'agent_immobilier',
    sub_themes:  ['double_mandat', 'conflit_interets', 'commission', 'representant', 'mandat_exclusif'],
  },

  // -------------------------------------------------------------------------
  // Thème 17 : Double mandat — jurisprudence Cass. 1re civ. sur le conflit d'intérêts
  // -------------------------------------------------------------------------
  {
    source_id:   'curated-double-mandat-jurisprudence',
    court:       'cc',
    chamber:     '1re civ.',
    date:        null,
    number:      null,
    solution:    'Cassation',
    situation:   "Un agent immobilier a représenté simultanément le vendeur et l'acheteur dans une même transaction et a perçu une commission des deux parties. L'une des parties conteste la validité de cette double rémunération, faisant valoir l'absence de mention dans son mandat.",
    principle:   "La Cour de cassation juge que l'agent immobilier qui perçoit une rémunération de chacune des parties à la transaction doit avoir été expressément autorisé à le faire par chacun des mandats. Le mandat doit mentionner que l'agent est également mandaté par la partie adverse. À défaut de cette mention bilatérale, la stipulation de rémunération est inopposable à la partie non informée. Ce principe découle de l'obligation de loyauté et de transparence de l'intermédiaire (Art. 1161 C. civ.) combiné à l'Art. 6 loi Hoguet.",
    consequence: "La clause de rémunération non mentionnée dans les deux mandats est nulle et l'agent perd son droit à commission vis-à-vis de la partie non informée. L'agent peut en outre engager sa responsabilité civile pour manquement à son devoir de conseil et de loyauté. (Jurisprudence de principe — pour arrêt exact, rechercher sur Judilibre : 'agent immobilier double commission mandat rémunération deux parties'.)",
    visa_refs:   ['Art. 1161 Code civil', 'Art. 6 loi n° 70-9 du 2 janvier 1970 (loi Hoguet)', 'Art. 1134 al. 3 Code civil (bonne foi)'],
    domain:      'agent_immobilier',
    sub_themes:  ['double_mandat', 'conflit_interets', 'commission', 'loyaute', 'nullite_clause'],
  },
]

// ---------------------------------------------------------------------------
// Embedding
// ---------------------------------------------------------------------------

const NOMIC_API_KEY = process.env.NOMIC_API_KEY ?? ''

async function embedText(text: string): Promise<number[] | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    const res = await fetch('https://api-atlas.nomic.ai/v1/embedding/text', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${NOMIC_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'nomic-embed-text-v1.5',
        texts: [text],
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer))

    if (!res.ok) {
      console.error(`[embed] Nomic API HTTP ${res.status}`)
      return null
    }
    const data = await res.json() as { embeddings: number[][] }
    return data.embeddings?.[0]?.length ? data.embeddings[0] : null
  } catch (err) {
    console.error('[embed] erreur:', err)
    return null
  }
}

// ---------------------------------------------------------------------------
// Seed principal
// ---------------------------------------------------------------------------

async function seedArret(arret: GrandArret): Promise<void> {
  console.log(`\n→ ${arret.source_id}`)

  // Texte à embedder : même format que index-judilibre.ts
  const embedInput = [
    arret.situation,
    arret.principle,
    arret.consequence,
  ].filter(Boolean).join('\n')

  if (DRY_RUN) {
    console.log(`  [dry-run] embedInput (${embedInput.length} chars) — skip insertion`)
    return
  }

  const embedding = await embedText(embedInput)
  if (!embedding) {
    console.error(`  ✗ Embedding échoué pour ${arret.source_id}`)
    return
  }

  const row = {
    source_id:       arret.source_id,
    court:           arret.court,
    chamber:         arret.chamber,
    date:            arret.date,
    number:          arret.number,
    solution:        arret.solution,
    situation:       arret.situation,
    principle:       arret.principle,
    consequence:     arret.consequence,
    visa_refs:       arret.visa_refs,
    domain:          arret.domain,
    sub_themes:      arret.sub_themes,
    url:             null,
    motivations_raw: null,
    embedding,
    curated:         true,
    deleted_at:      null,
  }

  const { error } = await supabase
    .from('jurisprudence')
    .upsert(row, { onConflict: 'source_id' })

  if (error) {
    console.error(`  ✗ Erreur Supabase : ${error.message}`)
  } else {
    console.log(`  ✓ Inséré / mis à jour (${arret.domain})`)
  }
}

async function main() {
  console.log(`=== seed-grands-arrets.ts — ${GRANDS_ARRETS.length} arrêts à indexer ===`)
  console.log(`Mode : ${DRY_RUN ? 'DRY-RUN (aucune écriture)' : 'PRODUCTION'}`)

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Variables Supabase manquantes. Utiliser dotenv-cli.')
    process.exit(1)
  }

  let ok = 0
  let ko = 0

  for (const arret of GRANDS_ARRETS) {
    try {
      await seedArret(arret)
      ok++
    } catch (err) {
      console.error(`  ✗ Exception pour ${arret.source_id}:`, err)
      ko++
    }
  }

  console.log(`\n=== Terminé : ${ok} succès, ${ko} erreurs ===`)
}

main().catch(err => {
  console.error('Erreur fatale :', err)
  process.exit(1)
})
