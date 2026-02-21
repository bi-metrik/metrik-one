'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Search, Trophy, CheckCircle2, Clock,
  Briefcase, Receipt, Timer,
  Shield, RefreshCw, Copy,
  TrendingUp, TrendingDown, DollarSign,
  AlertTriangle,
} from 'lucide-react'
import { toast } from 'sonner'
import OpportunityModal from '../pipeline/opportunity-modal'
import PulsoMes from './pulso-mes'
import CincoPreguntas from './cinco-preguntas'
import { generarMensajeCobro, getTipoCobro } from '../semaforo/collection-messages'
import type { OpportunityLegacy as Opportunity } from '@/types/database'
import type { SemaforoData } from '../semaforo/semaforo-actions'

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
  semaforoData: SemaforoData
}

const fmtShort = (v: number) => {
  if (Math.abs(v) >= 1000000) return `$${(v / 1000000).toFixed(1)}M`
  if (Math.abs(v) >= 1000) return `$${Math.round(v / 1000)}K`
  return `$${v.toLocaleString('es-CO')}`
}

type Estado = 'verde' | 'amarillo' | 'rojo'

const ESTADO_COLORS: Record<Estado, { bg: string; text: string; border: string }> = {
  verde: { bg: 'bg-green-50 dark:bg-green-950/20', text: 'text-green-700 dark:text-green-400', border: 'border-green-200 dark:border-green-900/30' },
  amarillo: { bg: 'bg-yellow-50 dark:bg-yellow-950/20', text: 'text-yellow-700 dark:text-yellow-400', border: 'border-yellow-200 dark:border-yellow-900/30' },
  rojo: { bg: 'bg-red-50 dark:bg-red-950/20', text: 'text-red-700 dark:text-red-400', border: 'border-red-200 dark:border-red-900/30' },
}

const CONFIANZA_COLORS: Record<string, string> = {
  alta: 'text-green-600',
  media: 'text-yellow-600',
  baja: 'text-red-600',
}

/**
 * Dashboard principal — Semáforo hero + Pulso + Cinco Preguntas + Quick actions
 */
export default function DashboardClient({
  fullName,
  workspaceName,
  subscriptionStatus,
  trialDaysLeft,
  dashData,
  semaforoData,
}: DashboardClientProps) {
  const router = useRouter()
  const firstName = fullName.split(' ')[0]
  const [quickAction, setQuickAction] = useState<'me-buscan' | 'ya-gane' | 'ya-entregue' | null>(null)
  const [showRiesgo, setShowRiesgo] = useState(false)

  const hour = new Date().getHours()
  const greeting =
    hour < 12 ? 'Buenos días' : hour < 18 ? 'Buenas tardes' : 'Buenas noches'

  const handleCreated = (_opp: OpportunityWithClient) => {
    setQuickAction(null)
    router.push('/pipeline')
    router.refresh()
  }

  const handleCopyMessage = (cliente: { concepto: string; monto: number; diasVencida: number }) => {
    const tipo = getTipoCobro(cliente.diasVencida)
    const msg = generarMensajeCobro(tipo, { nombre: cliente.concepto, monto: cliente.monto, diasVencida: cliente.diasVencida })
    navigator.clipboard.writeText(msg)
    toast.success('Mensaje de cobro copiado')
  }

  const { semaforo, resumen, indicadores, confianza, accion, clientesRiesgo, tieneCuentas } = semaforoData
  const colors = ESTADO_COLORS[semaforo.estado]

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Trial banner */}
      {subscriptionStatus === 'trial' && trialDaysLeft > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-4 py-2 text-sm">
          <Clock className="h-4 w-4 text-primary" />
          <span>
            <strong>{trialDaysLeft} días</strong> restantes de tu prueba Pro gratuita
          </span>
        </div>
      )}

      {/* Header: Greeting + Quick Actions inline */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-0.5">
          <h1 className="text-2xl font-bold">
            {greeting}, {firstName}
          </h1>
          <p className="text-sm text-muted-foreground">{workspaceName}</p>
        </div>

        {/* Quick actions — compact pills */}
        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-muted-foreground sm:block">¿Qué pasó hoy?</span>
          <button
            onClick={() => setQuickAction('me-buscan')}
            className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:border-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/30"
          >
            <Search className="h-3 w-3 text-blue-500" />
            Me buscan
          </button>
          <button
            onClick={() => setQuickAction('ya-gane')}
            className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:border-green-300 hover:bg-green-50 dark:hover:bg-green-950/30"
          >
            <Trophy className="h-3 w-3 text-green-500" />
            Ya gané
          </button>
          <button
            onClick={() => setQuickAction('ya-entregue')}
            className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:border-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/30"
          >
            <CheckCircle2 className="h-3 w-3 text-amber-500" />
            Ya entregué
          </button>
        </div>
      </div>

      {/* ═══ SEMÁFORO HERO ═══ */}
      {tieneCuentas ? (
        <div className="space-y-4">
          {/* Main traffic light card */}
          <div className={`rounded-2xl border-2 ${colors.border} ${colors.bg} p-6 sm:p-8`}>
            <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:text-left">
              <span className="text-5xl sm:text-4xl">{semaforo.emoji}</span>
              <div className="flex-1">
                <h2 className={`text-lg font-bold ${colors.text}`}>{semaforo.mensajePrincipal}</h2>
                {semaforo.mensajeSecundario && (
                  <p className="mt-0.5 text-sm text-muted-foreground">{semaforo.mensajeSecundario}</p>
                )}
              </div>
              <div className={`flex items-center gap-1.5 text-[10px] font-medium ${CONFIANZA_COLORS[confianza.nivel]}`}>
                <Shield className="h-3 w-3" />
                {confianza.nivel === 'alta' ? 'Datos al día' :
                 confianza.nivel === 'media' ? 'Actualiza saldos' :
                 `${confianza.diasSinActualizar}d sin actualizar`}
              </div>
            </div>

            {/* Suggested action inline */}
            {accion && (
              <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-current/10 bg-background/50 p-3">
                <div>
                  <p className="text-sm font-semibold">{accion.titulo}</p>
                  <p className="text-xs text-muted-foreground">{accion.subtitulo}</p>
                </div>
                {accion.tipo === 'actualizar' && (
                  <Link href="/config" className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90">
                    <RefreshCw className="h-3 w-3" /> Actualizar
                  </Link>
                )}
                {accion.tipo === 'cobrar' && clientesRiesgo[0] && (
                  <button onClick={() => handleCopyMessage(clientesRiesgo[0])} className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90">
                    <Copy className="h-3 w-3" /> Copiar cobro
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Financial summary strip */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-xl border bg-card p-3">
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <DollarSign className="h-3 w-3" /> Tienes
              </div>
              <p className="mt-0.5 text-lg font-bold">{fmtShort(resumen.tienes)}</p>
            </div>
            <div className="rounded-xl border bg-card p-3">
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <TrendingUp className="h-3 w-3" /> Te deben
              </div>
              <p className="mt-0.5 text-lg font-bold text-green-600">{fmtShort(resumen.teDeben)}</p>
              <p className="text-[9px] text-muted-foreground">Seguro: {fmtShort(resumen.teDebenSeguro)}</p>
            </div>
            <div className="rounded-xl border bg-card p-3">
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <TrendingDown className="h-3 w-3" /> Debes/mes
              </div>
              <p className="mt-0.5 text-lg font-bold text-red-500">{fmtShort(resumen.debes)}</p>
            </div>
            <div className="rounded-xl border bg-card p-3">
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <Clock className="h-3 w-3" /> Gasto prom.
              </div>
              <p className="mt-0.5 text-lg font-bold">{fmtShort(resumen.gastoMensual)}</p>
              <p className="text-[9px] text-muted-foreground">/mes (últ. 90d)</p>
            </div>
          </div>

          {/* P2-P4 micro indicators */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { key: 'P2', label: 'Cartera', desc: `${indicadores.p2.ratio.toFixed(1)}x`, estado: indicadores.p2.estado },
              { key: 'P3', label: 'Obligaciones', desc: `${indicadores.p3.ratio.toFixed(1)}x`, estado: indicadores.p3.estado },
              {
                key: 'P4', label: 'Flujo',
                desc: indicadores.p4.diasHastaFechaCritica !== null
                  ? `${indicadores.p4.diasHastaFechaCritica}d`
                  : 'OK 90d',
                estado: indicadores.p4.estado,
              },
            ].map(ind => {
              const ic = ESTADO_COLORS[ind.estado]
              return (
                <div key={ind.key} className={`rounded-lg border ${ic.border} ${ic.bg} p-2.5 text-center`}>
                  <span className="text-sm">{ind.estado === 'verde' ? '🟢' : ind.estado === 'amarillo' ? '🟡' : '🔴'}</span>
                  <p className={`text-xs font-semibold ${ic.text}`}>{ind.label}</p>
                  <p className="text-[10px] text-muted-foreground">{ind.desc}</p>
                </div>
              )
            })}
          </div>

          {/* Risk clients collapsible */}
          {clientesRiesgo.length > 0 && (
            <div>
              <button
                onClick={() => setShowRiesgo(!showRiesgo)}
                className="flex items-center gap-1.5 text-xs font-medium text-amber-600 hover:underline"
              >
                <AlertTriangle className="h-3 w-3" />
                {clientesRiesgo.length} cobro{clientesRiesgo.length !== 1 ? 's' : ''} en riesgo
              </button>
              {showRiesgo && (
                <div className="mt-2 space-y-1.5">
                  {clientesRiesgo.map((c, i) => {
                    const tipo = getTipoCobro(c.diasVencida)
                    return (
                      <div key={i} className="flex items-center justify-between rounded-lg border p-2.5 text-sm">
                        <div>
                          <p className="font-medium">{c.concepto}</p>
                          <p className="text-xs text-muted-foreground">{fmtShort(c.monto)} · {c.diasVencida}d</p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
                            tipo === 'urgente' ? 'bg-red-100 text-red-700 dark:bg-red-900/30' :
                            tipo === 'firme' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30' :
                            'bg-gray-100 text-gray-700 dark:bg-gray-800'
                          }`}>
                            {tipo}
                          </span>
                          <button onClick={() => handleCopyMessage(c)} className="rounded p-1 hover:bg-accent" title="Copiar mensaje">
                            <Copy className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        /* Semáforo onboarding */
        <div className="rounded-2xl border border-dashed p-6 text-center space-y-3">
          <span className="text-4xl">🏦</span>
          <p className="text-sm text-muted-foreground">
            Configura tus <strong>cuentas bancarias</strong> para activar tu semáforo financiero
          </p>
          <Link href="/config" className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
            Ir a configuración →
          </Link>
        </div>
      )}

      {/* ═══ PULSO + PREGUNTAS ═══ */}
      <div className="grid gap-6 lg:grid-cols-2">
        <PulsoMes
          ventasMes={dashData.pulso.ventasMes}
          metaVentas={dashData.pulso.metaVentas}
          cobradoMes={dashData.pulso.cobradoMes}
          metaCobros={dashData.pulso.metaCobros}
          gastoTotalMes={dashData.pulso.gastoTotalMes}
          gastosFijosMes={dashData.pulso.gastosFijosMes}
          hasMetas={dashData.hasMetas}
        />
        <CincoPreguntas
          caja={dashData.preguntas.caja}
          utilidad={dashData.preguntas.utilidad}
          margen={dashData.preguntas.margen}
          puntoEquilibrio={dashData.preguntas.puntoEquilibrio}
          runway={dashData.preguntas.runway}
          hasBankData={dashData.hasBankData}
        />
      </div>

      {/* Quick stats strip */}
      <div className="grid grid-cols-3 gap-3">
        <Link href="/proyectos" className="rounded-xl border bg-card p-4 hover:bg-accent transition-colors">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Briefcase className="h-3.5 w-3.5" /> Proyectos activos
          </div>
          <p className="mt-1 text-2xl font-bold">{dashData.stats.projectsActive}</p>
        </Link>
        <Link href="/proyectos" className="rounded-xl border bg-card p-4 hover:bg-accent transition-colors">
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
      </div>

      {/* Quick Action Modal */}
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
