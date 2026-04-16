# Domain Coverage Roadmap — Nestenn Juridique
> Généré le 2026-04-16 · Branche `architecture/legal-brief-v2`

## Résumé exécutif

La V2 couvre **4 domaines activés** via 6 playbooks validés et 6 gold cases.
Le système dispose d'infrastructure (detector, policy, T2AI ou shortlist) pour **13 domaines supplémentaires**
susceptibles de passer en playbook sans refactoring.
**2 domaines restent bloqués** (droit_social_immo sans detector, fiscalite en legacy).

| Statut | Domaines | Nb |
|--------|----------|----|
| activated | gestion_locative, copropriete, vente_immobiliere, environnement_immo, responsabilite_agent | 5 |
| candidate | baux_habitation, syndic_copropriete, agent_immobilier, diagnostics, fiscalite_investisseurs, location_touristique, construction, urbanisme, bail_commercial, sci_patrimoine, conformite_lcb_ft, rgpd_agence | 12 |
| fallback_only | viager_demembrement, servitudes | 2 |
| uncovered | droit_social_immo | 1 |
| legacy | fiscalite, litiges | 2 |

---

## Matrice complète de couverture

| Domaine | Vague | Détecteur | Policy | Playbook | Gold | Rollout | T2AI | Shortlist | Maturité | Risque | Valeur | Score | Action |
|---------|-------|-----------|--------|----------|------|---------|------|-----------|----------|--------|--------|-------|--------|
| baux_habitation | existing | ✓ | ✓ critical | ✗ | ✗ | ✗ | ✓ 3 | ✓ | candidate | critical | high | **16** | add_playbook |
| gestion_locative | V1 | ✓ | ✓ high | ✓ Q2 | ✓ | ✓ | ✓ | ✓ | **activated** | high | high | — | benchmark |
| copropriete | existing | ✓ | ✓ critical | ✓ Q4 | ✓ | ✓ | ✓ 5 | ✓ | **activated** | critical | high | — | benchmark |
| syndic_copropriete | V1 | ✓ | ✓ high | ✗ | ✗ | ✗ | ✓ 1 | ✓ | candidate | high | high | **14** | add_playbook |
| agent_immobilier | existing | ✓ | ✓ critical | ✗ | ✗ | ✗ | ✓ 5 | ✓ | candidate | critical | high | **16** | add_playbook |
| vente_immobiliere | existing | ✓ | ✓ critical | ✓ Q1 Q5 Q6 | ✓ | ✓ | ✓ | ✓ | **activated** | critical | high | — | benchmark |
| diagnostics | existing | ✓ | ✓ high | ✗ | ✗ | ✗ | ✓ 4 | ✓ | candidate | high | high | **14** | add_playbook |
| construction | existing | ✓ | ✓ high | ✗ | ✗ | ✗ | ✗ | ✓ | candidate | high | high | 12.5 | add_playbook |
| urbanisme | existing | ✓ | ✓ high | ✗ | ✗ | ✗ | ✗ | ✓ | candidate | high | medium | 11 | add_playbook |
| bail_commercial | existing | ✓ | ✓ high | ✗ | ✗ | ✗ | ✗ | ✓ | candidate | high | medium | 11 | add_playbook |
| viager_demembrement | existing | ✓ | ✓ high | ✗ | ✗ | ✗ | ✓ 1 | ✗ | fallback_only | medium | low | 7.5 | leave_fallback |
| droit_social_immo | V1 | **✗** | ✓ critical | ✗ | ✗ | ✗ | ✗ | ✗ | **uncovered** | critical | medium | 12* | **improve_detector** |
| fiscalite_investisseurs | V1 | ✓ | ✓ critical | ✗ | ✗ | ✗ | ✓ 1 | ✗ | candidate | critical | high | **14.5** | add_playbook |
| sci_patrimoine | V1 | ✓ | ✓ high | ✗ | ✗ | ✗ | ✗ | ✗ | candidate | high | medium | 10 | add_playbook |
| responsabilite_agent | V2 | ✓ | ✓ critical | ✓ Q6* | ✓ | ✓ | ✓ | ✗ | **activated** | critical | high | — | benchmark |
| location_touristique | V2 | ✓ | ✓ high | ✗ | ✗ | ✗ | ✓ 1 | ✗ | candidate | high | high | **13** | add_playbook |
| environnement_immo | V2 | ✓ | ✓ critical | ✓ Q3 | ✓ | ✓ | ✓ | ✓ | **activated** | critical | high | — | benchmark |
| conformite_lcb_ft | V3 | ✓ | ✓ critical | ✗ | ✗ | ✗ | ✗ | ✗ | candidate | critical | medium | 12.5 | add_playbook |
| rgpd_agence | V3 | ✓ | ✓ critical | ✗ | ✗ | ✗ | ✗ | ✓ | candidate | critical | medium | **13.5** | add_playbook |
| fiscalite | legacy | ✗ | ✓ legacy | ✗ | ✗ | ✗ | ✗ | ✗ | legacy | critical | low | — | leave_fallback |
| servitudes | legacy | ✓ | ✓ high | ✗ | ✗ | ✗ | ✗ | ✓ | fallback_only | medium | medium | 9 | add_playbook |
| litiges | legacy | ✓ | ✓ legacy | ✗ | ✗ | ✗ | ✗ | ✗ | legacy | high | low | — | leave_fallback |

> *Q6 (agent_defaut_information) a domain=vente_immobiliere — responsabilite_agent n'a pas encore de playbook natif.

---

## Scoring de priorité backlog

Formule : `(2 × risque) + (1.5 × valeur) + T2AI + shortlist + articles + sibling_nearby`
- risque : critical=4, high=3, medium=2
- valeur : high=3, medium=2, low=1
- boosters : T2AI=1, shortlist=1, articles indexés=1, sibling nearby=0.5

### Top 10 domaines à traiter

| Rang | Domaine | Score | Obstacle principal | Action |
|------|---------|-------|--------------------|--------|
| 1 | baux_habitation | 16.0 | Pas de playbook malgré infrastructure complète | add_playbook |
| 2 | agent_immobilier | 16.0 | T2AI riche, mandat_exclusif_duree déjà présent | add_playbook |
| 3 | fiscalite_investisseurs | 14.5 | Pas de shortlist — effort medium | add_playbook |
| 4 | diagnostics | 14.0 | T2AI 4 entrées, Q5 DPE voisin activé | add_playbook |
| 5 | syndic_copropriete | 14.0 | Sibling de copropriete activé | add_playbook |
| 6 | rgpd_agence | 13.5 | Shortlist présente, CNIL = sujet actuel | add_playbook |
| 7 | location_touristique | 13.0 | T2AI airbnb copropriete existant | add_playbook |
| 8 | conformite_lcb_ft | 12.5 | Pas de T2AI ni shortlist — risque pénal | add_playbook |
| 9 | construction | 12.5 | Shortlist présente, pas de T2AI | add_playbook |
| 10 | droit_social_immo | 12.0* | **Bloquant : domaine absent du detector** | improve_detector |

> \* Score théorique. Sans entrée dans domain-detector.ts, le domaine n'est jamais routé → priorité au fix detector avant tout.

---

## Domaines presque prêts (low-effort path to V2)

Critères : detector ✓ + policy ✓ + (T2AI ≥ 2 entrées OU shortlist ✓) + articles indexés ✓

### 1. `baux_habitation` — effort small
- 3 entrées T2AI + shortlist `loyers_impayes_procedure`
- minArticles 60 atteint (existing domain)
- Question canonique évidente : loyers impayés/expulsion = #1 des questions Nestenn
- **Blocage** : aucun

### 2. `diagnostics` — effort small
- 4 entrées T2AI (DPE F/G, collectif, amiante, validité)
- shortlist `diagnostics_dpe_amiante`
- Q5 `vente_dpe_errone` voisin activé — infrastructure de benchmark déjà validée
- **Blocage** : aucun (domaine existing)

### 3. `agent_immobilier` — effort small
- 5 entrées T2AI dont `mandat_exclusif_duree` et `mandat_honoraires_alur`
- shortlist `agent_hoguet_mandat`
- Q6 `agent_defaut_information` voisin (responsabilite_agent) activé
- **Blocage** : aucun

### 4. `syndic_copropriete` — effort small-medium
- T2AI `copropriete_syndic_professionnel`
- shortlist `syndic_mandat_recouvrement`
- T2AI copropriete_syndic_travaux couvre partiellement le domaine
- **Blocage** : conflit keyword avec `copropriete` (à gérer dans le playbook trigger)

### 5. `servitudes` — effort small
- shortlist `servitudes_mitoyennete`
- Detector présent mais domaine absent du corpus (à surveiller)
- Question récurrente simple (droit de passage)
- **Blocage** : absent de domain-reference-corpus.ts → vérifier indexation DB

---

## Alerte : domaine bloqué

### `droit_social_immo` — UNCOVERED

**Problème** : Le fichier `lib/domain-detector.ts` ne contient aucune entrée pour ce domaine.
Malgré la policy `critical` et les articles indexés, aucune question ne sera jamais routée vers ce domaine.

**Fix requis avant tout playbook** :
```typescript
// À ajouter dans lib/domain-detector.ts — DOMAIN_KEYWORDS
{
  keywords: [
    { term: 'idcc 1527',                     weight: 2.0 },
    { term: 'convention collective immobilier', weight: 2.0 },
    { term: 'négociateur immobilier salarié', weight: 2.0 },
    { term: 'licenciement agent immobilier',  weight: 2.0 },
    { term: 'rupture conventionnelle agence', weight: 2.0 },
    { term: 'clause de non-concurrence immo', weight: 2.0 },
    { term: 'préavis négociateur',            weight: 1.5 },
    { term: 'période d\'essai agent immobilier', weight: 1.5 },
    { term: 'salarié agence immobilière',     weight: 1.5 },
  ],
  domain: { name: 'droit_social_immo', judilibreTheme: 'contrat de travail', judilibreChamber: 'soc' },
}
```

---

## Recommandation Phase 3 — Les 3 prochains playbooks

### Playbook #7 — `baux_loyers_impayes_expulsion`
**Domaine** : `baux_habitation`
**Question canonique** : "Mon locataire ne paie plus son loyer depuis 3 mois et refuse de partir. Quelle procédure l'agence doit-elle engager ?"

**Pourquoi** :
- Score 16/20 = domaine le plus prioritaire du backlog
- Question #1 des agences Nestenn d'après le corpus de benchmark
- Infrastructure complète : detector ✓, policy critical ✓, T2AI 3 entrées ✓, shortlist ✓
- Jurisprudence riche indexée (minJurisprudence 50)
- Risque critique en cas de mauvaise réponse (trêve hivernale, délais légaux)

**Effort** : small
- Triggers identifiables depuis T2AI existant (article_24_bail_modification, loyers_impayes)
- Distinctions clés connues : commandement de payer → clause résolutoire → ordonnance d'expulsion → trêve

**Sources pivot** :
- Loi 89-462 art. 24 (commandement de payer, ELAN)
- CPCE L411-1 et s. (expulsion locataire)
- Art. 613-1 (trêve hivernale — 1er novembre → 31 mars)

**Gold type** : procédure en 4 étapes + délais + risques trêve
**Risques spécifiques** : confusion trêve hivernale/délai d'appel, confusion commandement de payer loi 89 vs CPCE

---

### Playbook #8 — `diagnostics_dpe_fg_interdits`
**Domaine** : `diagnostics`
**Question canonique** : "Notre propriétaire-bailleur a un logement classé G. Peut-il encore le louer ou le remettre en location en 2025 ?"

**Pourquoi** :
- Score 14/20 — T2AI le plus riche du backlog non activé (4 entrées)
- Actualité réglementaire brûlante : interdictions DPE G/F en vigueur depuis 2025
- Voisin direct de Q5 `vente_dpe_errone` déjà validé → réutilisation du benchmark
- Questions reçues en forte hausse depuis janvier 2025 (passoires thermiques)
- shortlist `diagnostics_dpe_amiante` présente

**Effort** : small
- T2AI `dpe_fg_consequences` contient déjà le answerNote complet et les articles forcés
- Triggers depuis `dpe f`, `dpe g`, `logement g interdit`, `passoire thermique`

**Sources pivot** :
- Loi Climat 2021-1104 art. 159 (interdiction location logements très énergivores)
- Loi Climat 2021-1104 art. 160 (gel des loyers F/G)
- CCH L173-2 (calendrier des interdictions)
- Décret 2021-19 (gel loyers passoires thermiques depuis août 2022)

**Gold type** : calendrier des interdictions (G depuis 01/01/2025, F depuis 2028) + obligations propriétaire + exceptions
**Risques spécifiques** : confusion date permis de construire amiante (≠ DPE), dates G vs F vs E

---

### Playbook #9 — `agent_mandat_exclusif_resiliation`
**Domaine** : `agent_immobilier`
**Question canonique** : "L'agent immobilier exige un mandat exclusif de 3 mois que l'on ne peut pas résilier. Est-ce légal et comment en sortir ?"

**Pourquoi** :
- Score 16/20 (tie avec baux_habitation) — domaine à valeur métier maximale
- T2AI `mandat_exclusif_duree` déjà présent avec un `answerNote` complet
- Question récurrente dans les agences Nestenn (propriétaires mécontents)
- Infrastructure optimale : 5 entrées T2AI, shortlist, detector, policy critical
- Faible risque de faux positifs grâce aux triggers ciblés

**Effort** : small
- Triggers depuis T2AI existant (`durée mandat exclusif`, `mandat exclusif révocable`, etc.)
- Distinctions connues : 3 mois irrévocables → tacite révocable 15 jours préavis

**Sources pivot** :
- Décret 72-678 art. 78 (durée max mandat exclusif = 3 mois irrévocables)
- Loi Hoguet 70-9 art. 6 (conditions du mandat)
- Délai préavis 15 jours pour révocation tacite reconduction

**Gold type** : droits du mandant (propriétaire) + procédure de résiliation + date pivot
**Risques spécifiques** : confusion mandat exclusif vs mandat simple, oubli calcul date fin irrévocable

---

## Synthèse Phase 3

| # | Playbook | Domaine | Effort | Score | Risque | Source pivot principale |
|---|----------|---------|--------|-------|--------|------------------------|
| 7 | baux_loyers_impayes_expulsion | baux_habitation | small | 16 | critical | Loi 89-462 art. 24 + CPCE L411-1 |
| 8 | diagnostics_dpe_fg_interdits | diagnostics | small | 14 | high | Loi Climat 2021-1104 art. 159/160 |
| 9 | agent_mandat_exclusif_resiliation | agent_immobilier | small | 16 | critical | Décret 72-678 art. 78 |

**Tous 3 sont effort small** : chaque playbook s'appuie sur T2AI + shortlist déjà présents.
Aucun refactoring d'architecture n'est requis.
La séquence suggérée : #7 → #8 → #9 (du plus fréquent au plus technique).

### Ordre des opérations Phase 3

1. `[immediate]` Fix detector `droit_social_immo` (15 min — add keywords)
2. `[sprint 1]`  Playbook #7 `baux_loyers_impayes_expulsion` + gold case Q7 + rollout whitelist
3. `[sprint 2]`  Playbook #8 `diagnostics_dpe_fg_interdits` + gold case Q8 + rollout whitelist
4. `[sprint 3]`  Playbook #9 `agent_mandat_exclusif_resiliation` + gold case Q9 + rollout whitelist
5. `[sprint 4]`  Décision : syndic_copropriete (score 14) ou fiscalite_investisseurs (score 14.5)

Chaque sprint = 1 playbook + 1 gold case + whitelist = structure identique aux phases 1 et 2.
