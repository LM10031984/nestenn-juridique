import { cn } from '@/lib/utils'
import { Shield, AlertTriangle, CheckCircle } from 'lucide-react'

type ConfidenceLevel = 'high' | 'medium' | 'verify'

const config: Record<ConfidenceLevel, { label: string; icon: typeof Shield; className: string }> = {
  high: { label: 'Confiance élevée', icon: CheckCircle, className: 'bg-status-success-bg text-status-success' },
  medium: { label: 'Confiance moyenne', icon: Shield, className: 'bg-status-info-bg text-status-info' },
  verify: { label: 'À vérifier', icon: AlertTriangle, className: 'bg-status-warning-bg text-status-warning' },
}

export function ConfidenceBadge({ level }: { level: ConfidenceLevel }) {
  const { label, icon: Icon, className } = config[level]
  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider', className)}>
      <Icon className="h-3 w-3" />
      {label}
    </span>
  )
}
