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
  court: string
  date: string
  number: string
  holding: string
  url?: string
}

/**
 * Associe chaque arrêt live à un identifiant fermé J1, J2, J3...
 * Le même ordre que dans le prompt → cohérence garantie.
 */
export function buildAllowedCaseTags(
  liveJuriCases: Array<{ court: string; date: string; number: string; holding: string; url?: string }>,
): TaggedCase[] {
  return liveJuriCases.map((c, i) => ({ tag: `J${i + 1}`, ...c }))
}

/**
 * Inspecte le texte généré et retourne les tags utilisés vs. non autorisés.
 * Un tag non autorisé (ex [J9] quand seulement 3 live) sera supprimé ensuite.
 */
export function validateCaseTags(
  text: string,
  allowedTags: string[],  // ex: ['J1', 'J2', 'J3']
): { usedTags: string[]; unauthorizedTags: string[] } {
  const allowedSet = new Set(allowedTags)
  const usedTags: string[] = []
  const unauthorizedTags: string[] = []

  for (const match of text.matchAll(/\[J(\d+)\]/g)) {
    const tag = `J${match[1]}`
    if (allowedSet.has(tag)) {
      if (!usedTags.includes(tag)) usedTags.push(tag)
    } else {
      if (!unauthorizedTags.includes(tag)) unauthorizedTags.push(tag)
    }
  }
  return { usedTags, unauthorizedTags }
}

/**
 * Supprime tout numéro d'arrêt libre (n° XX-XX.XXX) absent de allowedNumbers.
 * Appelé AVANT l'injection des tags → le LLM ne devrait pas en écrire, mais filet de sécurité.
 * allowedNumbers vide = suppression de TOUS les numéros libres.
 */
export function stripUnauthorizedCaseNumbers(
  text: string,
  allowedNumbers: string[] = [],
): { stripped: string; removed: string[] } {
  const normalize = (n: string) => n.replace(/[\s\-\.\/]/g, '').toLowerCase()
  const allowedSet = new Set(allowedNumbers.map(normalize))
  const removed: string[] = []

  const fullRefPattern = /(?:(?:Cass|CA)\.[^,]{1,60},\s*\d{1,2}\s+\w+\.?\s+\d{4},?\s*\*{0,2}\s*)?n°\s*\*{0,2}\s*(\d{2}-\d{2,3}\.\d{3})\s*\*{0,2}/gi

  const stripped = text.replace(fullRefPattern, (match, num) => {
    if (allowedSet.size > 0 && allowedSet.has(normalize(num))) return match
    console.warn(`[post-process] ❌ Numéro libre supprimé : n° ${num.trim()}`)
    removed.push(`n° ${num.trim()}`)
    return ''
  })

  // Nettoyer les fragments Cass. orphelins laissés après suppression
  const withoutOrphans = stripped.replace(/\*{0,2}Cass\.[^:]{5,80},\s*\*{0,2}\s*:/gi, '')

  return { stripped: withoutOrphans.replace(/[ \t]{2,}/g, ' '), removed }
}

/**
 * Remplace chaque [J1], [J2], [J3] par la vraie citation formatée.
 * Les tags inconnus ([J9] etc.) sont supprimés silencieusement.
 * Seul le backend peut produire un numéro d'arrêt dans la réponse finale.
 */
export function injectRealCitationsFromTags(
  text: string,
  taggedCases: TaggedCase[],
): string {
  let result = text

  for (const tc of taggedCases) {
    const courtLabel = tc.court === 'cass' ? 'Cass.' : 'CA'
    const ref = tc.date && tc.number
      ? `${courtLabel} ${tc.date}, n° ${tc.number}`
      : `${courtLabel} n° ${tc.number}`
    const citation = tc.url ? `[${ref}](${tc.url})` : ref
    result = result.replace(new RegExp(`\\[${tc.tag}\\]`, 'g'), citation)
    console.info(`[post-process] ✅ [${tc.tag}] → ${ref}`)
  }

  // Supprimer tout [Jn] résiduel non autorisé
  result = result.replace(/\[J\d+\]/g, (orphan) => {
    console.warn(`[post-process] ❌ Tag orphelin supprimé : ${orphan}`)
    return ''
  })

  return result
}

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
