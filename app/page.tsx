import Link from 'next/link'
import { Layout } from '@/components/Layout'
import { requireAuth } from '@/lib/auth'
import { Scale, Building2, Gavel, FileText, Shield, Users, BookOpen, CheckCircle, ArrowRight } from 'lucide-react'

const domains = [
  { icon: Building2, title: 'Copropriété', desc: 'Loi de 1965, AG, charges, travaux' },
  { icon: Gavel, title: 'Loi Hoguet', desc: 'Carte T, obligations professionnelles' },
  { icon: FileText, title: 'Transactions', desc: 'Mandats, compromis, conditions' },
  { icon: Scale, title: 'Gestion locative', desc: 'Baux, états des lieux, caution' },
  { icon: Shield, title: 'Responsabilité', desc: 'Civile, pénale, professionnelle' },
  { icon: Users, title: 'Syndics', desc: 'Obligations, carte, garantie' },
]

const trustPoints = [
  'Sources officielles Légifrance',
  'Droit immobilier français à jour',
  'Références juridiques précises',
  'Articles de loi cités et sourcés',
]

export default async function HomePage() {
  const user = await requireAuth()
  return (
    <Layout user={user}>
      <div className="min-h-screen bg-background overflow-auto">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 bg-navy" />
          <div className="relative z-10 max-w-5xl mx-auto px-6 py-24 md:py-32">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/20 text-white/90 text-xs font-medium mb-6">
                <Scale className="h-3.5 w-3.5" />
                Réservé aux professionnels Nestenn
              </div>
              <h1 className="text-3xl md:text-5xl font-bold text-white tracking-tight leading-tight mb-5">
                L&apos;expertise juridique immobilière,
                <span className="text-primary"> augmentée par l&apos;IA</span>
              </h1>
              <p className="text-base md:text-lg text-white/70 leading-relaxed mb-8 max-w-xl">
                Sécurisez vos transactions. Obtenez des réponses juridiques structurées, sourcées et fiables en quelques secondes.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Link
                  href="/chat"
                  className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-primary text-white font-semibold text-sm hover:opacity-90 transition-opacity"
                >
                  Poser ma question juridique
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/chat"
                  className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl text-white/80 text-sm font-medium border border-white/15 hover:border-white/30 hover:text-white hover:bg-white/5 transition-all"
                >
                  <FileText className="h-4 w-4 text-primary" />
                  Analyse de documents par IA intégrée
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* Trust bar */}
        <section className="border-b border-border bg-card">
          <div className="max-w-5xl mx-auto px-6 py-5">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
              {trustPoints.map((point) => (
                <div key={point} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <CheckCircle className="h-3.5 w-3.5 text-primary" />
                  {point}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Domains */}
        <section className="max-w-5xl mx-auto px-6 py-16">
          <div className="text-center mb-10">
            <h2 className="text-xl md:text-2xl font-bold text-foreground tracking-tight mb-2">
              Domaines d&apos;expertise couverts
            </h2>
            <p className="text-sm text-muted-foreground">Une couverture complète du droit immobilier français</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {domains.map((domain) => (
              <Link
                key={domain.title}
                href="/chat"
                className="group p-5 rounded-xl border border-border bg-card hover:border-primary/30 hover:shadow-sm transition-all"
              >
                <domain.icon className="h-5 w-5 text-primary mb-3" />
                <h3 className="text-sm font-semibold text-foreground mb-1">{domain.title}</h3>
                <p className="text-xs text-muted-foreground">{domain.desc}</p>
              </Link>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="max-w-5xl mx-auto px-6 pb-16">
          <div className="rounded-2xl bg-navy p-8 md:p-12 text-center">
            <BookOpen className="h-8 w-8 text-primary mx-auto mb-4" />
            <h2 className="text-xl md:text-2xl font-bold text-white tracking-tight mb-3">
              Quelle est votre problématique immobilière aujourd&apos;hui ?
            </h2>
            <p className="text-sm text-white/60 mb-6 max-w-md mx-auto">
              Posez votre question et obtenez une réponse juridique structurée, sourcée et vérifiable en quelques secondes.
            </p>
            <Link
              href="/chat"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-white font-semibold text-sm hover:opacity-90 transition-opacity"
            >
              Démarrer une consultation
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </div>
    </Layout>
  )
}
