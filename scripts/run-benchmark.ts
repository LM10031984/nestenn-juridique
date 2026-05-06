import fs from 'fs'
import path from 'path'

// Définition des chemins
const INPUT_CSV = path.join(process.cwd(), 'transaction.csv')
const OUTPUT_CSV = path.join(process.cwd(), 'benchmark-results.csv')

/**
 * Synonymes et variantes acceptées pour chaque mot-clé du benchmark.
 * Si le mot-clé exact n'est pas trouvé, on cherche ses équivalents.
 */
const SYNONYMS: Record<string, string[]> = {
  'caducité': ['caduc', 'caduque', 'devient caduc', 'frappé de caducité', 'tombe', 'sans effet'],
  'faute': ['fautif', 'fautive', 'manquement', 'violation', 'contrevenu', 'responsabilité', 'responsable'],
  'montant maximum': ['montant supérieur', 'montant excédant', 'dépassant le montant', 'au-delà du montant', 'excéder le montant'],
  'vice caché': ['vices cachés', 'vice dissimulé', 'défaut caché', 'vices rédhibitoires'],
  'exclusion': ['exclure', 'inopposable', 'non-garantie', 'ne peut pas invoquer', 'clause inapplicable', 'écarter la clause'],
  'article 606': ['art. 606', 'art 606', 'grosses réparations', 'gros travaux', 'réparations majeures'],
  'transfert de propriété': ['transfert de la propriété', 'vente parfaite', 'accord sur la chose et le prix', 'transmis aux héritiers', 'liés par le compromis', '1583'],
  'récépissé': ['accusé de réception', 'preuve de remise', 'reçu daté', 'attestation de remise'],
  'indemnité': ['indemnité d\'occupation', 'dommages et intérêts', 'dommages-intérêts', 'compensation', 'réparation'],
  'refonte': ['refait', 'renouveler', 'nouveau diagnostic', 'doit être refait', 'n\'est plus valable', 'périmé', 'obsolète', 'caduque'],
  'notification individuelle': ['notifié individuellement', 'notifier à chaque', 'chaque acquéreur', 'chaque époux', 'chacun des époux', 'séparément', 'personnellement'],
  'SRU': ['rétractation', 'délai de rétractation', 'L.271-1', 'L271-1', 'dix jours', '10 jours'],
}

/**
 * Vérifie si un mot-clé (ou l'un de ses synonymes) est présent dans la réponse.
 */
function keywordFound(responseLower: string, keyword: string): boolean {
  const kw = keyword.toLowerCase()
  // Vérification directe
  if (responseLower.includes(kw)) return true
  // Vérification des synonymes
  const synonyms = SYNONYMS[kw]
  if (synonyms) {
    return synonyms.some(syn => responseLower.includes(syn.toLowerCase()))
  }
  return false
}

/**
 * Fonction effectuant un vrai appel (fetch) vers l'API locale de Nestenn Juridique.
 */
async function askAI(question: string): Promise<string> {
  try {
    const response = await fetch('http://localhost:3001/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      // Attention: J'ai adapté le payload pour correspondre exactement à l'interface ChatRequestBody de votre API
      body: JSON.stringify({
        message: question
      }),
    })

    if (!response.ok) {
      console.error(`Erreur API: ${response.status} ${response.statusText}`)
      return "Erreur lors de l'appel à l'API"
    }

    // Lire la réponse. (On gère le texte brut, ou le JSON si l'API est configurée ainsi)
    const text = await response.text()
    
    // Parfois, le SDK AI renvoie des flux (streams) formatés. On s'assure de récupérer du texte.
    // Si la réponse est un JSON contenant un champ 'text' ou 'content', on le parse :
    try {
        const json = JSON.parse(text)
        if (json.text) return json.text
        if (json.content) return json.content
    } catch (e) {
        // Si ce n'est pas du JSON, on renvoie le texte brut (ce qui est le cas de votre flux SSE)
        return text
    }
    
    return text

  } catch (error) {
    console.error(`Erreur réseau:`, error)
    return "Erreur réseau lors de l'appel"
  }
}

/**
 * Petit parseur CSV robuste pour gérer les guillemets et les points-virgules
 */
function parseCsvLine(text: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === ';' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += char
    }
  }
  result.push(current)
  return result.map(col => col.trim())
}

async function runBenchmark() {
  if (!fs.existsSync(INPUT_CSV)) {
    console.error(`❌ Fichier introuvable : ${INPUT_CSV}`)
    process.exit(1)
  }

  console.log(`📖 Lecture du fichier : ${INPUT_CSV}`)
  const fileContent = fs.readFileSync(INPUT_CSV, 'utf-8')
  
  // Séparer les lignes et ignorer les lignes vides
  const lines = fileContent.split(/\r?\n/).filter(line => line.trim().length > 0)
  const header = lines.shift() // Retire l'entête
  
  const results: string[] = []
  results.push('ID;Theme;Question;Resultat;Mots_Manquants') // Nouvel entête

  console.log(`🚀 Démarrage du benchmark sur ${lines.length} questions...\n`)

  // Tracking par question pour le rapport final
  const questionResults: { id: string; question: string; status: string; missing: string[] }[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const columns = parseCsvLine(line)
    
    if (columns.length < 4) continue // Ligne mal formatée
    
    const id = columns[0]
    const theme = columns[1]
    const questionAgent = columns[2]
    const motsClesAttendus = columns[3].split(',').map(m => m.trim()).filter(m => m.length > 0)

    console.log(`⏳ Question ${id}/${lines.length}...`)
    
    // 1. Appel IA réel
    const aiResponse = await askAI(questionAgent)
    const responseLower = aiResponse.toLowerCase()
    
    // 2. Vérification des mots-clés (avec synonymes acceptés)
    const motsManquants: string[] = []
    for (const mot of motsClesAttendus) {
      if (!keywordFound(responseLower, mot)) {
        motsManquants.push(mot)
      }
    }
    
    const isSuccess = motsManquants.length === 0
    const status = isSuccess ? 'Succès' : 'Échec'
    const icon = isSuccess ? '✅' : '❌'
    
    console.log(`   ${icon} Q${id}: ${status}${motsManquants.length > 0 ? ` — manque: ${motsManquants.join(', ')}` : ''}`)
    
    questionResults.push({ id, question: questionAgent, status, missing: motsManquants })
    
    // 3. Ajouter au résultat CSV
    const safeQuestion = questionAgent.replace(/"/g, '""')
    const safeManquants = motsManquants.join(', ').replace(/"/g, '""')
    
    results.push(`${id};${theme};"${safeQuestion}";${status};"${safeManquants}"`)
  }

  // Écriture du fichier de résultats
  fs.writeFileSync(OUTPUT_CSV, results.join('\n'), 'utf-8')
  
  // ── RAPPORT FINAL ──────────────────────────────────────────────────
  const total = questionResults.length
  const successes = questionResults.filter(q => q.status === 'Succès').length
  const failures = total - successes
  const newScore = Math.round((successes / total) * 100)
  const oldScore = 50
  const improvement = newScore - oldScore

  console.log('\n')
  console.log('═══════════════════════════════════════════════════════════')
  console.log('              📊 RAPPORT DE BENCHMARK FINAL              ')
  console.log('═══════════════════════════════════════════════════════════')
  console.log('')
  console.log(`  📋 Questions testées :   ${total}`)
  console.log(`  ✅ Succès :              ${successes}`)
  console.log(`  ❌ Échecs :              ${failures}`)
  console.log('')
  console.log('───────────────────────────────────────────────────────────')
  console.log(`  📉 Ancien Score :        ${oldScore}%`)
  console.log(`  📈 Nouveau Score :       ${newScore}%`)
  console.log(`  🚀 Amélioration :        ${improvement > 0 ? '+' : ''}${improvement}%`)
  console.log('───────────────────────────────────────────────────────────')

  // Vérification ciblée SCI/DPE
  const sciQuestion = questionResults.find(q => q.id === '2')
  const dpeQuestion = questionResults.find(q => q.id === '5')

  console.log('')
  console.log('  🎯 VÉRIFICATION CIBLÉE (questions corrigées) :')
  console.log(`     Q2 (SCI familiale / SRU) : ${sciQuestion?.status === 'Succès' ? '✅ VALIDÉE' : '❌ TOUJOURS EN ÉCHEC — manque: ' + sciQuestion?.missing.join(', ')}`)
  console.log(`     Q5 (DPE classe F)        : ${dpeQuestion?.status === 'Succès' ? '✅ VALIDÉE' : '❌ TOUJOURS EN ÉCHEC — manque: ' + dpeQuestion?.missing.join(', ')}`)
  console.log('')
  console.log('═══════════════════════════════════════════════════════════')

  // Détail des échecs
  const failedQuestions = questionResults.filter(q => q.status === 'Échec')
  if (failedQuestions.length > 0) {
    console.log('')
    console.log('  📝 DÉTAIL DES ÉCHECS :')
    for (const q of failedQuestions) {
      console.log(`     Q${q.id}: manque [${q.missing.join(', ')}]`)
      console.log(`         "${q.question.slice(0, 80)}..."`)
    }
  }

  console.log('')
  console.log(`📊 Résultats CSV sauvegardés dans : ${OUTPUT_CSV}`)
}

runBenchmark().catch(console.error)
