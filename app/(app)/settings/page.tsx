'use client'

import { useState, useEffect, useCallback, type FormEvent } from 'react'
import {
  Settings as SettingsIcon,
  User as UserIcon,
  Mail,
  Shield,
  Sparkles,
  CheckCircle2,
  Loader2,
  AlertCircle,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { AVAILABLE_MODELS, DEFAULT_MODEL_ID } from '@/lib/model-config'

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  responsable_agence: "Responsable d'agence",
  conseiller: 'Conseiller',
}

const MODEL_PREF_KEY = 'nestenn:default-model-id'

interface ProfileData {
  id: string
  email: string
  full_name: string | null
  role: string
  can_switch_model: boolean
}

type Status =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string }

export default function SettingsPage() {
  const supabase = createClient()
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [fullName, setFullName] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [preferredModel, setPreferredModel] = useState<string>(DEFAULT_MODEL_ID)
  const [modelSavedAt, setModelSavedAt] = useState<number | null>(null)

  // Charge le profil
  const loadProfile = useCallback(async () => {
    setLoading(true)
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError || !user) {
        setStatus({ kind: 'error', message: 'Session expirée. Veuillez vous reconnecter.' })
        return
      }
      const { data, error } = await supabase
        .from('users')
        .select('full_name, role, can_switch_model')
        .eq('id', user.id)
        .single()
      if (error || !data) {
        setStatus({ kind: 'error', message: 'Impossible de charger le profil.' })
        return
      }
      const next: ProfileData = {
        id: user.id,
        email: user.email ?? '',
        full_name: data.full_name,
        role: data.role,
        can_switch_model: data.can_switch_model ?? false,
      }
      setProfile(next)
      setFullName(data.full_name ?? '')
    } finally {
      setLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    void loadProfile()
  }, [loadProfile])

  // Charge la préférence modèle depuis localStorage
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(MODEL_PREF_KEY)
      if (stored && AVAILABLE_MODELS.some(m => m.id === stored)) {
        setPreferredModel(stored)
      }
    } catch { /* localStorage indisponible */ }
  }, [])

  async function handleProfileSubmit(e: FormEvent) {
    e.preventDefault()
    if (!profile) return
    const trimmed = fullName.trim()
    if (trimmed === (profile.full_name ?? '')) {
      setStatus({ kind: 'success', message: 'Aucune modification à enregistrer.' })
      return
    }
    setStatus({ kind: 'saving' })
    const { error } = await supabase
      .from('users')
      .update({ full_name: trimmed || null })
      .eq('id', profile.id)
    if (error) {
      setStatus({ kind: 'error', message: `Erreur : ${error.message}` })
      return
    }
    setProfile({ ...profile, full_name: trimmed || null })
    setStatus({ kind: 'success', message: 'Profil mis à jour.' })
  }

  function handleModelChange(modelId: string) {
    setPreferredModel(modelId)
    try {
      window.localStorage.setItem(MODEL_PREF_KEY, modelId)
      setModelSavedAt(Date.now())
    } catch { /* localStorage indisponible */ }
  }

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] md:min-h-screen bg-nestenn-light">
        <div className="max-w-3xl mx-auto px-4 md:px-6 py-8 md:py-12">
          <div className="h-8 w-48 bg-slate-200 rounded animate-pulse mb-8" />
          <div className="space-y-6">
            <div className="h-64 bg-white rounded-2xl shadow-sm animate-pulse" />
            <div className="h-48 bg-white rounded-2xl shadow-sm animate-pulse" />
          </div>
        </div>
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] md:min-h-screen bg-nestenn-light flex items-center justify-center">
        <div className="text-center max-w-sm px-6">
          <AlertCircle className="h-10 w-10 text-status-warning mx-auto mb-3" />
          <p className="text-sm text-foreground/70">
            {status.kind === 'error' ? status.message : 'Profil indisponible.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-[calc(100vh-3.5rem)] md:min-h-screen bg-nestenn-light">
      <div className="max-w-3xl mx-auto px-4 md:px-6 py-8 md:py-12">
        {/* ── Header ── */}
        <header className="mb-8 flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-nestenn-cyan/10 flex items-center justify-center">
            <SettingsIcon className="h-5 w-5 text-nestenn-cyan" />
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-nestenn-dark tracking-tight">Paramètres</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Gérez votre profil et vos préférences IA</p>
          </div>
        </header>

        {/* ── Toast statut global ── */}
        {(status.kind === 'success' || status.kind === 'error') && (
          <div
            className={`mb-6 flex items-center gap-2 px-4 py-3 rounded-lg text-sm border ${
              status.kind === 'success'
                ? 'bg-green-50 border-green-200 text-green-800'
                : 'bg-red-50 border-red-200 text-red-800'
            }`}
            role="status"
          >
            {status.kind === 'success'
              ? <CheckCircle2 className="h-4 w-4 shrink-0" />
              : <AlertCircle className="h-4 w-4 shrink-0" />}
            <span>{status.message}</span>
          </div>
        )}

        {/* ── Section Profil ── */}
        <section className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 md:p-8 mb-6">
          <div className="flex items-center gap-2 mb-6">
            <UserIcon className="h-4 w-4 text-nestenn-dark" />
            <h2 className="text-sm font-semibold text-nestenn-dark uppercase tracking-wide">Profil</h2>
          </div>

          {/* Email & Rôle (lecture seule) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            <div>
              <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1.5">
                <Mail className="h-3.5 w-3.5" />
                Email
              </label>
              <div className="px-3 py-2.5 rounded-lg bg-nestenn-light border border-slate-100 text-sm text-foreground/80">
                {profile.email}
              </div>
            </div>
            <div>
              <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1.5">
                <Shield className="h-3.5 w-3.5" />
                Rôle
              </label>
              <div className="px-3 py-2.5 rounded-lg bg-nestenn-light border border-slate-100 text-sm text-foreground/80">
                {ROLE_LABELS[profile.role] ?? profile.role}
              </div>
            </div>
          </div>

          {/* Formulaire nom complet */}
          <form onSubmit={handleProfileSubmit} className="space-y-3">
            <div>
              <label htmlFor="full_name" className="block text-xs font-medium text-muted-foreground mb-1.5">
                Nom complet
              </label>
              <input
                id="full_name"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Ex. Marie Dupont"
                maxLength={120}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 bg-white text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-nestenn-cyan/30 focus:border-nestenn-cyan transition-colors"
              />
            </div>
            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={status.kind === 'saving'}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-nestenn-cyan text-white text-sm font-semibold hover:bg-nestenn-cyan-hover transition-colors disabled:opacity-60 disabled:cursor-not-allowed shadow-sm shadow-nestenn-cyan/20"
              >
                {status.kind === 'saving' && <Loader2 className="h-4 w-4 animate-spin" />}
                {status.kind === 'saving' ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </form>
        </section>

        {/* ── Section Préférences d'IA ── */}
        <section className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 md:p-8">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="h-4 w-4 text-nestenn-dark" />
            <h2 className="text-sm font-semibold text-nestenn-dark uppercase tracking-wide">Préférences d'IA</h2>
          </div>
          <p className="text-xs text-muted-foreground mb-5">
            Choisissez le modèle d'intelligence artificielle qui sera utilisé par défaut pour vos nouvelles conversations.
          </p>

          {!profile.can_switch_model && (
            <div className="mb-4 px-3 py-2.5 rounded-lg bg-amber-50 border border-amber-200 text-[12px] text-amber-800 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-px" />
              <span>
                Votre compte n'est pas autorisé à modifier le modèle. La préférence sera enregistrée localement mais ignorée tant que cette option n'est pas activée par votre administrateur.
              </span>
            </div>
          )}

          <div className="space-y-2">
            {AVAILABLE_MODELS.map((model) => {
              const isActive = preferredModel === model.id
              return (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => handleModelChange(model.id)}
                  className={`w-full text-left flex items-start gap-3 px-4 py-3.5 rounded-xl border transition-all ${
                    isActive
                      ? 'border-nestenn-cyan bg-nestenn-cyan/5 ring-1 ring-nestenn-cyan/20'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <Sparkles
                    className="h-4 w-4 mt-0.5 shrink-0"
                    style={{ color: model.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-semibold text-foreground">{model.name}</span>
                      {model.badge && (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                          style={{
                            backgroundColor: `${model.color}15`,
                            color: model.color,
                          }}
                        >
                          {model.badge}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground">{model.provider}</div>
                    <div className="text-xs text-muted-foreground mt-1 leading-relaxed">{model.description}</div>
                  </div>
                  {isActive && (
                    <CheckCircle2 className="h-5 w-5 text-nestenn-cyan shrink-0 mt-0.5" />
                  )}
                </button>
              )
            })}
          </div>

          {modelSavedAt && (
            <p className="mt-4 text-[11px] text-green-700 flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Préférence enregistrée localement
            </p>
          )}
        </section>
      </div>
    </div>
  )
}
