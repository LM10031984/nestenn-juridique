import { AlertTriangle } from 'lucide-react'

export function LegalDisclaimer() {
  return (
    <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-status-warning-bg border border-status-warning/20">
      <AlertTriangle className="h-4 w-4 mt-0.5 text-status-warning shrink-0" />
      <p className="text-xs text-status-warning leading-relaxed">
        <strong>Attention :</strong> Cet assistant fournit des informations générales en droit immobilier
        et ne constitue pas un conseil juridique personnalisé. Pour toute situation concrète,
        veuillez consulter un professionnel habilité (avocat, notaire).
      </p>
    </div>
  )
}
