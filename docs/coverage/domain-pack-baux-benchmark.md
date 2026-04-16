# Benchmark go / no-go — Domain Pack baux_habitation

**Fichier script** : `scripts/benchmark-domain-pack-baux.ts`  
**Fichier tests** : `__tests__/benchmark-domain-pack-baux.test.ts`  
**Commande** : `npx tsx scripts/benchmark-domain-pack-baux.ts [--save-json]`

---

## Objectif

Valider ou invalider le POC domain pack `baux_habitation` par un benchmark réel, sans modifier le routage prod ni appeler le LLM.

Le benchmark mesure si le domain pack améliore réellement la couverture utile des questions `baux_habitation` **non couvertes par les playbooks existants**.

---

## Dataset — 30 questions

| Catégorie | Questions | Profils |
|---|---|---|
| `loyers_impayes_expulsion` | 8 | 4 bien couverts / 2 flous / 2 cas bords |
| `depot_garantie_etat_lieux` | 6 | 2 bien couverts / 2 flous / 2 cas bords |
| `conge_bailleur_locataire` | 6 | 2 bien couverts / 2 flous / 2 cas bords |
| `decence_insalubrite` | 4 | 1 bien couvert / 2 flous / 1 cas bord |
| `sous_location_colocation` | 4 | 1 bien couvert / 2 flous / 1 cas bord |
| `treve_hivernale` | 2 | 1 bien couvert / 1 cas bord |

### Profils des questions

| Profil | Compte | Description |
|---|---|---|
| `well_covered` | 10 | Questions canoniques, formulation claire, dans le scope d'un archétype précis |
| `fuzzy` | 10 | Formulation naturelle, ambiguïté légère, vocabulaire non-technique |
| `edge_case` | 10 | Cas limites, intersections de régimes, sans playbook évident |

### Marqueurs par question

Chaque question porte :
- `expectedPlaybookMatch` : un playbook V2 devrait matcher (uniquement `baux_loyers_impayes_expulsion` pour l'instant)
- `expectedAbsorbableByDomainPack` : le domain pack seul devrait produire un brief utile (true pour toutes les 30 questions)
- `goldExpectation` : résumé court de ce qu'une bonne réponse doit contenir

---

## 3 modes comparés

| Mode | Description | Quand applicable |
|---|---|---|
| **A — Baseline** | Playbook seul (comportement prod actuel sans domain pack). Si aucun playbook : brief = null, score = 0. | Toujours |
| **B — Domain pack seul** | `buildBriefFromDomainPack` sans overlay, même si un playbook existe. Mesure la couverture native du domain pack. | Toujours |
| **C — Domain pack + overlay** | `buildBriefFromDomainPack` avec overlay playbook si disponible, sinon domain pack seul. Comportement cible de production. | Toujours |

**Aucun appel LLM. Aucun appel API prod.** Les 3 modes appellent les builders déterministes locaux.

---

## Métriques calculées

Pour chaque mode, le script calcule :

| Métrique | Description | Unité |
|---|---|---|
| **Absorbées** | Questions pour lesquelles le mode produit un brief actif (archétype spécifique ou playbook matché) | % |
| **Score gold** | Score heuristique de qualité du brief (authorityCards + distinctions + practicalOutcome + safetyAssertions) | /20 |
| **Gold (¬PB)** | Score gold uniquement sur le sous-ensemble sans playbook attendu | /20 |
| **Erreur de portée** | % de questions avec au moins une authority card hors scope baux_habitation | % |
| **Score practical** | Qualité des practical outcomes (nombre et richesse) | /5 |
| **Latence** | Temps de construction du brief (déterministe — microsecondes) | ms |
| **Taille** | Longueur totale du brief (somme de tous les items) | items |
| **Autorités** | Nombre moyen d'authority cards injectées | n |

### Formule du score gold (heuristique /20)

```
authorityScore (0–5)   : 4+ cards → 5 | 3 → 4.5 | 2 → 3.5 | 1 → 2 | 0 → 0
distinctionScore (0–5) : min(5, nbDistinctions × 0.85) + 0.5 bonus si brief absorbé
practicalScore (0–5)   : 4+ items → 5 | 3 → 4 | 2 → 3 | 1 → 1.5 | 0 → 0
safetyScore (0–5)      : 6+ assertions → 5 | 4+ → 4 | 2+ → 3 | 1 → 1.5 | 0 → 0
scopePenalty           : −1.5 par erreur de portée détectée

total = clamp(authorityScore + distinctionScore + practicalScore + safetyScore − scopePenalty, 0, 20)
```

---

## Règle go / no-go

Le benchmark conclut **GO** seulement si **tous** les critères suivants sont remplis :

| # | Critère | Seuil | Mesure |
|---|---|---|---|
| 1 | **Absorption sans playbook** | ≥ 40% des questions sans playbook absorbées par Mode B | `matchFallbackRule != null` |
| 2 | **Score gold** | Moyenne ≥ 16.5/20 sur les questions absorbées sans playbook en Mode B | Heuristique brief quality |
| 3 | **Aucune erreur de portée critique** | 0 question avec authority card hors scope dans Mode B ou C | `detectScopeErrors()` |
| 4 | **Latence acceptable** | Augmentation Mode B vs Mode A ≤ 20% | `performance.now()` |
| 5 | **Pas de régression playbook** | Mode C ≥ Mode A − 1pt sur les questions avec playbook overlay | Score gold comparé |

Si un seul critère échoue → **NO-GO** avec raisons explicites.

---

## Interprétation des résultats

### Score gold par mode

| Fourchette | Interprétation |
|---|---|
| ≥ 18/20 | Brief très riche — authority cards + distinctions + practical outcomes bien couverts |
| 16–17.5 | Brief correct — couverture suffisante pour un usage production |
| 14–15.5 | Brief minimal — couverture partielle, risque de lacunes sur cas spécifiques |
| < 14 | Brief insuffisant — domain pack ne couvre pas l'archétype de manière utile |

### Taux d'absorption Mode B

| Taux | Signal |
|---|---|
| ≥ 70% | Excellent — les fallback rules couvrent la quasi-totalité du domaine |
| 40–70% | Acceptable — seuil minimal go/no-go atteint |
| < 40% | Insuffisant — il faut ajouter des fallback rules pour les archétypes non couverts |

---

## Résultats attendus (théoriques)

Basé sur l'analyse du domain pack v1, voici les prévisions :

### Couverture par fallback rules

Les 7 fallback rules couvrent : `loyers_impayes_expulsion`, `depot_garantie_restitution`, `conge_bailleur`, `conge_locataire`, `treve_hivernale`, `decence_logement`, `sous_location`.

**Archétypes sans fallback rule** : `colocation_solidarite` — les questions B26/B28 risquent de ne pas être absorbées en Mode B.

### Prévisions

| Mode | Absorption attendue | Gold moyen attendu | Score practical |
|---|---|---|---|
| A | ~17% (5 questions avec playbook) | ~14/20 (élevé pour PB, 0 sans PB) | ~4.5/5 pour questions avec PB |
| B | ~75–85% | ~16–17/20 | ~4.5/5 |
| C | ~90–95% | ~17–18.5/20 | ~4.5–5/5 |

---

## Limites du benchmark

1. **Pas d'appel LLM** : le score gold mesure la *richesse du brief*, pas la *qualité de la réponse finale*. Un brief riche ne garantit pas une bonne réponse LLM.

2. **Articles synthétiques uniquement** : les tests utilisent `EMPTY_ARTICLES` et `EMPTY_CASES`. En production, les articles résolus live enrichiraient davantage les briefs.

3. **Latence non discriminante** : les builders déterministes s'exécutent en microsecondes — la comparaison de latence Mode B vs Mode A est peu significative. La latence réelle est celle de la résolution live (Légifrance/Judilibre), non testée ici.

4. **Subjectivité du score gold heuristique** : les seuils de la formule (0.85 par distinction, etc.) sont des approximations. Ils sont cohérents avec les scores observés sur les playbooks Phase 1–3 mais non validés empiriquement sur ce domaine.

---

## Comment exécuter

```bash
# Benchmark seul
npx tsx scripts/benchmark-domain-pack-baux.ts

# Avec sauvegarde JSON
npx tsx scripts/benchmark-domain-pack-baux.ts --save-json
# → docs/coverage/domain-pack-baux-benchmark-results.json

# Tests unitaires
npx vitest run __tests__/benchmark-domain-pack-baux.test.ts
```

---

## Prochaines étapes selon le verdict

### Si GO

1. Activer le domain pack dans le routage prod pour les questions `baux_habitation` sans playbook match.
2. Créer les playbooks manquants en priorité : `baux_depot_garantie`, `baux_conge_bailleur`, `baux_decence_logement`.
3. Enrichir la fallback rule `colocation_solidarite` pour couvrir B26/B28.
4. Lancer un benchmark live sur 50 questions avec résolution Légifrance réelle.

### Si NO-GO

| Critère échoué | Action corrective |
|---|---|
| Absorption < 40% | Ajouter des fallback rules pour les archétypes non couverts |
| Gold < 16.5 | Enrichir les fallback rules avec plus de `mandatoryDistinctions` et `forcedPivotArticleIds` |
| Erreurs de portée | Vérifier `authorityScopeConstraints` et les pivot articles |
| Régression playbook | Vérifier `buildRequiredDistinctions` — priorité overlay doit être respectée |
