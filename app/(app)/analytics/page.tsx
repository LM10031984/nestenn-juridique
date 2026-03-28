'use client'

import { useState, useEffect } from 'react'
import { BarChart2, MessageSquare, Building2, TrendingUp, AlertCircle } from 'lucide-react'

interface AnalyticsData {
  period: number
  totalQuestions: number
  byDomain: Array<{ domain: string; count: number }>
  byTopic: Array<{ topic: string; count: number }>
  byAgency: Array<{ agency_name: string; question_count: number }>
  topQuestions: Array<{ domain: string; question_preview: string; ask_count: number }>
  painPoints: Array<{ domain: string; sub_domain: string; question_count: number }>
  recentQuestions: Array<{ question_preview: string; sub_domain: string | null; domain: string | null; created_at: string }>
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
            <AlertCircle className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wide">Pain points</span>
          </div>
          <div className="text-3xl font-bold text-foreground">{data.painPoints.length}</div>
          <p className="text-xs text-muted-foreground mt-1">thèmes identifiés</p>
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

      {/* Pain points — VUE PRINCIPALE */}
      {data.painPoints.length > 0 && (
        <div className="bg-card border rounded-xl p-6 mb-8">
          <h2 className="text-lg font-semibold mb-2">
            Problématiques des agents
          </h2>
          <p className="text-sm text-muted-foreground mb-6">
            Ce sur quoi vos agents ont le plus besoin d&apos;aide
          </p>
          <div className="space-y-3">
            {data.painPoints.slice(0, 20).map((p, i) => {
              const maxCount = data.painPoints[0]?.question_count ?? 1
              const pct = (p.question_count / maxCount) * 100
              return (
                <div key={i} className="flex items-center gap-4">
                  <div className="w-8 text-right text-sm font-bold text-primary">
                    {p.question_count}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium">{p.sub_domain}</span>
                    </div>
                    <div className="bg-muted rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-primary h-full rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Questions récentes — détail */}
      {data.recentQuestions.length > 0 && (
        <div className="bg-card border rounded-xl p-6 mb-8">
          <h2 className="font-semibold mb-4">Dernières questions posées</h2>
          <div className="space-y-2">
            {data.recentQuestions.slice(0, 15).map((q, i) => (
              <div key={i} className="flex items-center gap-3 py-2 border-b last:border-0">
                <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded min-w-[160px] text-center">
                  {q.sub_domain ?? 'Non classé'}
                </span>
                <span className="flex-1 text-sm truncate">{q.question_preview}</span>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {new Date(q.created_at).toLocaleDateString('fr-FR')}
                </span>
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
