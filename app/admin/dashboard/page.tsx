// app/admin/dashboard/page.tsx
'use client'

import { useEffect, useState } from 'react'

interface FeedbackReport {
  negatives: Array<{ question: string; response: string; reason?: string; created_at: string }>
  satisfactionRate: number | null
  totalFeedbacks: number
  totalNegatives: number
  recurringIssues: Array<{ question: string; count: number }>
}

export default function AdminDashboardPage() {
  const [report, setReport] = useState<FeedbackReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/feedback-report')
      .then(r => r.json())
      .then(data => {
        if (data.error) setError(data.error)
        else setReport(data as FeedbackReport)
      })
      .catch(() => setError('Erreur réseau'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="p-8 text-gray-500">Chargement...</div>
  if (error) return <div className="p-8 text-red-600">Erreur : {error}</div>
  if (!report) return null

  return (
    <div className="max-w-4xl mx-auto p-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Tableau de bord Admin</h1>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 mb-8">
        <div className="bg-white rounded-xl p-5 border border-gray-200">
          <p className="text-sm text-gray-500 mb-1">Taux de satisfaction (30j)</p>
          <p className="text-3xl font-bold" style={{ color: '#00AEBC' }}>
            {report.satisfactionRate !== null ? `${report.satisfactionRate}%` : 'N/A'}
          </p>
          <p className="text-xs text-gray-400 mt-1">{report.totalFeedbacks} feedbacks au total</p>
        </div>
        <div className="bg-white rounded-xl p-5 border border-gray-200">
          <p className="text-sm text-gray-500 mb-1">Questions à réviser</p>
          <p className="text-3xl font-bold text-red-500">{report.totalNegatives}</p>
          <p className="text-xs text-gray-400 mt-1">réponses négatives au total</p>
        </div>
      </div>

      {/* Questions récurrentes */}
      {report.recurringIssues.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-gray-800 mb-3">
            Questions récurrentes mal répondues (≥3 fois)
          </h2>
          <div className="space-y-2">
            {report.recurringIssues.map(({ question, count }) => (
              <div key={question} className="bg-red-50 border border-red-200 rounded-lg p-3 flex justify-between items-start">
                <p className="text-sm text-gray-700">{question}</p>
                <span className="ml-4 text-xs font-bold text-red-600 whitespace-nowrap">{count}x 👎</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Liste des 20 derniers feedbacks négatifs */}
      <section>
        <h2 className="text-lg font-semibold text-gray-800 mb-3">20 dernières réponses à améliorer</h2>
        <div className="space-y-4">
          {report.negatives.map((fb, i) => (
            <div key={i} className="bg-white border border-gray-200 rounded-xl p-4">
              <p className="text-xs text-gray-400 mb-2">
                {new Date(fb.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
              <p className="text-sm font-medium text-gray-800 mb-2">
                <span className="text-gray-400">Q :</span> {fb.question}
              </p>
              <p className="text-xs text-gray-500 line-clamp-3">
                <span className="text-gray-400">R :</span> {fb.response}
              </p>
              {fb.reason && (
                <p className="mt-2 text-xs text-orange-600 bg-orange-50 rounded px-2 py-1">
                  Raison : {fb.reason}
                </p>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
