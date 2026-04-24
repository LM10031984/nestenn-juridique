// lib/juri-filter.ts
// Filtre déterministe des numéros de pourvoi cités par le LLM mais absents
// des sources réellement fournies au prompt. Remplace le numéro non reconnu
// par "[à vérifier sur Judilibre]" à l'intérieur du flux SSE sortant.
//
// - Aucun appel réseau, aucun appel LLM.
// - Réversible via ENABLE_JURI_FILTER=true dans l'appel.
// - Le texte en dehors des numéros n'est jamais modifié.

import type { JuriCase } from '@/lib/sources'

const PLACEHOLDER = '[à vérifier sur Judilibre]'

// Numéro de pourvoi Cassation complet : "n° NN-NN(NN).NNN(NN)"
//   ex. "n° 18-17.562", "n° 21-24.539", "n° 09-10.218".
const NUM_PATTERN = /n°\s*(\d{2}-\d{2,5}\.\d{3,5})/g

// Tail match : numéro de pourvoi en cours de frappe, ancré en fin de chaîne.
// Sert à décider combien de caractères du buffer on peut encore émettre.
const PENDING_TAIL = /n°?(?:\s{0,3}\d{0,5}(?:-\d{0,5}(?:\.\d{0,5})?)?)?$/i

function canonicalize(n: string): string {
  return n.trim().replace(/[.\s]/g, '').toLowerCase()
}

/**
 * Sanitise un texte complet : tout numéro de pourvoi Cassation absent de la
 * whitelist est remplacé par "n° [à vérifier sur Judilibre]". Fonction pure.
 */
export function sanitizeText(text: string, whitelistCanon: Set<string>): string {
  return text.replace(NUM_PATTERN, (match, num: string) =>
    whitelistCanon.has(canonicalize(num)) ? match : `n° ${PLACEHOLDER}`,
  )
}

/**
 * Construit un TransformStream SSE → SSE qui filtre les numéros de pourvoi.
 * La whitelist est dérivée des juriCases injectés dans le prompt (pg + live).
 */
export function buildJuriSanitizer(
  juriCases: Array<Pick<JuriCase, 'number'>>,
): TransformStream<Uint8Array, Uint8Array> {
  const whitelist = new Set(
    juriCases.map(c => canonicalize(c.number ?? '')).filter(Boolean),
  )
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()

  let sseBuffer = ''     // portion SSE non terminée par "\n\n"
  let textPending = ''   // contenu décodé retenu tant qu'un numéro peut être en cours

  function emitContent(controller: TransformStreamDefaultController<Uint8Array>, content: string) {
    if (content.length === 0) return
    const payload = { choices: [{ delta: { content } }] }
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
  }

  function drainSafe(
    controller: TransformStreamDefaultController<Uint8Array>,
    forceAll: boolean,
  ) {
    if (textPending.length === 0) return
    let safe: string
    if (forceAll) {
      safe = textPending
      textPending = ''
    } else {
      const m = textPending.match(PENDING_TAIL)
      const boundary =
        m && m.index !== undefined && m[0].length > 0 ? m.index : textPending.length
      safe = textPending.slice(0, boundary)
      textPending = textPending.slice(boundary)
    }
    emitContent(controller, sanitizeText(safe, whitelist))
  }

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      sseBuffer += decoder.decode(chunk, { stream: true })
      const events = sseBuffer.split('\n\n')
      sseBuffer = events.pop() ?? ''

      for (const event of events) {
        if (event.length === 0) continue

        for (const line of event.split('\n')) {
          if (!line.startsWith('data: ')) {
            if (line.length > 0) controller.enqueue(encoder.encode(line + '\n'))
            continue
          }
          const payload = line.slice(6)

          if (payload.includes('[DONE]')) {
            drainSafe(controller, true)
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            continue
          }

          let parsed: any
          try {
            parsed = JSON.parse(payload)
          } catch {
            controller.enqueue(encoder.encode(`data: ${payload}\n\n`))
            continue
          }

          const delta = parsed?.choices?.[0]?.delta?.content
          if (typeof delta !== 'string' || delta.length === 0) {
            // Événements non-content (role, finish_reason…) : on vide d'abord
            // le tampon texte pour préserver l'ordre côté client.
            drainSafe(controller, true)
            controller.enqueue(encoder.encode(`data: ${payload}\n\n`))
            continue
          }

          textPending += delta
          drainSafe(controller, false)
        }
      }
    },
    flush(controller) {
      drainSafe(controller, true)
      if (sseBuffer.length > 0) {
        controller.enqueue(encoder.encode(sseBuffer))
        sseBuffer = ''
      }
    },
  })
}
