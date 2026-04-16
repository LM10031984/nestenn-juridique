# Domain Pack — baux_habitation

**Version** : v1  
**Fichier** : `lib/domain-packs.ts` → `BAUX_HABITATION_PACK`  
**Builder** : `lib/domain-pack-builder.ts` → `buildBriefFromDomainPack`  
**Tests** : `__tests__/domain-packs.test.ts` (41 tests)

---

## Ce que couvre le pack

Le domain pack `baux_habitation` produit un cadre juridique utile pour toute question relative aux **baux d'habitation principale** régis par la **loi n° 89-462 du 6 juillet 1989**.

### Archétypes couverts

| Archétype | Statut | Playbook overlay |
|---|---|---|
| `loyers_impayes_expulsion` | **covered** | `baux_loyers_impayes_expulsion` (Phase 3) |
| `depot_garantie_restitution` | candidate | — |
| `conge_bailleur` | candidate | — |
| `conge_locataire` | candidate | — |
| `treve_hivernale` | candidate | — |
| `decence_logement` | candidate | — |
| `sous_location` | candidate | — |
| `colocation_solidarite` | candidate | — |

**Covered** = un playbook V2 whitelisté couvre cet archétype.  
**Candidate** = le domain pack seul produit un brief utilisable ; aucun playbook V2 n'est encore associé.

### Articles pivot (pivot articles)

Articles toujours pertinents dans ce domaine, indépendamment de la question :

| Loi | Article | Objet |
|---|---|---|
| loi 89-462 | 22 | Dépôt de garantie (montant max, délais restitution) |
| loi 89-462 | 24 | Clause résolutoire, commandement de payer, procédure |
| loi 89-462 | 15 | Congé bailleur (3 cas limitatifs, préavis 6 mois) |
| loi 89-462 | 15-I | Congé locataire (préavis 3 mois, réduit 1 mois zone tendue) |
| CPCE | L412-6 | Trêve hivernale (1er nov. – 31 mars) |
| Code civil | 1719 | Obligation de délivrance d'un logement décent |
| Code civil | 1728 | Obligation du locataire de payer le loyer |
| loi 89-462 | 8 | Sous-location interdite sans accord écrit |
| décret 2002-120 | 1 | Critères de décence |

### Distinctions récurrentes (recurringDistinctions)

Ces 5 distinctions sont injectées dans **tout** brief baux_habitation, quel que soit l'archétype :

1. Bail nu ≠ bail meublé (délais préavis, dépôt de garantie, durée)
2. Zone tendue ≠ hors zone tendue (préavis locataire, encadrement loyers)
3. Résidence principale uniquement (loi 89-462 ne s'applique pas aux secondaires, saisonniers, commerciaux)
4. Bailleur personne physique ≠ personne morale (congé pour reprise réservé aux personnes physiques)
5. Procédure judiciaire ≠ exécution de la décision (deux étapes distinctes, toutes deux obligatoires)

### Assertions interdites (forbiddenAssertions)

8 assertions interdites dans tout le domaine :

- Expulsion directe sans décision de justice
- Changement de serrures ou coupure de fluides par le bailleur lui-même
- Rétention du dépôt de garantie sans justification
- Trêve hivernale sans exception
- Préavis locataire systématiquement 3 mois (ignore zone tendue)
- Augmentation libre du loyer sans IRL ni encadrement
- Sous-location libre si le bail ne la mentionne pas
- Expulsion immédiate après un seul impayé

### Jurisprudence pivot

3 arrêts de référence intégrés au pack :

1. **Clause résolutoire** : ne peut jouer qu'après commandement de payer + délai 2 mois infructueux (Cass. 3e civ., loi 89-462 art. 24)
2. **Dépôt de garantie** : état des lieux incomplet = présomption de bon état → bailleur ne peut pas justifier les retenues (Cass. 3e civ., loi 89-462 art. 22)
3. **Congé pour vente** : doit mentionner l'offre de vente adressée au locataire à peine de nullité (Cass. 3e civ., loi 89-462 art. 15)

---

## Ce que le pack ne couvre pas encore

### Domaines connexes exclus

- **Bail commercial** (statut des baux commerciaux, Code de commerce) → hors scope
- **Bail rural** → hors scope  
- **Copropriété** → domain pack séparé à créer (`copropriete`)
- **Location meublée professionnelle / para-hôtelière** → hors scope
- **Colocation meublée étudiante** → partiellement couvert, pas de playbook

### Archétypes non encore formalisés (candidats)

Pour les archétypes `candidate`, le domain pack produit un brief minimal mais sans la précision qu'apporterait un playbook dédié :

| Archétype | Risque sans playbook | Prochain sprint |
|---|---|---|
| `depot_garantie_restitution` | Distinctions ELS incomplètes | Sprint 4 |
| `conge_bailleur` | Droit de préemption locataire peut être omis | Sprint 4 |
| `conge_locataire` | Conditions de réduction préavis non exhaustives | Sprint 5 |
| `treve_hivernale` | Exceptions à la trêve peuvent manquer | Sprint 5 |
| `decence_logement` | Distinction insalubrité/indécence fragile | Sprint 5 |
| `sous_location` | Réglementation Airbnb non couverte | Sprint 6 |

### Limites des articles pivot synthétiques

Les articles pivot non résolus live (pas de résolution Légifrance) sont injectés comme articles **synthétiques** — les métadonnées (titre, source) sont présentes mais il n'y a pas de texte brut de l'article. Le brief reste valide mais moins précis qu'avec une résolution live.

---

## Playbooks en overlay

Un seul playbook V2 couvre actuellement le domaine `baux_habitation` :

| Playbook | Question canonique | Rollout | Gold score |
|---|---|---|---|
| `baux_loyers_impayes_expulsion` | "Que faire si mon locataire ne paie plus son loyer et que je veux l'expulser ?" | Phase 3 ✅ | 20/20 |

Lorsque ce playbook est détecté, il vient en **overlay** sur le domain pack :
- Ses `requiredDistinctions` (5 items) sont prioritaires devant les distinctions récurrentes du domain pack
- Ses `forbiddenAssertions` (4 items) s'ajoutent sans doublon aux 8 assertions du domain pack
- Ses `practicalOutcome` (5 bullets) remplacent les `practicalActions` génériques du domain pack (plus précis)
- Son `id` devient l'`archetype` du LegalBrief (au lieu de `baux_habitation/loyers_impayes_expulsion`)

---

## Questions absorbables sans nouveau playbook

Grâce aux fallback rules, le domain pack peut déjà absorber les questions suivantes sans créer de playbook dédié — la précision est moindre mais le cadre juridique est correct :

| Question type | Fallback rule activée | Articles forcés |
|---|---|---|
| "Mon propriétaire refuse de restituer mon dépôt de garantie" | `depot_garantie_restitution` | loi 89-462 art. 22 |
| "Quel est mon préavis si je veux quitter mon appartement ?" | `conge_locataire` | loi 89-462 art. 15-I |
| "Mon bailleur m'a donné congé pour reprendre le logement" | `conge_bailleur` | loi 89-462 art. 15 |
| "Peut-on expulser en décembre ?" | `treve_hivernale` | CPCE L412-6 |
| "Mon logement est insalubre, que faire ?" | `decence_logement` | CC art. 1719, décret 2002-120 |
| "Mon locataire sous-loue sur Airbnb sans permission" | `sous_location` | loi 89-462 art. 8 |

Pour ces questions, le brief produit :
- ✅ Les distinctions clés de l'archétype
- ✅ Les articles pivot pertinents (synthétiques si non résolus live)
- ✅ Les assertions interdites du domaine
- ✅ Les actions pratiques génériques du domaine
- ⚠️ Pas d'outcomes pratiques spécifiques à la sous-question (fournis par le playbook overlay)
- ⚠️ Pas de jurisprudence ciblée (fournie par le playbook overlay)

---

## Industrialisation — comment créer le prochain domain pack

Le domain pack `baux_habitation` est le template de référence. Pour créer `copropriete`, `vente_immobiliere`, `diagnostics` :

1. Copier la structure `DomainPack` depuis `lib/domain-packs.ts`
2. Identifier les 5–10 articles pivot du domaine
3. Lister 3–5 distinctions récurrentes du domaine
4. Lister 5–8 assertions interdites
5. Définir les archétypes couverts (statut `covered` si un playbook V2 existe)
6. Écrire les fallback rules (1 par archétype candidat)
7. Ajouter le pack dans `DOMAIN_PACKS`
8. Créer les tests dans `__tests__/domain-packs-[domaine].test.ts`
9. Documenter dans `docs/coverage/domain-pack-[domaine].md`

Temps estimé par domain pack : 2–3h pour un domaine maîtrisé.
