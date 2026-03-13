// app/api/filter/route.ts
// Classificateur hors-sujet — détermine si une question relève du droit immobilier français
// Utilise gpt-4o-mini via OpenRouter pour une classification rapide et économique

import { NextRequest, NextResponse } from 'next/server'
import { openRouterChat, MODELS } from '@/lib/openrouter'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FilterRequestBody {
  message: string
}

interface FilterResponseBody {
  relevant: boolean
}

// ---------------------------------------------------------------------------
// Prompt de classification
// ---------------------------------------------------------------------------

const FILTER_SYSTEM_PROMPT =
  'Tu es un filtre de contenu pour un assistant juridique immobilier français. ' +
  'Réponds UNIQUEMENT par OUI ou NON, sans ponctuation ni explication. ' +
  'Réponds OUI si la question touche de près ou de loin à l\'immobilier ou au droit immobilier français : ' +
  'achat, vente, transaction, mandat (exclusif, simple, semi-exclusif), agence immobilière, agent immobilier, ' +
  'location, bail, loyer, locataire, propriétaire, copropriété, syndic, charges, assemblée générale, ' +
  'diagnostics immobiliers, DPE, amiante, plomb, loi Hoguet, ALUR, ELAN, ' +
  'notaire, compromis, promesse de vente, acte authentique, servitude, mitoyenneté, ' +
  'urbanisme, permis de construire, PLU, fiscalité immobilière, plus-value, taxe foncière, ' +
  'hypothèque, prêt immobilier, caution, dépôt de garantie. ' +
  'En cas de doute, réponds OUI. ' +
  'Réponds NON uniquement si la question est clairement hors immobilier : cuisine, sport, médecine, politique, etc.'

// ---------------------------------------------------------------------------
// POST /api/filter
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<NextResponse<FilterResponseBody>> {
  let body: FilterRequestBody

  try {
    body = (await req.json()) as FilterRequestBody
  } catch {
    // Body mal formé → fail-open pour ne pas bloquer l'utilisateur
    return NextResponse.json({ relevant: true }, { status: 200 })
  }

  const { message } = body

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    // Message absent ou vide → fail-open
    return NextResponse.json({ relevant: true }, { status: 200 })
  }

  try {
    const raw = await openRouterChat(
      [
        { role: 'system', content: FILTER_SYSTEM_PROMPT },
        { role: 'user', content: `Question : ${message.trim()}` },
      ],
      MODELS.FILTER,
      5 // maxTokens : "OUI" ou "NON" suffisent
    )

    // Normalise la réponse : strip whitespace, majuscules
    const answer = raw.trim().toUpperCase()
    const relevant = answer.startsWith('OUI')

    return NextResponse.json({ relevant }, { status: 200 })
  } catch (err) {
    // En cas d'erreur API → fail-open pour ne pas bloquer les utilisateurs
    console.error('[filter] Erreur classification :', err)
    return NextResponse.json({ relevant: true }, { status: 200 })
  }
}
