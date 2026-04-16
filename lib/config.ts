// lib/config.ts
// Feature flags — contrôlés par variables d'environnement
// Les flags sont inactifs par défaut : passer à 'true' pour activer

export const FEATURES = {
  DYNAMIC_DOMAINS: process.env.ENABLE_DYNAMIC_DOMAINS === 'true',

  // V2_LEGAL_BRIEF_ENABLED : active le moteur V2 (legal-brief-orchestrator) dans /api/chat.
  // Comportement : si un playbook V2 matche et toutes les conditions de rollout sont remplies
  //   → V2 répond ; sinon fallback V1 automatique.
  // Périmètre : 6 playbooks whitelistés (voir lib/legal-v2-rollout.ts).
  // Activation : ENABLE_V2_LEGAL_BRIEF=true dans .env.local ou variables Vercel.
  V2_LEGAL_BRIEF_ENABLED: process.env.ENABLE_V2_LEGAL_BRIEF === 'true',

  // V2_SHADOW_ENABLED : mode shadow — exécute V2 en arrière-plan sur playbook matché,
  // continue à répondre en V1, logge le score et la validation V2 pour comparaison.
  // Utile pour mesurer l'impact V2 sans l'exposer en production.
  // Ne pas activer en même temps que V2_LEGAL_BRIEF_ENABLED (inutile et coûteux).
  // Activation : ENABLE_V2_SHADOW=true dans .env.local ou variables Vercel.
  V2_SHADOW_ENABLED: process.env.ENABLE_V2_SHADOW === 'true',

  // ── Domain Pack flags (baux_habitation uniquement pour l'instant) ─────────────
  // DOMAIN_PACKS_ENABLED : master flag — aucun domain pack n'est actif si false.
  // BAUX_PACK_SHADOW : shadow mode — domain pack tourne en arrière-plan, V1 répond.
  //   Usage : mesurer la qualité du domain pack sur trafic réel avant activation.
  //   Conditions : DOMAIN_PACKS_ENABLED=true + BAUX_PACK_SHADOW=true.
  // BAUX_PACK_ACTIVE : active mode — domain pack répond si baux_habitation + pas de playbook.
  //   Conditions : DOMAIN_PACKS_ENABLED=true + BAUX_PACK_ACTIVE=true.
  // Règle : BAUX_PACK_ACTIVE prend le dessus sur BAUX_PACK_SHADOW si les deux sont true.
  // Ne pas activer BAUX_PACK_ACTIVE sans avoir validé en shadow d'abord.
  DOMAIN_PACKS_ENABLED: process.env.ENABLE_DOMAIN_PACKS === 'true',
  BAUX_PACK_SHADOW: process.env.ENABLE_BAUX_PACK_SHADOW === 'true',
  BAUX_PACK_ACTIVE: process.env.ENABLE_BAUX_PACK_ACTIVE === 'true',
} as const
