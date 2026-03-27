// lib/extract-refs.ts
// Extraction regex des numéros d'articles et lois mentionnés dans la question utilisateur.
// Retourne des forcedArticles injectables dans le pipeline Légifrance.

interface ExtractedRef {
  law: string
  artNums: string[]
}

// Patterns de lois/codes reconnus (clés compatibles LEGITEXT_MAP)
const LAW_PATTERNS: Array<{ regex: RegExp; law: string }> = [
  { regex: /code\s+civil/i, law: 'code civil' },
  { regex: /code\s+de\s+la\s+construction|code\s+de\s+l'habitation|\bCCH\b/i, law: 'cch' },
  { regex: /code\s+de\s+l'urbanisme|code\s+urbanisme/i, law: 'code urbanisme' },
  { regex: /code\s+de\s+l'environnement|code\s+environnement/i, law: 'code environnement' },
  { regex: /code\s+de\s+la\s+consommation|code\s+consommation|code\s+conso/i, law: 'code consommation' },
  { regex: /code\s+de\s+commerce|code\s+commerce/i, law: 'code commerce' },
  { regex: /code\s+des\s+assurances|code\s+assurances/i, law: 'code assurances' },
  { regex: /code\s+mon[ée]taire|CMF/i, law: 'code monétaire et financier' },
  { regex: /code\s+de\s+la\s+sant[ée]\s+publique|code\s+sant[ée]/i, law: 'code santé publique' },
  { regex: /code\s+g[ée]n[ée]ral\s+des\s+imp[ôo]ts|\bCGI\b/i, law: 'cgi' },
  { regex: /code\s+de\s+proc[ée]dure\s+civile|CPC\b/i, law: 'code procédure civile' },
  { regex: /\bCPCE\b|code.*proc[ée]dures.*civiles.*ex[ée]cution/i, law: 'cpce' },
  { regex: /loi\s+(?:n°?\s*)?70[- ]9\b|loi\s+hoguet/i, law: 'loi 70-9' },
  { regex: /loi\s+(?:n°?\s*)?89[- ]462\b/i, law: 'loi 89-462' },
  { regex: /loi\s+(?:n°?\s*)?65[- ]557\b/i, law: 'loi 65-557' },
  { regex: /d[ée]cret\s+(?:n°?\s*)?72[- ]678\b|d[ée]cret\s+hoguet/i, law: 'décret 72-678' },
  { regex: /d[ée]cret\s+(?:n°?\s*)?67[- ]223\b/i, law: 'décret 67-223' },
  { regex: /loi\s+(?:n°?\s*)?2014[- ]366\b|loi\s+ALUR/i, law: 'loi 2014-366' },
  { regex: /loi\s+(?:n°?\s*)?2018[- ]1021\b|loi\s+ELAN/i, law: 'loi 2018-1021' },
  { regex: /loi\s+(?:n°?\s*)?2021[- ]1104\b|loi\s+climat/i, law: 'loi 2021-1104' },
  { regex: /ordonnance\s+(?:n°?\s*)?2020[- ]71\b/i, law: 'ordonnance 2020-71' },
  { regex: /loi\s+(?:n°?\s*)?79[- ]596\b|loi\s+scrivener/i, law: 'loi 79-596' },
  { regex: /d[ée]cret\s+(?:n°?\s*)?87[- ]713\b/i, law: 'décret 87-713' },
]

// Regex pour capturer les numéros d'articles
// Capture : Art. 24, Article L412-6, L313-41, R423-23, article 1641, art. 78
const ART_NUM_REGEX = /\b(?:art(?:icle)?\.?\s*)([LRD]?\d+(?:[- ]\d+)*(?:[- ]\d+)*)\b/gi

// Regex pour capturer "article X du/de la [loi/code/décret]"
const ART_WITH_LAW_REGEX = /\b(?:art(?:icle)?\.?\s*)([LRD]?\d+(?:[- ]\d+)*)\s+(?:du|de\s+la|de\s+l['']|des?)\s+(.{5,60}?)(?=[.,;?!\n]|$)/gi

// Regex pour capturer "loi/décret X article Y" (ordre inversé)
const LAW_THEN_ART_REGEX = /(?:loi|d[ée]cret|ordonnance|code)\s+[^\n]{3,40}?\s+(?:art(?:icle)?\.?\s*)([LRD]?\d+(?:[- ]\d+)*)/gi

export function extractArticleRefs(message: string): ExtractedRef[] {
  const refs = new Map<string, Set<string>>() // law → Set<artNum>

  // Passe 1 : "article X du/de la [loi/code]"
  let match: RegExpExecArray | null
  ART_WITH_LAW_REGEX.lastIndex = 0
  while ((match = ART_WITH_LAW_REGEX.exec(message)) !== null) {
    const artNum = normalizeArtNum(match[1])
    const lawContext = match[2].trim()
    const law = identifyLaw(lawContext)
    if (law && artNum) {
      addRef(refs, law, artNum)
    }
  }

  // Passe 2 : "loi/décret X article Y"
  LAW_THEN_ART_REGEX.lastIndex = 0
  while ((match = LAW_THEN_ART_REGEX.exec(message)) !== null) {
    const artNum = normalizeArtNum(match[1])
    const fullMatch = match[0]
    const law = identifyLaw(fullMatch)
    if (law && artNum) {
      addRef(refs, law, artNum)
    }
  }

  // Passe 3 : articles isolés (Art. L412-6) — associer à la loi la plus proche dans le message
  ART_NUM_REGEX.lastIndex = 0
  while ((match = ART_NUM_REGEX.exec(message)) !== null) {
    const artNum = normalizeArtNum(match[1])
    if (!artNum) continue
    // Vérifier si déjà capturé
    let alreadyCaptured = false
    for (const [, nums] of refs) {
      if (nums.has(artNum)) { alreadyCaptured = true; break }
    }
    if (alreadyCaptured) continue

    // Chercher la loi la plus proche dans le message
    const law = findClosestLaw(message, match.index)
    if (law) {
      addRef(refs, law, artNum)
    }
  }

  // Convertir Map → Array
  const result: ExtractedRef[] = []
  for (const [law, artNums] of refs) {
    result.push({ law, artNums: [...artNums] })
  }

  if (result.length > 0) {
    console.info(`[extract-refs] ${result.length} ref(s) extraites : ${result.map(r => `${r.law}:${r.artNums.join(',')}`).join(' | ')}`)
  }

  return result
}

function normalizeArtNum(raw: string): string {
  return raw.replace(/\s+/g, '-').replace(/^0+/, '') || ''
}

function identifyLaw(text: string): string | null {
  for (const { regex, law } of LAW_PATTERNS) {
    if (regex.test(text)) return law
  }
  return null
}

function findClosestLaw(message: string, artIndex: number): string | null {
  let bestLaw: string | null = null
  let bestDistance = Infinity

  for (const { regex, law } of LAW_PATTERNS) {
    const globalRegex = new RegExp(regex.source, 'gi')
    let m: RegExpExecArray | null
    while ((m = globalRegex.exec(message)) !== null) {
      const distance = Math.abs(m.index - artIndex)
      if (distance < bestDistance) {
        bestDistance = distance
        bestLaw = law
      }
    }
  }

  // Ne matcher que si la loi est raisonnablement proche (< 120 chars)
  return bestDistance < 120 ? bestLaw : null
}

function addRef(refs: Map<string, Set<string>>, law: string, artNum: string) {
  if (!refs.has(law)) refs.set(law, new Set())
  refs.get(law)!.add(artNum)
}
