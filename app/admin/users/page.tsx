'use client'

import { useEffect, useState } from 'react'
import { CheckCircle, XCircle, Clock, User } from 'lucide-react'

interface UserRow {
  id: string
  full_name: string | null
  role: string
  status: string
  agency_id: string | null
  created_at: string
  agencies: { name: string } | null
}

const roleLabels: Record<string, string> = {
  super_admin: 'Super Admin',
  responsable_agence: "Responsable d'agence",
  conseiller: 'Conseiller',
}

const statusConfig: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
  pending:  { label: 'En attente', className: 'text-yellow-400 bg-yellow-400/10', icon: <Clock className="h-3 w-3" /> },
  active:   { label: 'Actif',      className: 'text-green-400 bg-green-400/10',  icon: <CheckCircle className="h-3 w-3" /> },
  rejected: { label: 'Refusé',     className: 'text-red-400 bg-red-400/10',      icon: <XCircle className="h-3 w-3" /> },
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function fetchUsers() {
    const res = await fetch('/api/admin/users')
    const data = await res.json()
    if (data.error) {
      console.error('[admin/users]', data.error)
      setError(data.error)
    }
    setUsers(data.users ?? [])
    setLoading(false)
  }

  async function handleAction(userId: string, action: 'approve' | 'reject') {
    setActionLoading(userId + action)
    await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, action }),
    })
    await fetchUsers()
    setActionLoading(null)
  }

  useEffect(() => { fetchUsers() }, [])

  if (loading) return <div className="p-8 text-sm text-muted-foreground">Chargement...</div>
  if (error) return <div className="p-8 text-sm text-red-400">Erreur API : {error}</div>

  const pending = users.filter(u => u.status === 'pending')
  const others  = users.filter(u => u.status !== 'pending')

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <h1 className="text-xl font-bold text-foreground mb-6">Gestion des utilisateurs</h1>

      {pending.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4 text-yellow-400" />
            En attente de validation ({pending.length})
          </h2>
          <div className="space-y-2">
            {pending.map(u => (
              <UserCard key={u.id} user={u} onAction={handleAction} actionLoading={actionLoading} />
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-sm font-semibold text-foreground mb-3">Tous les utilisateurs</h2>
        <div className="space-y-2">
          {others.map(u => (
            <UserCard key={u.id} user={u} onAction={handleAction} actionLoading={actionLoading} />
          ))}
        </div>
        {others.length === 0 && (
          <p className="text-sm text-muted-foreground">Aucun utilisateur.</p>
        )}
      </section>
    </div>
  )
}

function UserCard({
  user,
  onAction,
  actionLoading,
}: {
  user: UserRow
  onAction: (id: string, action: 'approve' | 'reject') => void
  actionLoading: string | null
}) {
  const status = statusConfig[user.status] ?? statusConfig.pending

  return (
    <div className="flex items-center justify-between p-4 rounded-xl border border-border bg-card">
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 rounded-full bg-sidebar-accent flex items-center justify-center shrink-0">
          <User className="h-4 w-4 text-muted-foreground" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">{user.full_name ?? '—'}</p>
          <p className="text-xs text-muted-foreground">
            {roleLabels[user.role]} · {user.agencies?.name ?? 'Agence inconnue'}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium ${status.className}`}>
          {status.icon}
          {status.label}
        </span>

        {user.status === 'pending' && (
          <div className="flex gap-2">
            <button
              onClick={() => onAction(user.id, 'approve')}
              disabled={actionLoading !== null}
              className="px-3 py-1.5 rounded-lg bg-green-500/10 text-green-400 hover:bg-green-500/20 text-xs font-medium transition-colors disabled:opacity-50"
            >
              {actionLoading === user.id + 'approve' ? '...' : 'Approuver'}
            </button>
            <button
              onClick={() => onAction(user.id, 'reject')}
              disabled={actionLoading !== null}
              className="px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs font-medium transition-colors disabled:opacity-50"
            >
              {actionLoading === user.id + 'reject' ? '...' : 'Refuser'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
