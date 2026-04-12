// lib/config.ts
// Feature flags — contrôlés par variables d'environnement
// Les flags sont inactifs par défaut : passer à 'true' pour activer

export const FEATURES = {
  DYNAMIC_DOMAINS: process.env.ENABLE_DYNAMIC_DOMAINS === 'true',
} as const
