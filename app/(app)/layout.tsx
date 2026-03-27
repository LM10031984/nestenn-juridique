import { Layout } from '@/components/Layout'
import { requireAuth } from '@/lib/auth'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAuth()
  return <Layout user={user}>{children}</Layout>
}
