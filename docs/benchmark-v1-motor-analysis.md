# Analyse moteur par domaine — préparation vague v2

**Branche** : `benchmark/nestenn-v1`
**Source** : run `2026-04-21_06h02` (Mistral Large 2512, 60 q, coverage globale **0.906**)
**But** : identifier où concentrer l'effort moteur si une vague v2 est déclenchée. Pas de modification de code à ce stade.

---

## Typologie des faiblesses

- **pivot/corpus** : article attendu absent / résumé trop pauvre / alias manquant.
- **retrieval** : article présent en base mais non ramené dans le top-N.
- **biais modèle** : article ramené dans le prompt mais ignoré par Mistral au profit d'un voisin.
- **prompt** : règle/format dans le system prompt (verbosité, citation, longueur).
- **routing** : mauvais domaine détecté ou bascule agent/article incorrecte.
- **benchmark strict** : le scoring attend un wording cumulatif ou exact que la réponse couvre sémantiquement mais pas lexicalement.

---

## 1. vente_immobiliere — 84%

| # | Questions fragiles | Score | Focus manqué | Type dominant |
|---|---|---|---|---|
| Q33 | Litige voisinage : obligation d'information | 0.33 | art. 1112-1 CC + DDT | biais modèle (documenté) |
| Q28 | Rétractation vendeur post-compromis | 0.67 | art. L.271-1 CCH (délai 10 j réservé acquéreur) | pivot/corpus |
| Q35 | Vendeur pro présumé connaître les vices | 0.67 | clause non-garantie inopposable | pivot/corpus |
| Q26 | Responsabilité vice caché post-vente | 0.75 | art. 1645 CC (dommages-intérêts si connaissance) | pivot/corpus |

- **Type dominant** : 3/4 pivots/corpus + 1 biais modèle structurel.
- **Sous-thèmes à fort levier** :
  - Rétractation SRU (L.271-1 CCH) : asymétrie vendeur/acquéreur sous-représentée.
  - Garantie des vices cachés (1641/1643/1645) : axe "vendeur professionnel" manquant.
  - Obligation précontractuelle d'information (1112-1) : biais modèle — à laisser.
- **Priorité : haute**.

---

## 2. agent_immobilier — 86%

| # | Questions fragiles | Score | Focus manqué | Type dominant |
|---|---|---|---|---|
| Q20 | Double mandat vendeur/acquéreur | 0.33 | art. 1161 CC + loyauté renforcée | biais modèle (documenté) |
| Q17 | Bon de visite → honoraires ? | 0.75 | absence de droit à rémunération | benchmark strict + volatilité |
| Q18 | Mandat signé après visite | 0.75 | pas de régularisation a posteriori | pivot/corpus |
| Q22 | Reconduction tacite du mandat | 0.75 | dénonciation possible (Châtel) | pivot/corpus |
| Q23 | Exercice sans carte pro | 1.00 | — (mais `risks=313-1`) | prompt (drift pénal connu) |

- **Type dominant** : 1 biais structurel (Q20) + 2 pivots Hoguet (Q18, Q22) + 1 cas scoring (Q17).
- **Sous-thèmes à fort levier** :
  - Régularisation mandat a posteriori (jurisprudence stable, pivot à enrichir).
  - Reconduction tacite et dénonciation Châtel (alias à poser dans le corpus).
  - Dérive pénale 313-1 déjà tentée (commit `757ee37`) — à surveiller sans réouvrir.
- **Priorité : moyenne** — 2 leviers nets mais Q20 non corrigible sans risque de régression.

---

## 3. urbanisme_preemption — 88%

| # | Questions fragiles | Score | Focus manqué | Type dominant |
|---|---|---|---|---|
| Q56 | Préemption à prix inférieur | 0.67 | art. L.213-4 (saisine juge expropriation) | pivot/corpus |
| Q59 | Terrain faussement constructible | 0.75 | dol (1137) / erreur (1132) | pivot/corpus (transversal) |

- Signal secondaire : `tooLongRate = 0.20` sur ce domaine (1 q sur 5) → verbosité prompt à surveiller.
- **Type dominant** : pivots/corpus avec lien transversal droit commun ↔ urbanisme.
- **Sous-thèmes à fort levier** :
  - Chaîne L.213-1 → L.213-4 → L.213-7 CU complète pour le parcours préemption.
  - Pont urbanisme ↔ vices du consentement (1137/1132) pour les cas terrain.
- **Priorité : faible** — petit volume (5 q), gain global marginal.

---

## 4. baux_habitation — 93%

| # | Questions fragiles | Score | Focus manqué | Type dominant |
|---|---|---|---|---|
| Q06 | Préavis 1 mois hors zone tendue | 0.67 | art. 15 loi 89-462 | benchmark strict cumulatif (documenté) |
| Q01 | Congé pour reprise (fils majeur) | 0.75 | bénéficiaires autorisés (descendants) | pivot/corpus |
| Q02 | Dépôt de garantie, traces d'usure | 0.75 | art. 1731 CC (charge preuve bailleur) | pivot/corpus (article manquant) |
| Q03 | Sous-location sans accord écrit | 0.75 | accord écrit y compris sur le prix | pivot/corpus |

- **Type dominant** : pivots/corpus + 1 cas scoring (Q06).
- **Sous-thèmes à fort levier** :
  - Art. 1731 CC (charge de preuve bailleur) : à indexer, absent du curated.
  - Congé pour reprise : liste des bénéficiaires (descendants/ascendants/concubin notoire) à enrichir.
- **Priorité : faible** — 93% déjà atteint, volume le plus gros (15 q) donc plafond naturel, ROI marginal par question.

---

## Synthèse comparative

| Domaine | Score | # fragiles / total | Leviers récupérables (hors biais) | Gain domaine potentiel | Gain global estimé | Priorité |
|---|---|---|---|---|---|---|
| vente_immobiliere | 84% | 4 / 10 | 3 (Q26, Q28, Q35) | +~15 pts → ~99% | +~2,5 pts | **haute** |
| agent_immobilier | 86% | 4 / 10 | 2 (Q18, Q22) | +~10 pts → ~96% | +~1,7 pts | moyenne |
| urbanisme_preemption | 88% | 2 / 5 | 2 (Q56, Q59) | +~15 pts → ~100% | +~1,3 pts | faible (volume) |
| baux_habitation | 93% | 4 / 15 | 3 (Q01, Q02, Q03) | +~5 pts → ~98% | +~1,3 pts | faible |

---

## Recommandation — par où attaquer la vague v2

**Attaquer `vente_immobiliere` en premier.**

Pourquoi :

1. **Score le plus bas** du benchmark (0.84) avec un **volume significatif** (10 q, 16,6% du jeu) → chaque question récupérée pèse sur le global.
2. **Typologie favorable** : 3 des 4 faiblesses sont des pivots/corpus — c'est exactement la classe de patch qui a déjà produit les gains de la stabilisation v1 (6 commits corpus sur 6), donc **risque de régression maîtrisé**.
3. **Sous-thèmes cohérents entre eux** : vices cachés (1641/1645), rétractation (L.271-1 CCH), vendeur professionnel — un seul vrai chantier corpus, pas dispersé.
4. **Gain global estimé** : passage probable de **0.906 → ~0.93** en enrichissant 3 pivots, sans toucher au moteur ni au prompt.
5. **Le seul résidu non corrigible (Q33 / art. 1112-1)** est déjà documenté comme biais modèle structurel — il reste en l'état, pas de tentative prompt.

Ordre de bataille suggéré (si la vague est lancée) :

1. `vente_immobiliere` — enrichissement corpus (haute).
2. `agent_immobilier` — pivots Hoguet Q18 / Q22 (moyenne).
3. `urbanisme_preemption` — L.213-4 + pont dol/erreur (faible, en bundle avec 2).
4. `baux_habitation` — indexer 1731 CC + bénéficiaires congé (faible).

Ne **pas toucher** : Q06 (scoring), Q17 (scoring + volatilité), Q20 / Q33 (biais modèle Mistral).

---

## Addendum — garde-fou qualification avant-contrat (branche `improve/motor-v2-qualification-avant-contrat`)

Un garde-fou ciblé a été mergé hors du périmètre benchmark v1. Il ne vise pas un gain de coverage mais la correction de deux risques produit observés sur la famille « offre acceptée / compromis non signé / formation de la vente » (mini-benchmark de 6 questions QC1–QC6) :

1. **Contradictions et réponses catégoriques** entre QC1 (« le vendeur est engagé ») et QC2/QC3 (« sans écrit rien n'est formé ») — dangereux en conseil terrain.
2. **Numéros de pourvoi fictifs** récurrents (famille `Cass. 3e civ., 10 juillet 2019, n° 18-17.xxx`) — hallucination visible par l'agent.

### Ce qui a été livré

- **Règle doctrinale** ajoutée dans `lib/prompts/mistral-system-prompt.ts` (§11 Large / §10 Small) — art. 1583 comme principe, deux scénarios explicites (accord ferme vs. renvoi à un compromis), relecture de l'offre systématiquement recommandée. Aucun playbook forcé, aucun `forcedArticles`.
- **Filtre déterministe** `lib/juri-filter.ts` — TransformStream SSE → SSE qui détecte les numéros de pourvoi Cassation `n° NN-NN.NNN`, compare à la whitelist construite depuis les `juriCases` injectés au prompt (pg + live), et remplace les numéros hors-sources par `n° [à vérifier sur Judilibre]`. Aucun appel réseau, aucun appel LLM.
- **Câblage dans `app/api/chat/route.ts`** — un `pipeThrough` derrière `process.env.ENABLE_JURI_FILTER === 'true'`. Rollback = commenter la variable dans l'environnement, pas de rebuild.

### Résultats observés sur le mini-benchmark qualification

- Contradictions QC1/QC2/QC3 : **levées** (raisonnement unifié autour de 1583).
- Faux arrêts visibles côté user : **8 → 0** sur les 6 réponses.
- Vrais arrêts neutralisés à tort : **0** — les 2 numéros qui passent (`14-22.372` du 2016-09-27, `15-27.290` du 2017-01-05) sont vérifiés présents dans Supabase.
- Artefacts de streaming (numéro coupé, placeholder mal fermé) : **0**.

### Variable d'environnement

`ENABLE_JURI_FILTER=true` — à déclarer côté env (local `.env.local` déjà gitignored, prod : à ajouter selon le process d'environnement de la cible). Absente ou `!== 'true'` → comportement historique, filtre inactif.
