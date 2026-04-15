// lib/legal-playbooks.ts
// Playbooks V2 : scénarios juridiques pilotes pour le moteur legal-brief
// Matching déterministe, sans LLM — normalisation + triggers pondérés
// Phase 1 : 3 playbooks benchmark uniquement

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
      "offre seule vs offre contresign\u00e9e vs compromis ou promesse synallagmatique",
      "th\u00e9orie de la formation du contrat vs r\u00e9alit\u00e9 pratique du contentieux",
      "conditions suspensives (pr\u00eat, urbanisme) et leur impact sur l'engagement",
      "d\u00e9lai de r\u00e9tractation de 10 jours de l'acqu\u00e9reur non professionnel en mati\u00e8re d'habitation (L271-1 CCH)",
      "ex\u00e9cution forc\u00e9e th\u00e9oriquement possible mais non automatique en pratique",
    ],
    forbiddenAssertions: [
      "l'acquéreur est forcément tenu d'acheter",
      'la vente est définitivement parfaite',
      "l'exécution forcée est automatique",
      'le vendeur peut obliger mécaniquement l\'acquéreur à signer',
    ],
    practicalOutcome: [
      "Une offre d'achat contresignée par le vendeur peut en principe engager les deux parties si elle réunit les conditions d'une rencontre des volontés (art. 1113 C. civ.). Vérifier la nature du document est la première démarche : offre simple, offre contresignée, ou compromis de vente ? La qualification juridique du document conditionne toute la suite.",
      "Cet engagement doit être systématiquement nuancé : vérifier la rédaction du document et les conditions suspensives stipulées (notamment la condition suspensive d'obtention de prêt immobilier, art. L313-41 C. conso.), et la nature du bien (habitation → droit de rétractation L271-1 CCH).",
      "Le délai de rétractation de 10 jours (L271-1 CCH) constitue la protection centrale de l'acquéreur non professionnel pour un bien à usage d'habitation — il peut se rétracter sans motif ni pénalité.",
      "L'exécution forcée, fondée sur l'art. 1589 C. civ. (promesse de vente vaut vente), nécessite une action en justice et reste rarement accordée en pratique — les juges privilégient les dommages-intérêts. Consulter un notaire ou un avocat spécialisé pour évaluer les risques et qualifier le document.",
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
      "fragilit\u00e9 probatoire li\u00e9e \u00e0 l'incompl\u00e9tude vs impossibilit\u00e9 absolue de toute preuve",
      "r\u00f4le du bailleur (d\u00e9cision) vs r\u00f4le de l'agence mandataire (conseil et ex\u00e9cution)",
      "d\u00e9lais de restitution du d\u00e9p\u00f4t (art. 22 loi 89-462) vs justification des retenues",
      "\u00e9tat des lieux incomplet : quelle valeur probatoire et quels \u00e9l\u00e9ments compl\u00e9mentaires possibles",
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
      "d\u00e9nonciation du voisin vs d\u00e9clenchement formel d'un contr\u00f4le SPANC : deux choses distinctes",
      "non-conformit\u00e9 simple vs danger sanitaire ou environnemental av\u00e9r\u00e9 : cons\u00e9quences diff\u00e9rentes",
      "texte l\u00e9gal applicable vs pratique administrative locale variable selon la commune",
      "situation lors d'une vente vs exploitation normale du bien : obligations diff\u00e9rentes",
      "sanctions th\u00e9oriques pr\u00e9vues par les textes vs d\u00e9cision effective de l'administration locale",
    ],
    forbiddenAssertions: [
      'la dénonciation entraîne automatiquement une sanction',
      'la commune imposera forcément des travaux immédiats',
      // Les assertions avec montants précis sans source taggée sont interdites
      'amende de [montant précis] euros',
      'délai précis certain sans base textuelle fermée',
    ],
    practicalOutcome: [
      "Prendre contact directement avec le SPANC de la commune — c'est l'autorité compétente pour le contrôle de l'assainissement non collectif (art. L1331-11-1 CSP). La dénonciation du voisin ne constitue pas en elle-même un contrôle officiel ni une sanction.",
      "Demander au SPANC un rapport écrit précisant la nature des non-conformités constatées, le niveau de risque sanitaire ou environnemental (qui détermine l'urgence des travaux), et les délais de mise en conformité applicables localement.",
      "Distinguer deux situations selon l'art. L1331-1-1 CSP : (a) si le bien est en cours de vente, le diagnostic assainissement est obligatoire et les non-conformités doivent être portées à la connaissance de l'acquéreur ; (b) en exploitation normale, les délais de mise en conformité sont fixés par arrêté local.",
      "Ne mentionner ni montant de sanction ni délai précis sans base textuelle couverte — les sanctions théoriques existent (art. L1331-11-1 CSP) mais leur mise en œuvre effective relève de la décision administrative locale.",
      "Consulter un professionnel (entreprise de vidange agréée, bureau d'études) avant d'engager des travaux pour s'assurer de la conformité de la solution retenue.",
    ],
    confidenceStyle: 'strict',
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
