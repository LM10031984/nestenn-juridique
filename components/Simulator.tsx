'use client'

import React, { useState, useRef } from 'react'
import { Home, Wallet, TrendingUp, Sparkles, Loader2, Euro } from 'lucide-react'

export interface SimulationData {
  purchasePrice?: number
  works?: number
  notaryFees?: number
  monthlyRent?: number
  propertyTax?: number
  annualCharges?: number
  managementFeePercent?: number
}

export function Simulator() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [purchasePrice, setPurchasePrice] = useState<number>(200000)
  const [works, setWorks] = useState<number>(15000)
  const [notaryFees, setNotaryFees] = useState<number>(16000)
  const [monthlyRent, setMonthlyRent] = useState<number>(1200)
  const [propertyTax, setPropertyTax] = useState<number>(1000)
  const [annualCharges, setAnnualCharges] = useState<number>(1500)
  const [managementFeePercent, setManagementFeePercent] = useState<number>(5)

  const [isSimulating, setIsSimulating] = useState(false)

  // Calculations
  const totalInvestment = purchasePrice + works + notaryFees
  const annualRent = monthlyRent * 12
  const managementAnnual = annualRent * (managementFeePercent / 100)
  
  const grossYield = purchasePrice > 0 ? (annualRent / purchasePrice) * 100 : 0
  const netYield = totalInvestment > 0 ? ((annualRent - annualCharges - propertyTax - managementAnnual) / totalInvestment) * 100 : 0
  
  const monthlyCashFlow = monthlyRent - (annualCharges / 12) - (propertyTax / 12) - (managementAnnual / 12)

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setIsSimulating(true)

    try {
      const formData = new FormData()
      formData.append('file', file)

      // Appel de la future API d'extraction
      const response = await fetch('/api/simulateur/extract', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        throw new Error("Erreur lors de l'extraction par l'IA.")
      }

      const data: SimulationData = await response.json()
      
      // Mise à jour sélective des états selon ce que l'IA a trouvé
      if (data.purchasePrice !== undefined) setPurchasePrice(data.purchasePrice)
      if (data.works !== undefined) setWorks(data.works)
      if (data.notaryFees !== undefined) setNotaryFees(data.notaryFees)
      if (data.monthlyRent !== undefined) setMonthlyRent(data.monthlyRent)
      if (data.propertyTax !== undefined) setPropertyTax(data.propertyTax)
      if (data.annualCharges !== undefined) setAnnualCharges(data.annualCharges)
      if (data.managementFeePercent !== undefined) setManagementFeePercent(data.managementFeePercent)

    } catch (error) {
      console.error("Extraction error:", error)
      alert("Erreur lors de l'analyse du document. Veuillez réessayer ou vérifier le format.")
    } finally {
      setIsSimulating(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // La fonction est désormais appelée directement dans le onClick

  return (
    <div className="w-full max-w-5xl mx-auto bg-nestenn-light p-6 rounded-2xl shadow-sm border border-border">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-nestenn-dark flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-nestenn-cyan" />
            Simulateur de Rentabilité
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Estimez instantanément la performance de votre investissement locatif.
          </p>
        </div>
        
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isSimulating}
          className="flex items-center gap-2 bg-nestenn-cyan text-white px-4 py-2 rounded-xl font-medium hover:bg-nestenn-cyan-hover transition-colors shadow-sm disabled:opacity-70 disabled:cursor-not-allowed"
        >
          {isSimulating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Analyse du document...
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              Synchroniser avec l'analyse IA
            </>
          )}
        </button>

        {/* Input fichier caché pour l'upload */}
        <input 
          type="file" 
          ref={fileInputRef}
          onChange={handleFileChange}
          accept=".pdf,.doc,.docx" 
          className="hidden" 
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* FORMULAIRE (Gauche) */}
        <div className="lg:col-span-7 bg-white p-6 rounded-xl shadow-sm border border-border space-y-6">
          <h3 className="text-lg font-semibold text-nestenn-dark border-b border-border pb-3 mb-4 flex items-center gap-2">
            <Home className="h-5 w-5 text-nestenn-cyan" />
            Données du projet
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Prix d'achat */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Prix d'achat (€)</label>
              <div className="relative">
                <Euro className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <input 
                  type="number" 
                  value={purchasePrice} 
                  onChange={(e) => setPurchasePrice(Number(e.target.value))}
                  className="w-full pl-9 pr-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-nestenn-cyan/20 focus:border-nestenn-cyan"
                />
              </div>
            </div>

            {/* Travaux */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Travaux estimés (€)</label>
              <div className="relative">
                <Euro className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <input 
                  type="number" 
                  value={works} 
                  onChange={(e) => setWorks(Number(e.target.value))}
                  className="w-full pl-9 pr-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-nestenn-cyan/20 focus:border-nestenn-cyan"
                />
              </div>
            </div>

            {/* Frais de notaire */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Frais de notaire (€)</label>
              <div className="relative">
                <Euro className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <input 
                  type="number" 
                  value={notaryFees} 
                  onChange={(e) => setNotaryFees(Number(e.target.value))}
                  className="w-full pl-9 pr-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-nestenn-cyan/20 focus:border-nestenn-cyan"
                />
              </div>
            </div>

            {/* Loyer mensuel */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Loyer mensuel (€)</label>
              <div className="relative">
                <Euro className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <input 
                  type="number" 
                  value={monthlyRent} 
                  onChange={(e) => setMonthlyRent(Number(e.target.value))}
                  className="w-full pl-9 pr-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-nestenn-cyan/20 focus:border-nestenn-cyan"
                />
              </div>
            </div>

            {/* Taxe Foncière */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Taxe Foncière annuelle (€)</label>
              <div className="relative">
                <Euro className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <input 
                  type="number" 
                  value={propertyTax} 
                  onChange={(e) => setPropertyTax(Number(e.target.value))}
                  className="w-full pl-9 pr-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-nestenn-cyan/20 focus:border-nestenn-cyan"
                />
              </div>
            </div>

            {/* Charges */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Charges de copro annuelles (€)</label>
              <div className="relative">
                <Euro className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <input 
                  type="number" 
                  value={annualCharges} 
                  onChange={(e) => setAnnualCharges(Number(e.target.value))}
                  className="w-full pl-9 pr-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-nestenn-cyan/20 focus:border-nestenn-cyan"
                />
              </div>
            </div>

            {/* Frais de gestion */}
            <div className="space-y-2 md:col-span-2">
              <div className="flex justify-between">
                <label className="text-sm font-medium text-foreground">Frais de gestion locative (%)</label>
                <span className="text-sm font-bold text-nestenn-cyan">{managementFeePercent}%</span>
              </div>
              <input 
                type="range" 
                min="0" max="15" step="0.5"
                value={managementFeePercent} 
                onChange={(e) => setManagementFeePercent(Number(e.target.value))}
                className="w-full accent-nestenn-cyan"
              />
            </div>

          </div>
        </div>

        {/* RESULTATS (Droite) */}
        <div className="lg:col-span-5 bg-nestenn-dark p-6 rounded-xl shadow-lg text-white flex flex-col justify-between">
          <div>
            <h3 className="text-lg font-semibold border-b border-white/20 pb-3 mb-6 flex items-center gap-2">
              <Wallet className="h-5 w-5 text-nestenn-cyan" />
              Performances
            </h3>

            <div className="space-y-8">
              {/* Rendement Brut */}
              <div className="bg-white/5 p-4 rounded-xl border border-white/10">
                <p className="text-white/70 text-sm font-medium mb-1">Rendement Brut</p>
                <div className="flex items-end gap-3">
                  <span className="text-4xl font-bold text-white">{grossYield.toFixed(2)}</span>
                  <span className="text-xl text-white/50 mb-1">%</span>
                </div>
              </div>

              {/* Rendement Net */}
              <div className="bg-white/5 p-4 rounded-xl border border-white/10 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-24 h-24 bg-nestenn-cyan/20 rounded-full blur-2xl -mr-8 -mt-8" />
                <p className="text-white/70 text-sm font-medium mb-1 relative z-10">Rendement Net Estimé</p>
                <div className="flex items-end gap-3 relative z-10">
                  <span className="text-5xl font-extrabold text-nestenn-cyan">{netYield.toFixed(2)}</span>
                  <span className="text-2xl text-nestenn-cyan/70 mb-1.5">%</span>
                </div>
              </div>

              {/* Cash Flow */}
              <div className={`p-4 rounded-xl border ${monthlyCashFlow >= 0 ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-rose-500/10 border-rose-500/30'}`}>
                <p className="text-white/70 text-sm font-medium mb-1">Cash Flow Mensuel (hors crédit)</p>
                <div className="flex items-center gap-2">
                  <span className={`text-3xl font-bold ${monthlyCashFlow >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {monthlyCashFlow > 0 ? '+' : ''}{monthlyCashFlow.toFixed(0)} €
                  </span>
                </div>
              </div>
            </div>
          </div>
          
          <div className="mt-8 text-xs text-white/40 text-center">
            * Ces calculs sont des estimations à titre indicatif et ne tiennent pas compte de la fiscalité sur le revenu ni du financement bancaire.
          </div>
        </div>

      </div>
    </div>
  )
}
