'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Search, Trophy, CheckCircle2, Clock,
  Briefcase, Receipt, Activity, Timer,
} from 'lucide-react'
import OpportunityModal from '../pipeline/opportunity-modal'
import PulsoMes from './pulso-mes'
import CincoPreguntas from './cinco-preguntas'
import type { Opportunity } from '@/types/database'

type OpportunityWithClient = Opportunity & {
  clients: { name: string } | null
}

interface DashData {
  pulso: {
    ventasMes: number
    metaVentas: number
    cobradoMes: number
    metaCobros: number
    gastoTotalMes: number
    gastosFijosMes: number
  }
  preguntas: {
    caja: number
    utilidad: number
    margen: number
    puntoEquilibrio: number
    runway: number
  }
  stats: {
    projectsActive: number
    horasMes: number
    pendingAmount: number
    pendingCount: number
    totalCollected: number
    totalRetentions: number
  }
  hasMetas: boolean
  hasBankData: boolean
}

interface DashboardClientProps {
  fullName: string
  workspaceName: string
  subscriptionStatus: string
  trialDaysLeft: number
  dashData: DashData
}

const fmtShort = (v: number) => {
  if (Math.abs(v) >= 1000000) return `$${(v / 1000000).toFixed(1)}M`
  if (Math.abs(v) >= 1000) return `$${Math.round(v / 1000)}K`
  return `$${v.toLocaleString('es-CO')}`
}

/**
 * Dashboard principal — F16 (Pulso del Mes) + F17 (Cinco Preguntas)
 * + Quick actions originales: "Me buscan" / "Ya gané" / "Ya entregué"
 */
export default function DashboardClient({
  fullName,
  workspaceName,
  subscriptionStatus,
  trialDaysLeft,
  dashData,
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
    <div className="mx-auto max-w-3xl space-y-8">
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

      {/* F16: Pulso del Mes */}
      <PulsoMes
        ventasMes={dashData.pulso.ventasMes}
        metaVentas={dashData.pulso.metaVentas}
        cobradoMes={dashData.pulso.cobradoMes}
        metaCobros={dashData.pulso.metaCobros}
        gastoTotalMes={dashData.pulso.gastoTotalMes}
        gastosFijosMes={dashData.pulso.gastosFijosMes}
        hasMetas={dashData.hasMetas}
      />

      {/* F17: Cinco Preguntas */}
      <CincoPreguntas
        caja={dashData.preguntas.caja}
        utilidad={dashData.preguntas.utilidad}
        margen={dashData.preguntas.margen}
        puntoEquilibrio={dashData.preguntas.puntoEquilibrio}
        runway={dashData.preguntas.runway}
        hasBankData={dashData.hasBankData}
      />

      {/* Quick stats strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Link href="/proyectos" className="rounded-xl border bg-card p-4 hover:bg-accent transition-colors">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Briefcase className="h-3.5 w-3.5" /> Proyectos activos
          </div>
          <p className="mt-1 text-2xl font-bold">{dashData.stats.projectsActive}</p>
        </Link>
        <Link href="/facturacion" className="rounded-xl border bg-card p-4 hover:bg-accent transition-colors">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Receipt className="h-3.5 w-3.5" /> Pendiente cobro
          </div>
          <p className="mt-1 text-2xl font-bold">{fmtShort(dashData.stats.pendingAmount)}</p>
          <p className="text-[10px] text-muted-foreground">{dashData.stats.pendingCount} factura{dashData.stats.pendingCount !== 1 ? 's' : ''}</p>
        </Link>
        <Link href="/numeros" className="rounded-xl border bg-card p-4 hover:bg-accent transition-colors">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Timer className="h-3.5 w-3.5" /> Horas este mes
          </div>
          <p className="mt-1 text-2xl font-bold">{dashData.stats.horasMes.toFixed(1)}h</p>
        </Link>
        <Link href="/semaforo" className="rounded-xl border bg-card p-4 hover:bg-accent transition-colors">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Activity className="h-3.5 w-3.5" /> Semáforo
          </div>
          <p className="mt-1 text-lg font-bold">Ver estado →</p>
        </Link>
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
