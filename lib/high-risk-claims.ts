// lib/high-risk-claims.ts
// Detection et reformulation des affirmations juridiques a haut risque.
// Couche transverse applicable a tous les domaines — aucun import de module domaine.
//
// Cinq categories :
//   sanction               → montants d'amende, penalites CNIL/DGCCRF
//   delay                  → delais assertes sans nuance (48h, 2 mois, 3 ans…)
//   automatic_effect       → effets de plein droit, nullite automatique, declencheurs
//   mandatory_procedure    → obligations absolues enoncees sans reserve
//   liability_or_causation → responsabilite / causalite formulees trop fort
//
// Note Unicode : en JavaScript, \b et \w ne reconnaissent que les caracteres ASCII
// (a-z, A-Z, 0-9, _). Les lettres accentuees (e, a, o...) sont traitees comme \W.
// Consequence : \b ne fonctionne pas apres "responsabilite", "preuve", "plein", etc.
// Solution : les patterns termines par un caractere accentue omettent le \b final,
// et "." est utilise a la place de \w pour les segments contenant des accents.
//
// Niveaux de reformulation (SoftenLevel) :
//   medium   → reformulations de base (toujours actives)
//   high     → reformulations supplementaires : declencheurs, doit+verbe, impossible sans…
//   critical → reformulations maximales : montants precis, delais reformules completement
//
// Utilisation :
//   1. detectHighRiskClaims(text) → diagnostique les risques
//   2. softenHighRiskClaims(text, { safetyLevel }) → reformule selon le niveau du domaine
//
// Active dans route.ts :
//   - toujours en log [high-risk-claims] (tous domaines)
//   - softenHighRiskClaims avec safetyLevel issu de domain-policies

// ---------------------------------------------------------------------------
// Types publics
// ---------------------------------------------------------------------------

export type HighRiskClaimType =
  | 'sanction'
  | 'delay'
  | 'automatic_effect'
  | 'mandatory_procedure'
  | 'liability_or_causation'

export interface HighRiskClaim {
  type: HighRiskClaimType
  matchedText: string
  index: number
  /** Phrase entourant la correspondance — pour le log / diagnostic */
  sentence: string
}

/** Niveau de prudence croissant : medium < high < critical */
export type SoftenLevel = 'medium' | 'high' | 'critical'

// ---------------------------------------------------------------------------
// Helpers prives
// ---------------------------------------------------------------------------

const LEVEL_RANK: Record<SoftenLevel, number> = { medium: 1, high: 2, critical: 3 }

/**
 * Extrait la phrase contenant le match a la position matchIndex.
 * Cherche les delimiteurs de phrase (.  !  ? \n) avant et apres.
 */
function extractSentence(text: string, matchIndex: number): string {
  const before = text.slice(0, matchIndex)
  const lastBreak = Math.max(
    before.lastIndexOf('. ') + 2,
    before.lastIndexOf('.\n') + 2,
    before.lastIndexOf('! ') + 2,
    before.lastIndexOf('? ') + 2,
    before.lastIndexOf('\n') + 1,
    0,
  )
  const after = text.slice(matchIndex)
  const nextBreakRel = after.search(/[.!?]\s|\n/)
  const end = nextBreakRel === -1 ? text.length : matchIndex + nextBreakRel + 1
  return text.slice(lastBreak, end).trim().slice(0, 200)
}

// ---------------------------------------------------------------------------
// Patterns de detection — du plus specifique au plus generique
// ---------------------------------------------------------------------------

interface DetectionPattern {
  type: HighRiskClaimType
  re: RegExp
}

const DETECTION_PATTERNS: DetectionPattern[] = [

  // ── Sanctions ─────────────────────────────────────────────────────────────

  { type: 'sanction', re: /\bamende(?:\s+(?:de|jusqu['\u2019]à|pouvant\s+atteindre)\s+[\d\s.,]+[€MK%][\w\s%]*)?\b/gi },
  { type: 'sanction', re: /\d+\s*(?:M€|millions?\s*d.euros?|%\s*du\s*(?:CA|chiffre\s+d.affaires?))/gi },
  { type: 'sanction', re: /\bpassible\s+de\b/gi },
  { type: 'sanction', re: /\bpenalite(?:s)?\s+(?:de\s+\d|administrative)/gi },
  { type: 'sanction', re: /\bsanctionn(?:[eé]{1,2}(?:s|r|ra|rait|ez)?)\b/gi },

  // ── Delais ────────────────────────────────────────────────────────────────

  { type: 'delay', re: /dans\s+un\s+d[e\u00e9]lai\s+de\s+(?:\d+\s+)?.+?(?=\s*[.,;!?\n]|$)/gi },
  { type: 'delay', re: /sous\s+\d+\s*(?:h(?:eures?)?|jours?|semaines?|mois)\b/gi },
  { type: 'delay', re: /\bsous\s+\d+\s*ans?\b/gi },
  { type: 'delay', re: /\bdans\s+le\s+(?:mois|d[e\u00e9]lai)\b/gi },
  { type: 'delay', re: /\bdans\s+les\s+\d+\s+(?:jours?|mois|ans?|semaines?)\b/gi },

  // ── Effets automatiques ───────────────────────────────────────────────────

  { type: 'automatic_effect', re: /\bde\s+plein\s+droit\b/gi },
  { type: 'automatic_effect', re: /\bautomatiquement\b/gi },
  { type: 'automatic_effect', re: /\bipso\s+facto\b/gi },
  // "est nul(le)" — exclure "nul besoin", "nul doute", "nul lieu"
  { type: 'automatic_effect', re: /\best\s+nul(?:le)?\b(?!\s+(?:besoin|doute|lieu))/gi },
  // "nullite" — patterns avec accents ecrits en ASCII-safe
  { type: 'automatic_effect', re: /\bnullit[e\u00e9]\s+(?:absolue?|d.ordre\s+public|automatique|de\s+plein\s+droit)/gi },
  { type: 'automatic_effect', re: /\bnulle?\s+et\s+(?:non\s+avenu?e?|de\s+nul\s+effet)\b/gi },
  // Declencheurs — "déclenche un contrôle", "entraîne la résiliation"
  { type: 'automatic_effect', re: /\bd[eé]clenche(?:nt)?\b/gi },
  { type: 'automatic_effect', re: /\bentra[î\u00eei]ne(?:nt)?\b/gi },

  // ── Procedures obligatoires ───────────────────────────────────────────────

  { type: 'mandatory_procedure', re: /\bsous\s+peine\s+de\b/gi },
  { type: 'mandatory_procedure', re: /\best\s+(?:donc\s+)?obligatoire\b/gi },
  { type: 'mandatory_procedure', re: /\bdoit\s+imp[e\u00e9]rativement\b/gi },
  { type: 'mandatory_procedure', re: /\bil\s+est\s+(?:absolument\s+)?(?:interdit|ill[e\u00e9]gal|impossible\s+de)\b/gi },
  // "Toute X est illegale" — .{1,40} absorbe les mots accentues que \w ne capture pas en JS
  { type: 'mandatory_procedure', re: /\btoute\s+.{1,40}est\s+(?:ill[e\u00e9]gale?|interdite?|nulle?)/gi },
  // Obligations pratiques courantes dans gestion_locative / baux_habitation
  { type: 'mandatory_procedure', re: /\bdoit\s+restituer\b/gi },
  { type: 'mandatory_procedure', re: /\bdoit\s+r[e\u00e9]aliser\b/gi },
  // "impossible sans état des lieux"
  { type: 'mandatory_procedure', re: /\bimpossible\s+sans\b/gi },
  // "la loi impose de / que"
  { type: 'mandatory_procedure', re: /\bimpose\s+(?:de\b|que\b)/gi },

  // ── Responsabilite / causalite ────────────────────────────────────────────
  // Note : on omet \b final car "responsabilite" se termine par 'e' accentue (\W en JS)

  { type: 'liability_or_causation', re: /\bengage\s+(?:sa|son|leur|votre)\s+responsabilit[e\u00e9]/gi },
  // "prive le bailleur de la preuve" — plusieurs mots possibles entre prive et preuve
  { type: 'liability_or_causation', re: /\bprive\s+.{0,40}preuve/gi },
  { type: 'liability_or_causation', re: /\brend\s+.{0,20}ill[e\u00e9]g(?:al|aux?|ale)/gi },
  // "rend X impossible" — rend difficile / impossible la récupération, etc.
  { type: 'liability_or_causation', re: /\brend\s+.{0,40}impossible/gi },
  // "s'expose a" — apostrophe droite ou courbe, pas de \b final (a accentue = \W)
  { type: 'liability_or_causation', re: /\bs['\u2019]expose\s+/gi },
  { type: 'liability_or_causation', re: /\bencourt\s+(?:une?\s+)?(?:sanction|amende|poursuite|nullit[e\u00e9])\b/gi },
  // "est imputable à / au / aux" — pas de \b final (contraction au/aux possible)
  { type: 'liability_or_causation', re: /\best\s+imputable\s+/gi },
]

// ---------------------------------------------------------------------------
// detectHighRiskClaims
// ---------------------------------------------------------------------------

/**
 * Analyse un texte et retourne la liste des affirmations juridiquement sensibles.
 * Chaque claim est type et inclut la phrase de contexte.
 * Les doublons (meme position, types differents) sont conserves — ils decrivent
 * des risques independants sur la meme phrase.
 */
export function detectHighRiskClaims(text: string): HighRiskClaim[] {
  const claims: HighRiskClaim[] = []
  const seen = new Set<string>() // cle = `${type}:${index}` pour dedupliquer les patterns du meme type

  for (const { type, re } of DETECTION_PATTERNS) {
    const flags = re.flags.includes('g') ? re.flags : re.flags + 'g'
    const safeRe = new RegExp(re.source, flags)
    for (const m of text.matchAll(safeRe)) {
      const idx = m.index ?? 0
      const dedupeKey = `${type}:${idx}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)
      claims.push({
        type,
        matchedText: m[0],
        index: idx,
        sentence: extractSentence(text, idx),
      })
    }
  }

  // Trier par position dans le texte
  return claims.sort((a, b) => a.index - b.index)
}

// ---------------------------------------------------------------------------
// Regles de reformulation prudente
// ---------------------------------------------------------------------------

interface SoftenRule {
  re: RegExp
  replacement: string
  /**
   * Niveau minimum requis (medium < high < critical).
   * Undefined = toujours applique (niveau medium et au-dessus).
   * @deprecated Utiliser minLevel a la place de aggressive.
   */
  minLevel?: SoftenLevel
}

const SOFTEN_RULES: SoftenRule[] = [

  // ── Responsabilite / causalite (medium — toujours) ─────────────────────────
  // Note : memes contraintes Unicode que les patterns de detection

  { re: /\bengage\s+sa\s+responsabilit[e\u00e9]/gi,          replacement: 'peut engager sa responsabilité' },
  { re: /\bengage\s+son\s+responsabilit[e\u00e9]/gi,         replacement: 'peut engager son responsabilité' },
  { re: /\bengage\s+leur\s+responsabilit[e\u00e9]/gi,        replacement: 'peut engager leur responsabilité' },
  { re: /\bengage\s+votre\s+responsabilit[e\u00e9]/gi,       replacement: 'peut engager votre responsabilité' },
  { re: /\bprive\s+.{0,40}preuve/gi,                         replacement: 'affaiblit fortement la preuve' },
  { re: /\brend\s+.{0,20}ill[e\u00e9]g(?:al|aux?|ale)/gi,   replacement: 'peut rendre la situation illicite' },
  { re: /\bs['\u2019]expose\s+/gi,                           replacement: "peut s'exposer " },
  { re: /\bencourt\s+(?:une?\s+)?(?:sanction|amende|poursuite|nullit[e\u00e9])\b/gi,
    replacement: 'peut encourir des sanctions ou des poursuites' },

  // ── Effets automatiques (medium — toujours) ─────────────────────────────────

  { re: /\bde\s+plein\s+droit\b/gi,
    replacement: 'en principe, sans formalité supplémentaire (sous réserve des circonstances)' },
  { re: /\bautomatiquement\b/gi,
    replacement: 'en principe automatiquement (à vérifier)' },
  { re: /\best\s+nul(?:le)?\b(?!\s+(?:besoin|doute|lieu))/gi,
    replacement: 'peut être remis(e) en cause' },
  { re: /\bnulle?\s+et\s+(?:non\s+avenu?e?|de\s+nul\s+effet)\b/gi,
    replacement: 'dont la validité peut être contestée' },
  // "Toute X est illegale" — capture group $1 pour le substantif
  { re: /\btoute\s+(\w+)\s+est\s+(?:ill[e\u00e9]gale?|interdite?|nulle?)/gi,
    replacement: 'une $1 insuffisamment justifiee est tres contestable' },

  // ── Procedures absolues (medium — toujours) ─────────────────────────────────

  { re: /\bdoit\s+imp[e\u00e9]rativement\b/gi,               replacement: 'devrait en principe' },
  { re: /\bil\s+est\s+absolument\s+interdit\b/gi,            replacement: 'il est en principe interdit' },
  { re: /\bil\s+est\s+ill[e\u00e9]gal\b/gi,                  replacement: 'cela serait en principe illicite' },
  { re: /\best\s+(?:donc\s+)?obligatoire\b/gi,               replacement: 'est en principe obligatoire (à vérifier)' },

  // ── Declencheurs (high — gestion_locative, baux, bail_commercial…) ──────────

  { re: /\bd[eé]clenchent\b/gi,                              replacement: 'peuvent déclencher', minLevel: 'high' },
  { re: /\bd[eé]clenche\b/gi,                                replacement: 'peut déclencher',   minLevel: 'high' },
  { re: /\bentra[î\u00eei]nent\b/gi,                         replacement: 'peuvent entraîner',  minLevel: 'high' },
  { re: /\bentra[î\u00eei]ne\b/gi,                           replacement: 'peut entraîner',     minLevel: 'high' },

  // ── Obligations pratiques (high) ─────────────────────────────────────────────

  { re: /\bdoit\s+restituer\b/gi,
    replacement: 'doit en principe restituer', minLevel: 'high' },
  { re: /\bdoit\s+r[e\u00e9]aliser\b/gi,
    replacement: 'doit en principe réaliser', minLevel: 'high' },
  { re: /\bimpossible\s+sans\b/gi,
    replacement: 'difficile à justifier sans', minLevel: 'high' },
  { re: /\bimpose\s+(de\b|que\b)/gi,
    replacement: 'prévoit en principe $1', minLevel: 'high' },

  // ── Responsabilite additionnelle (high) ──────────────────────────────────────

  // "rend X impossible" — capture ce qu'il y a entre rend et impossible
  { re: /\brend\s+(.{0,40}?)impossible/gi,
    replacement: 'rend $1très difficile', minLevel: 'high' },
  // "est imputable à / au / aux" — espace final capturé pour reconstruire la phrase
  { re: /\best\s+imputable\s+/gi,
    replacement: 'serait en principe imputable ', minLevel: 'high' },

  // ── Sanctions et delais precis (critical — environnement_immo, rgpd_agence…) ─

  // "amende jusqu'à 1 500 €"
  { re: /\bamende\s+jusqu['\u2019][à\u00e0a]\s+([\d\s.,]+€)/gi,
    replacement: "des sanctions pouvant aller jusqu'à $1 peuvent être encourues selon la situation et le texte applicable",
    minLevel: 'critical' },
  // "sous 4 ans" / "sous 6 mois" (délai précis avec reformulation complète)
  { re: /\bsous\s+(\d+)\s+(ans?|mois|jours?|semaines?)\b/gi,
    replacement: "dans un délai pouvant aller jusqu'à $1 $2, en principe et sous réserve des textes applicables",
    minLevel: 'critical' },
  // "amende de 20 M€ / 2 millions d'euros" (grande valeur)
  { re: /\bamende\s+de\s+(?:\d+\s*M€|\d+\s*millions?\s*d.euros?)/gi,
    replacement: 'des sanctions administratives importantes peuvent être encourues',
    minLevel: 'critical' },
]

// ---------------------------------------------------------------------------
// softenHighRiskClaims
// ---------------------------------------------------------------------------

/**
 * Reformule les affirmations trop absolues en formulations plus prudentes.
 *
 * @param text         Texte a reformuler
 * @param options
 *   safetyLevel       Niveau de prudence du domaine ('medium' | 'high' | 'critical').
 *                     Determine quelles regles s'appliquent.
 *   aggressive        Compat. descendante — equivalent a safetyLevel='critical'.
 *                     Ignore si safetyLevel est fourni.
 * @returns Texte reformule
 */
export function softenHighRiskClaims(
  text: string,
  options?: { aggressive?: boolean; safetyLevel?: SoftenLevel },
): string {
  // safetyLevel prime sur aggressive (compat. descendante)
  let effectiveLevel: SoftenLevel
  if (options?.safetyLevel) {
    effectiveLevel = options.safetyLevel
  } else if (options?.aggressive) {
    effectiveLevel = 'critical'
  } else {
    effectiveLevel = 'medium'
  }

  let result = text
  for (const { re, replacement, minLevel } of SOFTEN_RULES) {
    if (minLevel && LEVEL_RANK[effectiveLevel] < LEVEL_RANK[minLevel]) continue
    const flags = re.flags.includes('g') ? re.flags : re.flags + 'g'
    const safeRe = new RegExp(re.source, flags)
    result = result.replace(safeRe, replacement)
  }

  return result
}
