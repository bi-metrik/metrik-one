'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Search, Trophy, CheckCircle2, Clock } from 'lucide-react'
import OpportunityModal from '../pipeline/opportunity-modal'
import type { Opportunity } from '@/types/database'

type OpportunityWithClient = Opportunity & {
  clients: { name: string } | null
}

interface DashboardClientProps {
  fullName: string
  workspaceName: string
  subscriptionStatus: string
  trialDaysLeft: number
}

/**
 * Dashboard de bienvenida — D14, D49
 * 3 estados rápidos: "Me buscan" / "Ya gané" / "Ya entregué"
 * D172: Creación rápida = atajos
 */
export default function DashboardClient({
  fullName,
  workspaceName,
  subscriptionStatus,
  trialDaysLeft,
}: DashboardClientProps) {
  const router = useRouter()
  const firstName = fullName.split(' ')[0]
  const [quickAction, setQuickAction] = useState<'me-buscan' | 'ya-gane' | 'ya-entregue' | null>(null)

  // Greeting based on time of day
  const hour = new Date().getHours()
  const greeting =
    hour < 12 ? 'Buenos días' : hour < 18 ? 'Buenas tardes' : 'Buenas noches'

  const handleCreated = (_opp: OpportunityWithClient) => {
    setQuickAction(null)
    router.push('/pipeline')
    router.refresh()
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      {/* Trial banner */}
      {subscriptionStatus === 'trial' && trialDaysLeft > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-4 py-2.5 text-sm">
          <Clock className="h-4 w-4 text-primary" />
          <span>
            <strong>{trialDaysLeft} días</strong> restantes de tu prueba Pro gratuita
          </span>
        </div>
      )}

      {/* Welcome */}
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">
          {greeting}, {firstName}
        </h1>
        <p className="text-muted-foreground">
          {workspaceName} &mdash; ¿Qué está pasando hoy en tu negocio?
        </p>
      </div>

      {/* Quick-start actions — D49: Dashboard empuja oportunidad, no gasto */}
      <div className="space-y-3">
        <p className="text-sm font-medium text-muted-foreground">Acción rápida</p>

        <div className="grid gap-3 sm:grid-cols-3">
          {/* "Me buscan" → Lead */}
          <button
            className="group flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-6 text-center transition-all hover:border-primary hover:shadow-md"
            onClick={() => setQuickAction('me-buscan')}
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-blue-600 transition-colors group-hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-400">
              <Search className="h-7 w-7" />
            </div>
            <div>
              <p className="font-semibold">Me buscan</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Alguien me contactó para un trabajo
              </p>
            </div>
          </button>

          {/* "Ya gané" → Ganada + proyecto active */}
          <button
            className="group flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-6 text-center transition-all hover:border-primary hover:shadow-md"
            onClick={() => setQuickAction('ya-gane')}
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-50 text-green-600 transition-colors group-hover:bg-green-100 dark:bg-green-950 dark:text-green-400">
              <Trophy className="h-7 w-7" />
            </div>
            <div>
              <p className="font-semibold">Ya gané</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Cerré un negocio, ya empiezo a trabajar
              </p>
            </div>
          </button>

          {/* "Ya entregué" → Ganada + proyecto completed */}
          <button
            className="group flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-6 text-center transition-all hover:border-primary hover:shadow-md"
            onClick={() => setQuickAction('ya-entregue')}
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 text-amber-600 transition-colors group-hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-400">
              <CheckCircle2 className="h-7 w-7" />
            </div>
            <div>
              <p className="font-semibold">Ya entregué</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Terminé un proyecto y necesito cobrar
              </p>
            </div>
          </button>
        </div>
      </div>

      {/* Empty state hints */}
      <div className="rounded-xl border border-dashed border-border p-6">
        <div className="space-y-4 text-center">
          <p className="text-sm text-muted-foreground">
            Tu dashboard se llena con tus datos. Empieza con cualquiera de las acciones de arriba
            y tus <strong>Números</strong> empezarán a tomar forma.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {[
              { label: 'Pipeline', href: '/pipeline', ready: true },
              { label: 'Números', href: '/numeros', ready: false },
              { label: 'Proyectos', href: '/proyectos', ready: false },
              { label: 'Configuración', href: '/config', ready: false },
            ].map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <span className={`h-1.5 w-1.5 rounded-full ${item.ready ? 'bg-green-500' : 'bg-muted-foreground/30'}`} />
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Quick Action Modal — D172 */}
      {quickAction && (
        <OpportunityModal
          quickAction={quickAction}
          defaultStage={quickAction === 'me-buscan' ? 'lead' : 'won'}
          onClose={() => setQuickAction(null)}
          onCreated={handleCreated}
        />
      )}
    </div>
  )
}
