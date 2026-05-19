'use client'

import { useState } from 'react'
import { ChevronDown, Check, Sparkles } from 'lucide-react'
import { AVAILABLE_MODELS } from '@/lib/model-config'

interface Props {
  selected: string
  onChange: (modelId: string) => void
  disabled?: boolean
}

export function ModelSelector({ selected, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const current = AVAILABLE_MODELS.find(m => m.id === selected) ?? AVAILABLE_MODELS[0]

  return (
    <div className="relative">
      <button
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-transparent hover:bg-muted transition-colors text-sm text-muted-foreground disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span className="font-medium text-foreground/80">{current.name}</span>
        <ChevronDown className="h-4 w-4" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full right-0 mb-2 w-80 bg-card border border-border rounded-2xl shadow-xl z-50 overflow-hidden">
            <div className="px-4 py-2 border-b border-border bg-muted/50">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Choisir le modèle IA
              </span>
            </div>
            {AVAILABLE_MODELS.map(model => (
              <button
                key={model.id}
                onClick={() => { onChange(model.id); setOpen(false) }}
                className="w-full flex items-start gap-3 px-4 py-3 hover:bg-muted transition-colors text-left border-b border-border last:border-0"
              >
                <Sparkles className="h-4 w-4 mt-0.5 shrink-0" style={{ color: model.color }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-medium text-foreground">{model.name}</span>
                    {model.badge && (
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                        style={{
                          backgroundColor: `${model.color}15`,
                          color: model.color,
                        }}
                      >
                        {model.badge}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground">{model.provider}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                    {model.description}
                  </div>
                </div>
                {selected === model.id && (
                  <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
