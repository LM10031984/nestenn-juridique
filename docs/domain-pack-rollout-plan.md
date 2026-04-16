# Plan : Domain Pack Rollout — baux_habitation (Shadow → Active)

Branch: architecture/legal-brief-v2
Date: 2026-04-16
Status: DRAFT

## Objectif

Brancher le POC domain pack `baux_habitation` dans l'orchestrateur V2, en mode shadow d'abord, uniquement pour les questions `baux_habitation` sans playbook matché. Le benchmark est validé GO. On ne casse pas la prod.

## Contraintes

- Ne pas activer le domain pack globalement
- Ne pas toucher aux autres domaines  
- Ne pas changer de modèle (Mistral Large 3 reste le seul modèle V2)
- Playbooks restent prioritaires
- Domain pack uniquement si aucun playbook ne matche

## Codebase context (analysé)

### Fichiers existants clés
- `lib/domain-packs.ts` — BAUX_HABITATION_PACK, getDomainPack, matchFallbackRule ✅
- `lib/domain-pack-builder.ts` — buildBriefFromDomainPack(), retourne LegalBrief ✅
- `lib/legal-v2-rollout.ts` — shouldUseLegalV2(), V2_ROLLOUT_PLAYBOOKS ✅
- `lib/config.ts` — FEATURES flags (V2_LEGAL_BRIEF_ENABLED, V2_SHADOW_ENABLED) ✅
- `lib/pipeline/legal-brief-orchestrator.ts` — runLegalBriefOrchestrator(), buildV2SystemPrompt(), buildV2UserMessage() ✅
- `app/api/chat/route.ts` — tryV2Route(), runV2Shadow() ✅

### Architecture actuelle tryV2Route
```
tryV2Route(message) →
  detectLegalPlaybook(message) → playbook?
    NO → return null (fallback V1)
    YES + whitelisted? →
      runLegalBriefOrchestrator() →
        buildLegalBrief() → prompt → LLM → validate
      shouldUseLegalV2() → décision
      OK → Response SSE V2
      NOT OK → null (fallback V1)
```

### Architecture cible
```
tryV2Route(message) →
  detectLegalPlaybook(message) → playbook?
    YES + whitelisted → [flux actuel inchangé]
    NO (or not whitelisted) →
      detectDomain(message) → baux_habitation?
        NO → return null (fallback V1)
        YES →
          shouldUseDomainPack(config) →
            SHADOW → runDomainPackShadow() — waitUntil, V1 répond
            ACTIVE → tryDomainPackRoute() →
              buildBriefFromDomainPack() + live articles + live juri
              → prompt → LLM → validate
              OK → Response SSE V2 (headers X-Legal-Engine: v2-domain-pack)
              NOT OK → null (fallback V1)
```

## Étapes d'implémentation

### 1. lib/domain-pack-rollout.ts (nouveau fichier)

Flags :
```typescript
ENABLE_DOMAIN_PACKS: process.env.ENABLE_DOMAIN_PACKS === 'true'
ENABLE_BAUX_PACK_SHADOW: process.env.ENABLE_BAUX_PACK_SHADOW === 'true'  
ENABLE_BAUX_PACK_ACTIVE: process.env.ENABLE_BAUX_PACK_ACTIVE === 'true'
```

Logique politique :
- si domaine ≠ baux_habitation → 'none'
- si playbook matché → 'none' (playbook prioritaire)
- si aucun playbook + domain pack baux disponible :
  - ACTIVE=true → 'active'
  - SHADOW=true → 'shadow'
  - sinon → 'none'

Type `DomainPackPolicy = 'none' | 'shadow' | 'active'`

### 2. lib/pipeline/legal-brief-orchestrator.ts (extension)

Exporter une nouvelle fonction :
```typescript
export async function runLegalBriefOrchestratorWithDomainPack(
  userQuestion: string,
  domainPack: DomainPack,
): Promise<DomainPackOrchestratorResult>
```

Cette fonction :
1. Détecte playbook (optionnel — overlay si matché)
2. Résout articles live via Légifrance (pivot articles du domain pack)
3. Récupère jurisprudence live Judilibre
4. Construit LegalBrief via `buildBriefFromDomainPack()`
5. Génère réponse V2 via même buildV2SystemPrompt/buildV2UserMessage
6. Valide
7. Retourne résultat structuré

Type de retour :
```typescript
type DomainPackOrchestratorResult =
  | { status: 'ok'; domainPackId: string; fallbackRuleId: string | null; ... }
  | { status: 'error'; reason: string }
```

### 3. app/api/chat/route.ts (modification tryV2Route)

Dans `tryV2Route(message)`, après la vérification whitelist playbook :
- Si playbook matché → flux actuel (aucun changement)
- Si pas de playbook (ou non-whitelisted) :
  - detectDomain → baux_habitation?
  - getDomainPackPolicy() pour cette question
  - 'shadow' → waitUntil(runDomainPackShadow()), return null
  - 'active' → tryDomainPackRoute() → Response ou null (fallback)

### 4. lib/config.ts (ajout flags)

Ajouter :
```typescript
DOMAIN_PACKS_ENABLED: process.env.ENABLE_DOMAIN_PACKS === 'true',
BAUX_PACK_SHADOW: process.env.ENABLE_BAUX_PACK_SHADOW === 'true',
BAUX_PACK_ACTIVE: process.env.ENABLE_BAUX_PACK_ACTIVE === 'true',
```

### 5. Headers et logs

Logs minimum :
- `[domain-pack] domain=baux_habitation playbookMatched=yes/no fallbackRule=<id|none> mode=shadow|active`
- `[domain-pack] validationOk=yes/no usedV2Pack=yes/no fallbackReason=<...>`

Headers si réponse pack utilisée :
- `X-Legal-Engine: v2-domain-pack`
- `X-Legal-Domain-Pack: baux_habitation`
- `X-Legal-Fallback-Rule: <archetypeId|none>`

### 6. Tests (__tests__/domain-pack-rollout.test.ts)

- pack non utilisé si playbook matché
- pack non utilisé hors baux_habitation
- pack utilisé si baux_habitation + pas de playbook + flag actif
- shadow n'impacte pas la réponse utilisateur (return null toujours)
- fallback V1 si validation pack non ok
- flags OFF → policy = 'none' dans tous les cas

### 7. Documentation (docs/coverage/domain-pack-rollout-baux.md)

- flags et conditions d'activation
- métriques à suivre (score/20, validationOk %, fallback %)
- règle go/no-go pour passage shadow → active

## Analyse des risques

### Risque 1 : buildBriefFromDomainPack sans articles live = brief appauvri
- Mitigation : la fonction gère déjà ce cas avec les pivot articles synthétiques
- En shadow : acceptable (on mesure, on ne répond pas)
- En active : si validationOk=false → fallback V1 automatique

### Risque 2 : Double appel live (Légifrance + Judilibre) si V1 tourne aussi
- Shadow → les deux appels tournent (accepté en shadow, mesurable)
- Active → V1 ne tourne pas si V2 répond → pas de double appel
- En shadow : waitUntil() isole le coût côté Vercel, pas bloquant pour l'utilisateur

### Risque 3 : Détection domaine faux positif (question hors baux matchée comme baux)
- detectDomain() est déjà en prod et fiable
- Le domain pack ajoute une condition sur le domaine EN PLUS du flag
- Si domain pack génère une réponse hors sujet → validationOk=false → fallback V1

### Risque 4 : Régression playbooks existants
- La condition d'entrée dans le domain pack est explicitement "pas de playbook whitelisted"
- Les 9 playbooks existants gardent la priorité absolue

## Scénarios de test

| Scénario | Playbook | Domaine | Flag | Résultat attendu |
|----------|----------|---------|------|-----------------|
| Q whitelistée | baux_loyers_impayes | baux | — | V2 playbook (flux actuel) |
| Q baux sans playbook, shadow | null | baux | SHADOW | V1 répond, shadow logge |
| Q baux sans playbook, active | null | baux | ACTIVE | V2 domain pack répond |
| Q autre domaine | null | copropriete | ACTIVE | fallback V1 |
| V2 pack validation fail | null | baux | ACTIVE | fallback V1 |
| Tous flags OFF | null | baux | OFF | fallback V1 |

## Non-scope

- Autres domaines (copropriété, vente, etc.) : pas de domain pack pour l'instant
- Changement de modèle : Mistral Large 3 reste le seul modèle V2
- Changement de logique de validation : validateAnswerAgainstBrief() inchangée

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 0 | — | — |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

**VERDICT:** NO REVIEWS YET
