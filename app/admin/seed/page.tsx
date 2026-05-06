'use client'

import { useState, useEffect, useCallback } from 'react'
import { PlusCircle, Send, AlertCircle, CheckCircle2, Loader2, BookOpen, Trash2, List, History } from 'lucide-react'

/**
 * app/admin/seed/page.tsx
 * Interface d'administration premium pour injecter et gérer 
 * les règles juridiques de la base de connaissances.
 */

interface Rule {
  id: string
  title: string
  domain: string
  created_at: string
  article_num: string
}

export default function SeedPage() {
  // État du formulaire
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // État de la liste
  const [rules, setRules] = useState<Rule[]>([])
  const [listLoading, setListLoading] = useState(true)

  const [form, setForm] = useState({
    title: '',
    situation: '',
    principe: '',
    consequence: '',
    domain: 'vente_immobiliere'
  })

  // Récupération des règles
  const fetchRules = useCallback(async () => {
    try {
      setListLoading(true)
      const res = await fetch('/api/admin/rules')
      const data = await res.json()
      if (res.ok) setRules(data)
    } catch (err) {
      console.error('Erreur lors du chargement des règles:', err)
    } finally {
      setListLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchRules()
  }, [fetchRules])

  // Suppression d'une règle
  async function handleDelete(id: string) {
    if (!confirm('Êtes-vous sûr de vouloir supprimer cette règle ?')) return

    try {
      const res = await fetch(`/api/admin/rules?id=${id}`, { method: 'DELETE' })
      if (res.ok) {
        setRules(rules.filter(r => r.id !== id))
      }
    } catch (err) {
      console.error('Erreur suppression:', err)
    }
  }

  // Soumission du formulaire
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(false)

    try {
      const res = await fetch('/api/admin/seed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Une erreur est survenue lors de l\'injection.')

      setSuccess(true)
      setForm({
        title: '',
        situation: '',
        principe: '',
        consequence: '',
        domain: 'vente_immobiliere'
      })
      
      // Rafraîchir la liste
      fetchRules()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const domainLabels: Record<string, string> = {
    vente_immobiliere: 'Vente',
    baux_habitation: 'Baux',
    copropriete: 'Copro',
    agent_immobilier: 'Hoguet',
    sci_societes: 'SCI',
    diagnostics: 'Diag'
  }

  return (
    <div className="max-w-5xl mx-auto p-12 space-y-16">
      
      {/* SECTION 1 : FORMULAIRE D'AJOUT */}
      <section>
        <div className="flex items-center gap-5 mb-10 animate-in fade-in slide-in-from-left-4 duration-700">
          <div className="p-4 bg-primary/10 rounded-2xl shadow-inner">
            <BookOpen className="h-7 w-7 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight">Nouvelle Règle Juridique</h1>
            <p className="text-muted-foreground text-sm mt-1">Ajoutez un nouveau principe à l'IA.</p>
          </div>
        </div>

        <div className="bg-card border border-border/60 p-10 rounded-[2.5rem] shadow-xl shadow-black/5">
          <form onSubmit={handleSubmit} className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-3 md:col-span-2">
                <label className="text-sm font-semibold ml-1 flex items-center gap-2">Titre de la règle <span className="text-destructive">*</span></label>
                <input
                  required
                  className="w-full h-12 px-4 bg-muted/30 border border-border/50 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all placeholder:text-muted-foreground/50"
                  placeholder="Ex: Validité du DPE pour une vente"
                  value={form.title}
                  onChange={e => setForm({ ...form, title: e.target.value })}
                />
              </div>

              <div className="space-y-3">
                <label className="text-sm font-semibold ml-1">Domaine</label>
                <select
                  className="w-full h-12 px-4 bg-muted/30 border border-border/50 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all cursor-pointer"
                  value={form.domain}
                  onChange={e => setForm({ ...form, domain: e.target.value })}
                >
                  <option value="vente_immobiliere">🏠 Vente Immobilière</option>
                  <option value="baux_habitation">📄 Baux d'Habitation</option>
                  <option value="copropriete">🏢 Copropriété</option>
                  <option value="agent_immobilier">⚖️ Agent Immobilier</option>
                  <option value="sci_societes">🤝 SCI & Sociétés</option>
                  <option value="diagnostics">🔍 Diagnostics (DPE...)</option>
                </select>
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-sm font-semibold ml-1">Règle Juridique (Principe) <span className="text-destructive">*</span></label>
              <textarea
                required
                className="w-full h-32 px-4 py-3 bg-primary/[0.02] border border-primary/20 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none resize-none transition-all"
                placeholder="Le texte de loi ou le principe juridique exact..."
                value={form.principe}
                onChange={e => setForm({ ...form, principe: e.target.value })}
              />
            </div>

            <div className="min-h-[60px]">
              {error && <div className="flex items-center gap-3 p-4 bg-destructive/10 text-destructive rounded-2xl text-sm border border-destructive/20 animate-in fade-in"><AlertCircle className="h-5 w-5" />{error}</div>}
              {success && <div className="flex items-center gap-3 p-4 bg-emerald-500/10 text-emerald-500 rounded-2xl text-sm border border-emerald-500/20 animate-in fade-in"><CheckCircle2 className="h-5 w-5" />Règle injectée avec succès !</div>}
            </div>

            <button
              disabled={loading}
              type="submit"
              className="w-full h-14 bg-primary text-primary-foreground font-bold rounded-2xl flex items-center justify-center gap-3 hover:bg-primary/90 disabled:opacity-50 transition-all shadow-xl shadow-primary/20 active:scale-[0.98]"
            >
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <><Send className="h-5 w-5" />Indexer cette règle</>}
            </button>
          </form>
        </div>
      </section>

      {/* SECTION 2 : LISTE DES DERNIÈRES RÈGLES */}
      <section className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-muted rounded-xl">
              <History className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <h2 className="text-xl font-bold">Règles récemment ajoutées</h2>
              <p className="text-muted-foreground text-xs uppercase tracking-wider mt-0.5">Historique des 10 dernières injections</p>
            </div>
          </div>
        </div>

        <div className="bg-card border border-border/60 rounded-[2rem] overflow-hidden shadow-sm">
          {listLoading ? (
            <div className="h-64 flex flex-col items-center justify-center gap-3 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin opacity-20" />
              <p className="text-xs">Chargement de la base...</p>
            </div>
          ) : rules.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center gap-2 text-muted-foreground italic">
              Aucune règle personnalisée trouvée.
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-muted/30 border-b border-border/50">
                  <th className="px-8 py-4 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Titre</th>
                  <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-muted-foreground text-center">Domaine</th>
                  <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-muted-foreground text-center">Date</th>
                  <th className="px-8 py-4 text-[10px] font-bold uppercase tracking-widest text-muted-foreground text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {rules.map((rule) => (
                  <tr key={rule.id} className="group hover:bg-muted/10 transition-colors">
                    <td className="px-8 py-5">
                      <div className="font-semibold text-sm">{rule.title}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5 font-mono opacity-50 uppercase">{rule.article_num}</div>
                    </td>
                    <td className="px-6 py-5 text-center">
                      <span className="px-2.5 py-1 bg-muted rounded-full text-[10px] font-bold text-muted-foreground border border-border/50">
                        {domainLabels[rule.domain] || rule.domain}
                      </span>
                    </td>
                    <td className="px-6 py-5 text-center text-[11px] text-muted-foreground tabular-nums">
                      {new Date(rule.created_at).toLocaleDateString('fr-FR')}
                    </td>
                    <td className="px-8 py-5 text-right">
                      <button
                        onClick={() => handleDelete(rule.id)}
                        className="p-2.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                        title="Supprimer la règle"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <p className="text-center text-[10px] text-muted-foreground uppercase tracking-[0.2em] opacity-30 pb-12">
        Nestenn Juridique — CMS Intelligence v4.2
      </p>
    </div>
  )
}
