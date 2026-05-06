import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { embedQuestion } from '../lib/embedding'

/**
 * Script pour injecter manuellement la règle SCI / SRU manquante
 * dans la base de connaissances Nestenn Juridique.
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
)

async function seedSciSru() {
  console.log('🌱 Injection de la règle SCI / SRU dans la base de connaissances...\n')

  const title = 'Délai de rétractation SRU : Cas particulier des SCI'
  const text = "Une SCI, même familiale, ne bénéficie pas du délai de rétractation SRU de 10 jours si son acquisition est en lien avec son objet social, la qualifiant ainsi de professionnel de l'immobilier au sens de l'article L.271-1 du Code de la construction et de l'habitation (CCH)."

  // On prépare le résumé expert pour l'embedding et le RAG
  const situation = "Lorsqu'une SCI (Société Civile Immobilière), même familiale, signe un avant-contrat pour l'achat d'un bien immobilier."
  const principe = "La SCI ne bénéficie pas du délai de rétractation SRU de 10 jours dès lors que l'acquisition est en rapport direct avec son objet social."
  const consequence = "L'objet social lié à l'immobilier qualifie la SCI de professionnel. Selon l'article L.271-1 du CCH, seuls les acquéreurs non-professionnels bénéficient du délai de rétractation."

  const summary = { situation, principe, consequence }
  const embeddingText = `${situation} ${principe} ${consequence}`

  console.log('🧠 Génération de l\'embedding via Nomic/Ollama...')
  const embedding = await embedQuestion(embeddingText)

  if (!embedding || embedding.length === 0) {
    console.error('❌ Échec de la génération de l\'embedding. Vérifiez vos clés API.')
    return
  }

  console.log('📡 Insertion dans Supabase (table legal_articles)...')
  
  const { error } = await supabase
    .from('legal_articles')
    .upsert({
      law_id: 'CCH-CUSTOM-SRU',
      article_num: 'L271-1-SCI',
      title: title,
      content: text,
      // On stocke le résumé dans content_summary (utilisé par le pipeline RAG)
      content_summary: JSON.stringify(summary),
      date_version: new Date().toISOString().split('T')[0],
      url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000031046892',
      domain: 'vente_immobiliere',
      sub_themes: ['retractation', 'sru', 'sci'],
      in_force: true,
      embedding: embedding
    }, { onConflict: 'law_id,article_num' })

  if (error) {
    console.error('❌ Erreur lors de l\'insertion :', error.message)
  } else {
    console.log('✅ Règle SCI / SRU injectée avec succès !')
    console.log('🚀 Vous pouvez maintenant relancer le benchmark ou la question sur le chat.')
  }
}

seedSciSru().catch(console.error)
