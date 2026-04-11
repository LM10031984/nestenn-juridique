# Système de création dynamique de domaines

## Concept

L'auto-indexeur classe actuellement les articles dans **18 domaines fixes** via GPT-4o-mini. Quand aucun domaine ne dépasse un seuil de confiance, l'article tombe dans `autres` et devient difficile à retrouver par pgvector.

Le système de domaines dynamiques rend l'indexeur **auto-adaptatif** : il apprend de nouveaux domaines à mesure que les agents posent des questions sur des sujets non couverts.

## Workflow

```
Article indexé → classifyArticleDomain()
      │
      ├─ Domaine reconnu (VALID_DOMAINS) → indexé normalement
      │
      └─ Domaine non reconnu ("autres")
             │
             └─ [FEATURES.DYNAMIC_DOMAINS = true] → handleUnclassifiedArticle()
                    │
                    ├─ suggestNewDomain() → GPT-4o-mini propose un nom + label + keywords
                    │
                    ├─ findSimilarPendingDomain() → existe déjà dans pending_domains ?
                    │       ├─ Oui → incrementPendingDomain() (compteur++)
                    │       └─ Non → createPendingDomain() (nouvelle entrée)
                    │
                    └─ checkAutoCreationEligibility()
                           │
                           ├─ article_count >= 5 ET confidence_avg >= 0.4 ET limite mensuelle non atteinte
                           │       └─ autoCreateDomain() → status=auto_created + quality_alert
                           │
                           └─ Sinon → reste en "pending" (validation manuelle requise)
```

## Les 4 garde-fous

| Garde-fou | Valeur | Raison |
|-----------|--------|--------|
| **Minimum d'articles** | 5 articles | Évite les faux positifs sur un seul article isolé |
| **Limite mensuelle** | 5 créations/mois | Prévient l'explosion incontrôlée de domaines |
| **Confiance minimale** | 0.4 (40%) | Filtre les suggestions trop incertaines |
| **Cooldown** | Par vérification à chaque appel | Un seul domaine auto-créé par déclenchement |

## Comment activer le feature flag

Le système est **inactif par défaut**. Pour l'activer :

### Prérequis

1. Appliquer la migration Supabase manuellement :
   ```bash
   supabase db push --file supabase/migrations/025_pending_domains.sql
   ```
   — OU via le dashboard Supabase : SQL Editor → coller le contenu de `025_pending_domains.sql` → Run

2. Vérifier que la table `pending_domains` est créée dans Supabase.

### Activation

Dans `.env.local`, passer la valeur à `true` :

```env
ENABLE_DYNAMIC_DOMAINS=true
```

Puis redémarrer le serveur Next.js :

```bash
npm run dev
```

### Vérification

- Naviguer vers `/admin/domains` (super_admin requis)
- Vérifier que la page se charge sans erreur
- Lancer les tests d'intégration :
  ```bash
  ENABLE_DYNAMIC_DOMAINS=true npx vitest run __tests__/dynamic-domains.test.ts
  ```

## Gestion via le dashboard `/admin/domains`

### Sections du dashboard

| Section | Description |
|---------|-------------|
| **Statistiques** | Compteurs par statut (pending / approved / rejected / merged / auto_created) |
| **Auto-créations ce mois** | Jauge X/5 des créations automatiques du mois |
| **Domaines en attente** | Liste des pending avec actions inline |
| **Domaines actifs** | Grille des domaines existants avec compteur d'articles |
| **Historique** | Domaines traités (approuvés, rejetés, fusionnés) |

### Actions disponibles

| Action | Effet |
|--------|-------|
| **Approuver** | Passe `status` à `approved` — le domaine est officiellement validé |
| **Rejeter** | Passe `status` à `rejected` — les articles restent dans `autres` |
| **Renommer** | Modifie `suggested_name` et `suggested_label` avant approbation |
| **Fusionner** | Passe `status` à `merged`, reclasse les articles dans le domaine cible |

## Rollback d'un domaine auto-créé

Si un domaine auto-créé est jugé incorrect, procédure de rollback :

### Option 1 : via SQL (Supabase Dashboard)

```sql
-- 1. Retrouver le domaine auto-créé
SELECT * FROM pending_domains WHERE status = 'auto_created' ORDER BY auto_created_at DESC;

-- 2. Récupérer les article IDs associés
-- (visible dans le champ sample_article_ids du résultat ci-dessus)

-- 3. Remettre les articles dans 'autres'
UPDATE legal_articles 
SET domain = 'autres' 
WHERE domain = 'nom_du_domaine_a_rollback';

-- 4. Marquer le pending comme rejeté
UPDATE pending_domains 
SET status = 'rejected', reviewed_at = now()
WHERE suggested_name = 'nom_du_domaine_a_rollback';
```

### Option 2 : via le dashboard

1. Aller sur `/admin/domains`
2. Dans la section "Historique des domaines traités", retrouver le domaine auto-créé
3. Les boutons ne sont disponibles que sur les domaines `pending` — pour agir sur un `auto_created`, utiliser l'option SQL ci-dessus.

## Fichiers concernés

| Fichier | Rôle |
|---------|------|
| `supabase/migrations/025_pending_domains.sql` | Migration (à appliquer manuellement) |
| `lib/config.ts` | Feature flags |
| `lib/pending-domains.ts` | Logique cœur du système |
| `lib/auto-indexer.ts` | Point d'intégration (modifié) |
| `app/admin/domains/page.tsx` | Dashboard super_admin |
| `app/api/admin/pending-domains/route.ts` | GET : données dashboard |
| `app/api/admin/pending-domains/approve/route.ts` | POST : approbation |
| `app/api/admin/pending-domains/reject/route.ts` | POST : rejet |
| `app/api/admin/pending-domains/rename/route.ts` | POST : renommage |
| `app/api/admin/pending-domains/merge/route.ts` | POST : fusion |
| `__tests__/dynamic-domains.test.ts` | Tests d'intégration |
