// lib/authority-normalizer.ts
// Normalisation canonique des abréviations d'autorités légales dans les réponses V2.
// Objectif : améliorer la lisibilité et la compatibilité avec le gold scorer.
// Remplace les abréviations usuelles par les noms longs canoniques.
// S'applique sur le texte final après génération LLM, avant validation et gold scoring.

// ─────────────────────────────────────────────────────────────────────────────
// Table de substitution
// Ordre : du plus spécifique au moins spécifique (éviter les remplacements parasites)
// ─────────────────────────────────────────────────────────────────────────────

type AbbrevRule = {
  pattern: RegExp
  replacement: string
}

const ABBREV_RULES: AbbrevRule[] = [
  // Code civil — formes abrégées fréquentes
  { pattern: /\bC\.\s*civ\./g,            replacement: 'Code civil' },
  { pattern: /\bcode\s+civ\b/gi,           replacement: 'Code civil' },

  // Code de la consommation
  { pattern: /\bC\.\s*conso\./g,           replacement: 'Code de la consommation' },
  { pattern: /\bcode\s+conso\b/gi,         replacement: 'Code de la consommation' },

  // Code de la construction et de l'habitation
  { pattern: /\bC\.C\.H\./g,              replacement: "Code de la construction et de l'habitation" },
  // CCH seul (entre parenthèses ou avant espace) — ne pas toucher "EACH" etc.
  { pattern: /\bCCH\b/g,                  replacement: "Code de la construction et de l'habitation" },

  // Code de la santé publique — CSP (attention à ne pas toucher "SPANC" ou autres)
  // Sécurité : CSP doit être un mot seul ou encadré par ponctuation/espace
  { pattern: /\bCSP\b/g,                  replacement: 'Code de la santé publique' },

  // Loi du 6 juillet 1989 — formes abrégées
  // "loi 89-462" → "loi du 6 juillet 1989"
  { pattern: /\bloi\s+89[-–]462\b/gi,     replacement: 'loi du 6 juillet 1989' },
  // "art. 22 loi 89-462" est capturé par la règle ci-dessus (loi 89-462)

  // Code de commerce (pour cohérence, même si peu fréquent)
  { pattern: /\bC\.\s*com\./g,            replacement: 'Code de commerce' },
  { pattern: /\bcode\s+com\b/gi,          replacement: 'Code de commerce' },
]

// ─────────────────────────────────────────────────────────────────────────────
// expandAuthorityCitations
// Remplace les abréviations dans le texte de réponse par les formes canoniques longues.
// Idempotent : peut être appelé plusieurs fois sans effet cumulatif.
// ─────────────────────────────────────────────────────────────────────────────

export function expandAuthorityCitations(text: string): string {
  let result = text
  for (const rule of ABBREV_RULES) {
    result = result.replace(rule.pattern, rule.replacement)
  }
  return result
}
