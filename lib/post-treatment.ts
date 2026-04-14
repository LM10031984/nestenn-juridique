// lib/post-treatment.ts
// Vérification async + sanitisation des références d'arrêts — ne bloque pas le client
// Architecture 2 temps :
//   TEMPS 1 — Mistral génère avec [JURISPRUDENCE] à la place des numéros
//   TEMPS 2 — injectLiveJurisprudence remplace chaque token par un arrêt Judilibre vérifié

import { createClient } from '@supabase/supabase-js'

interface VerificationResult {
  totalRefs: number
  verified: number
  unverified: number
  invented: string[]  // références non trouvées dans pgvector
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase env manquant')
  return createClient(url, key)
}

export async function verifyReferencesAsync(
  responseText: string,
  sessionId?: string,
): Promise<VerificationResult> {
  const result: VerificationResult = {
    totalRefs: 0, verified: 0, unverified: 0, invented: [],
  }

  try {
    const caseRefs = extractCaseReferences(responseText)
    result.totalRefs = caseRefs.length

    if (caseRefs.length === 0) return result

    const supabase = getSupabase()

    for (const ref of caseRefs) {
      // Chercher dans la table jurisprudence
      const { count } = await supabase
        .from('jurisprudence')
        .select('*', { count: 'exact', head: true })
        .ilike('source_id', `%${ref.number}%`)

      if (count && count > 0) {
        result.verified++
      } else {
        result.unverified++
        const label = ref.date
          ? `${ref.court === 'cass' ? 'Cass.' : 'CA'} ${ref.date} n° ${ref.number}`
          : `${ref.court === 'cass' ? 'Cass.' : 'CA'} n° ${ref.number}`
        result.invented.push(label)
      }
    }

    if (result.invented.length > 0) {
      console.warn(`[post-treatment] ${result.invented.length} réf(s) non vérifiée(s): ${result.invented.join(', ')}`)

      void Promise.resolve(supabase.from('quality_alerts').insert({
        alert_type: 'unverified_reference',
        details: result,
        session_id: sessionId,
      }))  // fire-and-forget
    }

    return result
  } catch (err) {
    console.error('[post-treatment] error:', err)
    return result
  }
}

// ── TEMPS 2 : injection des arrêts live dans les tokens [JURISPRUDENCE] ─────────

/**
 * Remplace séquentiellement chaque [JURISPRUDENCE] par le prochain arrêt de liveJuriCases.
 * Si plus d'arrêts disponibles → supprime le token.
 * Déterministe : Mistral n'a généré aucun numéro, donc zéro risque d'hallucination.
 */
export function injectLiveJurisprudence(
  text: string,
  liveJuriCases: Array<{ court: string; date: string; number: string }>,
): string {
  let idx = 0
  const result = text.replace(/\[JURISPRUDENCE\]/g, () => {
    if (idx >= liveJuriCases.length) return ''
    const c = liveJuriCases[idx++]
    const courtLabel = c.court === 'cass' ? 'Cass.' : 'CA'
    const ref = c.date && c.number
      ? `${courtLabel} ${c.date}, n° ${c.number}`
      : `${courtLabel} n° ${c.number}`
    console.info(`[post-process] ✅ [JURISPRUDENCE] → ${ref}`)
    return ref
  })
  if (idx > 0) console.info(`[post-process] ${idx} token(s) [JURISPRUDENCE] injecté(s)`)
  return result
}

// ── Suppression des références complètes non vérifiées (passe 1) ─────────────

const MAX_SUBSTITUTIONS = 3

/**
 * Remplace les citations non vérifiées par le prochain arrêt live (round-robin).
 * Max 3 substitutions par réponse ; au-delà → suppression.
 * Log : [post-process] 🔄 n° 14-28.268 → n° 23-16.290
 */
export function removeUnverifiedReferences(
  text: string,
  liveJuriCases: Array<{ court: string; date: string; number: string }>,
): { cleaned: string; removed: string[]; substituted: string[] } {
  const normalize = (n: string) => n.replace(/[\s\-\.\/]/g, '').toLowerCase()
  const validNums = new Set(liveJuriCases.map(c => normalize(c.number)))
  console.log('[post-process] validNums:', validNums.size, [...validNums])
  const removed: string[] = []
  const substituted: string[] = []

  // Index round-robin pour les substitutions (partagé sur toute la réponse)
  let substituteIdx = 0

  // Passe 1a : citation complète "Cass. X, date, **n° XX-XX.XXX**"
  // \*{0,2}\s* absorbe les marqueurs markdown ** entre la date et n°, et après le numéro.
  // Le point est obligatoire : distingue n° 23-16.290 (arrêt) de n° 65-557 (loi).
  const fullRefPattern = /(?:(?:Cass|CA)\.[^,]{1,60},\s*\d{1,2}\s+\w+\.?\s+\d{4},?\s*\*{0,2}\s*)?n°\s*\*{0,2}\s*(\d{2}-\d{2,3}\.\d{3})\s*\*{0,2}/gi

  const cleaned = text.replace(fullRefPattern, (match, num) => {
    if (validNums.size === 0 || validNums.has(normalize(num))) return match

    if (substituteIdx < liveJuriCases.length && substituteIdx < MAX_SUBSTITUTIONS) {
      const replacement = liveJuriCases[substituteIdx++]
      const courtLabel = replacement.court === 'cass' ? 'Cass.' : 'CA'
      const ref = replacement.date && replacement.number
        ? `${courtLabel} ${replacement.date}, n° ${replacement.number}`
        : `${courtLabel} n° ${replacement.number}`
      console.warn(`[post-process] 🔄 n° ${num.trim()} → n° ${replacement.number}`)
      substituted.push(`n° ${num.trim()} → n° ${replacement.number}`)
      return ref
    }

    const label = `n° ${num.trim()}`
    console.warn(`[post-process] ❌ Arrêt non vérifié supprimé : ${label}`)
    removed.push(label)
    return ''
  })

  // Passe 1b : fragments Cass. orphelins sans numéro laissés par la passe 1a
  // Ex: "Cass. 3e civ., 15 décembre 2021, **" ou "**Cass. 3e civ., 15 décembre 2021, :"
  const withoutOrphans = cleaned.replace(/\*{0,2}Cass\.[^:]{5,80},\s*\*{0,2}\s*:/gi, '')

  // Nettoyage des espaces multiples laissés par les suppressions
  return { cleaned: withoutOrphans.replace(/[ \t]{2,}/g, ' '), removed, substituted }
}

// ── Sanitisation inline (avant envoi client) — passe 2 ───────────────────────

export function sanitizeJuriNumbers(
  text: string,
  validCases: Array<{ number: string }>,
): { sanitized: string; removed: string[] } {
  const normalize = (n: string) => n.replace(/[\s\-\.\/]/g, '').toLowerCase()
  const validNums = new Set(validCases.map(c => normalize(c.number)))

  const removed: string[] = []
  const sanitized = text.replace(
    /n°\s*(\d{2}-\d{2,3}\.\d{3})/g,
    (match, num) => {
      if (validNums.size === 0 || validNums.has(normalize(num))) return match
      removed.push(num.trim())
      return '[arrêt non vérifié]'
    }
  )
  return { sanitized, removed }
}

// ── Architecture tags fermés [J1][J2][J3] ────────────────────────────────────

export interface TaggedCase {
  tag: string   // 'J1', 'J2', 'J3'
  court: 'cass' | 'ca'
  date: string
  number: string
  holding: string
  url?: string
}

/**
 * Associe chaque arrêt live à un identifiant fermé J1, J2, J3...
 * Le même ordre que dans le prompt → cohérence garantie.
 */
export function buildTaggedLiveCases(
  liveCases: Array<{ court: 'cass' | 'ca'; date: string; number: string; holding: string; url?: string }>,
): TaggedCase[] {
  return liveCases.map((c, index) => ({
    tag: `J${index + 1}`,
    court: c.court,
    date: c.date,
    number: c.number,
    holding: c.holding,
    url: c.url,
  }))
}

/** @deprecated Utiliser buildTaggedLiveCases */
export function buildAllowedCaseTags(
  liveJuriCases: Array<{ court: 'cass' | 'ca'; date: string; number: string; holding: string; url?: string }>,
): TaggedCase[] {
  return buildTaggedLiveCases(liveJuriCases)
}

/**
 * Retourne les tags autorisés effectivement utilisés dans le texte.
 */
export function validateUsedCaseTags(text: string, allowedTags: string[]): string[] {
  const used = [...text.matchAll(/\[(J\d+)\]/g)].map(m => m[1])
  return [...new Set(used.filter(tag => allowedTags.includes(tag)))]
}

/**
 * @deprecated Utiliser validateUsedCaseTags
 */
export function validateCaseTags(
  text: string,
  allowedTags: string[],
): { usedTags: string[]; unauthorizedTags: string[] } {
  const allowedSet = new Set(allowedTags)
  const allUsed = [...text.matchAll(/\[J(\d+)\]/g)].map(m => `J${m[1]}`)
  const unique = [...new Set(allUsed)]
  return {
    usedTags: unique.filter(t => allowedSet.has(t)),
    unauthorizedTags: unique.filter(t => !allowedSet.has(t)),
  }
}

/**
 * Supprime tout numéro d'arrêt libre écrit par le LLM.
 * Dans l'architecture tags fermés, le LLM ne doit écrire QUE des [J1][J2]…
 * Tout n° libre est une hallucination → suppression systématique.
 */
export function stripUnauthorizedCaseNumbers(text: string): { cleaned: string; removed: string[] } {
  const removed: string[] = []

  // Passe 1 : citations complètes "Cass. X, date, n° XX-XX.XXX"
  const fullRefPattern = /(?:(?:Cass|CA)\.[^,]{1,60},\s*\d{1,2}\s+\w+\.?\s+\d{4},?\s*\*{0,2}\s*)?n°\s*\*{0,2}\s*(\d{2}-\d{2,3}\.\d{3})\s*\*{0,2}/gi
  const pass1 = text.replace(fullRefPattern, (match, num) => {
    console.warn(`[post-process] ❌ Numéro libre supprimé : n° ${num.trim()}`)
    removed.push(`n° ${num.trim()}`)
    return ''
  })

  // Passe 2 : fragments Cass. orphelins laissés par la passe 1
  const pass2 = pass1.replace(/\*{0,2}Cass\.[^:]{5,80},\s*\*{0,2}\s*:/gi, '')

  return { cleaned: pass2.replace(/[ \t]{2,}/g, ' '), removed }
}

/**
 * Remplace chaque [J1], [J2], [J3] par la vraie citation formatée.
 * Seul le backend peut produire un numéro d'arrêt dans la réponse finale.
 */
export function injectRealCaseCitations(text: string, taggedCases: TaggedCase[]): string {
  return text.replace(/\[(J\d+)\]/g, (_, rawTag: string) => {
    const found = taggedCases.find(c => c.tag === rawTag)
    if (!found) {
      console.warn(`[post-process] ❌ Tag orphelin supprimé : [${rawTag}]`)
      return '[arrêt non autorisé]'
    }
    const courtLabel = found.court === 'cass' ? 'Cass.' : 'CA'
    const ref = found.date && found.number
      ? `${courtLabel} ${found.date}, n° ${found.number}`
      : `${courtLabel} n° ${found.number}`
    const citation = found.url ? `[${ref}](${found.url})` : ref
    console.info(`[post-process] ✅ [${rawTag}] → ${ref}`)
    return citation
  })
}

/** @deprecated Utiliser injectRealCaseCitations */
export function injectRealCitationsFromTags(text: string, taggedCases: TaggedCase[]): string {
  return injectRealCaseCitations(text, taggedCases)
}

// ── Architecture tags fermés [A1][A2][A3] pour les articles ──────────────────

export interface TaggedArticle {
  tag: string           // 'A1', 'A2', 'A3'
  title: string         // "Art. 24 — loi n° 89-462" (label d'affichage)
  sourceLaw: string
  sourceArticle: string
  sourceUrl?: string
}

/**
 * Extrait les articles uniques des chunks et leur attribue un tag fermé A1, A2…
 * Max 5 articles citables pour garder le prompt lisible.
 */
export function buildTaggedArticles(
  chunks: Array<{ sourceLaw: string; sourceArticle: string; sourceUrl?: string | null }>,
): TaggedArticle[] {
  const unique = new Map<string, TaggedArticle>()

  for (const chunk of chunks) {
    const key = `${chunk.sourceLaw}|${chunk.sourceArticle}`
    if (!unique.has(key)) {
      unique.set(key, {
        tag: `A${unique.size + 1}`,
        title: chunk.sourceArticle
          ? `Art. ${chunk.sourceArticle} — ${chunk.sourceLaw}`
          : chunk.sourceLaw,
        sourceLaw: chunk.sourceLaw,
        sourceArticle: chunk.sourceArticle,
        sourceUrl: chunk.sourceUrl ?? undefined,
      })
    }
  }

  return [...unique.values()].slice(0, 5)
}

/**
 * Retourne les tags article autorisés effectivement utilisés dans le texte.
 */
export function validateUsedArticleTags(text: string, allowedTags: string[]): string[] {
  const used = [...text.matchAll(/\[(A\d+)\]/g)].map(m => m[1])
  return [...new Set(used.filter(tag => allowedTags.includes(tag)))]
}

/**
 * Remplace chaque [A1], [A2]… par le titre de l'article.
 * Un tag inconnu est remplacé par '[article non autorisé]'.
 */
export function injectRealArticleCitations(text: string, taggedArticles: TaggedArticle[]): string {
  return text.replace(/\[(A\d+)\]/g, (_, rawTag: string) => {
    const found = taggedArticles.find(a => a.tag === rawTag)
    if (!found) {
      console.warn(`[post-process] ❌ Tag article orphelin : [${rawTag}]`)
      return '[article non autorisé]'
    }
    const label = found.sourceUrl ? `[${found.title}](${found.sourceUrl})` : found.title
    console.info(`[post-process] ✅ [${rawTag}] → ${found.title}`)
    return label
  })
}

// ── Détection et suppression des citations libres d'articles ──────────────────

export interface FreeArticleCitation {
  match: string    // texte exact trouvé
  article: string  // numéro d'article extrait (ex: "L.1331-8", "1641")
  index: number    // position dans le texte
}

// Regex partagée : "art. L.1331-8 du Code de la santé publique", "article 1641", "l'art. 24 de la loi n° 89-462"
// Le suffixe de loi s'arrête aux conjonctions (et, ou, ainsi) et à la ponctuation.
const FREE_ARTICLE_RE = /\b(?:l[''])?art(?:icle)?s?\.?\s+((?:[LRDA]\.?\s*)?\d[\d\-\.]*)(?:\s+(?:du|de\s+(?:la|l['']))\s+(?:code|loi|décret|ordonnance)(?:\s+(?!(?:et|ou|ainsi)\b)\S+){0,5})?/gi

/**
 * Détecte toutes les citations libres d'articles dans le texte.
 * Une "citation libre" est une référence du type "art. L.xxx" sans tag [Ax].
 * Les tags [A1][A2]… ne sont pas des citations libres — ils ne déclenchent pas ce pattern.
 */
export function findFreeFormArticleCitations(text: string): FreeArticleCitation[] {
  const results: FreeArticleCitation[] = []
  const re = new RegExp(FREE_ARTICLE_RE.source, FREE_ARTICLE_RE.flags)
  for (const m of text.matchAll(re)) {
    results.push({ match: m[0], article: m[1].trim(), index: m.index ?? 0 })
  }
  return results
}

/**
 * Remplace les citations libres d'articles par des formulations neutres — V2.
 * Actif uniquement si des tags [A1][A2]… sont définis (allowedArticleTags non vide).
 * Si aucun tag n'est actif → retour sans modification (mode libre autorisé).
 *
 * V2 applique des patterns contextuels dans l'ordre suivant :
 *  1. Blocs parenthétiques  : "(Art. X ...)"  → supprimé entièrement
 *  2. Liens markdown        : "[Art. X](url)" → "la règle applicable"
 *  3. Prépositions connues  : "selon l'art. X", "en vertu de l'art. X" → "selon la règle applicable"
 *  4. Article comme sujet   : "l'art. X prévoit/dispose/précise" → "la règle applicable prévoit/…"
 *  5. Fallback générique    : toute citation restante → "la règle applicable"
 *
 * Chaque passe est loguée ; les passes sont mutuellement exclusives grâce à leur ordre.
 */
export function stripUnauthorizedArticleCitations(
  text: string,
  allowedArticleTags: string[],
): { cleaned: string; found: FreeArticleCitation[] } {
  const found = findFreeFormArticleCitations(text)
  if (allowedArticleTags.length === 0 || found.length === 0) {
    return { cleaned: text, found }
  }

  // ── Passe 1 : blocs parenthétiques "(Art. X [du Code Y])" ─────────────────
  // Capture tout le bloc entre parenthèses dès qu'il contient une citation libre.
  // Limité à 120 chars pour éviter de supprimer des parenthèses légitimes longues.
  let cleaned = text.replace(
    /\(\s*(?:l[''])?art(?:icle)?s?\.?\s+(?:[LRDA]\.?\s*)?\d[\d\-\.]*[^)]{0,100}\)/gi,
    (match) => {
      console.warn(`[post-process] ⚠️ V2-P1 bloc parenthétique supprimé : "${match.trim()}"`)
      return ''
    },
  )

  // ── Passe 2 : liens markdown "[Art. X ...](url)" ──────────────────────────
  // Pattern : [texte contenant art. XXX](url) → "la règle applicable"
  cleaned = cleaned.replace(
    /\[(?:[^\]]*?(?:l[''])?art(?:icle)?s?\.?\s+(?:[LRDA]\.?\s*)?\d[\d\-\.]*[^\]]*?)\]\([^)]{0,200}\)/gi,
    (match) => {
      console.warn(`[post-process] ⚠️ V2-P2 lien markdown article supprimé : "${match.trim()}"`)
      return 'la règle applicable'
    },
  )

  // ── Passe 3 : prépositions connues ─────────────────────────────────────────
  // "selon l'art. X", "conformément à l'art. X", "en vertu de l'art. X",
  // "d'après l'art. X", "au sens de l'art. X" → formule de remplacement appropriée
  const PREPOSITION_PATTERNS: Array<[RegExp, string]> = [
    [/selon\s+l['']art(?:icle)?s?\.?\s+(?:[LRDA]\.?\s*)?\d[\d\-\.]*(?:\s+(?:du|de\s+(?:la|l['']))\s+(?:code|loi|décret|ordonnance)(?:\s+(?!(?:et|ou)\b)\S+){0,4})?/gi, 'selon la règle applicable'],
    [/conformément\s+(?:aux?|à\s+l[''])?art(?:icle)?s?\.?\s+(?:[LRDA]\.?\s*)?\d[\d\-\.]*(?:\s+(?:du|de\s+(?:la|l['']))\s+(?:code|loi|décret|ordonnance)(?:\s+(?!(?:et|ou)\b)\S+){0,4})?/gi, 'conformément à la règle applicable'],
    [/en\s+vertu\s+(?:des?|de\s+l[''])?art(?:icle)?s?\.?\s+(?:[LRDA]\.?\s*)?\d[\d\-\.]*(?:\s+(?:du|de\s+(?:la|l['']))\s+(?:code|loi|décret|ordonnance)(?:\s+(?!(?:et|ou)\b)\S+){0,4})?/gi, 'en vertu de la règle applicable'],
    [/d['']après\s+l['']art(?:icle)?s?\.?\s+(?:[LRDA]\.?\s*)?\d[\d\-\.]*(?:\s+(?:du|de\s+(?:la|l['']))\s+(?:code|loi|décret|ordonnance)(?:\s+(?!(?:et|ou)\b)\S+){0,4})?/gi, 'selon la règle applicable'],
    [/au\s+sens\s+(?:de\s+)?l['']art(?:icle)?s?\.?\s+(?:[LRDA]\.?\s*)?\d[\d\-\.]*(?:\s+(?:du|de\s+(?:la|l['']))\s+(?:code|loi|décret|ordonnance)(?:\s+(?!(?:et|ou)\b)\S+){0,4})?/gi, 'au sens de la règle applicable'],
  ]

  for (const [re, replacement] of PREPOSITION_PATTERNS) {
    cleaned = cleaned.replace(re, (match) => {
      console.warn(`[post-process] ⚠️ V2-P3 préposition article remplacée : "${match.trim()}"`)
      return replacement
    })
  }

  // ── Passe 4 : article comme sujet avec verbe de disposition ───────────────
  // "l'art. X prévoit que", "l'art. X dispose que", "l'art. X CC dispose que", etc.
  // → "la règle applicable prévoit que / dispose que / …"
  // [^.\n]{0,80}? : lazy — absorbe jusqu'à 80 chars (abréviations, code, références)
  // entre le numéro d'article et le verbe de disposition.
  const DISPOSITION_VERBS = '(?:prévoit|dispose|précise|stipule|énonce|impose|interdit|autorise|permet|exige|oblige|fixe|définit)'
  cleaned = cleaned.replace(
    new RegExp(
      `l['']art(?:icle)?s?\\.?\\s+(?:[LRDA]\\.?\\s*)?\\d[\\d\\-\\.]*[^.\\n]{0,80}?\\s+(${DISPOSITION_VERBS})\\b`,
      'gi',
    ),
    (match, verb) => {
      console.warn(`[post-process] ⚠️ V2-P4 article-sujet remplacé : "${match.trim()}"`)
      return `la règle applicable ${verb}`
    },
  )

  // ── Passe 5 : fallback générique ───────────────────────────────────────────
  // Toute citation libre restante qui n'a pas été capturée par les passes précédentes.
  const reFallback = new RegExp(FREE_ARTICLE_RE.source, FREE_ARTICLE_RE.flags)
  cleaned = cleaned.replace(reFallback, (match) => {
    console.warn(`[post-process] ⚠️ V2-P5 citation libre (fallback) : "${match.trim()}"`)
    return 'la règle applicable'
  })

  // Nettoyage cosmétique : espaces multiples laissés par les suppressions de parenthèses
  cleaned = cleaned.replace(/[ \t]{2,}/g, ' ').replace(/\(\s*\)/g, '').trim()

  return { cleaned, found }
}

/**
 * Adoucit les affirmations normatives trop catégoriques en mode "normative safety".
 * Activé quand : aucun arrêt pgvector + ≤ 1 arrêt live + citations libres d'articles détectées.
 * Ajoute un footer prudentiel si absent.
 */
export function optionallyDowngradeUnsupportedNormativeClaims(text: string): string {
  const PATTERNS: Array<[RegExp, string]> = [
    [/\best\s+obligatoire\b/gi,        'est en principe obligatoire (à vérifier selon la situation)'],
    [/\bsont\s+obligatoires\b/gi,      'seraient en principe obligatoires (à vérifier)'],
    [/\best\s+interdit\b/gi,           'pourrait être interdit (à vérifier)'],
    [/\bsont\s+interdits\b/gi,         'pourraient être interdits (à vérifier)'],
    [/\best\s+nul\b/gi,                'pourrait être nul (à vérifier)'],
    [/\best\s+nulle\b/gi,              'pourrait être nulle (à vérifier)'],
    [/\bdoit\s+impérativement\b/gi,    'devrait en principe'],
    [/\bil\s+est\s+certain\s+que\b/gi, 'il semble que'],
  ]

  let result = text
  for (const [pattern, replacement] of PATTERNS) {
    result = result.replace(pattern, replacement)
  }

  const SAFETY_FOOTER = '\n\n> ⚠️ *Sources limitées pour cette question. Vérifiez les dispositions applicables auprès de la mairie, du SPANC ou des textes officiels en vigueur.*'
  if (!result.includes('Sources limitées')) {
    result += SAFETY_FOOTER
  }

  return result
}

// ── Détection de densité normative ───────────────────────────────────────────

/**
 * Seuil au-dessus duquel la densité normative est considérée comme "haute".
 * Basé sur le nombre de TYPES distincts détectés (pas le nombre d'occurrences).
 * ≥ 3 types distincts = texte assertif sans grounding suffisant.
 */
export const NORMATIVE_DENSITY_HIGH = 3

// Types de formulations normatives suivis — chaque type compte pour 1 point.
// On décompte les TYPES présents (pas les occurrences), pour éviter l'inflation
// due à la répétition normale du verbe "doit" dans un texte juridique.
const NORMATIVE_PATTERN_TYPES: Array<[string, RegExp]> = [
  ['doit',               /\bdoit\b/i],
  ['est_obligatoire',    /\best\s+(?:en\s+principe\s+)?obligatoire\b/i],
  ['est_interdit',       /\best\s+(?:formellement\s+|absolument\s+)?interdit\b/i],
  ['s_expose_a',         /\bs[''\u2019]expose\b/i],
  ['encourt',            /\bencourt\b/i],
  ['peut_exiger',        /\bpeut\s+exiger\b/i],
  ['est_tenu_de',        /\best\s+tenu\s+de\b/i],
  ['est_nul',            /\best\s+nul(?:le)?\b/i],
  ['doit_imperativement',/\bdoit\s+impérativement\b/i],
  ['ne_peut_pas',        /\bne\s+peut\s+pas\b/i],
]

export interface NormativeDensityResult {
  /** Nombre de types de patterns normatifs distincts détectés (0–N). */
  score: number
  /** Noms des types détectés — utile pour le logging. */
  patterns: string[]
}

/**
 * Évalue la densité normative d'un texte en comptant les TYPES de formulations
 * assertives présentes (distinct, pas les occurrences).
 * Score ≥ NORMATIVE_DENSITY_HIGH (3) = haute densité.
 */
export function detectNormativeDensity(text: string): NormativeDensityResult {
  const patterns: string[] = []
  for (const [name, re] of NORMATIVE_PATTERN_TYPES) {
    if (re.test(text)) patterns.push(name)
  }
  return { score: patterns.length, patterns }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

interface CaseRef {
  court: 'cass' | 'ca'
  date: string
  number: string
}

function extractCaseReferences(text: string): CaseRef[] {
  const refs: CaseRef[] = []

  // Pattern Cass : "Cass. civ. 3e, 12 mars 2020, n° 19-14.531"
  const cassPattern = /Cass\.[^,]*,?\s*(\d{1,2}\s+\w+\s+\d{4}),?\s*n°\s*([\d\-.]+)/gi
  for (const match of text.matchAll(cassPattern)) {
    refs.push({ court: 'cass', date: match[1], number: match[2] })
  }

  // Pattern CA : "CA Paris, 12 mars 2020, n° 19/14531"
  const caPattern = /CA\s+\w+,?\s*(\d{1,2}\s+\w+\s+\d{4}),?\s*n°\s*([\d\/\-.]+)/gi
  for (const match of text.matchAll(caPattern)) {
    refs.push({ court: 'ca', date: match[1], number: match[2] })
  }

  return refs
}
