// lib/legal-playbooks.ts
// Playbooks V2 : scénarios juridiques pilotes pour le moteur legal-brief
// Matching déterministe, sans LLM — normalisation + triggers pondérés
// Phase 1 : 3 playbooks benchmark (Q1 vente, Q2 gestion locative, Q3 SPANC)
// Phase 2 : 3 nouveaux cas (Q4 copropriété travaux, Q5 DPE erroné, Q6 responsabilité agent)
// Phase 3 : 3 nouveaux cas (Q7 expulsion, Q8 DPE F/G interdits, Q9 mandat exclusif)

export type PlaybookAuthorityHint = {
  law: string
  artNum: string
  label: string
  required: boolean
}

export type LegalPlaybook = {
  id: string
  canonicalQuestion: string
  domain: string
  triggers: string[]
  forcedArticles: PlaybookAuthorityHint[]
  requiredDistinctions: string[]
  forbiddenAssertions: string[]
  practicalOutcome: string[]
  confidenceStyle: 'strict' | 'guarded' | 'practical'
}

// ─────────────────────────────────────────────────────────────────────────────
// Playbooks pilotes
// ─────────────────────────────────────────────────────────────────────────────

const PLAYBOOKS: LegalPlaybook[] = [
  // ── PHASE 1 ───────────────────────────────────────────────────────────────

  {
    id: 'vente_offre_contre_signee',
    canonicalQuestion:
      "Une offre d'achat contresignée par le vendeur oblige-t-elle l'acquéreur à acheter ?",
    domain: 'vente_immobiliere',
    triggers: [
      "offre d'achat contresignee",
      "offre achat contresignee",
      "offre contresignee vendeur",
      "offre contresignee oblige",
      "offre d achat contresignee",
      "offre d'achat signee vendeur",
      "offre signee par le vendeur",
      "vendeur a signe l offre",
      "vendeur signe offre achat",
      "contresignee par le vendeur",
      "contresignature vendeur offre",
      "offre acceptee vendeur oblige",
      "offre achat acceptee vendeur",
    ],
    forcedArticles: [
      { law: 'code civil', artNum: '1113', label: 'Art. 1113 — formation du contrat', required: true },
      { law: 'code civil', artNum: '1114', label: 'Art. 1114 — offre de contracter', required: true },
      { law: 'code civil', artNum: '1589', label: 'Art. 1589 — promesse de vente vaut vente', required: true },
      { law: 'code de la construction et de l\'habitation', artNum: 'L271-1', label: 'Art. L271-1 CCH — droit de rétractation acquéreur', required: true },
      { law: 'code civil', artNum: '1304', label: 'Art. 1304 — conditions suspensives', required: false },
      { law: 'code de la consommation', artNum: 'L313-41', label: 'Art. L313-41 — condition suspensive crédit', required: false },
    ],
    requiredDistinctions: [
      "offre seule vs offre contresignée vs compromis ou promesse synallagmatique",
      "théorie de la formation du contrat (Code civil) vs réalité pratique du contentieux",
      "conditions suspensives (prêt immobilier, urbanisme) et leur impact sur l'engagement",
      "délai de rétractation de 10 jours de l'acquéreur non professionnel en matière d'habitation (L271-1)",
      "exécution forcée théoriquement possible mais nécessite une action en justice — non automatique en pratique",
    ],
    forbiddenAssertions: [
      "l'acquéreur est forcément tenu d'acheter",
      'la vente est définitivement parfaite',
      "l'exécution forcée est automatique",
      'le vendeur peut obliger mécaniquement l\'acquéreur à signer',
    ],
    practicalOutcome: [
      "Une offre d'achat contresignée par le vendeur peut en principe engager les deux parties si elle réunit les conditions d'une rencontre des volontés (art. 1113 Code civil). Vérifier la nature du document est la première démarche : offre simple, offre contresignée, ou compromis de vente ? La qualification juridique du document conditionne toute la suite.",
      "Cet engagement doit être systématiquement nuancé : vérifier la rédaction du document et les conditions suspensives stipulées (notamment la condition suspensive d'obtention de prêt immobilier, art. L313-41 Code de la consommation), et la nature du bien (habitation → droit de rétractation L271-1 Code de la construction et de l'habitation).",
      "Le délai de rétractation de 10 jours (art. L271-1) constitue la protection centrale de l'acquéreur non professionnel pour un bien à usage d'habitation — il peut se rétracter sans motif ni pénalité.",
      "L'exécution forcée est théoriquement possible (art. 1589 Code civil — promesse de vente vaut vente), mais elle nécessite une action en justice et reste rarement accordée en pratique : les juges privilégient les dommages-intérêts. L'engagement n'est donc pas automatique.",
      "Consulter un notaire ou un avocat spécialisé pour qualifier le document (offre simple ou compromis de vente ?) et évaluer l'impact des conditions suspensives, notamment la condition de prêt immobilier. Sans cette qualification, toute conclusion sur l'engagement des parties reste incertaine.",
    ],
    confidenceStyle: 'guarded',
  },

  {
    id: 'gestion_locative_depot_garantie',
    canonicalQuestion:
      "Le propriétaire me demande de retenir une partie du dépôt de garantie pour des dégradations, mais l'état des lieux de sortie est incomplet. Que peut faire l'agence de gestion ?",
    domain: 'gestion_locative',
    triggers: [
      'depot garantie etat des lieux incomplet',
      'retenue depot garantie etat des lieux',
      'etat des lieux incomplet depot',
      'depot garantie degradations etat lieux',
      'retenir depot garantie manque etat lieux',
      'etat des lieux de sortie incomplet',
      'agence gestion depot garantie',
      'retenue caution etat des lieux',
      'depot garantie retenue justification',
      'etat sortie incomplet retenue',
      'caution retenue degat etat lieux manquant',
      'etat des lieux sortie lacunaire',
    ],
    forcedArticles: [
      { law: 'loi 89-462', artNum: '22', label: 'Art. 22 — dépôt de garantie et délais de restitution', required: true },
      { law: 'code civil', artNum: '1731', label: 'Art. 1731 C. civ. — présomption de bon état', required: true },
      { law: 'loi hoguet', artNum: '6', label: 'Art. 6 loi Hoguet — obligations du mandataire', required: false },
    ],
    requiredDistinctions: [
      "fragilité probatoire liée à l'incomplétude vs impossibilité absolue de toute preuve",
      "rôle du bailleur (décision) vs rôle de l'agence mandataire (conseil et exécution)",
      "délais de restitution du dépôt (art. 22 loi 89-462) vs justification des retenues",
      "état des lieux incomplet : quelle valeur probatoire et quels éléments complémentaires possibles",
      "risque contentieux pour le bailleur vs conduite pratique prudente de l'agence",
    ],
    forbiddenAssertions: [
      'toute retenue est illégale',
      'photos ou témoignages sont sans valeur',
      "l'agence doit toujours restituer immédiatement",
      "l'état des lieux incomplet empêche absolument toute preuve",
    ],
    practicalOutcome: [
      "Alerter le bailleur par écrit dès réception de sa demande : lui exposer clairement le risque contentieux lié à l'état des lieux incomplet et documenter cette alerte pour la traçabilité de l'agence.",
      "Déconseiller formellement toute retenue en l'absence de justificatifs exploitables (photos datées, devis, attestations contradictoires). Rappeler que la charge de la preuve des dégradations pèse sur le bailleur (art. 1731 C. civ.).",
      "Proposer l'alternative la plus sûre : restituer dans les délais légaux (1 mois ou 2 mois selon l'état des lieux de sortie) pour éviter la majoration de 10 % par mois de retard prévue par l'art. 22 loi 89-462.",
      "Si le bailleur maintient sa demande malgré l'alerte, lui remettre par écrit l'état du dossier et refuser d'agir en dehors du mandat — l'agence ne peut pas décider seule de retenir.",
      "Risque contentieux : en cas de litige, l'art. 1731 C. civ. crée une présomption de bon état en faveur du locataire — cette présomption est très difficile à renverser sans état des lieux complet et contradictoire.",
    ],
    confidenceStyle: 'guarded',
  },

  {
    id: 'environnement_immo_spanc',
    canonicalQuestion:
      "Que faire si ma fosse septique n'est pas aux normes et que mon voisin m'a dénoncé ?",
    domain: 'environnement_immo',
    triggers: [
      'fosse septique pas aux normes voisin',
      'fosse septique voisin denonce',
      'assainissement non collectif denonciation',
      'spanc voisin plainte',
      'fosse septique denonciation voisin',
      'assainissement individuel voisin signalement',
      'non conformite fosse septique voisin',
      'fosse septique non conforme denonce',
      'spanc controle voisin',
      'installation assainissement voisin',
      'fosse septique norme voisin signale',
      'assainissement non collectif non conforme',
    ],
    forcedArticles: [
      { law: 'code de la santé publique', artNum: 'L1331-1-1', label: 'Art. L1331-1-1 CSP — obligations assainissement non collectif', required: true },
      { law: 'code de la santé publique', artNum: 'L1331-11-1', label: 'Art. L1331-11-1 CSP — contrôle SPANC et mise en conformité', required: true },
    ],
    requiredDistinctions: [
      "dénonciation du voisin vs déclenchement formel d'un contrôle SPANC : deux choses distinctes",
      "non-conformité simple vs danger sanitaire ou environnemental avéré : conséquences différentes",
      "texte légal applicable vs pratique administrative locale variable selon la commune",
      "situation lors d'une vente vs exploitation normale du bien : obligations différentes",
      "sanctions théoriques prévues par les textes vs décision effective de l'administration locale",
    ],
    forbiddenAssertions: [
      'la dénonciation entraîne automatiquement une sanction',
      'la commune imposera forcément des travaux immédiats',
      'amende de [montant précis] euros',
      'délai précis certain sans base textuelle fermée',
    ],
    practicalOutcome: [
      "Prendre contact directement avec le SPANC de la commune — c'est l'autorité compétente selon le Code de la Santé Publique (art. L1331-11-1 CSP) pour le contrôle de l'assainissement non collectif. La dénonciation du voisin ne constitue pas en elle-même un contrôle officiel ni une sanction.",
      "Demander au SPANC un rapport écrit précisant la nature des non-conformités constatées, le niveau de risque sanitaire ou environnemental (qui détermine l'urgence des travaux), et les délais de mise en conformité applicables localement.",
      "Distinguer deux situations selon l'art. L1331-1-1 CSP : (a) si le bien est en cours de vente, le diagnostic assainissement est obligatoire et les non-conformités doivent être portées à la connaissance de l'acquéreur ; (b) en exploitation normale, les délais de mise en conformité sont fixés par arrêté local.",
      "Ne mentionner ni montant de sanction ni délai précis sans base textuelle couverte — les sanctions théoriques existent (art. L1331-11-1 CSP) mais leur mise en œuvre effective relève de la décision administrative locale.",
      "Consulter un professionnel (entreprise de vidange agréée, bureau d'études) avant d'engager des travaux pour s'assurer de la conformité de la solution retenue.",
    ],
    confidenceStyle: 'strict',
  },

  // ── PHASE 2 ───────────────────────────────────────────────────────────────

  {
    id: 'syndic_travaux_urgents',
    canonicalQuestion:
      "Le syndic peut-il engager des travaux urgents sans vote préalable de l'assemblée générale ?",
    domain: 'copropriete',
    triggers: [
      // Triggers couvrant la question exacte Phase 2
      'syndic engager travaux urgents sans vote',
      'syndic travaux urgents vote prealable assemblee',
      'syndic peut il engager travaux urgents',
      'travaux urgents sans vote prealable assemblee',
      // Triggers larges
      'syndic travaux urgents sans ag',
      'travaux urgents copropriete sans vote',
      'syndic travaux sans assemblee',
      'travaux urgents syndic assemblee',
      'syndic a fait des travaux sans ag',
      'travaux copropriete sans vote ag',
      'syndic urgence travaux vote',
      'travaux sans convocation assemblee generale',
      'syndic decidé travaux seul',
      'travaux non votes copropriete',
      'travaux urgents sans autorisation ag',
      'charge travaux urgents copropriete',
    ],
    forcedArticles: [
      { law: 'loi 65-557', artNum: '18', label: 'Art. 18 loi 65-557 — pouvoirs du syndic, travaux urgents', required: true },
      { law: 'décret 67-223', artNum: '37', label: 'Art. 37 décret 67-223 — travaux urgents, obligation d\'information AG', required: true },
      { law: 'loi 65-557', artNum: '14', label: 'Art. 14 loi 65-557 — charges de copropriété', required: false },
      { law: 'code civil', artNum: '1240', label: 'Art. 1240 Code civil — responsabilité délictuelle', required: false },
    ],
    requiredDistinctions: [
      "travaux urgents légalement autorisés (art. 18 loi 65-557) vs travaux courants nécessitant un vote AG",
      "obligation d'information du syndic à l'AG dans les meilleurs délais après travaux urgents",
      "répartition des charges : les copropriétaires supportent les charges selon leurs tantièmes, même sans vote",
      "recours des copropriétaires contre le syndic si les travaux dépassaient l'urgence réelle",
      "distinction urgence réelle (risque immédiat pour la sécurité ou l'immeuble) vs simple commodité",
    ],
    forbiddenAssertions: [
      'le syndic n\'a jamais le droit de faire des travaux sans AG',
      'les copropriétaires ne doivent rien payer sans avoir voté',
      'tout travaux urgent est forcément illégal sans vote',
    ],
    practicalOutcome: [
      "Le syndic dispose légalement du pouvoir d'engager des travaux urgents sans vote préalable en AG (art. 18 loi 65-557 — copropriété). Ce pouvoir est strictement limité : l'urgence doit être réelle (risque immédiat pour la sécurité des personnes ou la conservation de l'immeuble) et non une simple anticipation de travaux courants.",
      "Après exécution des travaux urgents, le syndic a l'obligation légale d'en informer l'assemblée générale dans les meilleurs délais (art. 37 décret 67-223). À défaut, sa responsabilité peut être engagée vis-à-vis des copropriétaires.",
      "Les charges résultant de travaux urgents sont réparties entre les copropriétaires selon leurs tantièmes (art. 14 loi 65-557), même en l'absence de vote préalable. Le refus de payer expose le copropriétaire à une action en recouvrement.",
      "Pour contester les travaux : vérifier que l'urgence était réelle et documentée. Si les travaux dépassaient le cadre de l'urgence, une action en responsabilité contre le syndic (et/ou mise en cause lors de la prochaine AG) est envisageable. Consulter un avocat spécialisé en copropriété ou le conseil syndical.",
      "Action concrète : demander au syndic le rapport d'urgence justifiant les travaux (devis, rapport de l'entreprise, nature du sinistre). Ce document conditionne la légalité de la procédure.",
    ],
    confidenceStyle: 'guarded',
  },

  {
    id: 'vente_dpe_errone',
    canonicalQuestion:
      "Le vendeur peut-il être poursuivi si le DPE était erroné et que l'acheteur découvre après la vente une consommation bien plus élevée ?",
    domain: 'vente_immobiliere',
    triggers: [
      // Triggers couvrant la question exacte Phase 2
      'dpe errone vendeur poursuivi',
      'dpe errone acheteur vente vendeur',
      'vendeur poursuivi dpe errone',
      'dpe errone consommation elevee',
      'dpe errone acheteur decouvre apres vente',
      // Triggers larges
      'dpe errone vente',
      'dpe faux achat immobilier',
      'diagnostic performance energetique incorrect',
      'classe energetique fausse vente',
      'dpe inexact apres achat',
      'erreur dpe achat maison',
      'dpe mauvaise classe vente',
      'diagnostic energetique errone',
      'dpe opposable erreur',
      'dpe errone recours',
      'classe dpe incorrecte achat',
      'faux dpe immeuble',
    ],
    forcedArticles: [
      { law: 'code de la construction et de l\'habitation', artNum: 'L271-4', label: 'Art. L271-4 CCH — diagnostics techniques obligatoires annexés à l\'avant-contrat', required: true },
      { law: 'code civil', artNum: '1641', label: 'Art. 1641 Code civil — garantie des vices cachés', required: true },
      { law: 'code civil', artNum: '1604', label: 'Art. 1604 Code civil — obligation de délivrance conforme', required: false },
      { law: 'code civil', artNum: '1240', label: 'Art. 1240 Code civil — responsabilité délictuelle du diagnostiqueur', required: false },
    ],
    requiredDistinctions: [
      "DPE opposable depuis le 1er juillet 2021 (loi Climat-Résilience n° 2021-1104) vs anciens DPE informatifs non opposables",
      "recours contre le vendeur (vice caché art. 1641 Code civil ou délivrance non conforme) vs recours contre le diagnostiqueur (responsabilité délictuelle art. 1240 Code civil)",
      "DPE erroné mais sans impact sur la décision d'achat (indemnisation limitée) vs DPE erroné déterminant dans la décision d'achat (possibilité de réduction de prix)",
      "délai d'action : 2 ans pour les vices cachés à compter de la découverte, 5 ans pour la responsabilité contractuelle",
      "preuve de l'erreur : rapport d'un nouvel expert DPE vs DPE du diagnostiqueur initial",
    ],
    forbiddenAssertions: [
      'le DPE erroné entraîne automatiquement la nullité de la vente',
      'le vendeur est toujours responsable des erreurs du diagnostiqueur',
      'tout DPE erroné donne droit à une indemnisation automatique',
    ],
    practicalOutcome: [
      "Le DPE est opposable depuis le 1er juillet 2021 (loi Climat-Résilience n° 2021-1104). Un DPE erroné établi après cette date peut fonder une action contre le diagnostiqueur (art. 1240 Code civil — responsabilité délictuelle) et/ou contre le vendeur si l'erreur a vicié le consentement de l'acheteur.",
      "Recours prioritaire : faire établir un nouveau DPE par un diagnostiqueur certifié indépendant pour documenter l'écart avec le DPE initial. Cet écart est le fondement de toute action. Sans preuve de l'erreur, aucun recours sérieux n'est possible.",
      "Contre le vendeur : l'art. 1641 Code civil (vice caché) peut s'appliquer si la mauvaise classe énergétique constitue un défaut rendant le bien impropre à sa destination ou diminuant son usage de manière significative. Délai d'action : 2 ans à compter de la découverte de l'erreur.",
      "Contre le diagnostiqueur : sa responsabilité civile (art. 1240 Code civil) peut être engagée si une faute dans l'établissement du DPE est démontrée. La réparation couvre le préjudice réel (surcoût de travaux, perte de valeur, etc.).",
      "Consulter un avocat spécialisé en droit immobilier pour évaluer la stratégie (mise en cause du diagnostiqueur vs. du vendeur) selon la date du DPE, la nature de l'erreur et le préjudice subi. Vérifier également si le diagnostiqueur dispose d'une assurance responsabilité civile professionnelle.",
    ],
    confidenceStyle: 'guarded',
  },

  {
    id: 'agent_defaut_information',
    canonicalQuestion:
      "L'agent immobilier peut-il être responsable s'il n'a pas signalé un problème connu sur le bien au moment de la vente ?",
    domain: 'vente_immobiliere',
    triggers: [
      // Triggers couvrant la question exacte Phase 2
      'agent immobilier responsable probleme connu vente',
      'agent signale probleme connu vente',
      'agent responsable probleme connu bien',
      'agent immobilier n a pas signale probleme connu',
      // Triggers larges
      'agent immobilier n a pas signale probleme',
      'agent n a pas dit vice',
      'agent cache probleme vente',
      'responsabilite agent immobilier defaut information',
      'agent n a pas informe vice cache',
      'agent immobilier devoir conseil manquement',
      'agent n a pas signale defaut',
      'agent responsable probleme non signale',
      'agent immobilier n a pas revele probleme',
      'defaut conseil agent immobilier',
      'agent n a pas averti acheteur',
      'agent n a pas mentionne probleme',
    ],
    forcedArticles: [
      { law: 'code civil', artNum: '1240', label: 'Art. 1240 Code civil — responsabilité délictuelle', required: true },
      { law: 'code civil', artNum: '1231-1', label: 'Art. 1231-1 Code civil — dommages-intérêts contractuels', required: true },
      { law: 'loi 70-9', artNum: '6', label: 'Art. 6 loi Hoguet — obligations du mandataire', required: false },
      { law: 'code civil', artNum: '1641', label: 'Art. 1641 Code civil — garantie des vices cachés (vendeur)', required: false },
    ],
    requiredDistinctions: [
      "responsabilité de l'agent (défaut de conseil / devoir d'information) vs responsabilité du vendeur (vice caché art. 1641 Code civil)",
      "problème que l'agent connaissait effectivement vs problème qu'il ne pouvait pas connaître — la preuve de la connaissance est centrale",
      "devoir d'information de l'agent envers l'acheteur (obligation légale loi Hoguet) vs devoir de conseil au vendeur (mandant)",
      "préjudice indemnisable : différence de valeur du bien ou coût des travaux de remise en état",
      "prescription : 5 ans pour la responsabilité contractuelle et délictuelle (art. 2224 Code civil)",
    ],
    forbiddenAssertions: [
      'l\'agent est automatiquement responsable de tout vice caché',
      'l\'acheteur est toujours indemnisé si l\'agent n\'a rien dit',
      'le contrat de vente est nul automatiquement',
    ],
    practicalOutcome: [
      "L'agent immobilier est soumis à un devoir d'information et de conseil envers toutes les parties (loi Hoguet, art. 6 loi 70-9). S'il avait connaissance d'un problème (vice, sinistre passé, contentieux de voisinage, servitude non déclarée) et ne l'a pas signalé, sa responsabilité délictuelle peut être engagée (art. 1240 Code civil).",
      "La clé est de prouver que l'agent connaissait le problème : vérifier les documents remis lors du mandat, les échanges écrits, les rapports d'expertise antérieurs. Si le problème figurait dans un rapport que l'agent avait consulté, la preuve est facilitée.",
      "L'action contre l'agent est distincte de l'action contre le vendeur (garantie des vices cachés, art. 1641 Code civil). Les deux actions peuvent être menées simultanément. La responsabilité peut être partagée entre l'agent et le vendeur.",
      "Préjudice indemnisable : le montant des travaux de remise en état, la perte de valeur du bien, ou les frais engagés en raison du problème non signalé. Faire établir un devis ou une expertise contradictoire pour chiffrer le préjudice.",
      "Délai : agir dans les 5 ans à compter de la découverte du problème (art. 2224 Code civil — prescription de droit commun). Consulter un avocat spécialisé en droit immobilier pour évaluer la solidité du dossier avant toute mise en demeure.",
    ],
    confidenceStyle: 'guarded',
  },

  // ── PHASE 3 ───────────────────────────────────────────────────────────────

  {
    id: 'baux_loyers_impayes_expulsion',
    canonicalQuestion:
      "Que faire si mon locataire ne paie plus son loyer et que je veux l'expulser ?",
    domain: 'baux_habitation',
    triggers: [
      // Triggers couvrant la question canonique Phase 3
      'locataire ne paie plus son loyer expulser',
      'locataire ne paie plus loyer expulsion',
      'locataire ne paye pas loyer expulser',
      'loyer impaye expulsion locataire',
      'locataire impaye expulsion',
      'expulser locataire loyer impaye',
      // Triggers larges
      'loyer impaye que faire',
      'locataire ne paie plus',
      'locataire ne paye plus loyer',
      'commandement de payer locataire',
      'clause resolutoire bail',
      'expulsion locataire impaye',
      'procedure expulsion loyer',
      'expulsion bail impaye',
      'commandement payer loyer',
      'resiliation bail loyer impaye',
      'treve hivernale expulsion',
      'bailleur expulsion locataire',
    ],
    forcedArticles: [
      { law: 'loi 89-462', artNum: '24', label: 'Art. 24 loi 89-462 — commandement de payer, clause résolutoire et procédure d\'expulsion', required: true },
      { law: 'code des procédures civiles d\'exécution', artNum: 'L412-6', label: 'Art. L412-6 CPCE — trêve hivernale (1er nov. — 31 mars)', required: true },
      { law: 'code des procédures civiles d\'exécution', artNum: 'L411-1', label: 'Art. L411-1 CPCE — interdiction d\'expulser sans décision de justice', required: true },
      { law: 'code civil', artNum: '1728', label: 'Art. 1728 Code civil — obligation du locataire de payer le loyer', required: false },
    ],
    requiredDistinctions: [
      "commandement de payer (acte d'huissier) ≠ simple mise en demeure amiable",
      "délai de 2 mois après commandement avant saisine du tribunal judiciaire (art. 24 loi 89-462)",
      "rôle de la Commission de coordination des actions de prévention des expulsions locatives (CCAPEX) — alertée automatiquement",
      "trêve hivernale du 1er novembre au 31 mars : l'expulsion est interdite pendant cette période même avec décision de justice",
      "expulsion physique : nécessite un commandement de quitter les lieux + intervention du commissaire de justice",
    ],
    forbiddenAssertions: [
      'le bailleur peut changer les serrures ou couper les fluides lui-même',
      'l\'expulsion est possible immédiatement après un impayé',
      'la trêve hivernale n\'existe plus',
      'le locataire peut être expulsé sans décision de justice',
    ],
    practicalOutcome: [
      "Première démarche : envoyer une lettre recommandée de relance amiable puis faire délivrer par un commissaire de justice un commandement de payer (acte officiel). Ce commandement déclenche le délai légal de 2 mois et active la clause résolutoire du bail si elle est stipulée (art. 24 loi 89-462).",
      "Si le locataire ne règle pas dans les 2 mois suivant le commandement, saisir le tribunal judiciaire (juge des contentieux de la protection) en référé ou au fond pour obtenir la résiliation du bail et l'expulsion. Sans décision de justice, aucune expulsion n'est légale (art. L411-1 CPCE).",
      "Vérifier la période : si la décision de justice est rendue, l'expulsion physique est suspendue du 1er novembre au 31 mars (trêve hivernale, art. L412-6 CPCE). La trêve ne suspend pas la procédure judiciaire — seulement l'exécution de l'expulsion.",
      "Alerter la CAF si le locataire perçoit des aides au logement : l'APL peut être maintenue et versée directement au bailleur (tiers-payant). Cette démarche est souvent plus rapide que la procédure judiciaire pour obtenir un paiement partiel.",
      "Consulter un avocat spécialisé en baux d'habitation ou contacter directement un commissaire de justice : la procédure d'expulsion est strictement encadrée, les erreurs de forme invalident les actes et retardent la procédure de plusieurs mois.",
    ],
    confidenceStyle: 'strict',
  },

  {
    id: 'diagnostics_dpe_fg_interdits',
    canonicalQuestion:
      "Un logement classé G peut-il encore être loué en 2025 ?",
    domain: 'diagnostics',
    triggers: [
      // Triggers couvrant la question canonique Phase 3
      'logement classe g peut encore etre loue 2025',
      'logement classe g loue 2025',
      'logement classe g location 2025',
      'bien classe g location interdit',
      'dpe g location 2025',
      // Triggers larges
      'dpe g interdit location',
      'passoire thermique interdit location',
      'classe g location loi',
      'logement g louer interdit',
      'logement f interdit location',
      'dpe f location interdit',
      'passoire energetique location interdit',
      'classe f interdit louer',
      'logement indecent energie interdire',
      'location logement g 2025',
      'location passoire thermique 2025',
      'classe energetique interdite location',
      'gel loyer classe f g',
      'loyer classe g interdiction',
    ],
    forcedArticles: [
      { law: 'code de la construction et de l\'habitation', artNum: 'L173-2', label: 'Art. L173-2 CCH — interdiction de louer les logements à forte consommation (classe G à partir de 2025)', required: true },
      { law: 'loi 89-462', artNum: '17', label: 'Art. 17 loi 89-462 modifié — logement décent, seuil de performance énergétique', required: true },
      { law: 'loi climat-résilience', artNum: '160', label: 'Art. 160 loi Climat-Résilience n° 2021-1104 — calendrier d\'interdiction de location', required: false },
      { law: 'loi 89-462', artNum: '17-1', label: 'Art. 17-1 loi 89-462 — gel des loyers pour logements F et G', required: false },
    ],
    requiredDistinctions: [
      "interdiction de louer un logement G depuis le 1er janvier 2025 (nouveaux baux et renouvellements) vs baux en cours conclus avant 2025 (dispositions transitoires)",
      "gel des loyers : les logements classés F ou G ne peuvent pas faire l'objet d'une augmentation de loyer (art. 17-1 loi 89-462) depuis le 24 août 2022",
      "calendrier des interdictions : G dès 2025, F dès 2028, E dès 2034 (loi Climat-Résilience)",
      "seuil de consommation : classe G = consommation finale > 450 kWh/m²/an (décret n° 2021-19)",
      "sanctions : bailleur ne peut pas conclure de nouveau bail ni renouveler un bail pour un logement G — le locataire peut demander des travaux ou une réduction de loyer",
    ],
    forbiddenAssertions: [
      'tous les logements G sont immédiatement expulsables',
      'le locataire actuel peut être expulsé pour cause de DPE G',
      'le bailleur doit obligatoirement rénover avant toute autre démarche',
      'la vente du logement est interdite pour un bien classé G',
    ],
    practicalOutcome: [
      "Depuis le 1er janvier 2025, un logement classé G (consommation finale > 450 kWh/m²/an selon le décret n° 2021-19) ne peut plus faire l'objet d'un nouveau contrat de location résidentielle ni d'un renouvellement ou reconduction tacite (art. L173-2 CCH issu de la loi Climat-Résilience n° 2021-1104).",
      "Pour les baux en cours conclus avant le 1er janvier 2025 : le locataire en place ne peut pas être expulsé du seul fait de la classe G. Le bail se poursuit mais le bailleur ne peut pas augmenter le loyer (gel des loyers F et G depuis le 24 août 2022, art. 17-1 loi 89-462).",
      "Le propriétaire a trois options principales : (a) rénover le logement pour sortir de la classe G avant tout nouveau bail, (b) vendre le bien, (c) garder le locataire actuel en place sans possibilité de louer à un nouveau locataire. La rénovation n'est pas obligatoire mais conditionne la possibilité de louer.",
      "Calendrier complet à connaître : G interdit dès 2025, F interdit dès 2028, E interdit dès 2034 (loi Climat-Résilience, art. 160). Le bailleur qui anticipe sur les classes F évite une nouvelle mise en conformité dans 3 ans.",
      "Consulter un diagnostiqueur certifié pour un nouveau DPE — certains logements peuvent être reclassés après travaux légers (isolation, changement de système de chauffage). Contacter l'ADEME ou un conseiller France Rénov' pour les aides disponibles (MaPrimeRénov', CEE, éco-PTZ).",
    ],
    confidenceStyle: 'strict',
  },

  {
    id: 'agent_mandat_exclusif_resiliation',
    canonicalQuestion:
      "Un vendeur peut-il résilier un mandat exclusif avant 3 mois ?",
    domain: 'agent_immobilier',
    triggers: [
      // Triggers couvrant la question canonique Phase 3
      'vendeur resilier mandat exclusif avant 3 mois',
      'resiliation mandat exclusif avant 3 mois',
      'mandat exclusif resilier avant 3 mois',
      'vendeur peut resilier mandat exclusif',
      'mandat exclusif peut on rompre avant 3 mois',
      // Triggers larges
      'mandat exclusif resiliation',
      'resilier mandat exclusif',
      'rompre mandat exclusif agence',
      'mandat exclusif delai minimum',
      'mandat exclusif duree minimale',
      'sortir mandat exclusif',
      'quitter agence mandat exclusif',
      'mettre fin mandat exclusif',
      'mandat exclusif 3 mois incompressible',
      'mandat exclusif avant terme',
      'mandat exclusif rupture agence',
      'mandat exclusif preavis',
      'mandat exclusif lettre recommandee',
    ],
    forcedArticles: [
      { law: 'décret 72-678', artNum: '78', label: 'Art. 78 décret 72-678 — mandat exclusif : durée minimale 3 mois incompressibles et résiliation par LR/AR', required: true },
      { law: 'loi 70-9', artNum: '7', label: 'Art. 7 loi Hoguet — forme écrite obligatoire et contenu du mandat', required: true },
      { law: 'code civil', artNum: '1103', label: 'Art. 1103 Code civil — force obligatoire des contrats', required: false },
      { law: 'loi 70-9', artNum: '6', label: 'Art. 6 loi Hoguet — conditions de rémunération de l\'agent', required: false },
    ],
    requiredDistinctions: [
      "mandat exclusif vs mandat simple : seul le mandat exclusif est incompressible sur la durée initiale de 3 mois",
      "pendant les 3 premiers mois : résiliation impossible sauf faute de l'agence ou accord mutuel écrit des parties",
      "après 3 mois : résiliation possible par lettre recommandée avec AR avec un préavis de 15 jours avant chaque échéance (art. 78 décret 72-678)",
      "faute de l'agence justifiant résiliation anticipée : absence de compte-rendu d'activité, manquement aux obligations du mandat — à documenter",
      "honoraires dus si l'agence avait trouvé un acquéreur avant résiliation : la vente postérieure peut déclencher le droit à commission selon les clauses du mandat",
    ],
    forbiddenAssertions: [
      'le vendeur peut résilier à tout moment sans préavis',
      'le mandat exclusif peut être rompu sans lettre recommandée',
      'l\'agence n\'a droit à aucune indemnité en cas de rupture anticipée',
      'après 3 mois, aucun préavis n\'est nécessaire',
    ],
    practicalOutcome: [
      "Pendant les 3 premiers mois d'un mandat exclusif, le vendeur ne peut pas résilier unilatéralement le contrat (art. 78 décret n° 72-678 du 20 juillet 1972). Cette période est incompressible : ni la volonté du vendeur ni le désaccord sur le prix ne suffisent à rompre le mandat.",
      "Exception : si l'agence a manqué à ses obligations (absence de compte-rendus d'activité, défaut de publicité, comportement fautif documenté), le vendeur peut invoquer l'inexécution contractuelle pour demander la résiliation anticipée (art. 1103 et 1224 Code civil). Cette faute doit être documentée par écrit.",
      "Après 3 mois : le mandat peut être résilié par lettre recommandée avec avis de réception, en respectant un préavis de 15 jours avant chaque date d'échéance ou de reconduction (art. 78 décret 72-678). Sans ce préavis, le mandat est reconduit tacitement pour une nouvelle période.",
      "Risque d'honoraires post-résiliation : si l'agence avait présenté un acquéreur identifié avant la résiliation et que la vente se conclut finalement avec cet acquéreur après résiliation, l'agence peut réclamer ses honoraires. Vérifier les clauses du mandat sur ce point avant tout contact direct avec un acquéreur présenté par l'agence.",
      "Action pratique : lire le mandat signé (durée, clause de reconduction, préavis) et consulter un avocat ou la DGCCRF en cas de litige sur la résiliation. La DGCCRF traite les plaintes contre les pratiques commerciales illicites des agences immobilières.",
    ],
    confidenceStyle: 'guarded',
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// Helper : normalisation déterministe
// ─────────────────────────────────────────────────────────────────────────────

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    // Apostrophes typographiques et variantes → espace
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u02BC']/g, ' ')
    // Tirets et traits d'union → espace
    .replace(/[-–—]/g, ' ')
    // Normalisation Unicode NFC → décomposition → suppression des diacritiques (accents)
    // ex: "contresignée" → "contresignee", "acquéreur" → "acquereur"
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // Ponctuation superflue
    .replace(/[.,;:!?()[\]{}«»""]/g, ' ')
    // Espaces multiples
    .replace(/\s+/g, ' ')
    .trim()
}

// ─────────────────────────────────────────────────────────────────────────────
// detectLegalPlaybook
// Matching déterministe par triggers pondérés
//
// Stratégie de matching à deux niveaux :
//   1. Substring exact : si le trigger apparaît tel quel dans le texte normalisé
//   2. Bag-of-words : si tous les mots du trigger sont présents (non contigus)
//
// Pondération : triggers longs (plus de mots) → score plus élevé
// Priorité aux expressions longues (spécificité maximale)
// ─────────────────────────────────────────────────────────────────────────────

export function detectLegalPlaybook(message: string): LegalPlaybook | null {
  const normalized = normalizeText(message)
  // Ensemble de mots du texte normalisé pour le bag-of-words
  const wordSet = new Set(normalized.split(' ').filter((w) => w.length > 0))

  // Score par playbook : somme des triggers matchés, pondérée par nombre de mots
  const scores: Array<{ playbook: LegalPlaybook; score: number }> = PLAYBOOKS.map((playbook) => {
    let score = 0
    for (const trigger of playbook.triggers) {
      const normalizedTrigger = normalizeText(trigger)
      const triggerWords = normalizedTrigger.split(' ').filter((w) => w.length > 0)
      const wordCount = triggerWords.length

      if (normalized.includes(normalizedTrigger)) {
        // Match exact (substring) : poids fort
        score += wordCount * 2
      } else if (triggerWords.length >= 3 && triggerWords.every((w) => wordSet.has(w))) {
        // Match bag-of-words : tous les mots présents, mais pas contigus
        // Poids moins élevé que substring exact pour éviter les faux positifs
        score += wordCount
      }
    }
    return { playbook, score }
  })

  // Trier par score décroissant
  scores.sort((a, b) => b.score - a.score)

  const best = scores[0]
  if (!best || best.score === 0) return null

  return best.playbook
}

export { PLAYBOOKS }
