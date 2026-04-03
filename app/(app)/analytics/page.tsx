'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Search, ChevronRight, ChevronLeft, TrendingUp, TrendingDown, Minus } from 'lucide-react'

// ─── Constantes ROI ──────────────────────────────────────────────────────────

const CALL_CENTER_COST_PER_AGENCY = 89  // €/mois — coût call center juridique
const NESTENN_COST_PER_AGENCY     = 40  // €/mois — coût Nestenn Juridique

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

interface WeekData {
  week_start: string
  week_offset: number
  count: number
}

interface PainPointDetail {
  theme: string
  by_agency: Array<{ agency_name: string; agency_slug: string; cnt: number }>
  recent: Array<{ preview: string; created_at: string; agency_name: string }>
}

interface InactiveAgency {
  agency_name: string
  agency_slug: string
  city: string | null
  email: string | null
  last_question: string | null
  days_inactive: number | null
}

interface AnalyticsData {
  period: number
  totalQuestions: number
  painPoints: Array<{ domain: string; sub_domain: string; question_count: number }>
  recentQuestions: Array<{ question_preview: string; sub_domain: string | null; domain: string | null; created_at: string }>
  topQuestions: Array<{ domain: string; question_preview: string; ask_count: number }>
  isAdmin: boolean
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

function useCountUp(target: number, delay = 0, duration = 1400) {
  const [value, setValue] = useState(0)
  const ref = useRef(target)
  ref.current = target

  useEffect(() => {
    if (!target) { setValue(0); return }
    const timer = setTimeout(() => {
      const start = performance.now()
      const animate = (now: number) => {
        const t = Math.min((now - start) / duration, 1)
        const eased = 1 - Math.pow(1 - t, 4) // ease-out-quart
        setValue(Math.round(eased * ref.current))
        if (t < 1) requestAnimationFrame(animate)
      }
      requestAnimationFrame(animate)
    }, delay)
    return () => clearTimeout(timer)
  }, [target, delay, duration])

  return value
}

// ─── Utilitaires ─────────────────────────────────────────────────────────────

function getPainEmoji(theme: string): string {
  const t = theme.toLowerCase()
  if (t.includes('impay') || t.includes('expuls') || t.includes('loyer')) return '🔥'
  if (t.includes('diagnos') || t.includes('dpe') || t.includes('énerg')) return '📋'
  if (t.includes('mandat') || t.includes('commis') || t.includes('exclus')) return '🏠'
  if (t.includes('vice') || t.includes('caché') || t.includes('garanti')) return '⚖️'
  if (t.includes('dépôt') || t.includes('caution') || t.includes('restitut')) return '🔑'
  if (t.includes('copro') || t.includes('syndic') || t.includes('charge')) return '🏢'
  if (t.includes('travaux') || t.includes('rénov')) return '🔨'
  if (t.includes('bail') || t.includes('location') || t.includes('locataire')) return '🔐'
  if (t.includes('vente') || t.includes('compromis') || t.includes('promesse')) return '📝'
  if (t.includes('assur')) return '🛡️'
  if (t.includes('préavis') || t.includes('congé')) return '📬'
  return '💬'
}

function getAgencyStatus(lastQuestion: string | null): {
  dot: string; label: string; days: number | null
} {
  if (!lastQuestion) return { dot: '#94a3b8', label: 'Jamais utilisé', days: null }
  const days = Math.floor((Date.now() - new Date(lastQuestion).getTime()) / 86400000)
  if (days < 7)  return { dot: '#22c55e', label: `il y a ${days === 0 ? "aujourd'hui" : days + 'j'}`, days }
  if (days < 14) return { dot: '#f59e0b', label: `il y a ${days}j`, days }
  return { dot: '#ef4444', label: `il y a ${days}j`, days }
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function pct(a: number, b: number) { return b > 0 ? Math.round((a / b) * 100) : 0 }

// ─── Sparkline activité ────────────────────────────────────────────────────

function ActivitySparkline({ data }: { data: Array<{ day: string; cnt: number }> }) {
  const days: Array<{ day: string; cnt: number }> = []
  for (let i = 29; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    const found = data.find(r => r.day.slice(0, 10) === key)
    days.push({ day: key, cnt: found?.cnt ?? 0 })
  }
  const max = Math.max(...days.map(d => d.cnt), 1)
  const total = days.reduce((s, d) => s + d.cnt, 0)

  // Étiquettes abscisses : J-29, J-14, aujourd'hui
  const xLabels = [
    { idx: 0,  label: days[0].day.slice(5).replace('-', '/') },
    { idx: 14, label: days[14].day.slice(5).replace('-', '/') },
    { idx: 29, label: "auj." },
  ]

  return (
    <div>
      {/* Ordonnée max + total */}
      <div className="flex justify-between items-baseline mb-1">
        <span className="text-[10px] text-muted-foreground">
          max {max} q/j
        </span>
        <span className="text-[10px] text-muted-foreground">
          {total.toLocaleString('fr-FR')} questions sur 30j
        </span>
      </div>

      {/* Barres */}
      <div className="relative">
        <div className="flex items-end gap-0.5 h-14">
          {days.map((d, i) => (
            <div
              key={i}
              title={`${d.day.slice(5).replace('-', '/')} : ${d.cnt} question${d.cnt !== 1 ? 's' : ''}`}
              className="flex-1 rounded-sm cursor-default transition-colors"
              style={{
                height: `${Math.max((d.cnt / max) * 100, d.cnt > 0 ? 8 : 2)}%`,
                backgroundColor: d.cnt > 0
                  ? `hsl(185 100% 37% / ${0.25 + (d.cnt / max) * 0.75})`
                  : 'hsl(var(--muted))',
              }}
            />
          ))}
        </div>

        {/* Abscisses */}
        <div className="relative h-4 mt-1">
          {xLabels.map(({ idx, label }) => (
            <span
              key={idx}
              className="absolute text-[10px] text-muted-foreground -translate-x-1/2"
              style={{ left: `${(idx / 29) * 100}%` }}
            >
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Section 01 — Santé réseau ───────────────────────────────────────────────

function NetworkBanner({ period }: { period: number }) {
  const [kpis, setKpis]                   = useState<NetworkKPIs | null>(null)
  const [showInactive, setShowInactive]   = useState(false)
  const [inactiveAgencies, setInactiveA]  = useState<InactiveAgency[] | null>(null)
  const [networkActivity, setNetActivity] = useState<Array<{ day: string; cnt: number }>>([])

  useEffect(() => {
    fetch(`/api/admin/analytics/network?period=${period}`)
      .then(r => r.json()).then(d => { if (!d.error) setKpis(d) })
  }, [period])

  useEffect(() => {
    fetch('/api/admin/analytics/network-activity')
      .then(r => r.json()).then(d => { if (Array.isArray(d)) setNetActivity(d) })
  }, [])

  const handleInactiveClick = () => {
    setShowInactive(v => !v)
    if (!inactiveAgencies) {
      fetch('/api/admin/analytics/inactive-agencies')
        .then(r => r.json())
        .then(d => { if (Array.isArray(d)) setInactiveA(d) })
    }
  }

  const totalQ    = useCountUp(kpis?.total_questions ?? 0, 100)
  const activeA   = useCountUp(kpis?.active_agencies ?? 0, 200)
  const inactiveC = useCountUp(kpis?.inactive_count ?? 0, 300)

  const pctChange = kpis && kpis.prev_total_questions > 0
    ? Math.round(((kpis.total_questions - kpis.prev_total_questions) / kpis.prev_total_questions) * 100)
    : null

  const savingsMonthly = kpis
    ? kpis.active_agencies * (CALL_CENTER_COST_PER_AGENCY - NESTENN_COST_PER_AGENCY)
    : 0
  const savingsYearly  = savingsMonthly * 12
  const savingsUp      = useCountUp(savingsMonthly, 500)
  const pctActive      = kpis ? pct(kpis.active_agencies, kpis.total_agencies) : 0

  if (!kpis) return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden mb-8 animate-pulse">
      <div className="h-36" />
    </div>
  )

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden mb-8">
      {/* Bande supérieure — 4 KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-border">

        {/* Total questions */}
        <div className="p-6 relative">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-3">
            Questions ce mois
          </div>
          <div
            className="text-5xl font-bold leading-none mb-1"
            style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontVariantNumeric: 'tabular-nums' }}
          >
            {totalQ.toLocaleString('fr-FR')}
          </div>
          {pctChange !== null && (
            <div className={`flex items-center gap-1 text-xs font-medium mt-2 ${pctChange >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
              {pctChange > 0 ? <TrendingUp className="h-3 w-3" /> : pctChange < 0 ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
              {pctChange > 0 ? '+' : ''}{pctChange}% vs période préc.
            </div>
          )}
        </div>

        {/* Agences actives */}
        <div className="p-6">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-3">
            Agences actives
          </div>
          <div
            className="text-5xl font-bold leading-none mb-1"
            style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontVariantNumeric: 'tabular-nums' }}
          >
            {activeA}
            <span className="text-2xl text-muted-foreground font-normal">/{kpis.total_agencies}</span>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <div className="flex-1 bg-muted rounded-full h-1.5">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all duration-1000"
                style={{ width: `${pctActive}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground font-medium">{pctActive}%</span>
          </div>
        </div>

        {/* Top thème */}
        <div className="p-6">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-3">
            Top thème
          </div>
          <div className="text-lg font-bold leading-tight text-foreground line-clamp-2">
            {kpis.top_theme ? (
              <>
                <span className="mr-1.5">{getPainEmoji(kpis.top_theme)}</span>
                {kpis.top_theme}
              </>
            ) : '—'}
          </div>
          {kpis.top_theme_count > 0 && (
            <div className="text-xs text-muted-foreground mt-2">
              {kpis.top_theme_count.toLocaleString('fr-FR')} questions
              {kpis.total_questions > 0 && (
                <span className="ml-1 text-primary font-medium">
                  ({pct(kpis.top_theme_count, kpis.total_questions)}%)
                </span>
              )}
            </div>
          )}
        </div>

        {/* Alertes inactivité — cliquable */}
        <div className="p-6">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-3">
            Alertes inactivité
          </div>
          <button
            onClick={kpis.inactive_count > 0 ? handleInactiveClick : undefined}
            className={`text-left ${kpis.inactive_count > 0 ? 'cursor-pointer group' : 'cursor-default'}`}
          >
            <div
              className={`text-5xl font-bold leading-none mb-1 transition-colors ${
                inactiveC > 0
                  ? 'text-red-500 group-hover:text-red-600'
                  : 'text-foreground'
              }`}
              style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontVariantNumeric: 'tabular-nums' }}
            >
              {inactiveC}
            </div>
            <div className="text-xs mt-2">
              {kpis.inactive_count > 0 ? (
                <span className="text-red-500 underline underline-offset-2 decoration-dotted">
                  agence{kpis.inactive_count > 1 ? 's' : ''} sans activité depuis 7j+
                </span>
              ) : (
                <span className="text-muted-foreground">aucune alerte</span>
              )}
            </div>
          </button>
        </div>
      </div>

      {/* Sparkline réseau — 30 derniers jours */}
      <div className="border-t border-border px-6 py-4">
        <div className="text-xs text-muted-foreground mb-2">Activité réseau — 30 derniers jours</div>
        {networkActivity.length > 0
          ? <ActivitySparkline data={networkActivity} />
          : <div className="h-12 flex items-center">
              <div className="flex items-end gap-0.5 h-12 w-full">
                {Array.from({ length: 30 }).map((_, i) => (
                  <div key={i} className="flex-1 rounded-sm bg-muted" style={{ height: '2%' }} />
                ))}
              </div>
            </div>
        }
      </div>

      {/* Panel agences inactives */}
      {showInactive && (
        <div className="border-t border-border bg-red-50/50 dark:bg-red-950/10">
          <div className="px-6 py-3 flex items-center justify-between">
            <span className="text-xs font-semibold text-red-700 dark:text-red-400 uppercase tracking-wider">
              Agences inactives
            </span>
            <button
              onClick={() => setShowInactive(false)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Fermer ✕
            </button>
          </div>
          {!inactiveAgencies ? (
            <div className="px-6 pb-4 text-xs text-muted-foreground">Chargement…</div>
          ) : inactiveAgencies.length === 0 ? (
            <div className="px-6 pb-4 text-xs text-muted-foreground">Aucune agence inactive.</div>
          ) : (
            <div className="divide-y divide-border/50">
              {inactiveAgencies.map((a, i) => (
                <div key={i} className="flex items-center gap-4 px-6 py-2.5">
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium text-foreground truncate block">{a.agency_name}</span>
                    {a.city && <span className="text-xs text-muted-foreground">{a.city}</span>}
                  </div>
                  <span className="text-xs text-red-500 shrink-0">
                    {a.days_inactive != null
                      ? `inactif depuis ${a.days_inactive}j`
                      : 'jamais connecté'}
                  </span>
                  {a.email ? (
                    <a
                      href={`mailto:${a.email}`}
                      className="text-xs px-2.5 py-1 rounded-lg border border-border bg-background hover:bg-muted transition-colors shrink-0"
                      onClick={e => e.stopPropagation()}
                    >
                      Contacter
                    </a>
                  ) : (
                    <span className="text-xs text-muted-foreground shrink-0 w-[72px]" />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Bande ROI — économie réseau */}
      <div className="border-t border-border bg-emerald-50 dark:bg-emerald-950/20 px-6 py-3 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs text-emerald-700 dark:text-emerald-400 font-medium uppercase tracking-wider">
            Économie réseau vs call center
          </span>
          <span
            className="text-xl font-bold text-emerald-700 dark:text-emerald-400"
            style={{ fontFamily: "'Source Serif 4', Georgia, serif" }}
          >
            {savingsUp.toLocaleString('fr-FR')} €/mois
          </span>
        </div>
        <div className="ml-auto text-xs text-emerald-600 dark:text-emerald-500 font-medium hidden sm:block">
          soit {savingsYearly.toLocaleString('fr-FR')} €/an
        </div>
      </div>
    </div>
  )
}

// ─── Section 02 — Problématiques terrain ─────────────────────────────────────

function PainPointsSection({
  painPoints, period, totalQuestions,
}: {
  painPoints: Array<{ domain: string; sub_domain: string; question_count: number }>
  period: number
  totalQuestions: number
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<PainPointDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  const handleClick = useCallback((theme: string) => {
    if (selected === theme) { setSelected(null); setDetail(null); return }
    setSelected(theme)
    setDetail(null)
    setLoadingDetail(true)
    fetch(`/api/admin/analytics/painpoint?theme=${encodeURIComponent(theme)}&period=${period}`)
      .then(r => r.json())
      .then(d => { if (!d.error) setDetail(d) })
      .finally(() => setLoadingDetail(false))
  }, [selected, period])

  const max = painPoints[0]?.question_count ?? 1
  const topPct = totalQuestions > 0 && painPoints[0]
    ? pct(painPoints[0].question_count, totalQuestions)
    : 0

  function generateSuggestion(theme: string, sharePct: number): string | null {
    if (sharePct < 10) return null
    const t = theme.toLowerCase()
    const suggestions: Array<[string, string]> = [
      ['impay',    `Les impayés représentent ${sharePct}% des questions. Envisagez une formation réseau sur la procédure d'expulsion et la clause résolutoire.`],
      ['expuls',   `L'expulsion est le sujet n°1 de vos agents (${sharePct}%). Un webinaire sur la procédure complète (commandement → tribunal → trêve hivernale) réduirait la charge.`],
      ['dpe',      `Le DPE et la performance énergétique concernent ${sharePct}% des questions. Avec le calendrier Climat-Résilience (F interdit en 2028), une note réseau serait utile.`],
      ['diagnos',  `Les diagnostics représentent ${sharePct}% des demandes. Vérifiez que vos agences ont un partenaire diagnostiqueur fiable et à jour.`],
      ['mandat',   `${sharePct}% des questions portent sur les mandats. Un rappel réseau sur la durée irrévocable (3 mois max) et les clauses essentielles éviterait des litiges.`],
      ['copro',    `La copropriété génère ${sharePct}% des questions. Les charges et l'AG sont les sujets récurrents — une fiche pratique réseau serait pertinente.`],
      ['vice',     `Les vices cachés représentent ${sharePct}% des questions. Rappelez à vos agents l'importance du DDT complet et de la transparence vendeur.`],
      ['dépôt',    `Le dépôt de garantie concentre ${sharePct}% des demandes. Un modèle de lettre de restitution standardisé pour le réseau limiterait les litiges.`],
      ['sous-loc', `La sous-location (dont Airbnb) génère ${sharePct}% des questions — sujet en forte hausse. Une note réseau sur les règles applicables serait opportune.`],
      ['préempt',  `Le droit de préemption représente ${sharePct}% des questions. Un rappel sur les délais et les options du vendeur aiderait vos agents.`],
    ]
    for (const [key, text] of suggestions) {
      if (t.includes(key)) return text
    }
    return `Le thème "${theme}" représente ${sharePct}% des questions de vos agents ce mois. C'est un sujet de formation prioritaire.`
  }

  const suggestion = topPct >= 10 && painPoints[0]
    ? generateSuggestion(painPoints[0].sub_domain, topPct)
    : null

  const now = new Date()
  const monthName = now.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })

  return (
    <section className="mb-8">
      {/* En-tête section */}
      <div className="flex items-end justify-between mb-5">
        <div className="flex items-end gap-3">
          <span
            className="text-6xl font-bold text-border leading-none select-none"
            style={{ fontFamily: "'Source Serif 4', Georgia, serif" }}
            aria-hidden
          >02</span>
          <div>
            <h2 className="text-base font-semibold text-foreground">Ce que vos agents demandent</h2>
            <p className="text-xs text-muted-foreground capitalize">{monthName}</p>
          </div>
        </div>
        <span className="text-xs text-muted-foreground hidden sm:block">Cliquez pour explorer</span>
      </div>

      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        {painPoints.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Aucun pain point sur cette période.</div>
        ) : (
          <div className="divide-y divide-border">
            {painPoints.slice(0, 10).map((p, i) => {
              const barPct = (p.question_count / max) * 100
              const sharePct = pct(p.question_count, totalQuestions)
              const isOpen = selected === p.sub_domain

              return (
                <div key={i}>
                  <button
                    onClick={() => handleClick(p.sub_domain)}
                    className={`w-full text-left px-5 py-4 transition-colors ${isOpen ? 'bg-primary/5' : 'hover:bg-muted/40'}`}
                  >
                    <div className="flex items-center gap-4">
                      {/* Emoji + Rank */}
                      <div className="flex items-center gap-2 w-8 shrink-0">
                        <span className="text-lg leading-none">{getPainEmoji(p.sub_domain)}</span>
                      </div>

                      {/* Label + barre */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className={`text-sm font-medium ${isOpen ? 'text-primary' : 'text-foreground'}`}>
                            {p.sub_domain}
                          </span>
                          <div className="flex items-center gap-3 shrink-0 ml-4">
                            {sharePct >= 15 && (
                              <span className="text-xs bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 px-1.5 py-0.5 rounded font-medium">
                                {sharePct}%
                              </span>
                            )}
                            <span
                              className="text-sm font-bold text-foreground tabular-nums"
                              style={{ fontFamily: "'Source Serif 4', Georgia, serif" }}
                            >
                              {p.question_count}
                            </span>
                            <ChevronRight
                              className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isOpen ? 'rotate-90' : ''}`}
                            />
                          </div>
                        </div>
                        <div className="bg-muted rounded-full h-1.5 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary transition-all duration-700"
                            style={{
                              width: `${barPct}%`,
                              animationDelay: `${i * 80}ms`,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </button>

                  {/* Panel détail pain point */}
                  {isOpen && (
                    <div className="border-t border-border bg-muted/30 px-5 py-4 animate-fade-in">
                      {loadingDetail ? (
                        <div className="text-xs text-muted-foreground py-2">Chargement…</div>
                      ) : detail ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                          {/* Agences concernées */}
                          <div>
                            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                              Top agences
                            </div>
                            <div className="space-y-1.5">
                              {detail.by_agency.slice(0, 6).map((a, j) => (
                                <div key={j} className="flex items-center gap-2">
                                  <span className="text-xs text-foreground flex-1 truncate">{a.agency_name}</span>
                                  <span className="text-xs font-semibold tabular-nums text-muted-foreground shrink-0">
                                    {a.cnt}
                                  </span>
                                  <div className="w-16 bg-border rounded-full h-1">
                                    <div
                                      className="bg-primary h-full rounded-full"
                                      style={{ width: `${(a.cnt / (detail.by_agency[0]?.cnt ?? 1)) * 100}%` }}
                                    />
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                          {/* Questions récentes */}
                          <div>
                            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                              Questions récentes
                            </div>
                            <div className="space-y-2">
                              {detail.recent.slice(0, 5).map((r, j) => (
                                <div key={j} className="text-xs text-foreground/80 leading-relaxed">
                                  <span className="text-muted-foreground mr-1.5">•</span>
                                  <span className="italic">{r.preview}</span>
                                  <span className="text-muted-foreground ml-1.5 not-italic">
                                    — {r.agency_name}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground">Aucune donnée disponible.</div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Suggestion automatique */}
        {suggestion && (
          <div className="border-t border-border bg-primary/5 px-5 py-3 flex items-start gap-2.5">
            <span className="text-base mt-0.5">💡</span>
            <p className="text-xs text-foreground/80 leading-relaxed">{suggestion}</p>
          </div>
        )}
      </div>
    </section>
  )
}

// ─── Section 03 — Classement agences ─────────────────────────────────────────

function AgencyRanking({ period }: { period: number }) {
  const router = useRouter()
  const [agencies, setAgencies] = useState<AgencyRow[]>([])
  const [pagination, setPagination] = useState<{ page: number; totalPages: number; totalCount: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [filter, setFilter]   = useState('all')
  const [sort, setSort]       = useState('questions')
  const [page, setPage]       = useState(1)

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1) }, 350)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(() => {
    setLoading(true)
    const p = new URLSearchParams({ page: String(page), filter, sort, ...(debouncedSearch ? { search: debouncedSearch } : {}) })
    fetch(`/api/admin/analytics/agencies?${p}`)
      .then(r => r.json())
      .then(d => { if (!d.error) { setAgencies(d.agencies); setPagination(d.pagination) } })
      .finally(() => setLoading(false))
  }, [page, filter, sort, debouncedSearch])

  useEffect(() => { load() }, [load])

  return (
    <section className="mb-8">
      <div className="flex items-end justify-between mb-5">
        <div className="flex items-end gap-3">
          <span
            className="text-6xl font-bold text-border leading-none select-none"
            style={{ fontFamily: "'Source Serif 4', Georgia, serif" }}
            aria-hidden
          >03</span>
          <div>
            <h2 className="text-base font-semibold text-foreground">Classement des agences</h2>
            {pagination && <p className="text-xs text-muted-foreground">{pagination.totalCount} agences</p>}
          </div>
        </div>
        {agencies.length > 0 && (
          <button
            onClick={() => {
              const header = 'Agence,Ville,Questions,Dernière activité\n'
              const rows = agencies.map(a =>
                `"${a.agency_name}","${a.city ?? ''}",${a.question_count},"${a.last_question ? new Date(a.last_question).toLocaleDateString('fr-FR') : 'Jamais'}"`
              ).join('\n')
              const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' })
              const url = URL.createObjectURL(blob)
              const link = document.createElement('a')
              link.href = url
              link.download = `nestenn-agences-${new Date().toISOString().slice(0, 10)}.csv`
              link.click()
              URL.revokeObjectURL(url)
            }}
            className="text-xs px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-muted transition-colors flex items-center gap-1.5"
          >
            <span>↓</span> Exporter CSV
          </button>
        )}
      </div>

      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        {/* Contrôles */}
        <div className="flex flex-col sm:flex-row gap-2 p-4 border-b border-border">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher une agence ou une ville…"
              className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <select
            value={filter}
            onChange={e => { setFilter(e.target.value); setPage(1) }}
            className="text-xs rounded-lg border border-border bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="all">Toutes</option>
            <option value="active">Actives (&lt; 7j)</option>
            <option value="inactive">Inactives (+ 7j)</option>
          </select>
          <select
            value={sort}
            onChange={e => { setSort(e.target.value); setPage(1) }}
            className="text-xs rounded-lg border border-border bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="questions">Trier : questions</option>
            <option value="activity">Trier : activité récente</option>
            <option value="name">Trier : nom</option>
            <option value="city">Trier : ville</option>
          </select>
        </div>

        {/* Légende statuts */}
        <div className="flex items-center gap-4 px-4 py-2 border-b border-border bg-muted/30 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Actif (&lt; 7j)</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Peu actif (7–14j)</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> Inactif (14j+)</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-slate-300 inline-block" /> Jamais utilisé</span>
        </div>

        {/* Liste */}
        {loading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-10 rounded-lg bg-muted animate-pulse" />
            ))}
          </div>
        ) : agencies.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-10">Aucune agence trouvée.</p>
        ) : (
          <div className="divide-y divide-border">
            {agencies.map((a, i) => {
              const status = getAgencyStatus(a.last_question)
              const rank = (page - 1) * 20 + i + 1
              return (
                <button
                  key={a.agency_slug}
                  onClick={() => router.push(`/analytics/agency/${a.agency_slug}`)}
                  className="w-full flex items-center gap-4 px-4 py-3 hover:bg-muted/40 transition-colors text-left group"
                >
                  {/* Rang */}
                  <span
                    className="text-xs font-bold text-muted-foreground tabular-nums w-6 shrink-0 text-right"
                    style={{ fontFamily: "'Source Serif 4', Georgia, serif" }}
                  >
                    {rank}
                  </span>

                  {/* Statut dot */}
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: status.dot }}
                  />

                  {/* Nom + ville */}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-foreground truncate group-hover:text-primary transition-colors">
                      {a.agency_name}
                    </div>
                    {a.city && <div className="text-xs text-muted-foreground">{a.city}</div>}
                  </div>

                  {/* Questions */}
                  <span
                    className="text-sm font-bold text-foreground tabular-nums shrink-0"
                    style={{ fontFamily: "'Source Serif 4', Georgia, serif" }}
                  >
                    {a.question_count.toLocaleString('fr-FR')}
                    <span className="text-xs font-normal text-muted-foreground ml-0.5">q.</span>
                  </span>

                  {/* Dernière activité */}
                  <span className="text-xs text-muted-foreground w-24 text-right shrink-0 hidden sm:block">
                    {status.label}
                  </span>

                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              )
            })}
          </div>
        )}

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="flex items-center gap-1 text-xs text-muted-foreground disabled:opacity-40 hover:text-foreground transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Précédent
            </button>
            <span className="text-xs text-muted-foreground">Page {page} / {pagination.totalPages}</span>
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
    </section>
  )
}

// ─── Section 04 — Tendances ───────────────────────────────────────────────────

function WeeklyTrends() {
  const [weeks, setWeeks] = useState<WeekData[]>([])

  useEffect(() => {
    fetch('/api/admin/analytics/trends?weeks=5')
      .then(r => r.json())
      .then(d => { if (!d.error) setWeeks(d.weeks ?? []) })
  }, [])

  const data = weeks.filter((_, i) => i > 0) // Exclure la semaine en cours (partielle)
  const max = Math.max(...data.map(w => w.count), 1)

  const getGrowthLabel = (cur: number, prev: number) => {
    if (!prev) return null
    const g = Math.round(((cur - prev) / prev) * 100)
    return { value: g, label: `${g > 0 ? '+' : ''}${g}%` }
  }

  const lastWeek = data[data.length - 1]
  const firstWeek = data[0]
  const overallGrowth = firstWeek && lastWeek && firstWeek.count > 0
    ? Math.round(((lastWeek.count - firstWeek.count) / firstWeek.count) * 100)
    : null

  const weekLabel = (w: WeekData, i: number) => {
    const d = new Date(w.week_start)
    return `Sem ${i + 1} · ${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`
  }

  return (
    <section className="mb-8">
      <div className="flex items-end justify-between mb-5">
        <div className="flex items-end gap-3">
          <span
            className="text-6xl font-bold text-border leading-none select-none"
            style={{ fontFamily: "'Source Serif 4', Georgia, serif" }}
            aria-hidden
          >04</span>
          <div>
            <h2 className="text-base font-semibold text-foreground">Tendances</h2>
            <p className="text-xs text-muted-foreground">Évolution semaine par semaine</p>
          </div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-2xl p-6">
        {data.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-6">Données insuffisantes.</div>
        ) : (
          <>
            <div className="space-y-3">
              {data.map((w, i) => {
                const prev = data[i - 1]
                const growth = prev ? getGrowthLabel(w.count, prev.count) : null
                const barWidth = (w.count / max) * 100

                return (
                  <div key={i} className="flex items-center gap-4">
                    {/* Label semaine */}
                    <div className="text-xs text-muted-foreground w-32 shrink-0">
                      {weekLabel(w, i)}
                    </div>

                    {/* Barre */}
                    <div className="flex-1 bg-muted rounded-full h-5 overflow-hidden relative">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-700 flex items-center justify-end pr-2"
                        style={{
                          width: `${barWidth}%`,
                          animationDelay: `${i * 100}ms`,
                          minWidth: w.count > 0 ? '2.5rem' : '0',
                        }}
                      />
                    </div>

                    {/* Valeur + croissance */}
                    <div className="flex items-center gap-2 w-24 justify-end shrink-0">
                      <span
                        className="text-sm font-bold tabular-nums text-foreground"
                        style={{ fontFamily: "'Source Serif 4', Georgia, serif" }}
                      >
                        {w.count.toLocaleString('fr-FR')}
                      </span>
                      {growth && (
                        <span className={`text-xs font-medium ${growth.value > 0 ? 'text-emerald-600' : growth.value < 0 ? 'text-red-500' : 'text-muted-foreground'}`}>
                          {growth.label}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Résumé */}
            {overallGrowth !== null && (
              <div className="mt-5 pt-4 border-t border-border flex items-center gap-2 text-xs">
                <span className="text-base">
                  {overallGrowth > 5 ? '📈' : overallGrowth < -5 ? '📉' : '➡️'}
                </span>
                <span className="text-foreground/80">
                  {overallGrowth > 0
                    ? `Adoption en croissance sur la période (+${overallGrowth}%)`
                    : overallGrowth < 0
                    ? `Légère baisse sur la période (${overallGrowth}%)`
                    : `Activité stable sur la période`}
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}

// ─── Vue agence manager (non-admin) ──────────────────────────────────────────

function AgencyManagerView({ data }: { data: AnalyticsData }) {
  const max = data.painPoints[0]?.question_count ?? 1

  return (
    <div>
      <div className="grid grid-cols-2 gap-4 mb-8">
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Questions</div>
          <div
            className="text-4xl font-bold"
            style={{ fontFamily: "'Source Serif 4', Georgia, serif" }}
          >
            {data.totalQuestions.toLocaleString('fr-FR')}
          </div>
          <p className="text-xs text-muted-foreground mt-1">sur {data.period} jours</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Thèmes identifiés</div>
          <div
            className="text-4xl font-bold"
            style={{ fontFamily: "'Source Serif 4', Georgia, serif" }}
          >
            {data.painPoints.length}
          </div>
          <p className="text-xs text-muted-foreground mt-1">pain points distincts</p>
        </div>
      </div>

      {data.painPoints.length > 0 && (
        <div className="bg-card border border-border rounded-2xl overflow-hidden mb-8">
          <div className="px-5 py-4 border-b border-border">
            <h2 className="text-sm font-semibold">Ce que vos agents demandent</h2>
          </div>
          <div className="divide-y divide-border">
            {data.painPoints.slice(0, 15).map((p, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-3">
                <span className="text-base">{getPainEmoji(p.sub_domain)}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-foreground mb-1 truncate">{p.sub_domain}</div>
                  <div className="bg-muted rounded-full h-1.5">
                    <div
                      className="bg-primary h-full rounded-full"
                      style={{ width: `${(p.question_count / max) * 100}%` }}
                    />
                  </div>
                </div>
                <span className="text-sm font-bold tabular-nums shrink-0" style={{ fontFamily: "'Source Serif 4', Georgia, serif" }}>
                  {p.question_count}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.recentQuestions.length > 0 && (
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <h2 className="text-sm font-semibold">Questions récentes</h2>
          </div>
          <div className="divide-y divide-border">
            {data.recentQuestions.slice(0, 12).map((q, i) => (
              <div key={i} className="flex items-center gap-3 px-5 py-3">
                <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded min-w-[140px] text-center truncate">
                  {q.sub_domain ?? 'Non classé'}
                </span>
                <span className="flex-1 text-xs truncate text-foreground/80">{q.question_preview}</span>
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

// ─── Page principale ──────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const [data, setData]     = useState<AnalyticsData | null>(null)
  const [period, setPeriod] = useState(30)
  const [error, setError]   = useState<string | null>(null)

  useEffect(() => {
    setData(null); setError(null)
    fetch(`/api/admin/analytics?period=${period}`)
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setData(d) })
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
      {/* En-tête */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1
            className="text-2xl font-bold text-foreground"
            style={{ fontFamily: "'Source Serif 4', Georgia, serif" }}
          >
            {data.isAdmin ? 'Tableau de bord réseau' : 'Analytics'}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {data.isAdmin ? 'Vue directeur réseau Nestenn' : 'Questions juridiques de votre agence'}
          </p>
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

      {data.isAdmin ? (
        <>
          {/* Section 01 */}
          <NetworkBanner period={period} />

          {/* Section 02 */}
          {data.painPoints.length > 0 && (
            <PainPointsSection
              painPoints={data.painPoints}
              period={period}
              totalQuestions={data.totalQuestions}
            />
          )}

          {/* Section 03 */}
          <AgencyRanking period={period} />

          {/* Section 04 */}
          <WeeklyTrends />
        </>
      ) : (
        <AgencyManagerView data={data} />
      )}
    </div>
  )
}
