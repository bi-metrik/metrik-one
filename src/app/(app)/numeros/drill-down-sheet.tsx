'use client'

import { X } from 'lucide-react'
import { formatCOP } from '@/lib/contacts/constants'
import type { NumerosData } from './actions-v2'

interface DrillDownSheetProps {
  questionNumber: 1 | 2 | 3 | 4 | 5
  data: NumerosData
  monthType: 'current' | 'past' | 'future'
  onClose: () => void
}

export default function DrillDownSheet({ questionNumber, data, monthType, onClose }: DrillDownSheetProps) {
  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Sheet */}
      <div className="fixed inset-x-0 bottom-0 z-[60] mx-auto max-w-2xl animate-in slide-in-from-bottom duration-300">
        <div className="rounded-t-2xl border bg-card shadow-2xl max-h-[80vh] overflow-y-auto">
          {/* Handle + Close */}
          <div className="sticky top-0 z-10 bg-card rounded-t-2xl border-b px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                P{questionNumber}
              </span>
              <h2 className="text-sm font-bold">{TITLES[questionNumber]}</h2>
            </div>
            <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-accent">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="p-4 space-y-4">
            {questionNumber === 1 && <DrillP1 data={data} monthType={monthType} />}
            {questionNumber === 2 && <DrillP2 data={data} monthType={monthType} />}
            {questionNumber === 3 && <DrillP3 data={data} monthType={monthType} />}
            {questionNumber === 4 && <DrillP4 data={data} monthType={monthType} />}
            {questionNumber === 5 && <DrillP5 data={data} monthType={monthType} />}
          </div>
        </div>
      </div>
    </>
  )
}

const TITLES: Record<number, string> = {
  1: '¿Cuanta plata tengo?',
  2: '¿Estoy ganando?',
  3: '¿Cuanto me deben?',
  4: '¿Cuanto necesito vender?',
  5: '¿Cuanto aguanto?',
}

// ── Helpers ──────────────────────────────────────────

function Row({ label, value, bold, color, indent }: {
  label: string
  value: string | number
  bold?: boolean
  color?: 'green' | 'red' | 'yellow' | 'muted'
  indent?: boolean
}) {
  const colorClass = color === 'green' ? 'text-green-600 dark:text-green-400'
    : color === 'red' ? 'text-red-600 dark:text-red-400'
    : color === 'yellow' ? 'text-yellow-600 dark:text-yellow-400'
    : color === 'muted' ? 'text-muted-foreground'
    : ''

  return (
    <div className={`flex items-center justify-between py-1.5 ${indent ? 'pl-4' : ''}`}>
      <span className={`text-xs ${bold ? 'font-semibold' : 'text-muted-foreground'}`}>{label}</span>
      <span className={`text-xs font-medium tabular-nums ${bold ? 'font-semibold' : ''} ${colorClass}`}>
        {typeof value === 'number' ? formatCOP(value) : value}
      </span>
    </div>
  )
}

function SectionTitle({ children }: { children: string }) {
  return <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground pt-2">{children}</h3>
}

function Divider() {
  return <div className="border-t my-1" />
}

// ── P1: ¿Cuánta plata tengo? ────────────────────────

function DrillP1({ data, monthType }: { data: NumerosData; monthType: string }) {
  const pctRecaudo = data.metaRecaudo && data.metaRecaudo > 0
    ? Math.round((data.recaudoMes / data.metaRecaudo) * 100)
    : null

  const proyeccionRecaudo = monthType === 'current' && data.diaActual > 0
    ? (data.recaudoMes / data.diaActual) * data.diasDelMes
    : null

  return (
    <div className="space-y-1">
      <SectionTitle>Saldo actual</SectionTitle>
      <Row label="Saldo en caja" value={data.saldoCaja} bold />
      <Row label="Fuente" value={data.saldoEsReal ? 'Saldo bancario reportado' : 'Calculado (estimado)'} color="muted" />

      <Divider />
      <SectionTitle>Recaudo del mes</SectionTitle>
      <Row label="Recaudado este mes" value={data.recaudoMes} />
      {data.metaRecaudo && <Row label="Meta de recaudo" value={data.metaRecaudo} />}
      {pctRecaudo !== null && <Row label="Avance" value={`${pctRecaudo}%`} color={pctRecaudo >= 80 ? 'green' : pctRecaudo >= 50 ? 'yellow' : 'red'} />}
      <Row label="Recaudo mes anterior" value={data.recaudoMesAnterior} color="muted" />

      {proyeccionRecaudo && (
        <>
          <Divider />
          <SectionTitle>Proyeccion</SectionTitle>
          <Row label={`Al ritmo actual (dia ${data.diaActual}/${data.diasDelMes})`} value={Math.round(proyeccionRecaudo)} />
          {data.metaRecaudo && (
            <Row
              label="vs Meta"
              value={proyeccionRecaudo >= data.metaRecaudo ? 'En camino ✅' : `Falta ${formatCOP(data.metaRecaudo - proyeccionRecaudo)}`}
              color={proyeccionRecaudo >= data.metaRecaudo ? 'green' : 'red'}
            />
          )}
        </>
      )}
    </div>
  )
}

// ── P2: ¿Estoy ganando? ─────────────────────────────

function DrillP2({ data }: { data: NumerosData; monthType: string }) {
  const utilidadAnterior = data.ingresosMesAnterior - data.gastosMesAnterior
  const otrosGastos = Math.max(0, data.gastosMes - data.componenteNomina - data.componenteOperativo)
  const margenPct = data.ingresosMes > 0
    ? Math.round((data.utilidad / data.ingresosMes) * 100)
    : 0

  return (
    <div className="space-y-1">
      <SectionTitle>Estado de resultados simplificado</SectionTitle>
      <Row label="Ingresos cobrados" value={data.ingresosMes} color="green" />
      {data.componenteNomina > 0 && (
        <Row label="(-) Nomina (Mi Equipo)" value={data.componenteNomina} color="red" indent />
      )}
      {data.componenteOperativo > 0 && (
        <Row label="(-) Gastos operativos fijos" value={data.componenteOperativo} color="red" indent />
      )}
      {otrosGastos > 0 && (
        <Row label="(-) Otros gastos del mes" value={otrosGastos} color="red" indent />
      )}
      <Divider />
      <Row label="Utilidad" value={data.utilidad} bold color={data.utilidad >= 0 ? 'green' : 'red'} />
      <Row label="Margen" value={`${margenPct}%`} color={margenPct > 20 ? 'green' : margenPct > 0 ? 'yellow' : 'red'} />

      <Divider />
      <SectionTitle>Comparativo mes anterior</SectionTitle>
      <Row label="Ingresos anterior" value={data.ingresosMesAnterior} color="muted" />
      <Row label="Gastos anterior" value={data.gastosMesAnterior} color="muted" />
      <Row label="Utilidad anterior" value={utilidadAnterior} color="muted" />
      {utilidadAnterior !== 0 && (
        <Row
          label="Variacion"
          value={`${data.utilidad >= utilidadAnterior ? '+' : ''}${utilidadAnterior !== 0 ? Math.round(((data.utilidad - utilidadAnterior) / Math.abs(utilidadAnterior)) * 100) : 0}%`}
          color={data.utilidad >= utilidadAnterior ? 'green' : 'red'}
        />
      )}
    </div>
  )
}

// ── P3: ¿Cuánto me deben? ───────────────────────────

function DrillP3({ data }: { data: NumerosData; monthType: string }) {
  const cobroPct = data.totalFacturado > 0
    ? Math.round((data.totalCobrado / data.totalFacturado) * 100)
    : 0

  return (
    <div className="space-y-1">
      <SectionTitle>Resumen de cartera</SectionTitle>
      <Row label="Total facturado" value={data.totalFacturado} />
      <Row label="Total cobrado" value={data.totalCobrado} color="green" />
      <Divider />
      <Row label="Cartera pendiente" value={data.carteraPendiente} bold color={data.carteraPendiente > 0 ? 'red' : 'green'} />
      <Row label="Tasa de cobro" value={`${cobroPct}%`} color={cobroPct >= 80 ? 'green' : cobroPct >= 50 ? 'yellow' : 'red'} />

      <Divider />
      <SectionTitle>Tendencia</SectionTitle>
      <Row label="Cartera mes anterior" value={data.carteraMesAnterior} color="muted" />
      <Row
        label="Variacion"
        value={data.carteraPendiente <= data.carteraMesAnterior ? 'Bajando ✅' : 'Subiendo ⚠️'}
        color={data.carteraPendiente <= data.carteraMesAnterior ? 'green' : 'red'}
      />
    </div>
  )
}

// ── P4: ¿Cuánto necesito vender? ────────────────────

function DrillP4({ data, monthType }: { data: NumerosData; monthType: string }) {
  const faltaParaPE = Math.max(0, data.puntoEquilibrio - data.ventasMes)
  const diasRestantes = monthType === 'current' ? data.diasDelMes - data.diaActual : 0
  const ventaDiariaRequerida = diasRestantes > 0 ? faltaParaPE / diasRestantes : 0

  const margenLabel = data.margenFuente === 'calculado'
    ? `Calculado (${data.nProyectosMargen} proyectos cerrados)`
    : data.margenFuente === 'mixto'
      ? `Mixto (${data.nProyectosMargen} proyecto${data.nProyectosMargen !== 1 ? 's' : ''} + estimado)`
      : 'Estimado por ti'

  return (
    <div className="space-y-1">
      <SectionTitle>Gastos fijos mensuales</SectionTitle>
      {data.staffNomina.length > 0 && (
        <>
          <Row label="👥 Nomina (Mi Equipo)" value={data.componenteNomina} bold />
          {data.staffNomina.map((s, i) => (
            <Row key={i} label={s.nombre} value={s.salario} indent />
          ))}
        </>
      )}
      <Row label="🏢 Gastos operativos" value={data.componenteOperativo} bold={data.staffNomina.length > 0} />
      {data.staffNomina.length > 0 && (
        <>
          <Divider />
          <Row label="Total gastos fijos" value={data.costosFijosMes} bold />
        </>
      )}

      <Divider />
      <SectionTitle>Margen de contribucion</SectionTitle>
      <Row label="Margen efectivo" value={`${Math.round(data.margenContribucion * 100)}%`} />
      <div className="flex items-center justify-between py-1">
        <span className="text-[10px] text-muted-foreground">{margenLabel}</span>
        {data.margenFuente === 'estimado' && (
          <a href="/mi-negocio" className="text-[10px] font-medium text-primary hover:underline">Ajustar →</a>
        )}
      </div>

      <Divider />
      <SectionTitle>Minimo que necesitas vender</SectionTitle>
      <Row label="Gastos fijos / Margen de contribucion" value={data.puntoEquilibrio} bold />
      <p className="text-[10px] text-muted-foreground px-1 -mt-1">Es la venta minima mensual para cubrir todos tus costos fijos</p>

      <Divider />
      <SectionTitle>Avance de ventas</SectionTitle>
      <Row label="Ventas del mes" value={data.ventasMes} />
      {data.metaVentas && <Row label="Meta de ventas" value={data.metaVentas} />}
      <Row
        label="vs Minimo necesario"
        value={data.ventasMes >= data.puntoEquilibrio ? 'Superado ✅' : `Falta ${formatCOP(faltaParaPE)}`}
        color={data.ventasMes >= data.puntoEquilibrio ? 'green' : 'red'}
        bold
      />

      {monthType === 'current' && faltaParaPE > 0 && diasRestantes > 0 && (
        <>
          <Divider />
          <SectionTitle>Para cubrir tus costos</SectionTitle>
          <Row label="Dias restantes" value={`${diasRestantes} dias`} />
          <Row label="Venta diaria requerida" value={Math.round(ventaDiariaRequerida)} color="yellow" />
        </>
      )}
    </div>
  )
}

// ── P5: ¿Cuánto aguanto? ────────────────────────────

function DrillP5({ data }: { data: NumerosData; monthType: string }) {
  const escenarioOptimista = data.gastoPromedioMensual > 0
    ? data.saldoCaja / (data.gastoPromedioMensual * 0.8)
    : 0
  const escenarioPesimista = data.gastoPromedioMensual > 0
    ? data.saldoCaja / (data.gastoPromedioMensual * 1.2)
    : 0

  return (
    <div className="space-y-1">
      <SectionTitle>Calculo del runway</SectionTitle>
      <Row label="Saldo en caja" value={data.saldoCaja} />
      <Row label="Gasto promedio mensual" value={data.gastoPromedioMensual} />
      <Divider />
      <Row label="Runway" value={`${data.runwayMeses.toFixed(1)} meses`} bold
        color={data.runwayMeses > 6 ? 'green' : data.runwayMeses > 3 ? 'yellow' : 'red'}
      />

      <Divider />
      <SectionTitle>Escenarios</SectionTitle>
      <Row label="Optimista (gastos -20%)" value={`${escenarioOptimista.toFixed(1)} meses`} color="green" />
      <Row label="Base" value={`${data.runwayMeses.toFixed(1)} meses`} />
      <Row label="Pesimista (gastos +20%)" value={`${escenarioPesimista.toFixed(1)} meses`} color="red" />

      <Divider />
      <SectionTitle>Interpretacion</SectionTitle>
      <div className="text-xs text-muted-foreground py-1">
        {data.runwayMeses > 6
          ? 'Tu negocio tiene buena reserva. Puedes considerar invertir en crecimiento.'
          : data.runwayMeses > 3
            ? 'Reserva moderada. Enfocate en aumentar ingresos o reducir gastos.'
            : 'Atencion: reserva baja. Prioriza cobros pendientes y reduce gastos no esenciales.'}
      </div>
    </div>
  )
}
