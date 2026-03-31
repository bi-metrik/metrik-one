'use client'

import { useState, useTransition, useEffect } from 'react'
import { ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { formatCOP } from '@/lib/contacts/constants'
import QuestionCard from './question-card'
import Semaforo from './semaforo'
import FranjaConciliacion from './franja-conciliacion'
import SaldoDialog from './saldo-dialog'
import DrillDownSheet from './drill-down-sheet'
import type { NumerosData } from './actions-v2'
import { getNumeros } from './actions-v2'
import { FEATURES } from '@/lib/feature-flags'

interface Props {
  initialData: NumerosData | null
}

export default function NumerosV2Client({ initialData }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [data, setData] = useState(initialData)
  const [mesRef, setMesRef] = useState(initialData?.mesRef ?? getCurrentMes())
  const [isPending, startTransition] = useTransition()
  const [showSaldoDialog, setShowSaldoDialog] = useState(false)
  const [activeDrill, setActiveDrill] = useState<1 | 2 | 3 | 4 | 5 | null>(null)

  // Open saldo dialog when arriving via ?saldo=1 (only when CONCILIACION is enabled)
  useEffect(() => {
    if (FEATURES.CONCILIACION && searchParams.get('saldo') === '1') {
      setShowSaldoDialog(true)
      router.replace('/numeros', { scroll: false })
    }
  }, [searchParams, router])

  // C12: límite 24 meses atrás
  const minMes = (() => {
    const d = new Date()
    d.setMonth(d.getMonth() - 24)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })()

  const navigateMonth = (direction: -1 | 1) => {
    if (direction === -1 && mesRef <= minMes) return
    const [y, m] = mesRef.split('-').map(Number)
    const newDate = new Date(y, m - 1 + direction, 1)
    const newMes = `${newDate.getFullYear()}-${String(newDate.getMonth() + 1).padStart(2, '0')}`
    setMesRef(newMes)
    startTransition(async () => {
      const newData = await getNumeros(newMes)
      setData(newData)
    })
  }

  if (!data) {
    return <EmptyOnboarding />
  }

  const now = new Date()
  const currentMes = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const monthType: 'current' | 'past' | 'future' =
    mesRef === currentMes ? 'current' : mesRef < currentMes ? 'past' : 'future'

  const [yyyy, mm] = mesRef.split('-').map(Number)
  const monthName = new Date(yyyy, mm - 1).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })

  // D108-rev: Cards always visible. Capa 1 is informative, not blocking.
  const showCards = true

  // ── Color calculations (D105) ─────────────────────
  const ritmoRecaudo = data.metaRecaudo
    ? data.metaRecaudo * (data.diaActual / data.diasDelMes)
    : null
  const recaudoColor = monthType !== 'current' || !ritmoRecaudo
    ? undefined
    : data.recaudoMes >= ritmoRecaudo ? '#10B981'
    : data.recaudoMes >= ritmoRecaudo * 0.8 ? '#F59E0B'
    : '#EF4444'

  const ritmoVentas = data.metaVentas
    ? data.metaVentas * (data.diaActual / data.diasDelMes)
    : null

  // P4 color
  let ventasColor: string | undefined
  if (monthType === 'current' && data.puntoEquilibrio > 0) {
    if (data.ventasMes >= data.puntoEquilibrio) ventasColor = '#10B981'
    else if (data.diaActual <= data.diasDelMes * 0.5) ventasColor = '#F59E0B'
    else ventasColor = '#EF4444'
  }

  // P3 trend is inverted (cartera down = good)
  const carteraTrend = data.carteraPendiente < data.carteraMesAnterior ? 'down'
    : data.carteraPendiente > data.carteraMesAnterior * 1.05 ? 'up'
    : 'stable' as const

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-base font-bold">
          Mis Numeros
        </h1>
        <div className="flex items-center gap-1">
          <button
            onClick={() => navigateMonth(-1)}
            className={`p-1 rounded hover:bg-accent transition-opacity ${mesRef <= minMes ? 'opacity-50 cursor-not-allowed' : ''}`}
            disabled={isPending || mesRef <= minMes}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className={`text-sm font-medium min-w-[120px] text-center capitalize ${isPending ? 'opacity-50' : ''}`}>
            {monthName}
          </span>
          <button
            onClick={() => navigateMonth(1)}
            className="p-1 rounded hover:bg-accent"
            disabled={isPending}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Semáforo */}
      <Semaforo data={data.semaforo} />

      {/* Franja Conciliación */}
      {FEATURES.CONCILIACION && data.conciliacion && <FranjaConciliacion data={data.conciliacion} />}

      {/* Cards or placeholder */}
      {!showCards ? (
        <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground space-y-2">
          <p className="font-medium">Completa los pendientes para activar tus numeros</p>
          <p className="text-xs">Necesitas al menos: 1 gasto fijo, meta de ventas del mes y saldo bancario</p>
        </div>
      ) : (
        <>
          {/* P1 + P2 (2 columns) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* P1: ¿Cuánta plata tengo? — Saldo bancario + meta de cobro del mes */}
            <QuestionCard
              questionNumber={1}
              title="¿Cuánta plata tengo?"
              value={data.saldoCaja}
              valueFormat="currency"
              trend={data.recaudoMes > data.recaudoMesAnterior ? 'up' : data.recaudoMes < data.recaudoMesAnterior * 0.95 ? 'down' : 'stable'}
              trendIsPositive={true}
              barType="progress"
              barData={{
                current: data.recaudoMes,
                target: data.metaRecaudo ?? 1,
                label: 'Cobrado este mes',
                sublabel: data.metaRecaudo
                  ? `${formatCOP(data.recaudoMes)} de ${formatCOP(data.metaRecaudo)} (${data.metaRecaudo > 0 ? Math.round((data.recaudoMes / data.metaRecaudo) * 100) : 0}%)`
                  : 'Sin meta de cobro',
              }}
              barColor={recaudoColor}
              onClick={() => setActiveDrill(1)}
              isEmpty={monthType === 'future'}
              monthType={monthType}

            />

            {/* P2: ¿Estoy ganando? */}
            <QuestionCard
              questionNumber={2}
              title="¿Estoy ganando?"
              value={data.utilidad}
              valueFormat="currency"
              trend={data.utilidad > (data.ingresosMesAnterior - data.gastosMesAnterior) ? 'up' : data.utilidad < (data.ingresosMesAnterior - data.gastosMesAnterior) * 0.95 ? 'down' : 'stable'}
              trendIsPositive={true}
              barType="dual"
              barData={{
                bar1: { value: data.ingresosMes, label: 'Ingresos' },
                bar2: { value: data.gastosMes, label: 'Gastos' },
              }}
              onClick={() => setActiveDrill(2)}
              isEmpty={monthType === 'future'}
              monthType={monthType}

            />
          </div>

          {/* D119: CxP banner */}
          {data.cxpTotal > 0 && (
            <a
              href="/movimientos?tipo=egresos&estadoPago=pendiente"
              className="flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm transition-colors hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-950/40 dark:hover:bg-orange-950/60"
            >
              <AlertTriangle className="h-4 w-4 shrink-0 text-orange-600 dark:text-orange-400" />
              <span className="text-orange-800 dark:text-orange-300">
                <span className="font-semibold">Cuentas por pagar:</span>{' '}
                {formatCOP(data.cxpTotal)}{' '}
                <span className="text-orange-600 dark:text-orange-400">
                  ({data.cxpCount} pendiente{data.cxpCount !== 1 ? 's' : ''})
                </span>
              </span>
            </a>
          )}

          {/* P3 + P4 (2 columns) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* P3: ¿Cuánto me deben? — Cartera (facturas pendientes de cobro) */}
            <QuestionCard
              questionNumber={3}
              title="¿Cuánto me deben?"
              value={data.carteraPendiente}
              valueFormat="currency"
              trend={carteraTrend}
              trendIsPositive={carteraTrend === 'down'}
              barType="progress"
              barData={{
                current: data.totalCobrado,
                target: data.totalFacturado || 1,
                label: 'Cobrado',
                sublabel: data.totalFacturado > 0
                  ? `${formatCOP(data.totalCobrado)} de ${formatCOP(data.totalFacturado)} (${Math.round((data.totalCobrado / data.totalFacturado) * 100)}%)`
                  : 'Sin facturas emitidas',
              }}
              barColor={
                data.totalFacturado > 0
                  ? (data.totalCobrado / data.totalFacturado) >= 0.7 ? '#10B981'
                    : (data.totalCobrado / data.totalFacturado) >= 0.5 ? '#F59E0B'
                    : '#EF4444'
                  : undefined
              }
              onClick={() => setActiveDrill(3)}
              isEmpty={monthType === 'future'}
              monthType={monthType}

            />

            {/* P4: ¿Cuánto necesito vender? */}
            <QuestionCard
              questionNumber={4}
              title="¿Cuánto necesito vender?"
              value={data.puntoEquilibrio}
              valueFormat="currency"
              trend={data.puntoEquilibrio > data.costosFijosMes ? 'up' : 'stable'}
              trendIsPositive={false}
              barType="dual_marker"
              barData={{
                current: data.ventasMes,
                target: data.metaVentas ?? data.puntoEquilibrio * 1.5,
                marker: data.puntoEquilibrio,
                markerLabel: `Necesitas ${formatCOP(data.puntoEquilibrio)}`,
              }}
              barColor={ventasColor}
              onClick={() => setActiveDrill(4)}
              isEmpty={monthType === 'future'}
              monthType={monthType}

            />
          </div>

          {/* P5: ¿Cuánto aguanto? (full width) */}
          <QuestionCard
            questionNumber={5}
            title="¿Cuánto aguanto?"
            value={data.runwayMeses}
            valueFormat="months"
            trend={data.runwayMeses > 6 ? 'up' : data.runwayMeses < 3 ? 'down' : 'stable'}
            trendIsPositive={data.runwayMeses > 3}
            barType="gauge"
            barData={{
              value: data.runwayMeses,
              zones: [
                { start: 0, end: 3, color: '#EF4444' },
                { start: 3, end: 6, color: '#F59E0B' },
                { start: 6, end: 12, color: '#10B981' },
              ],
            }}
            onClick={() => setActiveDrill(5)}
            isEmpty={monthType === 'future'}
            monthType={monthType}
          />
        </>
      )}

      {/* Saldo Dialog */}
      {showSaldoDialog && (
        <SaldoDialog onClose={() => { setShowSaldoDialog(false); router.refresh() }} />
      )}

      {/* Drill-down sheet */}
      {activeDrill && (
        <DrillDownSheet
          questionNumber={activeDrill}
          data={data}
          monthType={monthType}
          onClose={() => setActiveDrill(null)}
          onChangeDrill={(q) => setActiveDrill(q)}
        />
      )}
    </div>
  )
}

// ── Empty onboarding ──────────────────────────────────

function EmptyOnboarding() {
  return (
    <div className="mx-auto max-w-md space-y-6 py-12 text-center">
      <h1 className="text-xl font-bold">Bienvenido a Mis Numeros!</h1>
      <p className="text-sm text-muted-foreground">
        Para que tus numeros cobren vida, necesitas completar estos pasos:
      </p>

      <div className="space-y-3 text-left">
        <OnboardingStep
          step={1}
          label="Configura tus gastos fijos mensuales"
          href="/mi-negocio"
        />
        <OnboardingStep
          step={2}
          label="Define tu meta de ventas del mes"
          href="/mi-negocio"
        />
        <OnboardingStep
          step={3}
          label="Registra tu saldo bancario actual"
          href="/numeros"
        />
        <OnboardingStep
          step={4}
          label="Crea tu primera oportunidad o proyecto"
          href="/pipeline"
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Cuando completes 1, 2 y 3, tus numeros se activan automaticamente. 🚀
      </p>
    </div>
  )
}

function OnboardingStep({ step, label, href }: { step: number; label: string; href: string }) {
  return (
    <a
      href={href}
      className="flex items-center gap-3 rounded-lg border p-3 hover:bg-accent transition-colors"
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
        {step}
      </span>
      <span className="text-sm font-medium">{label}</span>
    </a>
  )
}

function getCurrentMes() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}
