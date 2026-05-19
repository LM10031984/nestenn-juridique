import { Simulator } from '@/components/Simulator'

export const metadata = {
  title: 'Simulateur de Rentabilité | Nestenn Juridic',
}

export default function SimulatorPage() {
  return (
    <div className="flex-1 w-full bg-nestenn-light min-h-screen overflow-y-auto">
      <div className="py-12 px-6">
        <Simulator />
      </div>
    </div>
  )
}
