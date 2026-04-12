// lib/pending-domains.ts
// Gestion des domaines en attente de validation — création dynamique de domaines
// Actif uniquement si FEATURES.DYNAMIC_DOMAINS === true

import { createAdminClient } from '@/lib/supabase/admin'
import { openRouterChat, MODELS } from '@/lib/openrouter'

const SIMILARITY_THRESHOLD = 0.85
const AUTO_CREATE_MIN_ARTICLES = 5
const MAX_AUTO_CREATIONS_PER_MONTH = 5
const MIN_AVG_CONFIDENCE = 0.4

interface DomainSuggestion {
  name: string
  label: string
  keywords: string[]
}

interface UnclassifiedArticle {
  id: string
  content: string
  title: string
}

interface ClassificationResult {
  scores: Record<string, number>
}

export async function handleUnclassifiedArticle(
  article: UnclassifiedArticle,
  classification: ClassificationResult,
): Promise<void> {
  // 1. Demander à GPT-4o-mini de proposer un nouveau domaine
  const suggestion = await suggestNewDomain(article)
  if (!suggestion) return

  // 2. Vérifier si une suggestion similaire existe déjà
  const similar = await findSimilarPendingDomain(suggestion.label)

  if (similar) {
    // Incrémenter le compteur
    await incrementPendingDomain(similar.id, article.id, classification)
  } else {
    // Créer une nouvelle entrée
    await createPendingDomain(suggestion, article.id, classification)
  }

  // 3. Vérifier si un pending est éligible à l'auto-création
  await checkAutoCreationEligibility()
}

async function suggestNewDomain(article: UnclassifiedArticle): Promise<DomainSuggestion | null> {
  const prompt = `Voici un article de loi français qui ne rentre dans aucun des 18 domaines existants du droit immobilier (baux_habitation, copropriete, vente_immobiliere, agent_immobilier, diagnostics, construction, urbanisme, bail_commercial, viager_demembrement, gestion_locative, syndic_copropriete, droit_social_immo, fiscalite_investisseurs, sci_patrimoine, responsabilite_agent, location_touristique, conformite_lcb_ft, rgpd_agence).

Titre : ${article.title}
Contenu : ${article.content.slice(0, 1500)}

Propose un nom de domaine technique en snake_case (ex: 'concurrence_franchise') et un label en français court (ex: 'Concurrence et franchise immobilière'). Extrais aussi 5 mots-clés représentatifs.

Réponds en JSON strict, sans texte autour :
{ "name": "snake_case_name", "label": "Label en français", "keywords": ["mot1", "mot2", "mot3", "mot4", "mot5"] }`

  try {
    const text = await openRouterChat(
      [{ role: 'user', content: prompt }],
      MODELS.FILTER,
      200,
    )
    if (!text) return null
    return JSON.parse(text.trim()) as DomainSuggestion
  } catch (err) {
    console.error('[pending-domains] suggestNewDomain failed:', err)
    return null
  }
}

async function findSimilarPendingDomain(label: string): Promise<{ id: string; suggested_label: string } | null> {
  const supabaseAdmin = createAdminClient()

  const { data } = await supabaseAdmin
    .from('pending_domains')
    .select('id, suggested_label')
    .eq('status', 'pending')

  if (!data) return null

  const labelLower = label.toLowerCase()
  const found = data.find(d => {
    const sim = computeSimpleSimilarity(d.suggested_label.toLowerCase(), labelLower)
    return sim >= SIMILARITY_THRESHOLD
  })

  return found ?? null
}

function computeSimpleSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.split(/\s+/))
  const wordsB = new Set(b.split(/\s+/))
  const intersection = [...wordsA].filter(w => wordsB.has(w)).length
  const union = new Set([...wordsA, ...wordsB]).size
  return union === 0 ? 0 : intersection / union
}

async function createPendingDomain(
  suggestion: DomainSuggestion,
  articleId: string,
  classification: ClassificationResult,
): Promise<void> {
  const supabaseAdmin = createAdminClient()
  const avgConfidence = Object.values(classification.scores).length > 0
    ? Math.max(...Object.values(classification.scores))
    : 0

  await supabaseAdmin.from('pending_domains').insert({
    suggested_name: suggestion.name,
    suggested_label: suggestion.label,
    confidence_avg: avgConfidence,
    article_count: 1,
    sample_article_ids: [articleId],
    sample_keywords: suggestion.keywords,
    status: 'pending',
  })
}

async function incrementPendingDomain(
  pendingId: string,
  articleId: string,
  classification: ClassificationResult,
): Promise<void> {
  const supabaseAdmin = createAdminClient()

  const { data: existing } = await supabaseAdmin
    .from('pending_domains')
    .select('*')
    .eq('id', pendingId)
    .single()

  if (!existing) return

  const newConfidenceValue = Object.values(classification.scores).length > 0
    ? Math.max(...Object.values(classification.scores))
    : 0
  const newCount = existing.article_count + 1
  const newConfidence = (existing.confidence_avg * existing.article_count + newConfidenceValue) / newCount

  await supabaseAdmin
    .from('pending_domains')
    .update({
      article_count: newCount,
      confidence_avg: newConfidence,
      sample_article_ids: [...(existing.sample_article_ids ?? []), articleId].slice(-20),
      updated_at: new Date().toISOString(),
    })
    .eq('id', pendingId)
}

async function checkAutoCreationEligibility(): Promise<void> {
  const supabaseAdmin = createAdminClient()

  // Vérifier la limite mensuelle
  const oneMonthAgo = new Date()
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1)

  const { count: monthlyCount } = await supabaseAdmin
    .from('pending_domains')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'auto_created')
    .gte('auto_created_at', oneMonthAgo.toISOString())

  if ((monthlyCount ?? 0) >= MAX_AUTO_CREATIONS_PER_MONTH) {
    console.warn('[pending-domains] Limite mensuelle d\'auto-création atteinte')
    await supabaseAdmin.from('quality_alerts').insert({
      type: 'domain_creation_limit_reached',
      severity: 'warning',
      title: 'Limite mensuelle de création automatique de domaines atteinte',
      details: {
        monthly_count: monthlyCount,
        limit: MAX_AUTO_CREATIONS_PER_MONTH,
      },
    })
    return
  }

  // Trouver les pending éligibles
  const { data: eligible } = await supabaseAdmin
    .from('pending_domains')
    .select('*')
    .eq('status', 'pending')
    .gte('article_count', AUTO_CREATE_MIN_ARTICLES)
    .gte('confidence_avg', MIN_AVG_CONFIDENCE)
    .order('article_count', { ascending: false })

  if (!eligible || eligible.length === 0) return

  // Auto-créer le premier éligible (le plus populaire)
  await autoCreateDomain(eligible[0])
}

async function autoCreateDomain(pending: {
  id: string
  suggested_name: string
  suggested_label: string
  article_count: number
  sample_article_ids: string[]
  sample_keywords: string[]
}): Promise<void> {
  const supabaseAdmin = createAdminClient()

  // Marquer comme auto-créé
  await supabaseAdmin
    .from('pending_domains')
    .update({
      status: 'auto_created',
      auto_created_at: new Date().toISOString(),
    })
    .eq('id', pending.id)

  // Reclasser les articles dans le nouveau domaine
  if (pending.sample_article_ids && pending.sample_article_ids.length > 0) {
    await supabaseAdmin
      .from('legal_articles')
      .update({ domain: pending.suggested_name })
      .in('id', pending.sample_article_ids)
  }

  // Créer une quality_alert
  await supabaseAdmin.from('quality_alerts').insert({
    type: 'domain_auto_created',
    severity: 'info',
    title: `Nouveau domaine créé automatiquement : ${pending.suggested_label}`,
    details: {
      pending_domain_id: pending.id,
      name: pending.suggested_name,
      article_count: pending.article_count,
      keywords: pending.sample_keywords,
    },
  })

  console.info(`[pending-domains] ✅ Domaine auto-créé : ${pending.suggested_name} (${pending.article_count} articles)`)
}
