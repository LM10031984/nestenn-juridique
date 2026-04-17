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
