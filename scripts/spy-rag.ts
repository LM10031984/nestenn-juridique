import 'dotenv/config'
import { embedQuestion } from './lib/embedding'
import { fetchRelevantSources } from './lib/sources'
import { detectDomains } from './lib/domain-detector'

async function checkSpy() {
  const message = "Une SCI familiale achète un appartement pour y loger l'un de ses associés. Bénéficie-t-elle du délai de rétractation SRU de 10 jours ?"
  
  console.log("Recherche en cours...")
  const embedding = await embedQuestion(message)
  const domains = detectDomains(message)
  
  const { chunks } = await fetchRelevantSources(
    embedding,
    domains.length > 0 ? domains : null,
    8,
    0.30
  )

  console.log('\n🕵️‍♂️🕵️‍♂️🕵️‍♂️ [DEBUG RAG] DOCUMENTS REMONTÉS DEPUIS SUPABASE 🕵️‍♂️🕵️‍♂️🕵️‍♂️')
  chunks.forEach((chunk, index) => {
    console.log(`\n📄 Document ${index + 1} : [${chunk.sourceLaw}] - Art. ${chunk.sourceArticle || 'N/A'}`)
    console.log(`🎯 Similarité : ${chunk.similarity}`)
    console.log(`📝 Texte extrait :\n${chunk.chunkText}\n`)
  })
  console.log('🕵️‍♂️🕵️‍♂️🕵️‍♂️ FIN DES DOCUMENTS SUPABASE 🕵️‍♂️🕵️‍♂️🕵️‍♂️\n')
}

checkSpy().catch(console.error)
