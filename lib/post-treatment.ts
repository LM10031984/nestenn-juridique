// lib/post-treatment.ts
// Vérification async + sanitisation des références d'arrêts — ne bloque pas le client

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

// ── Suppression des références complètes non vérifiées (passe 1) ─────────────

/**
 * Supprime la citation jurisprudentielle entière quand son numéro n'est pas dans liveJuriCases.
 * Ex : "Cass. 3e civ., 12 mai 2022, n° 21-13.456" → supprimé
 * Ne touche PAS aux numéros vérifiés.
 */
export function removeUnverifiedReferences(
  text: string,
  liveJuriCases: Array<{ number: string }>,
): { cleaned: string; removed: string[] } {
  const normalize = (n: string) => n.replace(/[\s\-\.\/]/g, '').toLowerCase()
  const validNums = new Set(liveJuriCases.map(c => normalize(c.number)))
  console.log('[post-process] validNums:', validNums.size, [...validNums])
  const removed: string[] = []

  // Passe 1a : citation complète "Cass. X, date, **n° XX-XX.XXX**"
  // \*{0,2}\s* absorbe les marqueurs markdown ** entre la date et n°, et après le numéro.
  // Le point est obligatoire : distingue n° 23-16.290 (arrêt) de n° 65-557 (loi).
  const fullRefPattern = /(?:(?:Cass|CA)\.[^,]{1,60},\s*\d{1,2}\s+\w+\.?\s+\d{4},?\s*\*{0,2}\s*)?n°\s*\*{0,2}\s*(\d{2}-\d{2,3}\.\d{3})\s*\*{0,2}/gi

  const cleaned = text.replace(fullRefPattern, (match, num) => {
    if (validNums.size === 0 || validNums.has(normalize(num))) return match
    const label = `n° ${num.trim()}`
    console.warn(`[post-process] ❌ Arrêt non vérifié supprimé : ${label}`)
    removed.push(label)
    return ''
  })

  // Nettoyage des espaces multiples laissés par les suppressions
  return { cleaned: cleaned.replace(/[ \t]{2,}/g, ' '), removed }
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
