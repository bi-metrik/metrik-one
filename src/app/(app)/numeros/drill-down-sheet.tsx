'use client'

import { X, ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { formatCOP } from '@/lib/contacts/constants'
import type { NumerosData } from './actions-v2'

interface DrillDownSheetProps {
  questionNumber: 1 | 2 | 3 | 4 | 5
  data: NumerosData
  monthType: 'current' | 'past' | 'future'
  onClose: () => void
  onChangeDrill?: (q: 1 | 2 | 3 | 4 | 5) => void
}

export default function DrillDownSheet({ questionNumber, data, monthType, onClose, onChangeDrill }: DrillDownSheetProps) {
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
            {questionNumber === 1 && <DrillP1 data={data} monthType={monthType} onChangeDrill={onChangeDrill} />}
            {questionNumber === 2 && <DrillP2 data={data} monthType={monthType} />}
            {questionNumber === 3 && <DrillP3 data={data} monthType={monthType} />}
            {questionNumber === 4 && <DrillP4 data={data} monthType={monthType} />}
            {questionNumber === 5 && <DrillP5 data={data} monthType={monthType} onChangeDrill={onChangeDrill} />}
          </div>
        </div>
      </div>
    </>
  )
}

const TITLES: Record<number, string> = {
  1: '¿Cuánta plata tengo?',
  2: '¿Estoy ganando?',
  3: '¿Cuánto me deben?',
  4: '¿Cuánto necesito vender?',
  5: '¿Cuánto aguanto?',
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
  return <h3 className="text-[11px] font-semibold text-muted-foreground pt-2">{children}</h3>
}

function Divider() {
  return <div className="border-t my-1" />
}

function DrillDownLinks({ links }: { links: { label: string; href?: string; onClick?: () => void }[] }) {
  return (
    <div className="mt-3 pt-3 border-t space-y-1.5">
      {links.map((link, i) => link.href ? (
        <Link
          key={i}
          href={link.href}
          className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs font-medium text-primary hover:bg-accent transition-colors"
        >
          {link.label}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      ) : (
        <button
          key={i}
          onClick={link.onClick}
          className="flex w-full items-center justify-between rounded-lg border px-3 py-2 text-xs font-medium text-primary hover:bg-accent transition-colors"
        >
          {link.label}
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      ))}
    </div>
  )
}

// ── P1: ¿Cuánta plata tengo? ────────────────────────

function DrillP1({ data, monthType, onChangeDrill }: { data: NumerosData; monthType: string; onChangeDrill?: (q: 1 | 2 | 3 | 4 | 5) => void }) {
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
      <Row label="Fuente" value={data.saldoEsReal ? 'Ultimo saldo reportado' : 'Calculado (estimado)'} color="muted" />

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

      <DrillDownLinks links={[
        ...(onChangeDrill ? [{ label: 'Ver cartera completa', onClick: () => onChangeDrill(3) }] : []),
        { label: 'Ir a Oportunidades', href: '/pipeline' },
      ]} />
    </div>
  )
}

// ── P2: ¿Estoy ganando? ─────────────────────────────

function DrillP2({ data }: { data: NumerosData; monthType: string }) {
  const utilidadAnterior = data.ingresosMesAnterior - data.gastosMesAnterior
  const margenPct = data.ingresosMes > 0
    ? Math.round((data.utilidad / data.ingresosMes) * 100)
    : 0

  // Provisión impuestos estimada (35% régimen ordinario default)
  const tasaImpuestos = 0.35
  const provisionImpuestos = data.utilidad > 0 ? Math.round(data.utilidad * tasaImpuestos) : 0
  const disponibleParaTi = data.utilidad - provisionImpuestos

  return (
    <div className="space-y-1">
      <Row label="Ingresos cobrados" value={data.ingresosMes} color="green" />
      {data.componenteNomina > 0 && (
        <Row label="(-) Nomina (Mi Equipo)" value={data.componenteNomina} color="red" indent />
      )}
      {data.componenteOperativo > 0 && (
        <Row label="(-) Gastos operativos fijos" value={data.componenteOperativo} color="red" indent />
      )}
      {data.gastosProyectosMes > 0 && (
        <Row label="(-) Gastos de proyectos" value={data.gastosProyectosMes} color="red" indent />
      )}
      {(data.gastosMes - data.gastosProyectosMes) > 0 && (
        <Row label="(-) Otros gastos variables" value={data.gastosMes - data.gastosProyectosMes} color="red" indent />
      )}
      <Divider />
      <Row label="Utilidad" value={data.utilidad} bold color={data.utilidad >= 0 ? 'green' : 'red'} />
      <Row label="Margen" value={`${margenPct}%`} color={margenPct > 20 ? 'green' : margenPct > 0 ? 'yellow' : 'red'} />

      {/* COH-2: Disponible para ti */}
      {data.utilidad > 0 && (
        <>
          <Divider />
          <Row label={`(-) Provision impuestos (~${Math.round(tasaImpuestos * 100)}%)`} value={provisionImpuestos} color="red" indent />
          <Row label="Disponible para ti" value={disponibleParaTi} bold color="green" />
          <p className="text-[10px] text-muted-foreground px-1">Estimado. Consulta a tu contador para el calculo exacto.</p>
        </>
      )}

      {/* D141: Ahorro fiscal — conditional by regime */}
      {data.regimenFiscal === 'ordinario' && (data.gastosDeduciblesMes > 0 || data.gastosSinSoporteMes > 0 || data.totalDeduciblesMes > 0) && (
        <>
          <Divider />
          <SectionTitle>Ahorro fiscal</SectionTitle>
          <Row label="Gastos deducibles este mes" value={data.gastosDeduciblesMes + data.totalDeduciblesMes} color="green" />
          {data.gastosSinSoporteMes > 0 && (
            <Row label="Gastos sin soporte (oportunidad)" value={data.gastosSinSoporteMes} color="yellow" />
          )}
        </>
      )}
      {data.regimenFiscal === 'simple' && (
        <>
          <Divider />
          <p className="text-[10px] text-muted-foreground px-1 py-1">Tu regimen (SIMPLE) calcula impuestos sobre ingresos brutos. No aplican deducciones por gastos.</p>
        </>
      )}
      {!data.regimenFiscal && (
        <>
          <Divider />
          <div className="flex items-center justify-between py-1">
            <p className="text-[10px] text-muted-foreground">Configura tu regimen fiscal en Mi Negocio para ver estimaciones tributarias.</p>
            <Link href="/mi-negocio" className="text-[10px] font-medium text-primary hover:underline shrink-0 ml-2">Configurar →</Link>
          </div>
        </>
      )}

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

      <DrillDownLinks links={[
        { label: 'Ver detalle de gastos', href: '/movimientos' },
      ]} />
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

      {/* COH-3: Cartera detalle por factura */}
      {data.carteraDetalle && data.carteraDetalle.length > 0 && (
        <>
          <Divider />
          <SectionTitle>Detalle por factura</SectionTitle>
          <div className="space-y-1.5">
            {data.carteraDetalle.map((item, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg border px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium truncate">{item.proyectoNombre}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {item.facturaRef}{item.diasVencimiento > 0 ? ` · ${item.diasVencimiento} días` : ' · Hoy'}
                  </p>
                </div>
                <span className="text-xs font-semibold tabular-nums text-red-600 dark:text-red-400 shrink-0 ml-2">
                  {formatCOP(item.saldo)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <Divider />
      <SectionTitle>Tendencia</SectionTitle>
      <Row label="Cartera mes anterior" value={data.carteraMesAnterior} color="muted" />
      <Row
        label="Variacion"
        value={data.carteraPendiente <= data.carteraMesAnterior ? 'Bajando ✅' : 'Subiendo ⚠️'}
        color={data.carteraPendiente <= data.carteraMesAnterior ? 'green' : 'red'}
      />

      <DrillDownLinks links={[
        { label: 'Ver todas las facturas', href: '/proyectos' },
      ]} />
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
      <SectionTitle>Tu margen</SectionTitle>
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

      <DrillDownLinks links={[
        { label: 'Configurar gastos fijos', href: '/mi-negocio' },
        ...(data.ventasMes < data.puntoEquilibrio ? [{ label: 'Ir a Oportunidades', href: '/pipeline' }] : []),
      ]} />
    </div>
  )
}

// ── P5: ¿Cuánto aguanto? ────────────────────────────

function DrillP5({ data, onChangeDrill }: { data: NumerosData; monthType: string; onChangeDrill?: (q: 1 | 2 | 3 | 4 | 5) => void }) {
  const gastoTotal = data.gastoTotalMensual
  const escenarioOptimista = gastoTotal > 0
    ? data.saldoCaja / (gastoTotal * 0.8)
    : 0
  const escenarioPesimista = gastoTotal > 0
    ? data.saldoCaja / (gastoTotal * 1.2)
    : 0

  return (
    <div className="space-y-1">
      <Row label="Saldo en caja" value={data.saldoCaja} />
      <Row label="Gasto total mensual" value={gastoTotal} />
      <Row label="Gastos variables (prom. 3 meses)" value={data.gastoPromedioMensual} color="muted" indent />
      <Row label="Gastos fijos" value={data.costosFijosMes} color="muted" indent />
      <Divider />
      <Row label="Te alcanza para" value={`${data.runwayMeses.toFixed(1)} meses`} bold
        color={data.runwayMeses > 6 ? 'green' : data.runwayMeses > 3 ? 'yellow' : 'red'}
      />

      <Divider />
      <SectionTitle>Escenarios</SectionTitle>
      <Row label="Si gastas menos (-20%)" value={`${escenarioOptimista.toFixed(1)} meses`} color="green" />
      <Row label="Si todo sigue igual" value={`${data.runwayMeses.toFixed(1)} meses`} />
      <Row label="Si gastas mas (+20%)" value={`${escenarioPesimista.toFixed(1)} meses`} color="red" />

      <Divider />
      <SectionTitle>Interpretacion</SectionTitle>
      <div className="text-xs text-muted-foreground py-1">
        {data.runwayMeses > 6
          ? 'Tu negocio tiene buena reserva. Puedes considerar invertir en crecimiento.'
          : data.runwayMeses > 3
            ? 'Reserva moderada. Enfocate en aumentar ingresos o reducir gastos.'
            : 'Atencion: reserva baja. Prioriza cobros pendientes y reduce gastos no esenciales.'}
      </div>

      <DrillDownLinks links={[
        ...(onChangeDrill ? [{ label: 'Cobrar pendientes', onClick: () => onChangeDrill(3) }] : []),
        ...(onChangeDrill ? [{ label: 'Revisar gastos', onClick: () => onChangeDrill(4) }] : []),
        { label: 'Ir a Oportunidades', href: '/pipeline' },
      ]} />
    </div>
  )
}
