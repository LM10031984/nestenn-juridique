'use client'

import { useEffect, useState } from 'react'
import { Building2, Users, Plus, X, Eye, EyeOff } from 'lucide-react'

interface Agency {
  id: string
  name: string
  slug: string
  city: string | null
  email: string | null
  phone: string | null
  credits_remaining: number
  credits_total: number
  is_active: boolean
  created_at: string
  user_count: number
}

const roleLabels: Record<string, string> = {
  conseiller: 'Conseiller',
  responsable_agence: "Responsable d'agence",
}

export default function AdminAgenciesPage() {
  const [agencies, setAgencies] = useState<Agency[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Modal créer agence
  const [showAgencyModal, setShowAgencyModal] = useState(false)
  const [agencyForm, setAgencyForm] = useState({ name: '', city: '', email: '', phone: '', credits: '1000' })
  const [agencySubmitting, setAgencySubmitting] = useState(false)
  const [agencyError, setAgencyError] = useState<string | null>(null)

  // Modal créer utilisateur
  const [userModalAgency, setUserModalAgency] = useState<Agency | null>(null)
  const [userForm, setUserForm] = useState({ fullName: '', email: '', password: '', role: 'conseiller' })
  const [userSubmitting, setUserSubmitting] = useState(false)
  const [userError, setUserError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [createdUser, setCreatedUser] = useState<{ email: string; password: string } | null>(null)

  async function fetchAgencies() {
    const res = await fetch('/api/admin/agencies')
    const data = await res.json()
    if (data.error) { setError(data.error); setLoading(false); return }
    setAgencies(data.agencies ?? [])
    setLoading(false)
  }

  useEffect(() => { fetchAgencies() }, [])

  async function handleCreateAgency(e: React.FormEvent) {
    e.preventDefault()
    setAgencySubmitting(true)
    setAgencyError(null)
    const res = await fetch('/api/admin/agencies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(agencyForm),
    })
    const data = await res.json()
    setAgencySubmitting(false)
    if (data.error) { setAgencyError(data.error); return }
    setShowAgencyModal(false)
    setAgencyForm({ name: '', city: '', email: '', phone: '', credits: '1000' })
    await fetchAgencies()
  }

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault()
    if (!userModalAgency) return
    setUserSubmitting(true)
    setUserError(null)
    const res = await fetch('/api/admin/agencies/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...userForm, agencyId: userModalAgency.id }),
    })
    const data = await res.json()
    setUserSubmitting(false)
    if (data.error) { setUserError(data.error); return }
    setCreatedUser({ email: userForm.email, password: userForm.password })
    setUserForm({ fullName: '', email: '', password: '', role: 'conseiller' })
    await fetchAgencies()
  }

  function closeUserModal() {
    setUserModalAgency(null)
    setUserError(null)
    setCreatedUser(null)
    setUserForm({ fullName: '', email: '', password: '', role: 'conseiller' })
    setShowPassword(false)
  }

  if (loading) return <div className="p-8 text-sm text-muted-foreground">Chargement...</div>
  if (error) return <div className="p-8 text-sm text-red-400">Erreur : {error}</div>

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-foreground">Gestion des agences</h1>
        <button
          onClick={() => setShowAgencyModal(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
        >
          <Plus className="h-4 w-4" />
          Créer une agence
        </button>
      </div>

      {agencies.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucune agence pour l'instant.</p>
      ) : (
        <div className="space-y-3">
          {agencies.map(agency => (
            <div key={agency.id} className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <Building2 className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-foreground">{agency.name}</p>
                      {!agency.is_active && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 font-medium">Inactif</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {[agency.city, agency.email, agency.phone].filter(Boolean).join(' · ')}
                    </p>
                    <div className="flex items-center gap-4 mt-2">
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Users className="h-3 w-3" />
                        {agency.user_count} utilisateur{agency.user_count !== 1 ? 's' : ''}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {agency.credits_remaining} / {agency.credits_total} crédits
                      </span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setUserModalAgency(agency)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-foreground hover:bg-muted transition-colors shrink-0"
                >
                  <Plus className="h-3 w-3" />
                  Ajouter un agent
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal : Créer une agence */}
      {showAgencyModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold text-foreground">Créer une agence</h2>
              <button onClick={() => setShowAgencyModal(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleCreateAgency} className="space-y-3">
              <Field label="Nom de l'agence *">
                <input
                  required
                  value={agencyForm.name}
                  onChange={e => setAgencyForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Nestenn Bordeaux Centre"
                  className={inputClass}
                />
              </Field>
              <Field label="Ville">
                <input
                  value={agencyForm.city}
                  onChange={e => setAgencyForm(f => ({ ...f, city: e.target.value }))}
                  placeholder="Bordeaux"
                  className={inputClass}
                />
              </Field>
              <Field label="Email">
                <input
                  type="email"
                  value={agencyForm.email}
                  onChange={e => setAgencyForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="contact@nestenn-bordeaux.fr"
                  className={inputClass}
                />
              </Field>
              <Field label="Téléphone">
                <input
                  value={agencyForm.phone}
                  onChange={e => setAgencyForm(f => ({ ...f, phone: e.target.value }))}
                  placeholder="05 56 00 00 00"
                  className={inputClass}
                />
              </Field>
              <Field label="Crédits initiaux">
                <input
                  type="number"
                  min={0}
                  value={agencyForm.credits}
                  onChange={e => setAgencyForm(f => ({ ...f, credits: e.target.value }))}
                  className={inputClass}
                />
              </Field>
              {agencyError && <p className="text-xs text-red-400">{agencyError}</p>}
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setShowAgencyModal(false)} className={btnSecondary}>
                  Annuler
                </button>
                <button type="submit" disabled={agencySubmitting} className={btnPrimary}>
                  {agencySubmitting ? 'Création...' : 'Créer l\'agence'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal : Ajouter un utilisateur */}
      {userModalAgency && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-base font-semibold text-foreground">Ajouter un utilisateur</h2>
              <button onClick={closeUserModal} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground mb-5">{userModalAgency.name}</p>

            {createdUser ? (
              <div className="space-y-4">
                <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4">
                  <p className="text-sm font-medium text-green-400 mb-3">Compte créé avec succès</p>
                  <div className="space-y-2">
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Email</p>
                      <p className="text-sm font-mono text-foreground">{createdUser.email}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Mot de passe temporaire</p>
                      <p className="text-sm font-mono text-foreground">{createdUser.password}</p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-3">
                    Transmettez ces identifiants à l'utilisateur. Il pourra les modifier après connexion.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setCreatedUser(null)}
                    className={btnSecondary}
                  >
                    Ajouter un autre
                  </button>
                  <button onClick={closeUserModal} className={btnPrimary}>
                    Fermer
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleCreateUser} className="space-y-3">
                <Field label="Nom complet *">
                  <input
                    required
                    value={userForm.fullName}
                    onChange={e => setUserForm(f => ({ ...f, fullName: e.target.value }))}
                    placeholder="Jean Dupont"
                    className={inputClass}
                  />
                </Field>
                <Field label="Email *">
                  <input
                    required
                    type="email"
                    value={userForm.email}
                    onChange={e => setUserForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="jean.dupont@nestenn-bordeaux.fr"
                    className={inputClass}
                  />
                </Field>
                <Field label="Mot de passe temporaire *">
                  <div className="relative">
                    <input
                      required
                      type={showPassword ? 'text' : 'password'}
                      value={userForm.password}
                      onChange={e => setUserForm(f => ({ ...f, password: e.target.value }))}
                      placeholder="Minimum 8 caractères"
                      minLength={8}
                      className={`${inputClass} pr-10`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </Field>
                <Field label="Rôle *">
                  <select
                    value={userForm.role}
                    onChange={e => setUserForm(f => ({ ...f, role: e.target.value }))}
                    className={inputClass}
                  >
                    {Object.entries(roleLabels).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </Field>
                {userError && <p className="text-xs text-red-400">{userError}</p>}
                <div className="flex gap-2 pt-2">
                  <button type="button" onClick={closeUserModal} className={btnSecondary}>
                    Annuler
                  </button>
                  <button type="submit" disabled={userSubmitting} className={btnPrimary}>
                    {userSubmitting ? 'Création...' : 'Créer le compte'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
      {children}
    </div>
  )
}

const inputClass = 'w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-all'
const btnPrimary = 'flex-1 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50'
const btnSecondary = 'flex-1 px-4 py-2 rounded-lg border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors'
