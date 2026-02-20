'use client'

import { AlertTriangle, Clock, FileText, Banknote, Lightbulb } from 'lucide-react'

// ── Types ─────────────────────────────────────────────

interface Financiero {
  presupuesto_total: number | null
  presupuesto_consumido_pct: number | null
  horas_estimadas: number | null
  horas_reales: number | null
  facturado: number | null
  cobrado: number | null
  costo_acumulado: number | null
}

interface Factura {
  estado_pago: string | null
  dias_antiguedad: number | null
  saldo_pendiente: number | null
}

interface Props {
  financiero: Financiero
  facturas: Factura[]
}

interface Alerta {
  id: string
  severity: 'red' | 'yellow' | 'tip'
  icon: React.ReactNode
  message: string
}

// ── Alert calculations (§6.2) ─────────────────────────

function calcularAlertas(f: Financiero, facturas: Factura[]): Alerta[] {
  const alertas: Alerta[] = []

  // A01: Desvío presupuestal > 90% (🔴)
  const consumo = f.presupuesto_consumido_pct ?? 0
  if (consumo > 90) {
    alertas.push({
      id: 'A01',
      severity: 'red',
      icon: <AlertTriangle className="h-3.5 w-3.5" />,
      message: `Presupuesto consumido al ${consumo}% — riesgo de sobrecosto`,
    })
  }

  // A02: Horas excedidas (🟡)
  const horasEst = f.horas_estimadas ?? 0
  const horasReal = f.horas_reales ?? 0
  if (horasEst > 0 && horasReal > horasEst) {
    const exceso = Math.round(((horasReal - horasEst) / horasEst) * 100)
    alertas.push({
      id: 'A02',
      severity: 'yellow',
      icon: <Clock className="h-3.5 w-3.5" />,
      message: `Horas excedidas en ${exceso}% (${horasReal}h de ${horasEst}h estimadas)`,
    })
  }

  // A03: Factura vencida > 60 días (🔴)
  const facturasVencidas = facturas.filter(
    fa => fa.estado_pago !== 'pagada' && (fa.dias_antiguedad ?? 0) > 60
  )
  if (facturasVencidas.length > 0) {
    alertas.push({
      id: 'A03',
      severity: 'red',
      icon: <FileText className="h-3.5 w-3.5" />,
      message: `${facturasVencidas.length} factura${facturasVencidas.length > 1 ? 's' : ''} con mas de 60 dias sin cobro`,
    })
  }

  // A04: Desfase facturación — mucho trabajo hecho sin facturar (🟡)
  const presupuesto = f.presupuesto_total ?? 0
  const costoAcumulado = f.costo_acumulado ?? 0
  const facturado = f.facturado ?? 0
  if (presupuesto > 0 && costoAcumulado > 0) {
    const pctTrabajado = (costoAcumulado / presupuesto) * 100
    const pctFacturado = (facturado / presupuesto) * 100
    if (pctTrabajado - pctFacturado > 30) {
      alertas.push({
        id: 'A04',
        severity: 'yellow',
        icon: <FileText className="h-3.5 w-3.5" />,
        message: `Has trabajado ${Math.round(pctTrabajado)}% del presupuesto pero solo facturado ${Math.round(pctFacturado)}%`,
      })
    }
  }

  // A05: Cobro sin factura — más cobrado que facturado (🟡)
  const cobrado = f.cobrado ?? 0
  if (cobrado > facturado && facturado > 0) {
    alertas.push({
      id: 'A05',
      severity: 'yellow',
      icon: <Banknote className="h-3.5 w-3.5" />,
      message: 'Cobros superan lo facturado — revisa las facturas',
    })
  }

  // A06: Tip RST — if presupuesto > 10M and no retenciones configured (💡)
  if (presupuesto > 10_000_000) {
    alertas.push({
      id: 'A06',
      severity: 'tip',
      icon: <Lightbulb className="h-3.5 w-3.5" />,
      message: 'Proyecto > $10M — recuerda verificar retenciones con tu contador',
    })
  }

  return alertas
}

// ── Component ─────────────────────────────────────────

export default function ProyectoAlertas({ financiero, facturas }: Props) {
  const alertas = calcularAlertas(financiero, facturas)

  if (alertas.length === 0) return null

  return (
    <div className="space-y-1.5">
      {alertas.map(a => {
        const colorClass = a.severity === 'red'
          ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-400'
          : a.severity === 'yellow'
            ? 'border-yellow-200 bg-yellow-50 text-yellow-700 dark:border-yellow-900 dark:bg-yellow-950/20 dark:text-yellow-400'
            : 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/20 dark:text-blue-400'

        return (
          <div
            key={a.id}
            className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${colorClass}`}
          >
            <span className="shrink-0 mt-0.5">{a.icon}</span>
            <span>{a.message}</span>
          </div>
        )
      })}
    </div>
  )
}
