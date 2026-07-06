// scripts/benchmark-lib.ts
// Fonctions partagées entre benchmark-v2.ts (pipeline complet) et
// benchmark-baseline.ts (LLM brut sans RAG).
//
// Le scoring de couverture est une COPIE EXACTE de scripts/benchmark-v1.ts
// (benchmark v1 gelé — ne pas modifier sans re-valider les 3 runs de baseline).
// S'y ajoutent les métriques v2 de précision des citations.

// ── Types ────────────────────────────────────────────────────────────────────

export interface QuestionEntry {
  id:             string
  domain:         string
  level:          string
  question:       string
  expected_focus: string[]
  risk_type:      string
}

export interface BenchmarkFile {
  name:        string
  description: string
  version:     string
  created:     string
  questions:   QuestionEntry[]
}

// ── SSE parser ───────────────────────────────────────────────────────────────

export async function consumeSSE(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader  = stream.getReader()
  const decoder = new TextDecoder()
  const parts: string[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    for (const line of decoder.decode(value, { stream: true }).split('\n')) {
      if (!line.startsWith('data: ') || line.includes('[DONE]')) continue
      try {
        const json = JSON.parse(line.slice(6))
        const delta = json.choices?.[0]?.delta?.content
        if (delta) parts.push(delta)
      } catch { /* ligne SSE malformée */ }
    }
  }
  return parts.join('')
}

// ── Scoring : couverture expected_focus (copie v1) ──────────────────────────

const STOPWORDS = new Set([
  'pour', 'avec', 'sans', 'dans', 'sur', 'sous', 'par', 'les', 'des', 'une',
  'aux', 'que', 'qui', 'est', 'sont', 'être', 'avoir', 'fait', 'tout', 'tous',
  'cette', 'ces', 'leur', 'leurs', 'cas', 'entre', 'plus', 'moins', 'encore',
])

function normalizeArticleRef(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '').replace(/[^\w\-\.]/g, '')
}

export function extractArticleRefs(text: string): string[] {
  const refs: string[] = []
  const pattern = /\bart(?:icle)?\.?\s*([LRDA]?\.?\s*\d[\d\-\.]*(?:\s+[IVX]+)?(?:\s+bis|\s+ter)?)/gi
  for (const m of text.matchAll(pattern)) refs.push(normalizeArticleRef(m[1]))
  return refs
}

export function extractLawNumbers(text: string): string[] {
  return [...text.matchAll(/\b(\d{2,4}-\d{1,4})\b/g)].map(m => m[1])
}

function extractKeywords(text: string): string[] {
  return text.toLowerCase()
    .replace(/[^\w\sàâäéèêëîïôùûüç\-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOPWORDS.has(w))
}

const SEMANTIC_EQUIVALENTS: string[][] = [
  ['interdiction', 'nullité', 'nul', 'exercice illégal'],
  ['pratiquer', 'exercer', 'agir', 'faire visiter'],
  ['déchéance', 'perd', 'perte', 'condition réputée accomplie'],
  ['multiples', 'plusieurs', 'nombreux'],
  ['automatique', "d'office", 'systématique'],
  ['in concreto', 'au cas par cas', 'selon les circonstances'],
  ['diligence', 'démarches sérieuses', 'bonne foi', 'sincérité'],
  ['silence', 'absence de précision', 'ne le précise pas'],
  ['absence', 'perte du droit', 'privation du droit', 'pas de droit', 'privé de'],
  ['limitée', 'fixe', 'déterminée', 'maximale', 'terme'],
  ['démolition', 'remise en état', 'rétablir', 'condamnation au rétablissement'],
]

function hasKeywordOrEquivalent(keyword: string, respLower: string): boolean {
  if (respLower.includes(keyword)) return true
  for (const group of SEMANTIC_EQUIVALENTS) {
    if (!group.includes(keyword)) continue
    for (const eq of group) {
      if (eq !== keyword && respLower.includes(eq)) return true
    }
  }
  return false
}

function focusIsHit(focus: string, response: string): boolean {
  const respLower = response.toLowerCase()
  const respArticles = new Set(extractArticleRefs(response))
  const respLaws     = new Set(extractLawNumbers(response))

  const focusArticles = extractArticleRefs(focus)
  const focusLaws     = extractLawNumbers(focus)

  if (focusArticles.length > 0) {
    const anyArtHit = focusArticles.some(a => respArticles.has(a))
    if (!anyArtHit) return false
  }
  if (focusLaws.length > 0) {
    const anyLawHit = focusLaws.some(l => respLaws.has(l))
    if (!anyLawHit) return false
  }
  if (focusArticles.length > 0 || focusLaws.length > 0) return true

  const keywords = extractKeywords(focus)
  if (keywords.length === 0) return respLower.includes(focus.toLowerCase())
  const hits = keywords.filter(k => hasKeywordOrEquivalent(k, respLower)).length
  return hits / keywords.length >= 0.5
}

export function scoreCoverage(
  expectedFocus: string[],
  response:      string,
): { hits: number; total: number; ratio: number; misses: string[] } {
  const misses: string[] = []
  let hits = 0
  for (const f of expectedFocus) {
    if (focusIsHit(f, response)) hits++
    else misses.push(f)
  }
  return {
    hits,
    total: expectedFocus.length,
    ratio: expectedFocus.length === 0 ? 0 : hits / expectedFocus.length,
    misses,
  }
}

// ── Métriques v2 : précision des citations ──────────────────────────────────

export interface CitationMetrics {
  // Citations structurées trouvées dans la réponse
  articleRefsCount:    number   // refs d'articles citées (art. X)
  caseNumbersCount:    number   // numéros d'arrêts cités (n° XX-XX.XXX)
  legifranceLinks:     number   // liens markdown vers legifrance.gouv.fr
  judilibreLinks:      number   // liens vers courdecassation.fr / judilibre
  // Vérification
  linkedArticleRatio:  number   // part des refs d'articles accompagnées d'un lien Légifrance
  brokenLinks:         string[] // liens testés en HTTP qui ne répondent pas 200
  checkedLinks:        number
}

const CASE_NUMBER_RE = /n°\s*\d{2}-\d{2}[.\-]\d{3}/g
const MD_LINK_RE     = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g

// Cache global des URLs vérifiées (partagé entre questions d'un même run)
const urlCache = new Map<string, boolean>()

async function checkUrl(url: string, timeoutMs = 6000): Promise<boolean> {
  if (urlCache.has(url)) return urlCache.get(url)!
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    // GET plutôt que HEAD : legifrance.gouv.fr rejette certains HEAD
    const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: ctrl.signal })
    clearTimeout(timer)
    const ok = res.status === 200
    urlCache.set(url, ok)
    return ok
  } catch {
    urlCache.set(url, false)
    return false
  }
}

/**
 * Analyse les citations d'une réponse et vérifie les liens.
 * @param verifyLinks true → teste chaque lien Légifrance/Judilibre en HTTP (max 6/question)
 */
export async function analyzeCitations(response: string, verifyLinks: boolean): Promise<CitationMetrics> {
  const articleRefs = extractArticleRefs(response)
  const caseNumbers = [...response.matchAll(CASE_NUMBER_RE)].map(m => m[0])

  const links = [...response.matchAll(MD_LINK_RE)].map(m => ({ label: m[1], url: m[2] }))
  const legifrance = links.filter(l => l.url.includes('legifrance.gouv.fr'))
  const judilibre  = links.filter(l => l.url.includes('courdecassation.fr') || l.url.includes('judilibre'))

  // Part des refs d'articles dont le libellé d'un lien Légifrance mentionne le même numéro
  const linkedArticleNums = new Set(
    legifrance.flatMap(l => extractArticleRefs(l.label))
  )
  const linkedCount = articleRefs.filter(a => linkedArticleNums.has(a)).length

  const brokenLinks: string[] = []
  let checkedLinks = 0
  if (verifyLinks) {
    const uniqueUrls = [...new Set([...legifrance, ...judilibre].map(l => l.url))].slice(0, 6)
    for (const url of uniqueUrls) {
      checkedLinks++
      if (!(await checkUrl(url))) brokenLinks.push(url)
    }
  }

  return {
    articleRefsCount:   articleRefs.length,
    caseNumbersCount:   caseNumbers.length,
    legifranceLinks:    legifrance.length,
    judilibreLinks:     judilibre.length,
    linkedArticleRatio: articleRefs.length === 0 ? 1 : linkedCount / articleRefs.length,
    brokenLinks,
    checkedLinks,
  }
}

// ── Chargement .env.local + filtres CLI (partagés) ──────────────────────────

import { readFileSync } from 'fs'

export function loadEnvLocal(envPath: string): void {
  try {
    const envContent = readFileSync(envPath, 'utf-8')
    for (const line of envContent.split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* .env.local absent */ }
}

export function parseCliArg(name: string): string | null {
  const arg = process.argv.find(a => a.startsWith(`--${name}=`))
  return arg ? arg.slice(`--${name}=`.length) : null
}

export function filterQuestions(questions: QuestionEntry[]): QuestionEntry[] {
  const ids    = parseCliArg('ids')?.split(',').map(s => s.trim().toUpperCase()).filter(Boolean) ?? null
  const domain = parseCliArg('domain')
  const level  = parseCliArg('level')
  const limitRaw = parseCliArg('limit')
  const limit  = limitRaw ? parseInt(limitRaw, 10) : null

  let out = questions
  if (ids)    out = out.filter(q => ids.includes(q.id.toUpperCase()))
  if (domain) out = out.filter(q => q.domain === domain)
  if (level)  out = out.filter(q => q.level === level)
  if (limit && Number.isFinite(limit) && limit > 0) out = out.slice(0, limit)
  return out
}
