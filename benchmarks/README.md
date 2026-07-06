# Benchmarks Nestenn Juridique

## `nestenn-benchmark-v1.json`

Jeu de **60 questions** en droit immobilier français, utilisé pour mesurer la qualité juridique des réponses du pipeline Nestenn.

### Structure de chaque entrée

| Champ | Type | Description |
|---|---|---|
| `id` | string | Identifiant (Q01 à Q60) |
| `domain` | enum | Un des 7 domaines couverts |
| `level` | enum | `facile`, `moyen`, `piege` |
| `question` | string | Question posée telle quelle au pipeline |
| `expected_focus` | string[] | Points juridiques que la réponse doit couvrir (articles, jurisprudences, concepts clés) |
| `risk_type` | string | Type de dérive à surveiller lors de l'évaluation |

### Répartition

**Domaines (7)** : `baux_habitation` (15) · `agent_immobilier` (10) · `vente_immobiliere` (10) · `financement_compromis` (10) · `copropriete` (5) · `diagnostics_dpe` (5) · `urbanisme_preemption` (5)

**Niveaux** :
- `facile` : question directe à base légale unique
- `moyen` : nuance ou plusieurs fondements à articuler
- `piege` : intuition trompeuse, règle d'ordre public, généralisation courante fausse

### Utilisation

Chargement dans un script de benchmark TypeScript :

```ts
import benchmark from './benchmarks/nestenn-benchmark-v1.json'

for (const q of benchmark.questions) {
  const response = await askPipeline(q.question)
  const hits = q.expected_focus.filter(f => response.includes(f)).length
  // scoring : couverture expected_focus + absence des dérives risk_type
}
```

Pour filtrer par domaine ou niveau :

```ts
const impayes = benchmark.questions.filter(q => q.domain === 'baux_habitation' && q.level === 'piege')
```

---

## Lancement ciblé via `scripts/benchmark-v1.ts`

Le script accepte des filtres pour éviter de relancer les 60 questions à chaque micro-fix.

### Options supportées

| Option | Effet | Exemple |
|---|---|---|
| `--ids=Q01,Q04,Q32` | lance uniquement les IDs listés (virgule) | `--ids=Q32` |
| `--domain=<name>` | filtre par domaine (valeurs ci-dessus) | `--domain=vente_immobiliere` |
| `--level=<name>` | filtre par niveau (`facile`, `moyen`, `piege`) | `--level=piege` |
| `--limit=N` | limite au N premiers résultats après filtrage | `--limit=5` |

Les filtres se combinent (ET logique). **Sans aucun filtre : benchmark complet 60 questions.**

### Exemples de commandes

```powershell
# 1. Une seule question (Q32)
$env:BENCHMARK_MODEL="mistralai/mistral-large-2512"; npx tsx scripts/benchmark-v1.ts --ids=Q32

# 2. Un petit lot d'IDs (Q33 et Q34)
$env:BENCHMARK_MODEL="mistralai/mistral-large-2512"; npx tsx scripts/benchmark-v1.ts --ids=Q33,Q34

# 3. Un domaine complet (vente_immobiliere, 10 questions)
$env:BENCHMARK_MODEL="mistralai/mistral-large-2512"; npx tsx scripts/benchmark-v1.ts --domain=vente_immobiliere

# 4. Tous les pièges (10 questions tous domaines confondus)
$env:BENCHMARK_MODEL="mistralai/mistral-large-2512"; npx tsx scripts/benchmark-v1.ts --level=piege

# 5. Les 3 premières questions baux_habitation (smoke rapide)
$env:BENCHMARK_MODEL="mistralai/mistral-large-2512"; npx tsx scripts/benchmark-v1.ts --domain=baux_habitation --limit=3
```
