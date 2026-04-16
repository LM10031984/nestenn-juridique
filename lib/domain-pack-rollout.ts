// lib/domain-pack-rollout.ts
// Politique de rollout domain pack — source de vérité unique pour l'activation
// des domain packs par domaine et par mode (shadow / active).
//
// Règles :
//   - seul le domaine baux_habitation est couvert pour l'instant
//   - si un playbook est déjà matché → la politique est 'none' (playbook prioritaire)
//   - si aucun playbook et domaine = baux_habitation :
//     ACTIVE=true → 'active' (le domain pack répond)
//     SHADOW=true → 'shadow' (le domain pack tourne en arrière-plan)
//     sinon       → 'none'
//   - ACTIVE prend le dessus sur SHADOW si les deux flags sont actifs

import { FEATURES } from './config'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 'none'   → ne rien faire (domain pack non utilisé)
 * 'shadow' → domain pack tourne en arrière-plan via waitUntil(), V1 répond
 * 'active' → domain pack génère la réponse finale si validation ok
 */
export type DomainPackPolicy = 'none' | 'shadow' | 'active'

// ─────────────────────────────────────────────────────────────────────────────
// getDomainPackPolicy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retourne la politique d'activation du domain pack pour une question donnée.
 *
 * @param domain       Domaine détecté par detectDomain() — null si non détecté
 * @param playbookId   Playbook matché ET whitelisté — null si aucun match
 */
export function getDomainPackPolicy(
  domain: string | null,
  playbookId: string | null,
): DomainPackPolicy {
  // Master flag OFF → rien
  if (!FEATURES.DOMAIN_PACKS_ENABLED) return 'none'

  // Playbook matché → il est prioritaire, domain pack ne s'active pas
  if (playbookId !== null) return 'none'

  // Domain pack uniquement pour baux_habitation
  if (domain !== 'baux_habitation') return 'none'

  // Résoudre le mode : ACTIVE > SHADOW
  if (FEATURES.BAUX_PACK_ACTIVE) return 'active'
  if (FEATURES.BAUX_PACK_SHADOW) return 'shadow'

  return 'none'
}

// ─────────────────────────────────────────────────────────────────────────────
// logDomainPackEvent — log structuré standard pour toutes les étapes
// ─────────────────────────────────────────────────────────────────────────────

export interface DomainPackLogEvent {
  domain: string | null
  playbookMatched: boolean
  fallbackRuleId: string | null
  mode: DomainPackPolicy
  validationOk: boolean | null
  usedV2Pack: boolean
  fallbackReason: string | null
}

export function logDomainPackEvent(event: DomainPackLogEvent): void {
  console.info(
    `[domain-pack] domain=${event.domain ?? 'none'} `
    + `playbookMatched=${event.playbookMatched ? 'yes' : 'no'} `
    + `fallbackRule=${event.fallbackRuleId ?? 'none'} `
    + `mode=${event.mode} `
    + `validationOk=${event.validationOk === null ? 'n/a' : event.validationOk ? 'yes' : 'no'} `
    + `usedV2Pack=${event.usedV2Pack ? 'yes' : 'no'} `
    + `fallbackReason=${event.fallbackReason ?? 'none'}`
  )
}
