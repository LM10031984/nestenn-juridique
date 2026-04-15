# V2 Branchement Progressif — Règle de Décision

**Statut : DOCUMENTÉ UNIQUEMENT — non activé**
**Date de rédaction : 2026-04-15**
**À revoir après : premier run complet du comparateur V1 vs V2**

---

## Conditions de branchement progressif V2

V2 peut remplacer V1 sur un cas donné **uniquement si toutes ces conditions sont réunies** :

### Condition 1 — Playbook matché
```
result.status === 'ok'
```
Si aucun playbook V2 ne correspond à la question, V1 reste la route exclusive.

### Condition 2 — Validation finale OK
```
result.validationReportFinal.ok === true
```
La réponse V2 doit passer la validation déterministe (pas d'assertion interdite, pas de tag invalide, etc.).

### Condition 3 — Score gold V2 suffisant
```
v2ScoreGold.total >= SEUIL_GOLD_V2
```
**Seuil proposé : 14/20** (à affiner après mesure réelle).
Ce seuil garantit que la réponse V2 est qualitativement acceptable sur les 4 dimensions gold.

### Condition 4 — V2 surpasse V1 sur le cas
```
v2ScoreGold.total >= v1ScoreGold.total
```
V2 ne doit pas régresser par rapport à V1 sur un cas donné.

---

## Stratégie de déploiement recommandée

1. **Mesurer** : lancer `npx tsx scripts/compare-v1-v2-benchmark.ts --save-json` avec le serveur Next.js actif
2. **Analyser** : identifier le(s) cas où V2 gagne clairement (écart > 2 points gold)
3. **Brancher par playbook** : activer V2 uniquement pour les playbooks où les 4 conditions sont réunies
4. **Monitorer** : après branchement, comparer les retours utilisateurs pour confirmer la qualité

---

## Ce qui ne déclenche PAS le branchement

- V2 score gold légèrement supérieur (< 1 point d'écart) → trop proche pour justifier le risque
- Validation V2 échouée même après retry → la réponse reste non sûre
- Playbook non matché → V1 reste seul actif

---

## Fichiers de référence

- Cas gold : `docs/benchmarks/gold/*.gold.json`
- Scorer gold : `lib/legal-gold-score.ts`
- Comparateur : `scripts/compare-v1-v2-benchmark.ts`
- Orchestrateur V2 : `lib/pipeline/legal-brief-orchestrator.ts`
- Scorer interne V2 : `lib/legal-benchmark-score.ts`
