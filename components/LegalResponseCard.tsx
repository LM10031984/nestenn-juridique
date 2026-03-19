"use client";

import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { LegalSourceBlock } from "./LegalSourceBlock";
import { LegalDisclaimer } from "./LegalDisclaimer";
import { Send, Clock } from "lucide-react";

interface LegalResponse {
  id: string;
  question: string;
  confidence: "high" | "medium" | "verify";
  summary: string;
  analysis: string;
  recommendation?: string;
  sources: Array<{
    title: string;
    article: string;
    url: string;
    dateConsulted: string;
  }>;
  timestamp: string;
}

export function LegalResponseCard({ response }: { response: LegalResponse }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ease: [0.16, 1, 0.3, 1], duration: 0.6 }}
      className="bg-card rounded-xl border border-border overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-secondary/50">
        <ConfidenceBadge level={response.confidence} />
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          {response.timestamp}
        </div>
      </div>

      <div className="px-6 py-5 space-y-6">
        {/* Summary - L1 */}
        <div className="border-l-4 border-primary pl-4">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-primary mb-2">
            Résumé rapide
          </h3>
          <ReactMarkdown
            className="font-serif-legal text-sm font-medium text-foreground leading-relaxed prose prose-sm max-w-none prose-strong:text-foreground prose-ul:my-2 prose-li:my-0"
          >
            {response.summary}
          </ReactMarkdown>
        </div>

        {/* Analysis - L2 */}
        <div>
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-3">
            Analyse juridique
          </h3>
          <ReactMarkdown
            className="font-serif-legal text-sm text-foreground/90 leading-relaxed prose prose-sm max-w-none prose-strong:text-foreground prose-ul:my-2 prose-li:my-0"
          >
            {response.analysis}
          </ReactMarkdown>
        </div>

        {/* Recommendation */}
        {response.recommendation && (
          <div className="bg-accent rounded-lg p-4">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-accent-foreground mb-2">
              Recommandation pratique
            </h3>
            <ReactMarkdown
              className="font-serif-legal text-sm text-accent-foreground/80 leading-relaxed prose prose-sm max-w-none prose-strong:text-accent-foreground prose-ul:my-2 prose-li:my-0"
            >
              {response.recommendation}
            </ReactMarkdown>
          </div>
        )}

        {/* Sources - L3 */}
        <div>
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-3">
            Articles de loi applicables
          </h3>
          <div className="space-y-2">
            {response.sources.map((source, i) => (
              <LegalSourceBlock key={i} source={source} />
            ))}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-3 pt-2">
          <button className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition-opacity">
            <Send className="h-3.5 w-3.5" />
            Transférer au support juridique
          </button>
          <button className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:bg-secondary transition-colors">
            Demander une validation
          </button>
        </div>

        {/* Disclaimer */}
        <LegalDisclaimer />
      </div>
    </motion.div>
  );
}
