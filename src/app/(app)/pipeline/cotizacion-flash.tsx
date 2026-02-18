'use client'

import { useMemo } from 'react'
import { Info, AlertTriangle } from 'lucide-react'
import {
  calcularFiscal,
  formatCOP,
  FISCAL_DISCLAIMER,
  DEFAULT_USER_PROFILE,
  DEFAULT_CLIENT_PROFILE,
  type FiscalBreakdown,
} from '@/lib/fiscal/calculos'

interface CotizacionFlashProps {
  valorBruto: number
  /** If user has completed fiscal profile, pass it. Otherwise defaults apply. */
  hasFiscalProfile?: boolean
}

/**
 * Cotización Flash — D32, D50, D86
 * Widget que muestra en real-time los cálculos fiscales de una oportunidad.
 * 3 bloques: Cliente paga → Te retienen → Te consignan
 */
export default function CotizacionFlash({ valorBruto, hasFiscalProfile = false }: CotizacionFlashProps) {
  const breakdown: FiscalBreakdown | null = useMemo(() => {
    if (!valorBruto || valorBruto <= 0) return null
    return calcularFiscal(valorBruto, DEFAULT_USER_PROFILE, DEFAULT_CLIENT_PROFILE)
  }, [valorBruto])

  if (!breakdown) return null

  return (
    <div className="mt-3 space-y-3 rounded-lg border bg-card p-4">
      {/* Title */}
      <div className="flex items-center gap-2">
        <h4 className="text-sm font-semibold">Cotización Flash</h4>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
          En vivo
        </span>
      </div>

      {/* No fiscal profile warning — D34 */}
      {!hasFiscalProfile && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900 dark:bg-amber-950/30">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-500" />
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Cálculo estimado con perfil conservador. Completa tu perfil fiscal en Configuración para ver números exactos.
          </p>
        </div>
      )}

      {/* Block 1: Cliente paga */}
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Cliente paga</p>
        <div className="space-y-0.5">
          <Row label="Valor bruto" value={breakdown.valorBruto} />
          {breakdown.hasIVA && (
            <Row label={`IVA (${breakdown.ivaRate}%)`} value={breakdown.iva} />
          )}
          <Row label="Total paga cliente" value={breakdown.totalClientePaga} bold />
        </div>
      </div>

      {/* Block 2: Te retienen */}
      {breakdown.hasRetenciones && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Te retienen</p>
          <div className="space-y-0.5">
            {breakdown.reteFuente > 0 && (
              <Row
                label={`ReteFuente (${breakdown.reteFuenteRate}%)`}
                value={-breakdown.reteFuente}
                negative
              />
            )}
            {breakdown.reteICA > 0 && (
              <Row
                label={`ReteICA (${breakdown.reteICARate}‰)`}
                value={-breakdown.reteICA}
                negative
              />
            )}
            {breakdown.reteIVA > 0 && (
              <Row
                label={`ReteIVA (${breakdown.reteIVARate}% del IVA)`}
                value={-breakdown.reteIVA}
                negative
              />
            )}
            <Row label="Total retenciones" value={-breakdown.totalRetenciones} bold negative />
          </div>
        </div>
      )}

      {/* Block 3: Te consignan — D33 */}
      <div className="rounded-lg bg-primary/5 p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Te consignan</span>
          <span className="text-lg font-bold text-primary">
            {formatCOP(breakdown.netoRecibido)}
          </span>
        </div>
        {breakdown.hasRetenciones && (
          <p className="mt-1 text-xs text-muted-foreground">
            Retenciones se recuperan en declaración de renta
          </p>
        )}
      </div>

      {/* Disclaimer — D93 */}
      <div className="flex items-start gap-1.5 pt-1">
        <Info className="mt-0.5 h-3 w-3 flex-shrink-0 text-muted-foreground/50" />
        <p className="text-[10px] leading-tight text-muted-foreground/60">
          {FISCAL_DISCLAIMER}
        </p>
      </div>
    </div>
  )
}

// ── Row Component ──────────────────────────────────────

function Row({
  label,
  value,
  bold = false,
  negative = false,
}: {
  label: string
  value: number
  bold?: boolean
  negative?: boolean
}) {
  return (
    <div className="flex items-center justify-between">
      <span className={`text-xs ${bold ? 'font-medium' : 'text-muted-foreground'}`}>
        {label}
      </span>
      <span
        className={`text-xs tabular-nums ${
          bold ? 'font-semibold' : ''
        } ${negative ? 'text-red-500 dark:text-red-400' : ''}`}
      >
        {formatCOP(Math.abs(value))}
        {negative && value !== 0 ? '' : ''}
      </span>
    </div>
  )
}
