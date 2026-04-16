// lib/legal-v2-rollout.ts
// Politique de rollout progressif V2 — décision de routage V1/V2
//
// Responsabilité unique : décider si la réponse V2 est utilisable,
// indépendamment du flag global et des résultats de l'orchestrateur.
//
// Utilisé par tryV2Route (app/api/chat/route.ts).

// ─────────────────────────────────────────────────────────────────────────────
// Whitelist des playbooks activés en V2
// Phase 1 (3 playbooks) + Phase 2 (3 playbooks) = 6 playbooks validés
// Ne pas ajouter ici sans benchmark gold ≥ 17/20 et validation de portée
// ─────────────────────────────────────────────────────────────────────────────

export const V2_ROLLOUT_PLAYBOOKS = [
  // Phase 1 — validés sprint-final
  'vente_offre_contre_signee',
  'gestion_locative_depot_garantie',
  'environnement_immo_spanc',
  // Phase 2 — validés sprint qualité 2026-04-16
  'syndic_travaux_urgents',
  'vente_dpe_errone',
  'agent_defaut_information',
] as const

export type V2RolloutPlaybook = (typeof V2_ROLLOUT_PLAYBOOKS)[number]

export function isV2EnabledPlaybook(id: string): id is V2RolloutPlaybook {
  return (V2_ROLLOUT_PLAYBOOKS as readonly string[]).includes(id)
}

// ─────────────────────────────────────────────────────────────────────────────
// shouldUseLegalV2 — décision de routage V1/V2
//
// Appelé APRÈS l'orchestrateur avec ses résultats.
// Centralise toutes les règles de fallback dans un seul endroit testable.
// ─────────────────────────────────────────────────────────────────────────────

export type V2RoutingParams = {
  /** Feature flag global ENABLE_V2_LEGAL_BRIEF */
  featureEnabled: boolean
  /** Playbook détecté par detectLegalPlaybook() — null si aucun match */
  playbookId: string | null
  /** L'orchestrateur a retourné status === 'ok' */
  orchestratorOk: boolean
  /** validationReportFinal.ok — aucune issue severity medium/high */
  validationOk: boolean
  /** Au moins une issue de type AUTHORITY_SCOPE_MISMATCH */
  hasAuthorityScopeMismatch: boolean
  /** L'orchestrateur a déclenché un retry (premier essai de validation échoué) */
  retried: boolean
}

export type V2Decision = {
  useV2: boolean
  reason: V2FallbackReason
}

export type V2FallbackReason =
  | 'ok'
  | 'feature_flag_disabled'
  | 'no_playbook_match'
  | 'playbook_not_whitelisted'
  | 'orchestrator_failed'
  | 'validation_failed'
  | 'retry_failed_validation'
  | 'authority_scope_mismatch'

export function shouldUseLegalV2(params: V2RoutingParams): V2Decision {
  const { featureEnabled, playbookId, orchestratorOk, validationOk, hasAuthorityScopeMismatch, retried } = params

  if (!featureEnabled) {
    return { useV2: false, reason: 'feature_flag_disabled' }
  }

  if (!playbookId) {
    return { useV2: false, reason: 'no_playbook_match' }
  }

  if (!isV2EnabledPlaybook(playbookId)) {
    return { useV2: false, reason: 'playbook_not_whitelisted' }
  }

  if (!orchestratorOk) {
    return { useV2: false, reason: 'orchestrator_failed' }
  }

  if (!validationOk) {
    return { useV2: false, reason: retried ? 'retry_failed_validation' : 'validation_failed' }
  }

  if (hasAuthorityScopeMismatch) {
    return { useV2: false, reason: 'authority_scope_mismatch' }
  }

  return { useV2: true, reason: 'ok' }
}
