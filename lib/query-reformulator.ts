// lib/query-reformulator.ts
// Reformule une question utilisateur en requête juridique ciblée
// pour optimiser la recherche dans Légifrance et Judilibre.
//
// Utilise GPT-4o-mini pour extraire :
//   - les articles de loi pertinents
//   - les mots-clés juridiques pour Judilibre CC/CA
//   - le domaine juridique précis

import { openRouterChat, MODELS } from '@/lib/openrouter'

export interface ReformulatedQuery {
  /** Mots-clés juridiques optimisés pour Judilibre CC (Cour de cassation) */
  judilibreQuery: string
  /** Mots-clés optimisés pour Judilibre CA (Cours d'appel) */
  judilibreQueryCA: string
  /** Articles de loi spécifiques à chercher sur Légifrance [{law, artNums}] */
  articlesToFetch: Array<{ law: string; artNums: string[] }>
  /** Domaine juridique principal */
  domain: string
  /** Résumé juridique de la question en 1 phrase */
  legalSummary: string
}

const REFORMULATION_PROMPT = `Tu es un juriste spécialisé en droit immobilier français.

Analyse la question et produis une reformulation juridique optimisée pour rechercher dans les bases de données Légifrance et Judilibre.

IMPORTANT :
- Identifie les ARTICLES DE LOI EXACTS pertinents (numéro + loi)
- Formule des mots-clés JURIDIQUES précis pour la recherche de jurisprudence
- Distingue les termes pour Cour de cassation (principes) et Cours d'appel (application récente)

Réponds UNIQUEMENT en JSON valide, sans markdown :
{
  "judilibreQuery": "mots-clés juridiques précis pour CC (ex: révocation syndic copropriété majorité absolue article 25)",
  "judilibreQueryCA": "mots-clés pour CA (ex: syndic révocation anticipée contrat assemblée générale)",
  "articlesToFetch": [
    {"law": "loi 65-557", "artNums": ["18", "25"]},
    {"law": "code civil", "artNums": ["1984"]}
  ],
  "domain": "copropriete",
  "legalSummary": "Possibilité de renégocier le contrat de syndic avant son terme par décision d'AG"
}

Domaines valides : baux_habitation, copropriete, agent_immobilier, vente_immobiliere, diagnostics, construction, urbanisme, fiscalite, sci_societes, bail_commercial, consommation, viager_demembrement, location_saisonniere, responsabilite_civile

Pour les lois, utilise ces noms exacts :
- "loi 65-557" (copropriété)
- "loi 89-462" (baux habitation)
- "loi 70-9" (Hoguet, agents)
- "décret 72-678" (décret Hoguet)
- "code civil"
- "code de commerce" (bail commercial)
- "code de la consommation"
- "code de l'urbanisme"
- "CCH" (construction habitation)
- "CGI" (impôts)
- "loi 2014-366" (ALUR)
- "loi 2018-1021" (ELAN)
- "loi 2021-1104" (Climat-Résilience)`

/**
 * Reformule une question utilisateur en requête juridique ciblée.
 * Coût : ~100 tokens GPT-4o-mini (~0.00002€), latence ~300ms.
 * Fail-safe : retourne null si erreur (le pipeline continue avec la question brute).
 */
export async function reformulateQuery(question: string): Promise<ReformulatedQuery | null> {
  try {
    const response = await openRouterChat(
      [
        { role: 'system', content: REFORMULATION_PROMPT },
        { role: 'user', content: question },
      ],
      MODELS.FILTER, // GPT-4o-mini
      0.0,
    )

    const cleaned = response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const parsed = JSON.parse(cleaned) as ReformulatedQuery

    // Validation minimale
    if (!parsed.judilibreQuery || !parsed.domain) return null

    console.info(`[reformulator] domain=${parsed.domain} juri="${parsed.judilibreQuery.slice(0, 60)}" articles=${parsed.articlesToFetch?.length ?? 0}`)
    return parsed
  } catch (err) {
    console.warn('[reformulator] Erreur, fallback question brute:', err)
    return null
  }
}
