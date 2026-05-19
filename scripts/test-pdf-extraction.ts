import { extractTextFromSupabasePDF } from '../lib/pdfExtractor'
import dotenv from 'dotenv'
import { resolve } from 'path'

// Charger les variables d'environnement locales
dotenv.config({ path: resolve(process.cwd(), '.env.local') })

async function runTest() {
  // Remplacez cette valeur par le chemin exact d'un fichier PDF que vous venez d'uploader
  // Exemple: 'uploads/abcde-12345.pdf'
  const testFilePath = 'uploads/46l8geevt6q-1778583736659.pdf'

  if (testFilePath === 'REMPLACER_PAR_LE_CHEMIN_DU_FICHIER_UPLOADÉ.pdf') {
    console.log("⚠️ Veuillez modifier 'testFilePath' dans le script avec le chemin d'un vrai fichier sur votre Supabase (ex: 'uploads/xxx.pdf').")
    console.log("Vous pouvez trouver ce chemin dans les logs de votre terminal suite au récent upload.")
    return
  }

  console.log(`\n⏳ Tentative de téléchargement et d'extraction pour le fichier : ${testFilePath} ...\n`)

  try {
    const { text, method } = await extractTextFromSupabasePDF(testFilePath)

    console.log(`✅ EXTRACTION RÉUSSIE via ${method} ! Voici un aperçu des 500 premiers caractères :`)
    console.log('-------------------------------------------------------------------')
    console.log(text.substring(0, 500) + '...')
    console.log('-------------------------------------------------------------------')
    console.log(`📊 Longueur totale du texte extrait : ${text.length} caractères.`)
    
  } catch (error) {
    console.error('\n❌ Échec du test :', error)
  }
}

runTest()
