# CLAUDE.md

## Objectif du projet
Construire un assistant juridique immobilier français très fiable pour les agents immobiliers du réseau Nestenn.
Le système s’appuie sur Legifrance / PISTE, Judilibre, Supabase/pgvector et des prompts Mistral.
La priorité n’est pas de produire la réponse la plus longue, mais la réponse la plus fiable, utile et exploitable sur le terrain.

## Priorités absolues
1. Réduire les hallucinations juridiques.
2. Maximiser le grounding sur les sources réellement disponibles.
3. Favoriser des réponses courtes, claires, opérationnelles.
4. Améliorer le benchmark sur les cas fréquents des agents immobiliers.
5. Préserver la stabilité du pipeline avant toute optimisation ambitieuse.

## Ne pas casser
- Ne pas modifier plusieurs couches du système à la fois.
- Ne pas faire de refactor large sans demande explicite.
- Ne pas dégrader la stabilité de demo-stable.
- Ne pas augmenter fortement les coûts ou la latence sans raison claire.
- Ne pas forcer des citations ou jurisprudences absentes des sources fournies.

## Méthode de travail
- Toujours proposer d’abord un diagnostic avant une modification importante.
- Préférer un patch minimal à fort ROI.
- Une modification = un objectif mesurable.
- Après chaque changement : indiquer les fichiers modifiés, le diff, les tests à lancer, le risque éventuel.
- Quand une hypothèse est incertaine, créer un script de diagnostic avant de corriger à l’aveugle.

## Conventions juridiques
- Ne jamais inventer un article, un numéro d’arrêt ou une règle.
- Si les sources sont faibles, répondre de manière plus prudente et l’indiquer explicitement.
- Distinguer clairement :
  - règle certaine
  - point à vérifier
  - exception non confirmée
- Prioriser les textes applicables aux situations immobilières fréquentes :
  - baux habitation
  - mandat / loi Hoguet
  - vente immobilière
  - copropriété
  - diagnostics / DPE
  - urbanisme pratique

## Format attendu pour les réponses produit
Par défaut, réponses structurées en 4 blocs max :
1. Réponse courte
2. Base légale / jurisprudence utile
3. Points de vigilance
4. Actions concrètes

Réponse courte par défaut.
Réponse détaillée seulement si nécessaire.
Pas de tableau obligatoire.
Pas de développement théorique inutile.

## Quand tu proposes du code
Toujours préciser :
- pourquoi ce changement est prioritaire
- son impact attendu
- son risque
- comment le tester

## Quand tu fais une review
Prioriser :
- qualité juridique réelle
- grounding / retrieval
- stabilité
- impact benchmark
Pas de review cosmétique inutile.