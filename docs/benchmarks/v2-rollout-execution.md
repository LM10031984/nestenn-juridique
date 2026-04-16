# V2 Rollout — Guide d'exécution

**Date :** 2026-04-16  
**Branche :** `architecture/legal-brief-v2`  
**Fichier de politique :** `lib/legal-v2-rollout.ts`

---

## Variables d'environnement

| Variable | Valeur | Effet |
|---|---|---|
| `ENABLE_V2_LEGAL_BRIEF` | `true` | Active le moteur V2 sur les 6 playbooks whitelistés |
| `ENABLE_V2_LEGAL_BRIEF` | `false` (défaut) | Pipeline V1 uniquement |
| `ENABLE_V2_SHADOW` | `true` | Mode shadow : V2 tourne en arrière-plan, V1 répond |
| `ENABLE_V2_SHADOW` | `false` (défaut) | Shadow désactivé |

> **Ne jamais activer les deux en même temps.** `ENABLE_V2_SHADOW=true` est ignoré si `ENABLE_V2_LEGAL_BRIEF=true`.

---

## Playbooks activés en V2

| Playbook ID | Domaine | Phase | Score gold | Validé le |
|---|---|---|---|---|
| `vente_offre_contre_signee` | Vente immobilière | 1 | ≥ 18.7/20 | 2026-04-15 |
| `gestion_locative_depot_garantie` | Gestion locative | 1 | ≥ 18.7/20 | 2026-04-15 |
| `environnement_immo_spanc` | Environnement | 1 | ≥ 18.7/20 | 2026-04-15 |
| `syndic_travaux_urgents` | Copropriété | 2 | 20/20 | 2026-04-16 |
| `vente_dpe_errone` | Vente immobilière | 2 | 20/20 | 2026-04-16 |
| `agent_defaut_information` | Vente immobilière | 2 | 20/20 | 2026-04-16 |

Tout autre playbook → fallback V1 automatique (`reason: playbook_not_whitelisted`).

---

## Logique de routage V1/V2

```
Question entrante
  │
  ├─ detectLegalPlaybook() → null ?
  │    → fallback V1  [reason: no_playbook_match]
  │
  ├─ playbook.id dans whitelist ?
  │    non → fallback V1  [reason: playbook_not_whitelisted]
  │
  ├─ runLegalBriefOrchestrator() → status != 'ok' ?
  │    → fallback V1  [reason: orchestrator_failed]
  │
  ├─ validationReportFinal.ok = false ?
  │    retried=false → fallback V1  [reason: validation_failed]
  │    retried=true  → fallback V1  [reason: retry_failed_validation]
  │
  ├─ AUTHORITY_SCOPE_MISMATCH dans issues ?
  │    → fallback V1  [reason: authority_scope_mismatch]
  │
  └─ → Réponse V2  [reason: ok]
```

---

## Headers de réponse

### Réponse V2 (`X-Legal-Engine: v2`)

| Header | Valeur | Description |
|---|---|---|
| `X-Legal-Engine` | `v2` | Moteur utilisé |
| `X-Legal-Playbook` | ex. `vente_dpe_errone` | Playbook détecté |
| `X-Legal-Fallback-Reason` | `` (vide) | Pas de fallback |
| `X-Legal-Retried` | `true` / `false` | Retry déclenché |
| `X-V2-Budget` | ex. `high` | Niveau de précision budgété |
| `X-V2-Validation` | `ok` / `fail` | Résultat validation finale |
| `X-V2-Score` | ex. `18` | Score interne benchmark /20 |

### Réponse V1 (fallback)

Les headers `X-Legal-*` sont absents des réponses V1 (response streaming OpenRouter non wrappée). L'absence du header `X-Legal-Engine` indique V1.

---

## Logs structurés

Format des logs principaux pour le monitoring staging :

```
[v2-router] playbook=<id> engine=<v1|v2> reason=<reason> validation=<ok|fail> issues=<n> scope_mismatch=<bool> retried=<bool> duration=<ms>ms
[v2] score_interne=<n>/20 accuracy=<n> nuances=<n> practical=<n> safety=<n>
[v2-router] fallback_v1 reason=<reason> playbook=<id>         ← si fallback
[v2-shadow] playbook=<id> validation=<ok|fail> score=<n>/20   ← si shadow mode
```

---

## Mode shadow

Le mode shadow permet de mesurer l'impact V2 sans l'exposer en production.

**Activation :** `ENABLE_V2_SHADOW=true` (avec `ENABLE_V2_LEGAL_BRIEF=false`)

**Fonctionnement :**
1. Question entrante → V1 répond normalement (streaming)
2. Si playbook whitelisté détecté → V2 tourne en arrière-plan via `waitUntil()`
3. Score et validation V2 loggués sous `[v2-shadow]`

**Limites :** le mode shadow ne peut pas comparer textuellement V1 vs V2 (V1 est streamé et non capturé). La comparaison est qualitative : score V2 / validation V2.

---

## Procédure staging

### Étape 1 — Shadow (1 semaine)
```bash
ENABLE_V2_LEGAL_BRIEF=false
ENABLE_V2_SHADOW=true
```
Surveiller dans les logs :
- `[v2-shadow]` : score moyen, taux validation ok, fréquence scope_mismatch
- Objectif : score moyen ≥ 17/20, validation ok ≥ 90% des appels

### Étape 2 — V2 actif (staging uniquement)
```bash
ENABLE_V2_LEGAL_BRIEF=true
ENABLE_V2_SHADOW=false
```
Surveiller :
- `X-Legal-Engine: v2` dans les réponses
- `X-Legal-Fallback-Reason` absent (pas de fallback inattendu)
- Taux d'erreur 5xx inchangé
- Latence P95 : V2 < 4s (vs V1 < 2s — overhead orchestrateur acceptable)

### Étape 3 — Activation prod
1. Vérifier 7 jours de métriques staging (voir section ci-dessous)
2. Merger branche `architecture/legal-brief-v2` dans `master`
3. Ajouter `ENABLE_V2_LEGAL_BRIEF=true` dans les variables Vercel (production)
4. Vérifier les premiers logs prod dans les 30 minutes

---

## Procédure de rollback

```bash
# Désactiver V2 sans déploiement (variable Vercel)
ENABLE_V2_LEGAL_BRIEF=false
# Vercel redémarre automatiquement — pas de code change nécessaire
```

---

## Métriques à surveiller (7 jours post-activation)

| Métrique | Source | Seuil d'alerte |
|---|---|---|
| Taux `X-Legal-Engine: v2` | Headers / logs | < 40% sur playbooks whitelistés → investiguer |
| Taux `fallback_v1` | `[v2-router] fallback_v1` | > 20% → investiguer raison |
| Score moyen interne | `[v2] score_interne` | < 16/20 → stopper V2 |
| Taux validation ok | `[v2-router] validation=ok` | < 85% → stopper V2 |
| Taux `scope_mismatch` | `[v2-router] scope_mismatch=true` | > 5% → investiguer playbook |
| Taux retried | `[v2-router] retried=true` | > 30% → qualité playbook insuffisante |
| Latence P95 | Vercel Analytics | > 6s → optimiser ou stopper |
| Taux erreur 5xx | Vercel Analytics | Augmentation > baseline → rollback |

---

## Ajouter un nouveau playbook à la whitelist

1. Créer le playbook dans `lib/legal-playbooks.ts`
2. Créer les authority cards dans `lib/authority-cards.ts` si nécessaire
3. Créer les gold cases dans `lib/legal-gold-cases.ts`
4. Valider : score gold V2 ≥ 17/20, aucun `AUTHORITY_SCOPE_MISMATCH`
5. Ajouter l'id dans `V2_ROLLOUT_PLAYBOOKS` dans `lib/legal-v2-rollout.ts`
6. Mettre à jour ce document (tableau playbooks activés)
