'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Scale, Clock, FileText, LayoutDashboard, ChevronLeft, User } from 'lucide-react'
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

const mainNav = [
  { title: 'Assistant Juridique', url: '/chat', icon: Scale },
  { title: 'Historique', url: '/history', icon: Clock },
  { title: 'Documents', url: '/documents', icon: FileText },
  { title: 'Administration', url: '/admin/dashboard', icon: LayoutDashboard },
]

export function AppSidebar() {
  const { state, toggleSidebar } = useSidebar()
  const pathname = usePathname()
  const collapsed = state === 'collapsed'

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
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNav.map((item) => {
                const isActive = pathname === item.url || pathname.startsWith(item.url + '/')
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
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-3">
        {!collapsed && (
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="h-8 w-8 rounded-full bg-sidebar-accent flex items-center justify-center">
              <User className="h-4 w-4 text-sidebar-foreground/70" />
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-medium text-sidebar-foreground">Conseiller</span>
              <span className="text-[10px] text-sidebar-foreground/50">Nestenn</span>
            </div>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  )
}
