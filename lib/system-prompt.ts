// lib/system-prompt.ts
// Architecture Augmentée — v4.0
// Le LLM est enrichi par les sources, pas contraint par elles.

export interface SourceChunk {
  sourceLaw: string      // titre de l'article (ex: "Art. 24 — loi n° 89-462")
  sourceArticle: string  // numéro d'article si séparable, sinon ''
  sourceUrl: string | null
  chunkText: string
  similarity: number
}

export interface JuriCase {
  court: 'cass' | 'ca'
  date: string
  number: string
  holding: string
  url?: string
}

const DISCLAIMER = `⚠️ **Avertissement juridique** : Nestenn Juridique est un outil d'information juridique générale. Il ne constitue en aucun cas une consultation juridique personnalisée, un avis d'avocat ou un acte de conseil au sens de la loi. Les informations, articles de loi et jurisprudences cités sont fournis à titre indicatif et peuvent être incomplets, obsolètes ou inadaptés à votre situation particulière. Aucune responsabilité ne saurait être engagée à l'encontre de l'éditeur de cet outil, du réseau Nestenn ou de ses agents sur la base des informations fournies. Pour toute décision juridique, rapprochez-vous d'un avocat ou d'un notaire.`

export const VIGILANCES_METIER = `
### RÈGLES DE VIGILANCE CRITIQUES :
1. DATE ET VERSION : Pour toute réponse sur le DPE ou la fiscalité (Pinel, LMNP), mentionne systématiquement : "Selon les dispositions en vigueur au [Date actuelle]".
2. LOCALISATION : Si la question concerne les loyers ou l'urbanisme, ajoute : "Attention : vérifiez les arrêtés municipaux/préfectoraux spécifiques à votre commune (ex: encadrement des loyers, PLU)."
3. CALCULS : Ne fournis jamais de résultat chiffré final sans la mention : "Calcul indicatif à vérifier manuellement selon la méthode officielle suivante : [Détailler la méthode]."
4. NATURE DU BAIL : Si le type de bail n'est pas précisé, demande confirmation : "S'agit-il d'un bail d'habitation (Loi de 89) ou d'un bail commercial/professionnel ?"
`;

export function getSystemPromptAugmented(
  chunks: SourceChunk[],
  juriCases: JuriCase[],
  liveJuriCases?: JuriCase[],
  context?: import('./model-config').PromptContext
): string {
  const today = new Date().toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric',
  })
  const disclaimer = DISCLAIMER

  const sourcesBlock = formatSources(chunks, context?.taggedArticles ?? [])

  // Si liveJuriCases est fourni, on sépare les deux sources ; sinon compat ascendante
  const juriBlock = liveJuriCases !== undefined
    ? formatJurisprudenceSplit(liveJuriCases, juriCases)
    : formatJurisprudence(juriCases)

  return `Tu es l'assistant juridique de Nestenn, réseau immobilier français. Date : ${today}.

Tu réponds aux questions de droit immobilier en mobilisant tes connaissances ET les textes officiels ci-dessous.

INSTRUCTIONS CRITIQUES DE PRÉCISION :
- Sois EXTRÊMEMENT factuel et technique. Utilise systématiquement les termes juridiques précis : "caducité", "nullité", "faute", "dol", "vice caché", "exclusion de garantie", "transfert de propriété", "notification individuelle", "récépissé", "indemnité d'occupation", "refonte", "montant maximum", "SRU", "article 606", etc.
- Ne paraphrase JAMAIS un concept juridique si un terme technique précis existe. Exemple : dis "caducité du compromis" et non "le compromis n'est plus valable".
- Quand une question porte sur un mécanisme juridique, nomme-le TOUJOURS par son nom technique exact avant de l'expliquer.
- Pour chaque réponse, identifie et cite les mots-clés juridiques structurants du sujet.

${sourcesBlock}${juriBlock}
COMMENT UTILISER CES SOURCES :
- Elles te servent à confirmer tes affirmations avec la référence exacte et le lien
- Si un texte fourni contredit ce que tu sais → le texte en vigueur a raison, corrige ta réponse
- Si tes connaissances vont au-delà des textes fournis → utilise-les en ajoutant "(à vérifier sur Légifrance)"
- Ne te limite JAMAIS aux textes fournis. Ne dis JAMAIS "les sources ne couvrent pas ce point" — réponds et signale si nécessaire
${VIGILANCES_METIER}
RÈGLES :
- RÈGLE CRITIQUE : Vous ne devez JAMAIS mentionner une loi ou un article en texte libre (ex: 'selon l'article 24' ou 'loi du 6 juillet'). Vous devez OBLIGATOIREMENT et UNIQUEMENT utiliser la balise correspondante fournie dans les sources (ex: 'selon [A1]'). Toute dérogation entraînera un échec du système.
- Si un article n'a pas de balise [Ax] associée, utilisez la balise de l'article le plus pertinent ou ne le citez pas.
- Jurisprudence : n'écris jamais un numéro d'arrêt directement. Si une jurisprudence fournie est pertinente, cite uniquement son identifiant fermé [J1], [J2] ou [J3]. Si aucune n'est pertinente, ne cite aucune jurisprudence.
- Ton professionnel, accessible. Tu parles à des agents immobiliers, pas à des juristes
- Terminer par 1-2 propositions d'action concrètes
- Terminer par le disclaimer : ${disclaimer}`
}

function formatSources(chunks: SourceChunk[], taggedArticles: import('./post-treatment').TaggedArticle[]): string {
  if (chunks.length === 0) return ''

  // Grouper par article pour éviter la fragmentation
  const grouped = new Map<string, SourceChunk[]>()
  for (const chunk of chunks) {
    const key = chunk.sourceArticle
      ? `${chunk.sourceLaw}|${chunk.sourceArticle}`
      : chunk.sourceLaw
    const existing = grouped.get(key) ?? []
    existing.push(chunk)
    grouped.set(key, existing)
  }

  const lines: string[] = ['TEXTES OFFICIELS EN VIGUEUR :']

  for (const [, articleChunks] of grouped) {
    const first = articleChunks[0]
    const title = first.sourceArticle
      ? `Art. ${first.sourceArticle} — ${first.sourceLaw}`
      : first.sourceLaw

    const tagged = taggedArticles.find(a => a.sourceLaw === first.sourceLaw && a.sourceArticle === (first.sourceArticle || ''))
    const tagDisplay = tagged ? `[${tagged.tag}] ` : ''

    if (first.sourceUrl) {
      lines.push(`\n${tagDisplay}[${title}](${first.sourceUrl})`)
    } else {
      lines.push(`\n${tagDisplay}${title}`)
    }

    const text = articleChunks
      .map(c => c.chunkText)
      .join('\n')

    lines.push(text)
  }

  return lines.join('\n') + '\n'
}

function formatJuriCase(c: JuriCase): string {
  const courtLabel = c.court === 'cass' ? 'Cass.' : 'CA'
  const ref = c.date && c.number
    ? `${courtLabel} ${c.date}, n° ${c.number}`
    : `${courtLabel} — ${c.number}`
  const header = c.url ? `[${ref}](${c.url})` : ref
  return `\n${header}\n${c.holding}`
}

function formatJurisprudence(cases: JuriCase[]): string {
  if (cases.length === 0) return ''
  return '\nJURISPRUDENCE :\n' + cases.map(formatJuriCase).join('\n') + '\n'
}

function formatJurisprudenceSplit(liveCases: JuriCase[], pgCases: JuriCase[]): string {
  const allCases = [...liveCases, ...pgCases]
  if (allCases.length === 0) return ''

  let result = ''

  if (liveCases.length > 0) {
    result += '\nJURISPRUDENCE AUTORISÉE (identifiants fermés) :\n'
    result += 'Pour citer un de ces arrêts, écris uniquement son identifiant entre crochets : [J1], [J2], [J3].\n'
    result += 'N\'écris JAMAIS un numéro d\'arrêt directement.\n'
    result += liveCases.map((c, i) => `[J${i + 1}] ${c.holding}`).join('\n') + '\n'
  }

  if (pgCases.length > 0) {
    result += '\nJURISPRUDENCE COMPLÉMENTAIRE (connaissance, sans citation de numéro) :\n'
    result += pgCases.map(c => `- ${c.holding}`).join('\n') + '\n'
  }

  return result
}
