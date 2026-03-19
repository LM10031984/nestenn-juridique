import { Clock, Construction } from 'lucide-react'

export default function HistoryPage() {
  return (
    <div className="flex flex-col items-center justify-center h-[calc(100vh-3.5rem)] md:h-screen bg-background">
      <div className="text-center max-w-sm">
        <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
          <Clock className="h-7 w-7 text-primary" />
        </div>
        <h1 className="text-lg font-semibold text-foreground mb-2">Historique</h1>
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground mb-1">
          <Construction className="h-3.5 w-3.5" />
          <span>En construction</span>
        </div>
        <p className="text-xs text-muted-foreground">
          L'historique de vos consultations juridiques sera disponible prochainement.
        </p>
      </div>
    </div>
  )
}
