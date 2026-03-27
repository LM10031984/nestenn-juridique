# Nestenn Juridique — Assistant IA droit immobilier

Assistant juridique IA spécialisé en droit immobilier français, développé par la Start Academy pour le réseau Nestenn.

## Stack technique

- **Frontend** : Next.js 14 App Router + TypeScript + Tailwind CSS
- **LLM** : GPT-4o via OpenRouter (filtre : GPT-4o-mini)
- **Sources juridiques** : API DILA/Légifrance (dynamique, toujours à jour)
- **BDD** : Supabase (PostgreSQL + Auth + pgvector)
- **Déploiement** : Vercel (région Europe)

## Démarrage rapide

### 1. Installation

```bash
npm install
```

### 2. Configuration

```bash
cp .env.example .env.local
# Remplir les variables dans .env.local
```

### 3. Base de données Supabase

Dans l'éditeur SQL de Supabase, exécuter :
```
supabase/migrations/001_initial.sql
```

### 4. Lancer en développement

```bash
npm run dev
# → http://localhost:3000
```

## Architecture Phase 1

```
app/
├── (app)/chat/        # Interface principale
├── api/chat/          # Pipeline LLM (filtre → DILA → GPT-4o → SSE)
├── api/filter/        # Classificateur hors-sujet (gpt-4o-mini)
└── api/legifrance/    # Proxy DILA (Phase 2)

lib/
├── openrouter.ts      # Client OpenRouter
├── legifrance.ts      # OAuth2 DILA + cache + pipeline
├── system-prompt.ts   # Prompt officiel Nestenn
└── supabase/          # Client Supabase server/browser
```

## Pipeline de réponse

```
Question utilisateur
  → [filtre gpt-4o-mini] hors-sujet ? → refus standardisé
  → [DILA] extraction entités → récupération textes en vigueur
  → [GPT-4o] génération avec contexte juridique → stream SSE
```

## Variables d'environnement requises

Voir `.env.example`. Sans credentials PISTE (`PISTE_CLIENT_ID` / `PISTE_CLIENT_SECRET`), le système fonctionne en mode dégradé (LLM seul). Inscription sur https://piste.gouv.fr/registration.

## Philosophie produit

> Le chantier principal n'est plus la qualité de la réponse, c'est la qualité de la réponse en tant que produit juridique institutionnel.

## Roadmap

- **Phase 1** (S1-2) : Chat juridique + DILA ✅
- **Phase 2** (S3-5) : Upload documents + auth multi-agences
- **Phase 3** (S6-7) : Dashboard admin + vocal
- **Phase 4** (S8) : Production + sécurité
- **Phase 5** (M2-3) : PWA + CRM + optimisation
