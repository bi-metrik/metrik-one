'use client'

import { TrendingUp, TrendingDown, AlertTriangle, RotateCcw } from 'lucide-react'

/**
 * Sprint 12 — D88: Presupuesto vs Real enriquecido con rework tracking
 * Tab en proyecto 360
 */

interface BudgetVsRealProps {
  quotedPrice: number
  quotedCost: number
  actualInvoiced: number
  actualReceived: number
  actualExpenses: number
  reworkExpenses: number
  totalHours: number
  status: string
}

const fmt = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

function VarianceIndicator({ label, quoted, actual, invertColors = false }: {
  label: string
  quoted: number
  actual: number
  invertColors?: boolean // For costs: red = over budget
}) {
  const variance = actual - quoted
  const pctVariance = quoted > 0 ? (variance / quoted) * 100 : 0

  const isPositive = invertColors ? variance < 0 : variance > 0
  const isNegative = invertColors ? variance > 0 : variance < 0

  return (
    <div className="flex items-center justify-between rounded-lg border p-3">
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-sm font-medium">{fmt(actual)}</span>
          <span className="text-xs text-muted-foreground">/ {fmt(quoted)}</span>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {isPositive && <TrendingUp className="h-4 w-4 text-green-500" />}
        {isNegative && <TrendingDown className="h-4 w-4 text-red-500" />}
        {variance === 0 && <span className="h-4 w-4 text-muted-foreground">—</span>}
        <span className={`text-sm font-medium ${
          isPositive ? 'text-green-600 dark:text-green-400' :
          isNegative ? 'text-red-600 dark:text-red-400' :
          'text-muted-foreground'
        }`}>
          {variance > 0 ? '+' : ''}{pctVariance.toFixed(1)}%
        </span>
      </div>
    </div>
  )
}

export default function BudgetVsReal({
  quotedPrice,
  quotedCost,
  actualInvoiced,
  actualReceived,
  actualExpenses,
  reworkExpenses,
  totalHours,
  status,
}: BudgetVsRealProps) {
  const actualMargin = actualReceived > 0
    ? ((actualReceived - actualExpenses) / actualReceived) * 100
    : 0
  const quotedMargin = quotedPrice > 0 && quotedCost > 0
    ? ((quotedPrice - quotedCost) / quotedPrice) * 100
    : 0
  const netExpenses = actualExpenses - reworkExpenses

  const isOverBudget = actualExpenses > quotedCost * 1.1 // >10% over
  const hasLowMargin = actualMargin < quotedMargin - 10

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Presupuesto vs Real</h3>
        {status === 'completed' && (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
            Cerrado
          </span>
        )}
      </div>

      {/* Alerts */}
      {isOverBudget && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
          Los gastos superan el presupuesto por {fmt(actualExpenses - quotedCost)}
        </div>
      )}
      {hasLowMargin && !isOverBudget && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
          El margen real es {(quotedMargin - actualMargin).toFixed(1)} puntos menor al cotizado
        </div>
      )}

      {/* Key metrics */}
      <div className="space-y-2">
        <VarianceIndicator
          label="Ingresos"
          quoted={quotedPrice}
          actual={actualReceived}
        />
        <VarianceIndicator
          label="Gastos"
          quoted={quotedCost}
          actual={actualExpenses}
          invertColors
        />
      </div>

      {/* Margin comparison */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Margen cotizado</p>
          <p className="mt-1 text-lg font-bold">
            {quotedMargin > 0 ? `${quotedMargin.toFixed(1)}%` : '—'}
          </p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Margen real</p>
          <p className={`mt-1 text-lg font-bold ${
            actualMargin >= quotedMargin ? 'text-green-600 dark:text-green-400' :
            actualMargin >= 0 ? 'text-amber-600 dark:text-amber-400' :
            'text-red-600 dark:text-red-400'
          }`}>
            {actualReceived > 0 ? `${actualMargin.toFixed(1)}%` : '—'}
          </p>
        </div>
      </div>

      {/* Rework tracking */}
      {reworkExpenses > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-900/30 dark:bg-amber-950/10">
          <div className="flex items-center gap-2">
            <RotateCcw className="h-4 w-4 text-amber-500" />
            <span className="text-sm font-medium text-amber-700 dark:text-amber-400">
              Rework: {fmt(reworkExpenses)}
            </span>
          </div>
          <p className="mt-1 text-xs text-amber-600 dark:text-amber-500">
            Sin rework, los gastos serían {fmt(netExpenses)} y el margen {
              actualReceived > 0 ? `${((actualReceived - netExpenses) / actualReceived * 100).toFixed(1)}%` : '—'
            }
          </p>
        </div>
      )}

      {/* Desglose */}
      <div className="rounded-lg border p-3 space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Desglose</p>
        <div className="space-y-1.5">
          <Row label="Facturado" value={fmt(actualInvoiced)} />
          <Row label="Cobrado" value={fmt(actualReceived)} />
          <Row label="Gastos totales" value={fmt(actualExpenses)} highlight={isOverBudget} />
          {reworkExpenses > 0 && (
            <Row label="→ de los cuales rework" value={fmt(reworkExpenses)} dimmed />
          )}
          <Row label="Horas registradas" value={`${totalHours}h`} />
          <div className="border-t pt-1.5">
            <Row label="Resultado neto" value={fmt(actualReceived - actualExpenses)} bold />
          </div>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, bold, dimmed, highlight }: {
  label: string
  value: string
  bold?: boolean
  dimmed?: boolean
  highlight?: boolean
}) {
  return (
    <div className="flex items-center justify-between">
      <span className={`text-sm ${dimmed ? 'text-muted-foreground/60 pl-3' : 'text-muted-foreground'}`}>{label}</span>
      <span className={`text-sm ${
        bold ? 'font-bold' :
        highlight ? 'font-medium text-red-600 dark:text-red-400' :
        'font-medium'
      }`}>{value}</span>
    </div>
  )
}
