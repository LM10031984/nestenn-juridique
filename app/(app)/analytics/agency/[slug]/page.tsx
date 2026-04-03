'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft, Building2, MessageSquare, Users,
  TrendingUp, AlertCircle, Calendar,
} from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

interface AgencyInfo {
  id: string
  name: string
  slug: string
  city: string | null
  is_active: boolean
}

interface AgencyDetail {
  agency: AgencyInfo
  total_questions: number
  by_domain: Array<{ label: string; cnt: number }> | null
  pain_points: Array<{ label: string; cnt: number }> | null
  by_agent: Array<{ full_name: string; cnt: number }> | null
  daily_activity: Array<{ day: string; cnt: number }> | null
  recent_questions: Array<{
    question_preview: string
    sub_domain: string | null
    domain: string | null
    created_at: string
  }> | null
}

// ─── Mini graphe d'activité 30 jours ─────────────────────────────────────────

function ActivityChart({ data }: { data: Array<{ day: string; cnt: number }> }) {
  // Compléter les 30 derniers jours avec des 0
  const days: Array<{ day: string; cnt: number }> = []
  for (let i = 29; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    const found = data.find(r => r.day.slice(0, 10) === key)
    days.push({ day: key, cnt: found?.cnt ?? 0 })
  }

  const max = Math.max(...days.map(d => d.cnt), 1)

  return (
    <div className="flex items-end gap-0.5 h-16">
      {days.map((d, i) => (
        <div
          key={i}
          title={`${d.day.slice(5)}: ${d.cnt} question${d.cnt !== 1 ? 's' : ''}`}
          className="flex-1 bg-primary/20 hover:bg-primary/50 transition-colors rounded-sm cursor-default"
          style={{ height: `${Math.max((d.cnt / max) * 100, d.cnt > 0 ? 8 : 2)}%` }}
        />
      ))}
    </div>
  )
}

// ─── Barre horizontale avec label ────────────────────────────────────────────

function BarRow({ label, count, max }: { label: string; count: number; max: number }) {
  const pct = (count / max) * 100
  return (
    <div className="flex items-center gap-3">
      <div className="w-6 text-right text-xs font-bold text-primary shrink-0">{count}</div>
      <div className="flex-1">
        <div className="text-xs mb-1 truncate">{label}</div>
        <div className="bg-muted rounded-full h-1.5 overflow-hidden">
          <div className="bg-primary h-full rounded-full" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function AgencyDetailPage() {
  const params = useParams()
  const router = useRouter()
  const slug = params.slug as string

  const [detail, setDetail] = useState<AgencyDetail | null>(null)
  const [period, setPeriod] = useState(30)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDetail(null)
    setError(null)
    fetch(`/api/admin/analytics/agency/${slug}?period=${period}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error)
        else setDetail(d as AgencyDetail)
      })
      .catch(() => setError('Erreur réseau'))
  }, [slug, period])

  if (error) return (
    <div className="flex flex-col items-center justify-center h-screen gap-4">
      <p className="text-sm text-red-500">{error}</p>
      <button onClick={() => router.back()} className="text-xs text-muted-foreground underline">
        Retour
      </button>
    </div>
  )

  if (!detail) return (
    <div className="flex items-center justify-center h-screen">
      <p className="text-sm text-muted-foreground">Chargement…</p>
    </div>
  )

  const { agency } = detail
  const byDomain   = detail.by_domain   ?? []
  const painPoints = detail.pain_points ?? []
  const byAgent    = detail.by_agent    ?? []
  const dailyAct   = detail.daily_activity ?? []
  const recentQ    = detail.recent_questions ?? []

  const maxDomain = byDomain[0]?.cnt   ?? 1
  const maxPain   = painPoints[0]?.cnt ?? 1
  const maxAgent  = byAgent[0]?.cnt    ?? 1

  return (
    <div className="max-w-5xl mx-auto p-6 md:p-8">
      {/* En-tête */}
      <div className="flex items-center gap-3 mb-8">
        <button
          onClick={() => router.back()}
          className="p-1.5 rounded-lg hover:bg-muted transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-bold text-foreground">{agency.name}</h1>
            {agency.city && (
              <span className="text-sm text-muted-foreground">— {agency.city}</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {agency.is_active ? 'Agence active' : 'Agence inactive'} · slug: {agency.slug}
          </p>
        </div>
        {/* Sélecteur période */}
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

      {/* KPI principal */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center gap-2 text-muted-foreground mb-2">
            <MessageSquare className="h-3.5 w-3.5" />
            <span className="text-xs">Questions</span>
          </div>
          <div className="text-3xl font-bold text-foreground">
            {detail.total_questions.toLocaleString('fr-FR')}
          </div>
          <p className="text-xs text-muted-foreground mt-1">sur {period} jours</p>
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center gap-2 text-muted-foreground mb-2">
            <TrendingUp className="h-3.5 w-3.5" />
            <span className="text-xs">Top domaine</span>
          </div>
          <div className="text-sm font-semibold text-foreground line-clamp-2 leading-tight">
            {byDomain[0]?.label ?? '—'}
          </div>
          {byDomain[0] && (
            <p className="text-xs text-muted-foreground mt-1">{byDomain[0].cnt} questions</p>
          )}
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center gap-2 text-muted-foreground mb-2">
            <AlertCircle className="h-3.5 w-3.5" />
            <span className="text-xs">Top pain point</span>
          </div>
          <div className="text-sm font-semibold text-foreground line-clamp-2 leading-tight">
            {painPoints[0]?.label ?? '—'}
          </div>
          {painPoints[0] && (
            <p className="text-xs text-muted-foreground mt-1">{painPoints[0].cnt} questions</p>
          )}
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center gap-2 text-muted-foreground mb-2">
            <Users className="h-3.5 w-3.5" />
            <span className="text-xs">Agents actifs</span>
          </div>
          <div className="text-3xl font-bold text-foreground">{byAgent.length}</div>
          <p className="text-xs text-muted-foreground mt-1">sur la période</p>
        </div>
      </div>

      {/* Graphe d'activité 30 jours */}
      <div className="bg-card border border-border rounded-xl p-6 mb-8">
        <div className="flex items-center gap-2 mb-4">
          <Calendar className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Activité — 30 derniers jours</h2>
        </div>
        {dailyAct.length > 0 ? (
          <ActivityChart data={dailyAct} />
        ) : (
          <div className="h-16 flex items-center justify-center">
            <p className="text-xs text-muted-foreground">Aucune activité sur cette période.</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Par domaine */}
        {byDomain.length > 0 && (
          <div className="bg-card border border-border rounded-xl p-6">
            <h2 className="text-sm font-semibold text-foreground mb-4">Par domaine</h2>
            <div className="space-y-3">
              {byDomain.map((d, i) => (
                <BarRow key={i} label={d.label} count={d.cnt} max={maxDomain} />
              ))}
            </div>
          </div>
        )}

        {/* Pain points */}
        {painPoints.length > 0 && (
          <div className="bg-card border border-border rounded-xl p-6">
            <h2 className="text-sm font-semibold text-foreground mb-4">Pain points</h2>
            <div className="space-y-3">
              {painPoints.map((p, i) => (
                <BarRow key={i} label={p.label} count={p.cnt} max={maxPain} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Par agent */}
      {byAgent.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-6 mb-8">
          <div className="flex items-center gap-2 mb-4">
            <Users className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Activité par agent</h2>
          </div>
          <div className="space-y-2">
            {byAgent.map((a, i) => (
              <div key={i} className="flex items-center gap-3 py-1.5 border-b border-border last:border-0">
                <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <span className="text-xs font-bold text-primary">
                    {a.full_name?.charAt(0)?.toUpperCase() ?? '?'}
                  </span>
                </div>
                <span className="flex-1 text-xs text-foreground">{a.full_name}</span>
                <span className="text-xs font-semibold text-muted-foreground">{a.cnt} q.</span>
                <div className="w-20 bg-muted rounded-full h-1.5">
                  <div
                    className="bg-primary h-full rounded-full"
                    style={{ width: `${(a.cnt / maxAgent) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Questions récentes */}
      {recentQ.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-6">
          <h2 className="font-semibold mb-4">Questions récentes</h2>
          <div className="space-y-2">
            {recentQ.map((q, i) => (
              <div key={i} className="flex items-center gap-3 py-2 border-b last:border-0">
                <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded min-w-[140px] text-center truncate">
                  {q.sub_domain ?? q.domain ?? 'Non classé'}
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
    </div>
  )
}
