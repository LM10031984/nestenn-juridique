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
} as const
