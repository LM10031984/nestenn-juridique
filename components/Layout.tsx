'use client'

import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/AppSidebar'
import type { AuthUser } from '@/lib/auth'

export function Layout({ children, user }: { children: React.ReactNode; user: AuthUser }) {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar user={user} />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center border-b border-border px-4 bg-card shrink-0 md:hidden">
            <SidebarTrigger />
            <span className="ml-3 text-sm font-semibold text-foreground tracking-tight">
              Nestenn Juridic Assistant
            </span>
          </header>
          <main className="flex-1 overflow-auto">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  )
}
