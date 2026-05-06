'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Scale, ChevronLeft, User, BarChart2, Users, Building2, LogOut, Plus, MessageSquare, History, BookOpen } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  useSidebar,
} from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'
import type { AuthUser } from '@/lib/auth'

const allNav = [
  { title: 'Assistant Juridique', url: '/chat', icon: Scale, roles: ['super_admin', 'responsable_agence', 'conseiller'] },
  { title: 'Base de connaissances', url: '/admin/seed', icon: BookOpen, roles: ['super_admin'] },
  { title: 'Analytics', url: '/analytics', icon: BarChart2, roles: ['super_admin', 'responsable_agence'] },
  { title: 'Agences', url: '/admin/agencies', icon: Building2, roles: ['super_admin'] },
  { title: 'Utilisateurs', url: '/admin/users', icon: Users, roles: ['super_admin'] },
]

const roleLabels: Record<string, string> = {
  super_admin: 'Super Admin',
  responsable_agence: "Responsable d'agence",
  conseiller: 'Conseiller',
}

export function AppSidebar({ user }: { user: AuthUser }) {
  const { state, toggleSidebar } = useSidebar()
  const pathname = usePathname()
  const router = useRouter()
  const collapsed = state === 'collapsed'

  // État de l'historique
  const [history, setHistory] = useState<any[]>([])
  const [loadingHistory, setLoadingHistory] = useState(true)

  // Fetch de l'historique
  useEffect(() => {
    async function fetchHistory() {
      try {
        const res = await fetch('/api/chat/history')
        if (res.ok) {
          const data = await res.json()
          setHistory(data)
        }
      } catch (err) {
        console.error('[Sidebar] Erreur historique:', err)
      } finally {
        setLoadingHistory(false)
      }
    }
    
    // On recharge l'historique au montage et quand on change de chat
    fetchHistory()
  }, [pathname])

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  const nav = allNav.filter(item => item.roles.includes(user.role))

  return (
    <Sidebar collapsible="icon" className="border-r-0">
      <div className="flex h-16 items-center justify-between px-4 border-b border-sidebar-border">
        {!collapsed && (
          <div className="flex items-center gap-2.5">
            <img src="/logo-nestenn.svg" alt="Nestenn" className="h-5 w-auto brightness-0 invert" />
            <span className="text-[10px] text-sidebar-foreground/50 uppercase tracking-widest border-l border-sidebar-border/50 pl-2.5">
              Juridic
            </span>
          </div>
        )}
        <button
          onClick={toggleSidebar}
          className="p-1.5 rounded-md hover:bg-sidebar-accent text-sidebar-foreground/60 hover:text-sidebar-foreground transition-colors"
        >
          <ChevronLeft className={cn('h-4 w-4 transition-transform', collapsed && 'rotate-180')} />
        </button>
      </div>

      <SidebarContent className="pt-4">
        {/* BOUTON NOUVEAU CHAT */}
        <div className="px-3 mb-6">
          <button
            onClick={() => {
              // Réinitialise la conversation et redirige vers le chat vierge
              router.push('/chat')
            }}
            className={cn(
              "w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 transition-all shadow-lg shadow-primary/20",
              collapsed && "p-2.5"
            )}
          >
            <Plus className="h-4 w-4" />
            {!collapsed && <span>Nouveau chat</span>}
          </button>
        </div>

        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {nav.map((item) => {
                const isActive = pathname === item.url || (item.url !== '/chat' && pathname.startsWith(item.url + '/'))
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <Link
                        href={item.url}
                        className={cn(
                          'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-all',
                          isActive && 'bg-sidebar-accent text-sidebar-primary-foreground font-medium',
                        )}
                      >
                        <item.icon className="h-[18px] w-[18px] shrink-0" />
                        {!collapsed && <span>{item.title}</span>}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* SECTION HISTORIQUE (Visible uniquement si non replié) */}
        {!collapsed && history.length > 0 && (
          <SidebarGroup className="mt-6">
            <div className="px-4 py-2 flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-sidebar-foreground/30">
                Historique récent
              </span>
              <History className="h-3 w-3 text-sidebar-foreground/20" />
            </div>
            <SidebarGroupContent>
              <SidebarMenu>
                {loadingHistory ? (
                  <div className="px-4 py-2 text-[10px] text-sidebar-foreground/20 animate-pulse">
                    Chargement de la mémoire...
                  </div>
                ) : (
                  history.map((chat) => {
                    const isActive = pathname === `/chat/${chat.id}`
                    return (
                      <SidebarMenuItem key={chat.id}>
                        <SidebarMenuButton asChild isActive={isActive}>
                          <Link
                            href={`/chat/${chat.id}`}
                            className={cn(
                              'flex items-center gap-2.5 px-4 py-2 text-xs text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 rounded-lg transition-all truncate',
                              isActive && 'text-sidebar-foreground font-semibold bg-sidebar-accent'
                            )}
                          >
                            <MessageSquare className="h-3 w-3 shrink-0 opacity-30" />
                            <span className="truncate">{chat.title}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )
                  })
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-2 px-2 py-2">
          <div className="h-8 w-8 rounded-full bg-sidebar-accent flex items-center justify-center shrink-0">
            <User className="h-4 w-4 text-sidebar-foreground/70" />
          </div>
          {!collapsed && (
            <div className="flex flex-col flex-1 min-w-0">
              <span className="text-xs font-medium text-sidebar-foreground truncate">
                {user.full_name ?? user.email}
              </span>
              <span className="text-[10px] text-sidebar-foreground/50">{roleLabels[user.role]}</span>
            </div>
          )}
          <button
            onClick={handleSignOut}
            title="Se déconnecter"
            className="p-1.5 rounded-md hover:bg-sidebar-accent text-sidebar-foreground/50 hover:text-sidebar-foreground transition-colors shrink-0"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}

