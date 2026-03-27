'use client'

import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Scale, Clock } from 'lucide-react'

export default function PendingPage() {
  const router = useRouter()
  const supabase = createClient()

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="w-full max-w-sm text-center">
      <div className="inline-flex items-center gap-2 text-white mb-8">
        <Scale className="h-6 w-6 text-primary" />
        <span className="text-lg font-bold">Nestenn Juridique</span>
      </div>

      <div className="bg-card rounded-2xl p-8 border border-border">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 mb-4">
          <Clock className="h-6 w-6 text-primary" />
        </div>
        <h1 className="text-base font-semibold text-foreground mb-2">Demande en attente</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Votre compte est en cours de validation par un administrateur Nestenn.
          Vous recevrez un email dès que votre accès sera activé.
        </p>
        <button
          onClick={handleSignOut}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
        >
          Se déconnecter
        </button>
      </div>
    </div>
  )
}
