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

export function getSystemPromptAugmented(
  chunks: SourceChunk[],
  juriCases: JuriCase[],
  liveJuriCases?: JuriCase[],
): string {
  const today = new Date().toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric',
  })
  const disclaimer = DISCLAIMER

  const sourcesBlock = formatSources(chunks)

  // Si liveJuriCases est fourni, on sépare les deux sources ; sinon compat ascendante
  const juriBlock = liveJuriCases !== undefined
    ? formatJurisprudenceSplit(liveJuriCases, juriCases)
    : formatJurisprudence(juriCases)

  return `Tu es l'assistant juridique de Nestenn, réseau immobilier français. Date : ${today}.

Tu réponds aux questions de droit immobilier en mobilisant tes connaissances ET les textes officiels ci-dessous.

${sourcesBlock}${juriBlock}
COMMENT UTILISER CES SOURCES :
- Elles te servent à confirmer tes affirmations avec la référence exacte et le lien
- Si un texte fourni contredit ce que tu sais → le texte en vigueur a raison, corrige ta réponse
- Si tes connaissances vont au-delà des textes fournis → utilise-les en ajoutant "(à vérifier sur Légifrance)"
- Ne te limite JAMAIS aux textes fournis. Ne dis JAMAIS "les sources ne couvrent pas ce point" — réponds et signale si nécessaire

RÈGLES :
- Cite les articles avec le nom complet de la loi : "art. 24 de la loi n° 89-462 du 6 juillet 1989"
- Si un lien est fourni dans les sources → le recopier tel quel : [art. 24](url)
- Si pas de lien → citer sans lien, ne jamais inventer d'URL
- N° d'arrêts : citer UNIQUEMENT ceux fournis dans la section jurisprudence. Si tu en connais d'autres de mémoire → "(arrêt cité de mémoire — à vérifier sur Judilibre)"
- Ton professionnel, accessible. Tu parles à des agents immobiliers, pas à des juristes
- Terminer par 1-2 propositions d'action concrètes
- Terminer par le disclaimer : ${disclaimer}`
}

function formatSources(chunks: SourceChunk[]): string {
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

    if (first.sourceUrl) {
      lines.push(`\n[${title}](${first.sourceUrl})`)
    } else {
      lines.push(`\n${title}`)
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

  const refLabel = (c: JuriCase) => {
    const courtLabel = c.court === 'cass' ? 'Cass.' : 'CA'
    return c.date && c.number
      ? `${courtLabel} ${c.date}, n° ${c.number}`
      : `${courtLabel} — ${c.number}`
  }

  // Contrainte structurelle : liste numérotée des seuls arrêts autorisés
  const numberedList = allCases.map((c, i) => `[${i + 1}] ${refLabel(c)}`).join('\n')

  let result = '\nJURISPRUDENCE :\n'
  result += 'Les SEULS arrêts que tu peux citer sont listés ci-dessous avec leur numéro exact. Copie ces numéros tels quels, sans modification :\n'
  result += numberedList + '\n'
  result += 'Si tu cites un numéro qui n\'est pas dans cette liste, c\'est une erreur grave.\n'

  if (liveCases.length > 0) {
    result += '\nDÉTAIL — JURISPRUDENCE RÉCENTE (Judilibre, vérifiée en temps réel) :\n'
    result += liveCases.map(formatJuriCase).join('\n') + '\n'
  }

  if (pgCases.length > 0) {
    result += '\nDÉTAIL — JURISPRUDENCE COMPLÉMENTAIRE (base indexée) :\n'
    result += pgCases.map(formatJuriCase).join('\n') + '\n'
  }

  return result
}
