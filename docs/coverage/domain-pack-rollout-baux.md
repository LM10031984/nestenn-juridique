# Domain Pack Rollout — baux_habitation

## Contexte

Le domain pack `baux_habitation` couvre les questions de bail d'habitation sans playbook matché.
Benchmark validé GO. Déployé en shadow d'abord, actif ensuite.

## Flags d'activation

| Variable d'environnement | Effet |
|--------------------------|-------|
| `ENABLE_DOMAIN_PACKS=true` | Master flag — obligatoire pour tout le reste |
| `ENABLE_BAUX_PACK_SHADOW=true` | Shadow mode : domain pack tourne en arrière-plan, V1 répond |
| `ENABLE_BAUX_PACK_ACTIVE=true` | Active mode : domain pack répond si validation ok |

**Règle** : `BAUX_PACK_ACTIVE` prend le dessus sur `BAUX_PACK_SHADOW` si les deux sont actifs.

## Conditions d'activation

Le domain pack s'active **uniquement si** :
1. `ENABLE_DOMAIN_PACKS=true`
2. Domaine détecté = `baux_habitation`
3. Aucun playbook whitelisté n'a matché la question
4. Flag shadow ou active est `true`

**Les 9 playbooks whitelistés restent prioritaires** — le domain pack ne s'active jamais si un playbook matche.

## Architecture

```
tryV2Route(message)
  ├─ detectLegalPlaybook → playbook whitelisté?
  │     YES → flux V2 playbook (inchangé)
  │     NO  → getDomainPackPolicy(domain, null)
  │             'active' → tryDomainPackRoute() → SSE ou fallback V1
  │             'shadow' → waitUntil(runDomainPackShadow()) → V1 répond
  │             'none'   → fallback V1
```

## Headers réponse active

| Header | Valeur |
|--------|--------|
| `X-Legal-Engine` | `v2-domain-pack` |
| `X-Legal-Domain-Pack` | `baux_habitation` |
| `X-Legal-Fallback-Rule` | archetypeId activé (ex: `conge_bailleur`) ou vide |
| `X-V2-Budget` | `high` / `medium` / `low` |
| `X-V2-Validation` | `ok` / `fail` |
| `X-Legal-Retried` | `true` / `false` |

## Logs à surveiller

```
[domain-pack] domain=baux_habitation playbookMatched=no fallbackRule=conge_bailleur mode=shadow validationOk=yes usedV2Pack=no fallbackReason=none
[domain-pack-shadow] pack=baux_habitation_v1 fallbackRule=conge_bailleur validation=ok issues=0 scopeMismatch=false retried=false duration=3200ms budget=medium
```

## Métriques à suivre (shadow)

| Métrique | Cible go/no-go active |
|----------|----------------------|
| `validationOk` rate | ≥ 80% |
| `AUTHORITY_SCOPE_MISMATCH` rate | ≤ 5% |
| `retried` rate | ≤ 30% |
| Répartition `fallbackRule` | Toutes les règles activées (pas de biais archétype) |
| Duration moyenne | ≤ 5 000ms |

## Règle go/no-go : shadow → active

Après **minimum 50 questions en shadow** sur trafic baux_habitation réel :

**GO si :**
- `validationOk` ≥ 80%
- `scopeMismatch` ≤ 5%
- Duration P95 ≤ 6 000ms
- Au moins 3 archétypes représentés dans les `fallbackRule`

**NO-GO si :**
- `validationOk` < 70%
- `scopeMismatch` > 10%
- Un seul archétype représente > 80% des activations (biais)

## Activation progressive recommandée

1. `ENABLE_DOMAIN_PACKS=true` + `ENABLE_BAUX_PACK_SHADOW=true` → mesurer 50 questions
2. Valider les métriques go/no-go
3. `ENABLE_BAUX_PACK_ACTIVE=true` (remplace automatiquement shadow)
4. Monitorer 24h les headers `X-Legal-Engine: v2-domain-pack`
5. Rollback : mettre `ENABLE_BAUX_PACK_ACTIVE=false` — V1 reprend immédiatement

## Fichiers clés

| Fichier | Rôle |
|---------|------|
| `lib/domain-pack-rollout.ts` | Politique rollout + logging |
| `lib/pipeline/domain-pack-orchestrator.ts` | Pipeline LLM domain pack |
| `lib/domain-packs.ts` | BAUX_HABITATION_PACK + fallback rules |
| `lib/domain-pack-builder.ts` | buildBriefFromDomainPack() |
| `lib/config.ts` | Flags FEATURES |
| `app/api/chat/route.ts` | Intégration tryV2Route |
| `__tests__/domain-pack-rollout.test.ts` | 13 tests rollout policy |
