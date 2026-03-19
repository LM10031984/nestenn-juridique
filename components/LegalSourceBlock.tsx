import { ExternalLink, BookOpen } from 'lucide-react'

interface LegalSource {
  title: string
  article: string
  url: string
  dateConsulted: string
}

export function LegalSourceBlock({ source }: { source: LegalSource }) {
  return (
    <div className="bg-secondary p-4 rounded-lg border-l-2 border-primary">
      <div className="flex items-start gap-3">
        <BookOpen className="h-4 w-4 mt-0.5 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-foreground">{source.title}</p>
          <p className="text-xs text-muted-foreground font-serif-legal italic mt-1">{source.article}</p>
          <div className="flex items-center gap-4 mt-2">
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline font-medium"
            >
              Légifrance <ExternalLink className="h-3 w-3" />
            </a>
            <span className="text-[10px] text-muted-foreground">Consulté le {source.dateConsulted}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
