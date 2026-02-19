'use client'

import { useState, useTransition } from 'react'
import {
  Wallet, TrendingUp, PiggyBank, Target, ShieldCheck,
  ArrowRight, Loader2, ChevronDown, ChevronUp,
} from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { saveNumerosSetup } from '../gastos/actions'
import MonthlyComparison from './monthly-comparison'
import MaturityIndicators from './maturity-indicators'
import { generateCSV, downloadCSV } from '@/lib/export-csv'

// ── Types ──────────────────────────────────────────────

type QuestionState = 'empty' | 'partial' | 'complete'

interface NumerosQuestion {
  id: number
  question: string
  icon: React.ElementType
  state: QuestionState
  answer?: string
  detail?: string
  ctaLabel?: string
  ctaHref?: string
  dots?: number       // D38: progress dots (1-3)
  dotsTotal?: number
}

interface NumerosData {
  totalExpensesMonth: number
  totalFixedExpenses: number
  totalPaymentsMonth: number
  totalWonValue: number
  pipelineValue: number
  activeProjectsCount: number
  completedProjectsCount: number
  totalOpportunities: number
  wonCount: number
  hasExpenses: boolean
  hasFixedExpenses: boolean
  hasPayments: boolean
  hasOpportunities: boolean
  hasFiscal: boolean
  hasFiscalEstimated: boolean
  ingresosMonth: number
  gastosMonth: number
  puntoEquilibrio: number
}

interface MonthlyData {
  month: string
  monthLabel: string
  ingresos: number
  gastos: number
  margen: number
  proyectos: number
  oportunidades: number
  hoursLogged: number
}

interface MaturityData {
  questionsComplete: number
  projectsClosed: number
  fixedExpenseCategories: number
  waCollaborators: number
  invoicesRegistered: number
}

interface NumerosClientProps {
  data: NumerosData | null
  isFirstVisit: boolean  // D52: show setup prompt
  monthlyData?: MonthlyData[]  // Sprint 12: monthly comparisons
  maturityData?: MaturityData  // Sprint 12: maturity indicators
}

// ── Formatters ─────────────────────────────────────────

const fmt = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

// ── First Visit Setup Prompt (D52) ─────────────────────

function FirstVisitPrompt({ onComplete }: { onComplete: () => void }) {
  const [gastosFijos, setGastosFijos] = useState('')
  const [isPending, startTransition] = useTransition()

  const handleAmountChange = (raw: string) => {
    const digits = raw.replace(/[^0-9]/g, '')
    if (!digits) { setGastosFijos(''); return }
    const num = parseInt(digits, 10)
    setGastosFijos(num.toLocaleString('es-CO'))
  }

  const handleSubmit = () => {
    const value = parseInt(gastosFijos.replace(/[^0-9]/g, ''), 10) || 0

    startTransition(async () => {
      await saveNumerosSetup({
        gastosFijosMensual: value > 0 ? value : undefined,
      })

      toast.success('¡Listo! Tus Números están tomando forma')
      onComplete()
    })
  }

  return (
    <div className="mx-auto max-w-md space-y-6 rounded-2xl border bg-card p-8 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
        <PiggyBank className="h-8 w-8 text-primary" />
      </div>
      <div>
        <h2 className="text-xl font-bold">Bienvenido a tus Números</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Para darte respuestas útiles, necesito un par de datos base.
        </p>
      </div>

      {/* D52: Prompt 2 campos */}
      <div className="space-y-4 text-left">
        <div className="space-y-1.5">
          <label htmlFor="gastosFijos" className="text-sm font-medium">
            ¿Cuánto gastas al mes en lo fijo?
          </label>
          <p className="text-xs text-muted-foreground">
            Arriendo, servicios, suscripciones, etc. Un número global está bien por ahora.
          </p>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
            <input
              id="gastosFijos"
              type="text"
              inputMode="numeric"
              placeholder="2.000.000"
              value={gastosFijos}
              onChange={(e) => handleAmountChange(e.target.value)}
              className="flex h-11 w-full rounded-lg border border-input bg-background pl-8 pr-4 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            />
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onComplete}
          className="flex h-11 flex-1 items-center justify-center rounded-lg border border-input text-sm font-medium transition-colors hover:bg-accent"
        >
          Después
        </button>
        <button
          onClick={handleSubmit}
          disabled={isPending}
          className="flex h-11 flex-1 items-center justify-center rounded-lg bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Guardar y ver Números'}
        </button>
      </div>
    </div>
  )
}

// ── Question Card ──────────────────────────────────────

function QuestionCard({ q }: { q: NumerosQuestion }) {
  const [expanded, setExpanded] = useState(false)

  const stateColors = {
    empty: 'border-border',
    partial: 'border-yellow-500/30 bg-yellow-50/50 dark:bg-yellow-950/10',
    complete: 'border-green-500/30 bg-green-50/50 dark:bg-green-950/10',
  }

  const stateBadge = {
    empty: { label: 'Sin datos', color: 'bg-muted-foreground/20 text-muted-foreground' },
    partial: { label: 'Parcial', color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' },
    complete: { label: 'Completo', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  }

  const Icon = q.icon
  const badge = stateBadge[q.state]

  return (
    <div className={`rounded-xl border transition-colors ${stateColors[q.state]}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-4 p-5 text-left"
      >
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
          q.state === 'complete' ? 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400' :
          q.state === 'partial' ? 'bg-yellow-100 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400' :
          'bg-muted text-muted-foreground'
        }`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">P{q.id}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.color}`}>
              {badge.label}
            </span>
            {/* D38: Dots progreso */}
            {q.dots !== undefined && q.dotsTotal !== undefined && (
              <div className="flex gap-0.5">
                {Array.from({ length: q.dotsTotal }, (_, i) => (
                  <div
                    key={i}
                    className={`h-1.5 w-1.5 rounded-full ${
                      i < q.dots! ? 'bg-primary' : 'bg-muted-foreground/20'
                    }`}
                  />
                ))}
              </div>
            )}
          </div>
          <p className="mt-1 font-semibold">{q.question}</p>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="border-t px-5 pb-5 pt-4">
          {q.state === 'empty' ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {q.detail || 'Registra acciones para que esta pregunta tenga respuesta.'}
              </p>
              {q.ctaLabel && q.ctaHref && (
                <Link
                  href={q.ctaHref}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  {q.ctaLabel}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {q.answer && (
                <p className="text-2xl font-bold">{q.answer}</p>
              )}
              {q.detail && (
                <p className="text-sm text-muted-foreground">{q.detail}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main Component ─────────────────────────────────────

export default function NumerosClient({ data, isFirstVisit, monthlyData, maturityData }: NumerosClientProps) {
  const [showSetup, setShowSetup] = useState(isFirstVisit)

  if (showSetup) {
    return (
      <div className="mx-auto max-w-2xl py-8">
        <FirstVisitPrompt onComplete={() => setShowSetup(false)} />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="text-2xl font-bold">Números</h1>
        <p className="text-muted-foreground">Error cargando datos.</p>
      </div>
    )
  }

  // ── Build 5 Questions with Transition Matrix ──

  // P1: ¿Cuánta plata tengo?
  // Empty→Parcial: 1 gasto o ingreso. Parcial→Completo: gastos + ingresos + saldo
  const p1HasSome = data.hasExpenses || data.hasPayments || data.totalWonValue > 0
  const p1Complete = data.hasExpenses && (data.hasPayments || data.totalWonValue > 0)
  const p1State: QuestionState = p1Complete ? 'complete' : p1HasSome ? 'partial' : 'empty'
  const flujoNeto = data.ingresosMonth - data.gastosMonth

  const p1: NumerosQuestion = {
    id: 1,
    question: '¿Cuánta plata tengo?',
    icon: Wallet,
    state: p1State,
    dots: p1State === 'partial' ? 1 : p1State === 'complete' ? 3 : 0,
    dotsTotal: 3,
    answer: p1State !== 'empty'
      ? fmt(flujoNeto)
      : undefined,
    detail: p1State === 'empty'
      ? 'Registra tu primer gasto o ingreso para activar esta pregunta.'
      : p1State === 'partial'
      ? `Ingresos: ${fmt(data.ingresosMonth)} — Gastos: ${fmt(data.gastosMonth)}. Registra más para tener la foto completa.`
      : `Ingresos del mes: ${fmt(data.ingresosMonth)} — Gastos del mes: ${fmt(data.gastosMonth)}`,
    ctaLabel: p1State === 'empty' ? 'Registrar gasto' : undefined,
    ctaHref: p1State === 'empty' ? '/pipeline' : undefined,
  }

  // P2: ¿Estoy ganando?
  // Empty→Parcial: 1 gasto + 1 ingreso. Parcial→Completo: mes completo
  const p2HasSome = data.hasExpenses && (data.hasPayments || data.totalWonValue > 0)
  const p2Complete = p2HasSome && data.ingresosMonth > 0 && data.gastosMonth > 0
  const p2State: QuestionState = p2Complete ? 'complete' : p2HasSome ? 'partial' : 'empty'
  const margenBruto = data.ingresosMonth > 0
    ? ((data.ingresosMonth - data.gastosMonth) / data.ingresosMonth) * 100
    : 0

  const p2: NumerosQuestion = {
    id: 2,
    question: '¿Estoy ganando?',
    icon: TrendingUp,
    state: p2State,
    dots: p2State === 'partial' ? 1 : p2State === 'complete' ? 3 : 0,
    dotsTotal: 3,
    answer: p2State !== 'empty'
      ? flujoNeto > 0
        ? `Sí, +${fmt(flujoNeto)} este mes`
        : flujoNeto < 0
        ? `No, −${fmt(Math.abs(flujoNeto))} este mes`
        : 'En equilibrio'
      : undefined,
    detail: p2State === 'empty'
      ? 'Necesito al menos 1 gasto y 1 ingreso para contestar.'
      : p2State === 'partial'
      ? 'Registra más transacciones este mes para una respuesta más precisa.'
      : `Margen bruto: ${margenBruto.toFixed(1)}%. Ingresos: ${fmt(data.ingresosMonth)} — Gastos: ${fmt(data.gastosMonth)}`,
    ctaLabel: p2State === 'empty' ? 'Registrar actividad' : undefined,
    ctaHref: p2State === 'empty' ? '/pipeline' : undefined,
  }

  // P3: ¿Cuánto queda para mí?
  // P2 completa + fiscal → + provisión impuestos
  const p3State: QuestionState = data.hasFiscal && p2State === 'complete'
    ? 'complete'
    : p2State !== 'empty' && (data.hasFiscal || data.hasFiscalEstimated)
    ? 'partial'
    : 'empty'

  const p3: NumerosQuestion = {
    id: 3,
    question: '¿Cuánto queda para mí?',
    icon: PiggyBank,
    state: p3State,
    dots: p3State === 'partial' ? 1 : p3State === 'complete' ? 3 : 0,
    dotsTotal: 3,
    answer: p3State !== 'empty'
      ? fmt(flujoNeto) // Simplified — full fiscal in Sprint 6
      : undefined,
    detail: p3State === 'empty'
      ? 'Completa tu perfil fiscal para que ONE calcule cuánto es realmente tuyo después de impuestos.'
      : p3State === 'partial'
      ? data.hasFiscalEstimated
        ? 'Usando valores fiscales estimados. Completa tu perfil fiscal para datos exactos.'
        : 'Parcial — completa tu perfil fiscal en Configuración.'
      : `Ganancia después de provisión fiscal. Completa para precisar.`,
    ctaLabel: p3State === 'empty' ? 'Configurar perfil fiscal' : undefined,
    ctaHref: p3State === 'empty' ? '/config' : undefined,
  }

  // P4: ¿Cuánto necesito vender?
  // 1 gasto fijo → fijos completos + margen
  const p4State: QuestionState = data.hasFixedExpenses && data.totalFixedExpenses > 0
    ? data.hasExpenses && data.ingresosMonth > 0 ? 'complete' : 'partial'
    : 'empty'

  const p4: NumerosQuestion = {
    id: 4,
    question: '¿Cuánto necesito vender?',
    icon: Target,
    state: p4State,
    dots: p4State === 'partial' ? 1 : p4State === 'complete' ? 2 : 0,
    dotsTotal: 2,
    answer: p4State !== 'empty'
      ? `Mínimo ${fmt(data.totalFixedExpenses)}/mes`
      : undefined,
    detail: p4State === 'empty'
      ? 'Configura tus gastos fijos para calcular tu punto de equilibrio.'
      : p4State === 'partial'
      ? `Gastos fijos: ${fmt(data.totalFixedExpenses)}/mes. Registra gastos e ingresos para un cálculo más preciso.`
      : `Punto de equilibrio: ${fmt(data.totalFixedExpenses)}/mes en gastos fijos. Con margen, necesitas vender más.`,
    ctaLabel: p4State === 'empty' ? 'Configurar gastos fijos' : undefined,
    ctaHref: p4State === 'empty' ? '/config' : undefined,
  }

  // P5: ¿Cuánto aguanto?
  // Saldo + 1 mes gastos → + proyección real
  const totalGastosMes = data.gastosMonth > 0 ? data.gastosMonth : data.totalFixedExpenses
  const mesesRunway = totalGastosMes > 0 && flujoNeto < 0
    ? Math.max(0, Math.floor(Math.abs(flujoNeto) / totalGastosMes * -1) + 6) // placeholder
    : totalGastosMes > 0
    ? 99 // gaining money, unlimited
    : 0

  const p5HasSome = data.hasExpenses || data.hasFixedExpenses
  const p5State: QuestionState = p5HasSome && data.ingresosMonth > 0 ? 'complete' : p5HasSome ? 'partial' : 'empty'

  const p5: NumerosQuestion = {
    id: 5,
    question: '¿Cuánto aguanto?',
    icon: ShieldCheck,
    state: p5State,
    dots: p5State === 'partial' ? 1 : p5State === 'complete' ? 3 : 0,
    dotsTotal: 3,
    answer: p5State !== 'empty'
      ? flujoNeto >= 0
        ? 'Estás creciendo'
        : totalGastosMes > 0
        ? `~${Math.ceil(Math.abs(data.ingresosMonth) / totalGastosMes)} meses`
        : 'Necesito más datos'
      : undefined,
    detail: p5State === 'empty'
      ? 'Registra gastos fijos y actividad del mes para proyectar tu runway.'
      : p5State === 'partial'
      ? `Gastos mensuales: ${fmt(totalGastosMes)}. Registra ingresos para proyectar cuánto aguantas.`
      : flujoNeto >= 0
      ? `Tus ingresos (${fmt(data.ingresosMonth)}) superan tus gastos (${fmt(data.gastosMonth)}). ¡Sigue así!`
      : `Con tus gastos de ${fmt(totalGastosMes)}/mes y tus ingresos actuales, tienes margen limitado.`,
    ctaLabel: p5State === 'empty' ? 'Configurar gastos fijos' : undefined,
    ctaHref: p5State === 'empty' ? '/config' : undefined,
  }

  const questions = [p1, p2, p3, p4, p5]
  const completedCount = questions.filter(q => q.state === 'complete').length
  const partialCount = questions.filter(q => q.state === 'partial').length

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Números</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          5 preguntas clave sobre tu negocio.{' '}
          <span className="font-medium">
            {completedCount}/5 completas
            {partialCount > 0 && `, ${partialCount} parciales`}
          </span>
        </p>
      </div>

      {/* D37: Disclaimer parcial */}
      {completedCount < 5 && (completedCount > 0 || partialCount > 0) && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50/50 px-4 py-3 text-sm text-yellow-800 dark:border-yellow-900/30 dark:bg-yellow-950/10 dark:text-yellow-200">
          Algunos números son parciales. Registra más actividad para respuestas completas.
        </div>
      )}

      {/* Pipeline summary — quick context */}
      {data.hasOpportunities && (
        <div className="flex gap-3">
          <div className="flex-1 rounded-lg border bg-card p-4">
            <p className="text-xs text-muted-foreground">Pipeline activo</p>
            <p className="mt-1 text-lg font-bold">{fmt(data.pipelineValue)}</p>
            <p className="text-xs text-muted-foreground">{data.totalOpportunities - data.wonCount} oportunidades</p>
          </div>
          <div className="flex-1 rounded-lg border bg-card p-4">
            <p className="text-xs text-muted-foreground">Ganado</p>
            <p className="mt-1 text-lg font-bold">{fmt(data.totalWonValue)}</p>
            <p className="text-xs text-muted-foreground">{data.wonCount} proyecto{data.wonCount !== 1 ? 's' : ''}</p>
          </div>
        </div>
      )}

      {/* 5 Questions */}
      <div className="space-y-3">
        {questions.map((q) => (
          <QuestionCard key={q.id} q={q} />
        ))}
      </div>

      {/* Sprint 12: Monthly Comparison — D83 */}
      {monthlyData && monthlyData.length >= 2 && (
        <div className="space-y-3">
          <h2 className="text-lg font-bold">Comparativo mensual</h2>
          <MonthlyComparison months={monthlyData} />
        </div>
      )}

      {/* Sprint 12: Maturity Indicators — D82 */}
      {maturityData && (
        <MaturityIndicators data={maturityData} />
      )}

      {/* Sprint 12: CSV Export — D70 */}
      <div className="flex justify-center">
        <button
          onClick={() => {
            // Quick export of current Números summary
            const csvData = [
              {
                indicador: 'Ingresos del mes',
                valor: data.ingresosMonth,
                estado: data.hasPayments ? 'Datos reales' : 'Sin datos',
              },
              {
                indicador: 'Gastos del mes',
                valor: data.gastosMonth,
                estado: data.hasExpenses ? 'Datos reales' : 'Sin datos',
              },
              {
                indicador: 'Gastos fijos',
                valor: data.totalFixedExpenses,
                estado: data.hasFixedExpenses ? 'Configurado' : 'Sin configurar',
              },
              {
                indicador: 'Pipeline activo',
                valor: data.pipelineValue,
                estado: data.hasOpportunities ? 'Activo' : 'Vacío',
              },
              {
                indicador: 'Proyectos activos',
                valor: data.activeProjectsCount,
                estado: data.activeProjectsCount > 0 ? 'Activo' : 'Sin proyectos',
              },
            ]
            const csv = generateCSV(csvData, [
              { header: 'Indicador', accessor: (r) => r.indicador },
              { header: 'Valor', accessor: (r) => r.valor },
              { header: 'Estado', accessor: (r) => r.estado },
            ])
            downloadCSV(csv, `numeros-${new Date().toISOString().slice(0, 10)}`)
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          Exportar CSV
        </button>
      </div>

      {/* D40: Breadcrumbs — "Esto es un resultado, no un módulo" */}
      <p className="text-center text-xs text-muted-foreground">
        Tus Números se actualizan en tiempo real con cada acción que registras.
      </p>
    </div>
  )
}
