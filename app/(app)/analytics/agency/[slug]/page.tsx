'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, MapPin } from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

type AgentRow = {
  full_name: string
  user_id: string
  cnt: number
  last_in_period: string | null
  last_ever: string | null
}

interface AgencyDetail {
  agency: { id: string; name: string; slug: string; city: string | null; is_active: boolean }
  total_questions: number
  total_users: number
  by_domain: Array<{ label: string; cnt: number }> | null
  pain_points: Array<{ label: string; cnt: number }> | null
  by_agent: AgentRow[] | null
  daily_activity: Array<{ day: string; cnt: number }> | null
  recent_questions: Array<{
    question_preview: string
    sub_domain: string | null
    domain: string | null
    created_at: string
  }> | null
}

// ─── Utilitaires ─────────────────────────────────────────────────────────────

function getPainEmoji(theme: string): string {
  const t = theme.toLowerCase()
  if (t.includes('impay') || t.includes('expuls') || t.includes('loyer')) return '🔥'
  if (t.includes('diagnos') || t.includes('dpe') || t.includes('énerg')) return '📋'
  if (t.includes('mandat') || t.includes('commis') || t.includes('exclus')) return '🏠'
  if (t.includes('vice') || t.includes('caché') || t.includes('garanti')) return '⚖️'
  if (t.includes('dépôt') || t.includes('caution') || t.includes('restitut')) return '🔑'
  if (t.includes('copro') || t.includes('syndic')) return '🏢'
  if (t.includes('travaux') || t.includes('rénov')) return '🔨'
  if (t.includes('bail') || t.includes('location') || t.includes('locataire')) return '🔐'
  if (t.includes('vente') || t.includes('compromis')) return '📝'
  return '💬'
}

function daysAgo(d: string | null): number | null {
  if (!d) return null
  return Math.floor((Date.now() - new Date(d).getTime()) / 86400000)
}

function agentStatus(agent: AgentRow) {
  if (agent.cnt > 0) {
    const d = daysAgo(agent.last_in_period)
    return { color: '#22c55e', label: d === 0 ? "aujourd'hui" : d === 1 ? 'hier' : `il y a ${d}j` }
  }
  if (!agent.last_ever) {
    return { color: '#94a3b8', label: 'jamais connecté' }
  }
  const d = daysAgo(agent.last_ever)!
  return { color: '#ef4444', label: `inactif depuis ${d}j` }
}

// ─── Graphe d'activité 30 jours ───────────────────────────────────────────────

function ActivitySparkline({ data }: { data: Array<{ day: string; cnt: number }> }) {
  const days: Array<{ day: string; cnt: number }> = []
  for (let i = 29; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    const found = data.find(r => r.day.slice(0, 10) === key)
    days.push({ day: key, cnt: found?.cnt ?? 0 })
  }
  const max = Math.max(...days.map(d => d.cnt), 1)

  return (
    <div className="flex items-end gap-0.5 h-12">
      {days.map((d, i) => (
        <div
          key={i}
          title={`${d.day.slice(5).replace('-', '/')} : ${d.cnt}`}
          className="flex-1 rounded-sm cursor-default transition-colors"
          style={{
            height: `${Math.max((d.cnt / max) * 100, d.cnt > 0 ? 10 : 2)}%`,
            backgroundColor: d.cnt > 0
              ? `hsl(185 100% 37% / ${0.25 + (d.cnt / max) * 0.75})`
              : 'hsl(var(--muted))',
          }}
        />
      ))}
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function AgencyDetailPage() {
  const params = useParams()
  const router = useRouter()
  const slug   = params.slug as string

  const [detail, setDetail]   = useState<AgencyDetail | null>(null)
  const [period, setPeriod]   = useState(30)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    setDetail(null); setError(null)
    fetch(`/api/admin/analytics/agency/${slug}?period=${period}`)
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setDetail(d) })
      .catch(() => setError('Erreur réseau'))
  }, [slug, period])

  if (error) return (
    <div className="flex flex-col items-center justify-center h-screen gap-4">
      <p className="text-sm text-red-500">{error}</p>
      <button onClick={() => router.back()} className="text-xs text-muted-foreground underline">Retour</button>
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
  const maxAgent  = byAgent.length > 0 ? Math.max(...byAgent.map(a => a.cnt), 1) : 1
  const activeAgents = byAgent.filter(a => a.cnt > 0).length

  return (
    <div className="max-w-5xl mx-auto p-6 md:p-8">

      {/* En-tête */}
      <div className="flex items-start gap-4 mb-8">
        <button
          onClick={() => router.back()}
          className="mt-1 p-2 rounded-xl hover:bg-muted transition-colors shrink-0"
          aria-label="Retour"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1">
          <h1
            className="text-2xl font-bold text-foreground leading-tight"
            style={{ fontFamily: "'Source Serif 4', Georgia, serif" }}
          >
            {agency.name}
          </h1>
          {agency.city && (
            <p className="flex items-center gap-1 text-sm text-muted-foreground mt-0.5">
              <MapPin className="h-3 w-3" />{agency.city}
            </p>
          )}
        </div>
        <div className="flex gap-1">
          {[7, 30, 90].map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                period === p ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {p}j
            </button>
          ))}
        </div>
      </div>

      {/* KPIs principaux */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Questions</div>
          <div
            className="text-4xl font-bold"
            style={{ fontFamily: "'Source Serif 4', Georgia, serif" }}
          >
            {detail.total_questions.toLocaleString('fr-FR')}
          </div>
          <p className="text-xs text-muted-foreground mt-1">sur {period} jours</p>
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Agents actifs</div>
          <div
            className="text-4xl font-bold"
            style={{ fontFamily: "'Source Serif 4', Georgia, serif" }}
          >
            {activeAgents}
            <span className="text-xl font-normal text-muted-foreground">/{detail.total_users}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">conseillers inscrits</p>
        </div>

        <div className="bg-card border border-border rounded-xl p-5 col-span-2 sm:col-span-1">
          <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Top problématique</div>
          <div className="text-sm font-semibold text-foreground leading-tight line-clamp-2">
            {painPoints[0] ? (
              <><span className="mr-1">{getPainEmoji(painPoints[0].label)}</span>{painPoints[0].label}</>
            ) : '—'}
          </div>
          {painPoints[0] && (
            <p className="text-xs text-muted-foreground mt-1">{painPoints[0].cnt} questions</p>
          )}
        </div>
      </div>

      {/* Graphe 30 jours */}
      <div className="bg-card border border-border rounded-2xl p-5 mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-foreground">Activité — 30 derniers jours</h2>
          <span className="text-xs text-muted-foreground">Survolez pour le détail</span>
        </div>
        {dailyAct.length > 0
          ? <ActivitySparkline data={dailyAct} />
          : <div className="h-12 flex items-center justify-center text-xs text-muted-foreground">Aucune activité.</div>
        }
      </div>

      {/* Agents */}
      {byAgent.length > 0 && (
        <div className="bg-card border border-border rounded-2xl overflow-hidden mb-8">
          <div className="px-5 py-4 border-b border-border">
            <h2 className="text-sm font-semibold">Activité par agent</h2>
          </div>
          <div className="divide-y divide-border">
            {byAgent.map((a, i) => {
              const st = agentStatus(a)
              const barPct = (a.cnt / maxAgent) * 100

              return (
                <div key={i} className="flex items-center gap-4 px-5 py-3">
                  {/* Avatar initiale */}
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold"
                    style={{
                      backgroundColor: a.cnt > 0 ? 'hsl(185 100% 37% / 0.15)' : 'hsl(var(--muted))',
                      color: a.cnt > 0 ? 'hsl(185 100% 30%)' : 'hsl(var(--muted-foreground))',
                    }}
                  >
                    {a.full_name?.charAt(0)?.toUpperCase() ?? '?'}
                  </div>

                  {/* Nom */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-foreground truncate">{a.full_name}</span>
                      <span
                        className="text-xs"
                        style={{ color: st.color }}
                      >
                        {st.label}
                      </span>
                    </div>
                    {a.cnt > 0 && (
                      <div className="bg-muted rounded-full h-1.5 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{
                            width: `${barPct}%`,
                            backgroundColor: 'hsl(185 100% 37%)',
                          }}
                        />
                      </div>
                    )}
                  </div>

                  {/* Nb questions */}
                  <span
                    className="text-sm font-bold tabular-nums shrink-0"
                    style={{
                      fontFamily: "'Source Serif 4', Georgia, serif",
                      color: a.cnt > 0 ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))',
                    }}
                  >
                    {a.cnt > 0 ? `${a.cnt} q.` : '0'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Domaines + Pain points */}
      {(byDomain.length > 0 || painPoints.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {byDomain.length > 0 && (
            <div className="bg-card border border-border rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-border">
                <h2 className="text-sm font-semibold">Par domaine juridique</h2>
              </div>
              <div className="divide-y divide-border">
                {byDomain.map((d, i) => (
                  <div key={i} className="flex items-center gap-3 px-5 py-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-foreground mb-1 truncate">{d.label}</div>
                      <div className="bg-muted rounded-full h-1.5">
                        <div className="bg-primary h-full rounded-full" style={{ width: `${(d.cnt / maxDomain) * 100}%` }} />
                      </div>
                    </div>
                    <span className="text-sm font-bold tabular-nums shrink-0" style={{ fontFamily: "'Source Serif 4', Georgia, serif" }}>
                      {d.cnt}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {painPoints.length > 0 && (
            <div className="bg-card border border-border rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-border">
                <h2 className="text-sm font-semibold">Pain points</h2>
              </div>
              <div className="divide-y divide-border">
                {painPoints.map((p, i) => (
                  <div key={i} className="flex items-center gap-3 px-5 py-3">
                    <span className="text-base shrink-0">{getPainEmoji(p.label)}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-foreground mb-1 truncate">{p.label}</div>
                      <div className="bg-muted rounded-full h-1.5">
                        <div className="bg-primary h-full rounded-full" style={{ width: `${(p.cnt / maxPain) * 100}%` }} />
                      </div>
                    </div>
                    <span className="text-sm font-bold tabular-nums shrink-0" style={{ fontFamily: "'Source Serif 4', Georgia, serif" }}>
                      {p.cnt}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Questions récentes */}
      {recentQ.length > 0 && (
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <h2 className="text-sm font-semibold">Questions récentes</h2>
          </div>
          <div className="divide-y divide-border">
            {recentQ.map((q, i) => (
              <div key={i} className="flex items-start gap-3 px-5 py-3">
                <span className="text-muted-foreground text-sm mt-0.5 shrink-0">•</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-foreground/80 leading-relaxed italic">{q.question_preview}</p>
                  {(q.sub_domain || q.domain) && (
                    <span className="text-xs text-primary mt-1 block">{q.sub_domain ?? q.domain}</span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0 ml-2">
                  {new Date(q.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
