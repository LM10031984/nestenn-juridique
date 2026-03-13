import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Nestenn Juridique — Assistant IA droit immobilier',
  description:
    "Assistant juridique IA spécialisé en droit immobilier français. Loi Hoguet, copropriété, baux d'habitation, ALUR, ELAN — réponses précises avec sources officielles.",
  keywords: [
    'droit immobilier',
    'loi Hoguet',
    'copropriété',
    'bail habitation',
    'ALUR',
    'Nestenn',
  ],
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="fr">
      <head>
        <link rel="icon" href="/favicon.ico" />
      </head>
      <body className="font-metropolis antialiased">{children}</body>
    </html>
  )
}
