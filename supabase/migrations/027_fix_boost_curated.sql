-- Migration 027 : Fix du boost curated systématique
-- Bug : is_curated seul boostait ×1.30 TOUS les curated même hors domaine
-- Fix : boost curated UNIQUEMENT si match de domaine avec la question

DROP FUNCTION IF EXISTS search_all_legal_context(vector, integer, text[]);

CREATE OR REPLACE FUNCTION public.search_all_legal_context(
  query_embedding vector,
  match_count integer DEFAULT 8,
  boost_domains text[] DEFAULT NULL::text[]
)
RETURNS TABLE(
  source text, doc_id uuid, title text,
  situation text, principe text, consequence text,
  url text, domain text, similarity double precision
)
LANGUAGE sql
STABLE
AS $function$
  SELECT
    source, doc_id, title, situation, principe, consequence, url, domain,
    CASE
      WHEN is_curated = true AND boost_domains IS NOT NULL AND article_domains && boost_domains
        THEN similarity_raw * 1.25
      WHEN boost_domains IS NOT NULL AND article_domains && boost_domains
        THEN similarity_raw * 1.15
      ELSE similarity_raw
    END AS similarity
  FROM (
    SELECT
      'article'::text AS source, id AS doc_id, title,
      (content_summary::jsonb->>'situation') AS situation,
      (content_summary::jsonb->>'principe') AS principe,
      (content_summary::jsonb->>'consequence') AS consequence,
      url, domain,
      COALESCE(domains, ARRAY[domain]) AS article_domains,
      1 - (embedding <=> query_embedding) AS similarity_raw,
      false::boolean AS is_curated
    FROM public.legal_articles
    WHERE deleted_at IS NULL AND in_force = true AND embedding IS NOT NULL

    UNION ALL

    SELECT
      'arret'::text AS source, id AS doc_id,
      COALESCE(number, source_id) AS title,
      situation, principle AS principe, consequence, url, domain,
      COALESCE(domains, ARRAY[domain]) AS article_domains,
      1 - (embedding <=> query_embedding) AS similarity_raw,
      COALESCE(curated, false)::boolean AS is_curated
    FROM public.jurisprudence
    WHERE deleted_at IS NULL AND embedding IS NOT NULL
  ) combined
  ORDER BY
    CASE
      WHEN is_curated = true AND boost_domains IS NOT NULL AND article_domains && boost_domains
        THEN similarity_raw * 1.25
      WHEN boost_domains IS NOT NULL AND article_domains && boost_domains
        THEN similarity_raw * 1.15
      ELSE similarity_raw
    END DESC
  LIMIT match_count;
$function$;
