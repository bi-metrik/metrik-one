'use client'

import { useState, useTransition } from 'react'
import { ChevronLeft, ChevronRight, Flame, Target, Receipt, Banknote, Plus, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { formatCOP } from '@/lib/contacts/constants'
import QuestionCard from './question-card'
import Semaforo from './semaforo'
import FranjaConciliacion from './franja-conciliacion'
import SaldoDialog from './saldo-dialog'
import type { NumerosData } from './actions-v2'
import { getNumeros } from './actions-v2'

interface Props {
  initialData: NumerosData | null
}

export default function NumerosV2Client({ initialData }: Props) {
  const router = useRouter()
  const [data, setData] = useState(initialData)
  const [mesRef, setMesRef] = useState(initialData?.mesRef ?? getCurrentMes())
  const [isPending, startTransition] = useTransition()
  const [showFab, setShowFab] = useState(false)
  const [showSaldoDialog, setShowSaldoDialog] = useState(false)

  const navigateMonth = (direction: -1 | 1) => {
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

  // Show cards?
  const showCards = data.semaforo.capa1Estado !== 'red'
  const hasWarning = data.semaforo.capa1Estado === 'yellow'

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
          Hola {data.nombreUsuario}
        </h1>
        <div className="flex items-center gap-1">
          <button
            onClick={() => navigateMonth(-1)}
            className="p-1 rounded hover:bg-accent"
            disabled={isPending}
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
      <FranjaConciliacion data={data.conciliacion} />

      {/* Cards or placeholder */}
      {!showCards ? (
        <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          Completa los pendientes de arriba para ver tus 5 numeros
        </div>
      ) : (
        <>
          {/* P1 + P2 (2 columns) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* P1: ¿Cuánta plata tengo? */}
            <QuestionCard
              questionNumber={1}
              title="¿Cuanta plata tengo?"
              value={data.saldoCaja}
              valueFormat="currency"
              trend={data.recaudoMes > data.recaudoMesAnterior ? 'up' : data.recaudoMes < data.recaudoMesAnterior * 0.95 ? 'down' : 'stable'}
              trendIsPositive={true}
              barType="progress"
              barData={{
                current: data.recaudoMes,
                target: data.metaRecaudo ?? 1,
                label: `Recaudo`,
                sublabel: data.metaRecaudo
                  ? `${formatCOP(data.recaudoMes)} / ${formatCOP(data.metaRecaudo)} (${data.metaRecaudo > 0 ? Math.round((data.recaudoMes / data.metaRecaudo) * 100) : 0}%)`
                  : 'Sin meta',
              }}
              barColor={recaudoColor}
              isEmpty={monthType === 'future'}
              monthType={monthType}
              hasWarningBadge={hasWarning}
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
              isEmpty={monthType === 'future'}
              monthType={monthType}
              hasWarningBadge={hasWarning}
            />
          </div>

          {/* P3 + P4 (2 columns) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* P3: ¿Cuánto me deben? */}
            <QuestionCard
              questionNumber={3}
              title="¿Cuanto me deben?"
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
                  ? `${formatCOP(data.totalCobrado)} / ${formatCOP(data.totalFacturado)} (${Math.round((data.totalCobrado / data.totalFacturado) * 100)}%)`
                  : 'Sin facturas',
              }}
              barColor={
                data.totalFacturado > 0
                  ? (data.totalCobrado / data.totalFacturado) >= 0.7 ? '#10B981'
                    : (data.totalCobrado / data.totalFacturado) >= 0.5 ? '#F59E0B'
                    : '#EF4444'
                  : undefined
              }
              isEmpty={monthType === 'future'}
              monthType={monthType}
              hasWarningBadge={hasWarning}
            />

            {/* P4: ¿Cuánto necesito vender? */}
            <QuestionCard
              questionNumber={4}
              title="¿Cuanto necesito vender?"
              value={data.puntoEquilibrio}
              valueFormat="currency"
              trend={data.puntoEquilibrio > data.costosFijosMes ? 'up' : 'stable'}
              trendIsPositive={false}
              barType="dual_marker"
              barData={{
                current: data.ventasMes,
                target: data.metaVentas ?? data.puntoEquilibrio * 1.5,
                marker: data.puntoEquilibrio,
                markerLabel: `PE ${formatCOP(data.puntoEquilibrio)}`,
              }}
              barColor={ventasColor}
              isEmpty={monthType === 'future'}
              monthType={monthType}
              hasWarningBadge={hasWarning}
            />
          </div>

          {/* P5: ¿Cuánto aguanto? (full width) */}
          <QuestionCard
            questionNumber={5}
            title="¿Cuanto aguanto?"
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
            isEmpty={monthType === 'future'}
            monthType={monthType}
            hasWarningBadge={hasWarning}
          />
        </>
      )}

      {/* ── FAB ──────────────────────────────────────── */}
      {showFab && (
        <div
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]"
          onClick={() => setShowFab(false)}
        />
      )}

      {showFab && (
        <div className="fixed bottom-24 right-6 z-50 flex flex-col-reverse items-end gap-2">
          <button
            onClick={() => { setShowFab(false); router.push('/nuevo/oportunidad') }}
            className="flex items-center gap-2 rounded-full bg-orange-500 px-4 py-2.5 text-sm font-medium text-white shadow-lg hover:bg-orange-600"
          >
            <Target className="h-4 w-4" />
            Nueva oportunidad
          </button>
          <button
            onClick={() => { setShowFab(false); router.push('/nuevo/gasto') }}
            className="flex items-center gap-2 rounded-full bg-red-500 px-4 py-2.5 text-sm font-medium text-white shadow-lg hover:bg-red-600"
          >
            <Receipt className="h-4 w-4" />
            Registrar gasto
          </button>
          <button
            onClick={() => { setShowFab(false); router.push('/proyectos') }}
            className="flex items-center gap-2 rounded-full bg-green-500 px-4 py-2.5 text-sm font-medium text-white shadow-lg hover:bg-green-600"
          >
            <Banknote className="h-4 w-4" />
            Registrar cobro
          </button>
          <button
            onClick={() => { setShowFab(false); setShowSaldoDialog(true) }}
            className="flex items-center gap-2 rounded-full bg-blue-500 px-4 py-2.5 text-sm font-medium text-white shadow-lg hover:bg-blue-600"
          >
            <Flame className="h-4 w-4" />
            Actualizar saldo
          </button>
        </div>
      )}

      <button
        onClick={() => setShowFab(!showFab)}
        className={`fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-all ${
          showFab
            ? 'bg-foreground text-background'
            : 'bg-primary text-primary-foreground'
        }`}
      >
        {showFab ? <X className="h-6 w-6" /> : <Plus className="h-6 w-6" />}
      </button>

      {/* Saldo Dialog */}
      {showSaldoDialog && (
        <SaldoDialog onClose={() => { setShowSaldoDialog(false); router.refresh() }} />
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
          href="/config"
        />
        <OnboardingStep
          step={2}
          label="Define tu meta de ventas del mes"
          href="/config"
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
