// lib/typo-corrector.ts
// Correction des fautes courantes en immobilier avant détection de domaine et whitelist.
// NE PAS utiliser sur le message envoyé au LLM — le LLM comprend les fautes.

const COMMON_TYPOS: Record<string, string> = {
  'locatire': 'locataire',
  'propriétare': 'propriétaire',
  'proprietaire': 'propriétaire',
  'copropriete': 'copropriété',
  'coproprieté': 'copropriété',
  'expulser': 'expulsion',
  'syndique': 'syndic',
  'compromie': 'compromis',
  'diagnoctic': 'diagnostic',
  'diagnostique': 'diagnostic',
  'urbanime': 'urbanisme',
  'honoraire': 'honoraires',
  'comission': 'commission',
  'commision': 'commission',
  'assainisement': 'assainissement',
  'servitute': 'servitude',
  'mitoyeneté': 'mitoyenneté',
  'retractation': 'rétractation',
  'preemption': 'préemption',
  'preavis': 'préavis',
  'depôt': 'dépôt',
  'depot': 'dépôt',
  'garentie': 'garantie',
  'garanti': 'garantie',
  'hypoteque': 'hypothèque',
  'hipothèque': 'hypothèque',
  'bailleure': 'bailleur',
  'viagé': 'viager',
  'usufrit': 'usufruit',
  'succesion': 'succession',
  'succéssion': 'succession',
  'indivission': 'indivision',
}

// Construit les regex une seule fois au chargement du module
const TYPO_PATTERNS = Object.entries(COMMON_TYPOS).map(([typo, correction]) => ({
  pattern: new RegExp(`\\b${typo}\\b`, 'gi'),
  correction,
}))

export function correctTypos(text: string): string {
  let corrected = text
  for (const { pattern, correction } of TYPO_PATTERNS) {
    corrected = corrected.replace(pattern, correction)
  }
  return corrected
}
