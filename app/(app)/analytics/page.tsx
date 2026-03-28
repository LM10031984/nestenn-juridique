'use client'

import { useState, useEffect } from 'react'
import { BarChart2, MessageSquare, Building2, TrendingUp, AlertCircle } from 'lucide-react'
import { TOPIC_LABELS } from '@/lib/topic-detector'

interface AnalyticsData {
  period: number
  totalQuestions: number
  byDomain: Array<{ domain: string; count: number }>
  byTopic: Array<{ topic: string; count: number }>
  byAgency: Array<{ agency_name: string; question_count: number }>
  topQuestions: Array<{ domain: string; question_preview: string; ask_count: number }>
  painPoints: Array<{ domain: string; sub_domain: string; question_count: number }>
}

const DOMAIN_LABELS: Record<string, string> = {
  baux_habitation: 'Baux d\'habitation',
  copropriete: 'Copropriété',
  agent_immobilier: 'Loi Hoguet / Agent',
  transactions: 'Transactions',
  diagnostics: 'Diagnostics',
  urbanisme: 'Urbanisme',
  bail_commercial: 'Bail commercial',
  fiscalite: 'Fiscalité',
  viager: 'Viager / Démembrement',
  construction: 'Construction',
  servitudes: 'Servitudes',
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [period, setPeriod] = useState(30)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setData(null)
    setError(null)
    fetch(`/api/admin/analytics?period=${period}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error)
        else setData(d as AnalyticsData)
      })
      .catch(() => setError('Erreur réseau'))
  }, [period])

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-sm text-red-500">{error}</p>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-sm text-muted-foreground">Chargement...</p>
      </div>
    )
  }

  const maxCount = Math.max(...data.byDomain.map(d => d.count), 1)
  const maxTopicCount = Math.max(...data.byTopic.map(t => t.count), 1)

  return (
    <div className="max-w-5xl mx-auto p-6 md:p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-bold text-foreground">Analytics</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Questions juridiques posées par les agents</p>
        </div>

        {/* Sélecteur de période */}
        <div className="flex gap-1.5">
          {[7, 30, 90].map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                period === p
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {p}j
            </button>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center gap-2 text-muted-foreground mb-3">
            <MessageSquare className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wide">Questions totales</span>
          </div>
          <div className="text-3xl font-bold text-foreground">{data.totalQuestions}</div>
          <p className="text-xs text-muted-foreground mt-1">sur {period} jours</p>
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center gap-2 text-muted-foreground mb-3">
            <BarChart2 className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wide">Domaines actifs</span>
          </div>
          <div className="text-3xl font-bold text-foreground">{data.byDomain.length}</div>
          <p className="text-xs text-muted-foreground mt-1">domaines juridiques couverts</p>
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center gap-2 text-muted-foreground mb-3">
            <Building2 className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wide">Agences actives</span>
          </div>
          <div className="text-3xl font-bold text-foreground">{data.byAgency.length}</div>
          <p className="text-xs text-muted-foreground mt-1">agences utilisatrices</p>
        </div>
      </div>

      {/* Répartition par domaine — barres horizontales */}
      {data.byDomain.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-6 mb-6">
          <h2 className="text-sm font-semibold text-foreground mb-5 flex items-center gap-2">
            <BarChart2 className="h-4 w-4 text-primary" />
            Répartition par domaine juridique
          </h2>
          <div className="space-y-3">
            {data.byDomain.map(d => (
              <div key={d.domain} className="flex items-center gap-3">
                <div className="w-44 text-xs text-right text-muted-foreground truncate shrink-0">
                  {DOMAIN_LABELS[d.domain] ?? d.domain}
                </div>
                <div className="flex-1 bg-muted rounded-full h-6 overflow-hidden">
                  <div
                    className="bg-primary h-full rounded-full flex items-center justify-end px-2.5 transition-all duration-500"
                    style={{ width: `${Math.max((d.count / maxCount) * 100, 4)}%` }}
                  >
                    <span className="text-[11px] text-primary-foreground font-semibold">{d.count}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pain points — sous-domaines IA (GPT-4o-mini) */}
      {data.painPoints.length > 0 ? (
        <div className="bg-card border border-border rounded-xl p-6 mb-6">
          <h2 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-orange-400" />
            Pain points des agents
          </h2>
          <p className="text-xs text-muted-foreground mb-5">
            Sous-thèmes précis classifiés par IA — ce sur quoi les agents bloquent vraiment
          </p>
          <div className="space-y-2">
            {data.painPoints.slice(0, 15).map((p, i) => (
              <div key={i} className="flex items-center gap-4 py-2 border-b border-border last:border-0">
                <span className="text-xs bg-muted px-2 py-1 rounded min-w-[160px] text-right text-muted-foreground truncate shrink-0">
                  {DOMAIN_LABELS[p.domain] ?? p.domain}
                </span>
                <span className="flex-1 text-sm font-medium text-foreground">{p.sub_domain}</span>
                <span className="text-sm text-muted-foreground shrink-0">{p.question_count}×</span>
              </div>
            ))}
          </div>
        </div>
      ) : data.byTopic.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-6 mb-6">
          <h2 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-orange-400" />
            Pain points — thèmes juridiques
          </h2>
          <p className="text-xs text-muted-foreground mb-5">
            Ce sur quoi les agents bloquent le plus
          </p>
          <div className="space-y-3">
            {data.byTopic.slice(0, 15).map(t => (
              <div key={t.topic} className="flex items-center gap-3">
                <div className="w-52 text-xs text-right text-muted-foreground truncate shrink-0">
                  {TOPIC_LABELS[t.topic] ?? t.topic}
                </div>
                <div className="flex-1 bg-muted rounded-full h-6 overflow-hidden">
                  <div
                    className="bg-orange-400/80 h-full rounded-full flex items-center justify-end px-2.5 transition-all duration-500"
                    style={{ width: `${Math.max((t.count / maxTopicCount) * 100, 4)}%` }}
                  >
                    <span className="text-[11px] text-white font-semibold">{t.count}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top questions */}
        {data.topQuestions.length > 0 && (
          <div className="bg-card border border-border rounded-xl p-6">
            <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              Questions les plus fréquentes
            </h2>
            <div className="space-y-1">
              {data.topQuestions.slice(0, 15).map((q, i) => (
                <div key={i} className="flex items-center gap-3 py-2 border-b border-border last:border-0">
                  <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded shrink-0">
                    {DOMAIN_LABELS[q.domain] ?? q.domain}
                  </span>
                  <span className="flex-1 text-xs text-foreground/80 truncate">{q.question_preview}</span>
                  <span className="text-xs font-semibold text-muted-foreground shrink-0">{q.ask_count}×</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Par agence */}
        {data.byAgency.length > 0 && (
          <div className="bg-card border border-border rounded-xl p-6">
            <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" />
              Activité par agence
            </h2>
            <div className="space-y-1">
              {data.byAgency.slice(0, 20).map((a, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <span className="text-xs text-foreground/80">{a.agency_name}</span>
                  <span className="text-xs font-semibold text-muted-foreground">{a.question_count} questions</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* État vide */}
      {data.totalQuestions === 0 && (
        <div className="text-center py-16">
          <BarChart2 className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Aucune donnée sur cette période.</p>
          <p className="text-xs text-muted-foreground/70 mt-1">Les analytics se remplissent au fur et à mesure des questions posées.</p>
        </div>
      )}
    </div>
  )
}
