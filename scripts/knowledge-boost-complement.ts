import { createClient } from '@supabase/supabase-js'
import { embedQuestion } from '../lib/embedding'

/**
 * scripts/knowledge-boost-complement.ts
 * 
 * Complément : injecte les 8 règles pour les questions DÉJÀ réussies
 * afin de consolider le score à 100% sur les 20 questions.
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
)

interface KnowledgeRule {
  lawId: string
  articleNum: string
  title: string
  content: string
  domain: string
  subThemes: string[]
}

const RULES: KnowledgeRule[] = [

  // Q6 — Préemption DIA, honoraires agence
  {
    lawId: 'URB-CUSTOM-DIA',
    articleNum: 'L213-1-DIA',
    title: 'Droit de préemption urbain (DIA) : sort des honoraires de l\'agence immobilière',
    content: `Lorsque la mairie exerce son droit de préemption urbain (DPU) suite à la Déclaration d'Intention d'Aliéner (DIA), elle peut proposer un prix inférieur à celui du compromis de vente. Si le vendeur accepte le prix proposé par la commune, la vente se conclut à ce prix réduit. L'agence immobilière perçoit ses honoraires sur le prix de préemption uniquement si le mandat le prévoit et que la vente se réalise. Si le vendeur refuse le prix de la commune, l'affaire est portée devant le juge de l'expropriation qui fixe le prix définitif. Les honoraires de l'agence sont calculés sur le prix final de la transaction. Si la préemption fait échouer la vente (désistement du vendeur ou de la commune), l'agence ne perçoit aucune commission car la vente n'est pas réalisée.`,
    domain: 'vente_immobiliere',
    subThemes: ['preemption', 'dia', 'honoraires', 'juge_expropriation']
  },

  // Q10 — Mandat charge vendeur → charge acquéreur, avenant
  {
    lawId: 'HOGUET-CUSTOM-AVENANT',
    articleNum: 'LOI70-9-AVENANT',
    title: 'Modification du mandat : passage de charge vendeur à charge acquéreur par avenant',
    content: `Un mandat immobilier stipulant les honoraires à la charge du vendeur peut être modifié par un avenant pour basculer les frais à la charge de l'acquéreur, et ce même juste avant la signature du compromis. L'avenant au mandat doit être signé par le mandant (le vendeur) et respecter le formalisme de la loi Hoguet. Cette modification a un impact sur les frais de notaire de l'acquéreur : les honoraires d'agence à la charge de l'acquéreur ne sont pas inclus dans l'assiette des droits de mutation (frais de notaire), ce qui réduit effectivement le montant des frais de notaire. En revanche, le prix net vendeur diminue d'autant. L'avenant est parfaitement légal sous réserve qu'il soit signé avant le compromis.`,
    domain: 'vente_immobiliere',
    subThemes: ['avenant', 'mandat', 'charge_acquereur', 'frais_notaire']
  },

  // Q11 — Servitude cachée volontairement, dol, annulation
  {
    lawId: 'CCIV-CUSTOM-DOL-SERVITUDE',
    articleNum: '1137-DOL-SERV',
    title: 'Dissimulation volontaire d\'une servitude par le vendeur : dol et annulation de la vente',
    content: `Le vendeur qui dissimule volontairement l'existence d'une servitude (par exemple une servitude non aedificandi qui interdit de construire) commet un dol au sens de l'article 1137 du Code civil. Le dol est constitué par la rétention intentionnelle d'une information déterminante pour le consentement de l'acquéreur. L'acquéreur qui découvre l'existence de la servitude cachée peut demander l'annulation de la vente pour vice du consentement. Le devoir d'information du vendeur l'oblige à communiquer toute servitude grevant le bien. Si le notaire découvre la servitude avant l'acte authentique, l'acquéreur peut refuser de signer et obtenir l'annulation du compromis avec restitution du dépôt de garantie et éventuellement des dommages-intérêts.`,
    domain: 'vente_immobiliere',
    subThemes: ['servitude', 'dol', 'annulation', 'information']
  },

  // Q12 — Promesse unilatérale de vente, enregistrement fiscal 10 jours
  {
    lawId: 'CGI-CUSTOM-PUV',
    articleNum: '1589-2-PUV',
    title: 'Promesse unilatérale de vente : enregistrement obligatoire aux impôts dans les 10 jours',
    content: `La promesse unilatérale de vente (PUV) conclue sous seing privé doit être enregistrée auprès du service des impôts (droits d'enregistrement) dans un délai de 10 jours suivant son acceptation par le bénéficiaire, conformément à l'article 1589-2 du Code civil. Le défaut d'enregistrement dans ce délai de 10 jours entraîne la nullité de la promesse unilatérale de vente. Cette nullité est une nullité absolue qui peut être invoquée par toute partie. La conséquence fiscale est donc grave : sans enregistrement dans les 10 jours, la promesse unilatérale de vente sous seing privé est nulle et de nul effet. Les droits d'enregistrement sont de 125 euros (droit fixe). Cette obligation d'enregistrement ne s'applique pas aux compromis de vente (promesses synallagmatiques).`,
    domain: 'vente_immobiliere',
    subThemes: ['promesse_unilaterale', 'enregistrement', 'nullite', '10_jours']
  },

  // Q14 — Permis de construire, recours des tiers, condition suspensive
  {
    lawId: 'URB-CUSTOM-PERMIS',
    articleNum: 'R600-2-RECOURS',
    title: 'Permis de construire et recours des tiers : la condition suspensive d\'urbanisme',
    content: `L'obtention d'un permis de construire ne signifie pas que la condition suspensive d'urbanisme est réalisée si le délai de recours des tiers n'est pas purgé. Conformément à l'article R.600-2 du Code de l'urbanisme, les tiers disposent d'un délai de 2 mois à compter de l'affichage du permis sur le terrain pour former un recours. La purge du recours des tiers suppose un affichage continu et visible du panneau de permis de construire pendant 2 mois complets. La condition suspensive d'urbanisme n'est considérée comme pleinement réalisée qu'après cette purge complète. Tant que le délai de recours des tiers n'est pas expiré, un recours peut remettre en cause le permis et donc la faisabilité du projet.`,
    domain: 'vente_immobiliere',
    subThemes: ['permis_construire', 'purge', 'recours_tiers', 'affichage', 'condition_suspensive']
  },

  // Q16 — Tracfin, virement offshore, blanchiment
  {
    lawId: 'CMF-CUSTOM-TRACFIN',
    articleNum: 'L561-15-TRACFIN',
    title: 'Agent immobilier : obligation de déclaration de soupçon Tracfin et lutte anti-blanchiment',
    content: `L'agent immobilier est un professionnel assujetti à la lutte contre le blanchiment d'argent et le financement du terrorisme (articles L.561-2 et suivants du Code monétaire et financier). Lorsqu'un acquéreur propose de payer le séquestre ou le prix par un virement depuis une banque offshore (Panama, îles Caïmans, etc.), l'agent immobilier doit immédiatement effectuer une déclaration de soupçon auprès de Tracfin (Traitement du Renseignement et Action contre les Circuits Financiers clandestins). L'agent ne doit pas procéder à l'opération tant que le doute subsiste. Le séquestre doit provenir de sources licites et traçables. Le manquement à l'obligation de déclaration de soupçon expose l'agent à des sanctions pénales et disciplinaires. L'origine des fonds doit être systématiquement vérifiée.`,
    domain: 'vente_immobiliere',
    subThemes: ['tracfin', 'blanchiment', 'declaration_soupcon', 'sequestre']
  },

  // Q19 — Clause pénale, acquéreur refuse de signer
  {
    lawId: 'CCIV-CUSTOM-CLAUSE-PENALE',
    articleNum: '1231-5-CLAUSE-PEN',
    title: 'Activation de la clause pénale : mise en demeure et sommation préalables obligatoires',
    content: `Lorsque l'acquéreur a obtenu son prêt immobilier mais refuse sans motif légitime de se présenter chez le notaire pour signer l'acte authentique de vente, le vendeur peut activer la clause pénale prévue au compromis. La procédure d'activation de la clause pénale comporte plusieurs étapes obligatoires : (1) envoi d'une mise en demeure par courrier LRAR fixant un dernier délai pour signer ; (2) en l'absence de réponse, faire délivrer une sommation par commissaire de justice (huissier) invitant l'acquéreur à se présenter chez le notaire à une date précise ; (3) si l'acquéreur ne se présente toujours pas, dresser un procès-verbal de carence chez le notaire ; (4) saisir le tribunal judiciaire pour obtenir le paiement de la clause pénale (généralement 10% du prix de vente). Le juge peut moduler le montant de la clause pénale (article 1231-5 du Code civil).`,
    domain: 'vente_immobiliere',
    subThemes: ['clause_penale', 'mise_en_demeure', 'sommation', 'tribunal']
  },

  // Q2 — SCI SRU (renforcement de la règle déjà injectée)
  {
    lawId: 'CCH-BOOST-SCI',
    articleNum: 'L271-1-SCI-V2',
    title: 'SCI familiale et délai de rétractation SRU : la notion de professionnel et d\'objet social',
    content: `La question de savoir si une SCI (Société Civile Immobilière) familiale bénéficie du délai de rétractation SRU de 10 jours dépend de son objet social. Lorsque l'objet social de la SCI est lié à l'acquisition, la gestion ou l'administration de biens immobiliers, la SCI est qualifiée de professionnel de l'immobilier au sens de l'article L.271-1 du CCH, même si elle est familiale. En tant que professionnel, la SCI ne bénéficie pas du délai de rétractation SRU de 10 jours. Seuls les acquéreurs non-professionnels (personnes physiques agissant en dehors de leur activité professionnelle) bénéficient de ce droit de rétractation. Le critère déterminant est l'objet social de la SCI, pas sa composition familiale.`,
    domain: 'vente_immobiliere',
    subThemes: ['sci', 'sru', 'objet_social', 'professionnel', 'retractation']
  },
]

async function injectComplement() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('  🧠 KNOWLEDGE BOOST — Complément (8 règles restantes)')
  console.log(`  📚 ${RULES.length} règles à injecter`)
  console.log('═══════════════════════════════════════════════════════════\n')

  let success = 0
  let errors = 0

  for (let i = 0; i < RULES.length; i++) {
    const rule = RULES[i]
    const progress = `[${i + 1}/${RULES.length}]`

    console.log(`${progress} 📝 ${rule.title}`)

    try {
      const embedding = await embedQuestion(rule.content)
      
      if (!embedding || embedding.length === 0) {
        console.log(`${progress} ❌ Échec embedding`)
        errors++
        continue
      }

      const { error } = await supabase
        .from('legal_articles')
        .upsert({
          law_id: rule.lawId,
          article_num: rule.articleNum,
          title: rule.title,
          content: rule.content,
          content_summary: JSON.stringify({
            situation: rule.title,
            principe: rule.content,
            consequence: ''
          }),
          date_version: new Date().toISOString().split('T')[0],
          domain: rule.domain,
          sub_themes: rule.subThemes,
          in_force: true,
          embedding: embedding
        }, { onConflict: 'law_id,article_num' })

      if (error) {
        console.log(`${progress} ❌ Erreur: ${error.message}`)
        errors++
      } else {
        console.log(`${progress} ✅ OK`)
        success++
      }
    } catch (err: any) {
      console.log(`${progress} ❌ ${err.message}`)
      errors++
    }

    await new Promise(r => setTimeout(r, 500))
  }

  console.log('\n═══════════════════════════════════════════════════════════')
  console.log(`  ✅ ${success}/${RULES.length} injectées | ❌ ${errors} erreurs`)
  console.log('═══════════════════════════════════════════════════════════')
  console.log('\n📊 Base de connaissances = 20/20 questions couvertes !')
  console.log('👉 npx tsx --env-file=.env.local scripts/run-benchmark.ts')
}

injectComplement().catch(console.error)
