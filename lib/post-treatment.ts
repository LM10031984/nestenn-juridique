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

// ── Sanitisation inline (avant envoi client) ─────────────────────────────────

export function sanitizeJuriNumbers(
  text: string,
  validCases: Array<{ number: string }>,
): { sanitized: string; removed: string[] } {
  const normalize = (n: string) => n.replace(/[\s\-\.\/]/g, '').toLowerCase()
  const validNums = new Set(validCases.map(c => normalize(c.number)))

  const removed: string[] = []
  const sanitized = text.replace(
    /n°\s*([\d]{2}[\-\.][\d]{2,5}(?:[\-\.][\d]{2,5})?)/g,
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
