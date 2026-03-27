'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Scale } from 'lucide-react'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError('Email ou mot de passe incorrect.')
      setLoading(false)
      return
    }

    // Vérifier le statut du compte
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('Erreur de connexion.'); setLoading(false); return }

    const { data: profile } = await supabase
      .from('users')
      .select('status')
      .eq('id', user.id)
      .single()

    if (profile?.status === 'pending') {
      router.push('/pending')
    } else if (profile?.status === 'rejected') {
      await supabase.auth.signOut()
      setError('Votre compte a été refusé. Contactez votre administrateur.')
      setLoading(false)
    } else {
      router.push('/chat')
      router.refresh()
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 text-white mb-2">
          <Scale className="h-6 w-6 text-primary" />
          <span className="text-lg font-bold">Nestenn Juridique</span>
        </div>
        <p className="text-white/50 text-sm">Espace réservé aux professionnels</p>
      </div>

      <div className="bg-card rounded-2xl p-6 border border-border">
        <h1 className="text-base font-semibold text-foreground mb-5">Connexion</h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Email professionnel
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              placeholder="prenom.nom@nestenn.fr"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Mot de passe
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-xs text-red-400 bg-red-400/10 px-3 py-2 rounded-lg">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-primary text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {loading ? 'Connexion...' : 'Se connecter'}
          </button>
        </form>

        <p className="text-center text-xs text-muted-foreground mt-4">
          Pas encore de compte ?{' '}
          <Link href="/register" className="text-primary hover:underline">
            Demander un accès
          </Link>
        </p>
      </div>
    </div>
  )
}
