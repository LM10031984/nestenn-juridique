// app/admin/layout.tsx
// Layout protecteur : vérifie que l'utilisateur est admin côté serveur

import { requireRole } from '@/lib/auth'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireRole(['super_admin'])
  return <>{children}</>
}
