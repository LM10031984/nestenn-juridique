'use client'

import { motion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'

interface SuggestionCardProps {
  question: string
  category: string
  onClick: (question: string) => void
  index: number
}

export function SuggestionCard({ question, category, onClick, index }: SuggestionCardProps) {
  return (
    <motion.button
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, ease: [0.16, 1, 0.3, 1], duration: 0.5 }}
      onClick={() => onClick(question)}
      className="group text-left w-full p-4 rounded-xl border border-border bg-card hover:border-primary/30 hover:shadow-sm transition-all"
    >
      <span className="text-[10px] font-bold uppercase tracking-wider text-primary/70 block mb-1.5">
        {category}
      </span>
      <span className="text-sm text-foreground group-hover:text-primary transition-colors leading-snug block">
        {question}
      </span>
      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-primary mt-2 transition-all group-hover:translate-x-1" />
    </motion.button>
  )
}
