'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  BarChart2, MessageSquare, Building2, TrendingUp,
  AlertCircle, Search, ChevronLeft, ChevronRight,
  ArrowUpDown, Activity,
} from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

interface NetworkKPIs {
  total_questions: number
  prev_total_questions: number
  active_agencies: number
  total_agencies: number
  top_theme: string | null
  top_theme_count: number
  inactive_count: number
}

interface AgencyRow {
  agency_name: string
  agency_slug: string
  city: string | null
  question_count: number
  last_question: string | null
  total_count: number
}

interface Pagination {
  page: number
  totalPages: number
  totalCount: number
  limit: number
}

interface AnalyticsData {
  period: number
  totalQuestions: number
  byDomain: Array<{ domain: string; count: number }>
  byTopic: Array<{ topic: string; count: number }>
  topQuestions: Array<{ domain: string; question_preview: string; ask_count: number }>
  painPoints: Array<{ domain: string; sub_domain: string; question_count: number }>
  recentQuestions: Array<{ question_preview: string; sub_domain: string | null; domain: string | null; created_at: string }>
  isAdmin: boolean
}

// ─── Composant bannière réseau (super_admin) ─────────────────────────────────

function NetworkBanner({ period }: { period: number }) {
  const [kpis, setKpis] = useState<NetworkKPIs | null>(null)

  useEffect(() => {
    fetch(`/api/admin/analytics/network?period=${period}`)
      .then(r => r.json())
      .then(d => { if (!d.error) setKpis(d) })
  }, [period])

  if (!kpis) return (
    <div className="bg-card border border-border rounded-xl p-5 mb-8 animate-pulse h-24" />
  )

  const pctChange = kpis.prev_total_questions > 0
    ? Math.round(((kpis.total_questions - kpis.prev_total_questions) / kpis.prev_total_questions) * 100)
    : null

  const pctActive = kpis.total_agencies > 0
    ? Math.round((kpis.active_agencies / kpis.total_agencies) * 100)
    : 0

  return (
    <div className="bg-card border border-border rounded-xl p-5 mb-8">
      <div className="flex items-center gap-2 mb-4">
        <Activity className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold text-foreground">Vue réseau — {period} derniers jours</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {/* Total questions */}
        <div>
          <div className="text-2xl font-bold text-foreground">
            {kpis.total_questions.toLocaleString('fr-FR')}
          </div>
          <div className="text-xs text-muted-foreground">questions</div>
          {pctChange !== null && (
            <div className={`text-xs font-medium mt-0.5 ${pctChange >= 0 ? 'text-green-600' : 'text-red-500'}`}>
              {pctChange >= 0 ? '+' : ''}{pctChange}% vs période préc.
            </div>
          )}
        </div>

        {/* Agences actives */}
        <div>
          <div className="text-2xl font-bold text-foreground">
            {kpis.active_agencies}
            <span className="text-sm font-normal text-muted-foreground">/{kpis.total_agencies}</span>
          </div>
          <div className="text-xs text-muted-foreground">agences actives ({pctActive}%)</div>
        </div>

        {/* Top thème */}
        <div>
          <div className="text-sm font-semibold text-foreground line-clamp-2 leading-tight">
            {kpis.top_theme ?? '—'}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            top thème{kpis.top_theme_count ? ` · ${kpis.top_theme_count} questions` : ''}
          </div>
        </div>

        {/* Alertes inactivité */}
        <div>
          <div className={`text-2xl font-bold ${kpis.inactive_count > 0 ? 'text-amber-500' : 'text-foreground'}`}>
            {kpis.inactive_count}
          </div>
          <div className="text-xs text-muted-foreground">
            {kpis.inactive_count > 0
              ? 'agences inactives +7j'
              : 'aucune alerte inactivité'}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Composant liste agences paginée (super_admin) ───────────────────────────

function AgencyList({ period }: { period: number }) {
  const router = useRouter()
  const [agencies, setAgencies] = useState<AgencyRow[]>([])
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState('questions')
  const [page, setPage] = useState(1)

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1) }, 350)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({
      page: String(page),
      filter,
      sort,
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
    })
    fetch(`/api/admin/analytics/agencies?${params}`)
      .then(r => r.json())
      .then(d => {
        if (!d.error) {
          setAgencies(d.agencies)
          setPagination(d.pagination)
        }
      })
      .finally(() => setLoading(false))
  }, [page, filter, sort, debouncedSearch])

  useEffect(() => { load() }, [load])

  // Reset page on filter/sort change
  const handleFilter = (v: string) => { setFilter(v); setPage(1) }
  const handleSort   = (v: string) => { setSort(v);   setPage(1) }

  const formatDate = (d: string | null) => {
    if (!d) return 'jamais'
    const dt = new Date(d)
    const diff = Math.floor((Date.now() - dt.getTime()) / 86400000)
    if (diff === 0) return "aujourd'hui"
    if (diff === 1) return 'hier'
    if (diff < 7) return `il y a ${diff}j`
    return dt.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
  }

  return (
    <div className="bg-card border border-border rounded-xl p-6 mb-8">
      <div className="flex items-center gap-2 mb-4">
        <Building2 className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">Activité par agence</h2>
        {pagination && (
          <span className="text-xs text-muted-foreground ml-auto">
            {pagination.totalCount} agence{pagination.totalCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Contrôles */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        {/* Recherche */}
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher une agence ou une ville…"
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {/* Filtre activité */}
        <select
          value={filter}
          onChange={e => handleFilter(e.target.value)}
          className="text-xs rounded-lg border border-border bg-background px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="all">Toutes</option>
          <option value="active">Actives (30j)</option>
          <option value="inactive">Inactives (+7j)</option>
        </select>

        {/* Tri */}
        <select
          value={sort}
          onChange={e => handleSort(e.target.value)}
          className="text-xs rounded-lg border border-border bg-background px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="questions">Tri : questions</option>
          <option value="activity">Tri : dernière activité</option>
          <option value="name">Tri : nom</option>
          <option value="city">Tri : ville</option>
        </select>
      </div>

      {/* Tableau */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-9 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : agencies.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-8">Aucune agence trouvée.</p>
      ) : (
        <div className="divide-y divide-border">
          {agencies.map(a => (
            <button
              key={a.agency_slug}
              onClick={() => router.push(`/analytics/agency/${a.agency_slug}`)}
              className="w-full flex items-center gap-3 py-2.5 hover:bg-muted/40 transition-colors rounded-sm px-1 text-left"
            >
              <div className="flex-1 min-w-0">
                <span className="text-xs font-medium text-foreground truncate block">{a.agency_name}</span>
                {a.city && <span className="text-xs text-muted-foreground">{a.city}</span>}
              </div>
              <span className="text-xs font-semibold text-foreground shrink-0">
                {a.question_count.toLocaleString('fr-FR')} q.
              </span>
              <span className="text-xs text-muted-foreground shrink-0 w-20 text-right">
                {formatDate(a.last_question)}
              </span>
              <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
            </button>
          ))}
        </div>
      )}

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="flex items-center gap-1 text-xs text-muted-foreground disabled:opacity-40 hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> Précédent
          </button>
          <span className="text-xs text-muted-foreground">
            Page {page} / {pagination.totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
            disabled={page === pagination.totalPages}
            className="flex items-center gap-1 text-xs text-muted-foreground disabled:opacity-40 hover:text-foreground transition-colors"
          >
            Suivant <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Page principale ─────────────────────────────────────────────────────────

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

  if (error) return (
    <div className="flex items-center justify-center h-screen">
      <p className="text-sm text-red-500">{error}</p>
    </div>
  )

  if (!data) return (
    <div className="flex items-center justify-center h-screen">
      <p className="text-sm text-muted-foreground">Chargement…</p>
    </div>
  )

  return (
    <div className="max-w-5xl mx-auto p-6 md:p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-bold text-foreground">Analytics</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Questions juridiques posées par les agents</p>
        </div>
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

      {/* Bannière réseau — super_admin uniquement */}
      {data.isAdmin && <NetworkBanner period={period} />}

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
            <span className="text-xs font-medium uppercase tracking-wide">
              {data.isAdmin ? 'Vue réseau' : 'Agences actives'}
            </span>
          </div>
          <div className="text-3xl font-bold text-foreground">
            {data.isAdmin ? '450' : '1'}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {data.isAdmin ? 'agences dans le réseau' : 'votre agence'}
          </p>
        </div>
      </div>

      {/* Pain points */}
      {data.painPoints.length > 0 && (
        <div className="bg-card border rounded-xl p-6 mb-8">
          <h2 className="text-lg font-semibold mb-2">Problématiques des agents</h2>
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
                      <div className="bg-primary h-full rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Questions récentes */}
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
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

        {/* Placeholder pour garder la grille si pas de top questions */}
        {data.topQuestions.length === 0 && <div />}
      </div>

      {/* Liste agences paginée — super_admin uniquement */}
      {data.isAdmin && <AgencyList period={period} />}

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
