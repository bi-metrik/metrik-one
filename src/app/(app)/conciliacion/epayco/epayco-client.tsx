'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  CreditCard, TrendingDown, Receipt, Banknote, ArrowLeft,
  ChevronDown, ExternalLink,
} from 'lucide-react'
import type { ConciliacionEpaycoData, CobroEpayco } from '@/lib/actions/conciliacion-epayco-actions'

// ── Helpers de formato ────────────────────────────────────────────────────────

const fmtCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(n)

const fmtFecha = (iso: string) => {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

const TIPO_LABELS: Record<string, string> = {
  anticipo: 'Anticipo',
  pago: 'Pago',
  pasante: 'Pasante',
  saldo: 'Saldo',
  honorario: 'Honorario',
}

const VERDE = '#10B981'
const FONT = { fontFamily: 'var(--font-montserrat), Montserrat, sans-serif' }

// ── Meses disponibles para el selector ───────────────────────────────────────

function labelMes(mes: string): string {
  const [y, m] = mes.split('-')
  const nombres = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
  return `${nombres[parseInt(m) - 1]} ${y}`
}

// ── Componente de tarjeta de resumen ─────────────────────────────────────────

function ResumenCard({
  label,
  valor,
  icono: Icono,
  color,
  sublabel,
}: {
  label: string
  valor: number
  icono: React.ElementType
  color: string
  sublabel?: string
}) {
  return (
    <div
      className="flex flex-col gap-1.5 rounded-xl border bg-white p-4"
      style={{ borderColor: '#E5E7EB' }}
    >
      <div className="flex items-center gap-2">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${color}15` }}
        >
          <Icono className="h-4 w-4" style={{ color }} />
        </div>
        <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: '#6B7280' }}>
          {label}
        </span>
      </div>
      <p className="text-[22px] font-bold tabular-nums leading-none" style={{ color: '#1A1A1A' }}>
        {fmtCOP(valor)}
      </p>
      {sublabel && (
        <p className="text-[11px]" style={{ color: '#9CA3AF' }}>
          {sublabel}
        </p>
      )}
    </div>
  )
}

// ── Tabla de cobros ───────────────────────────────────────────────────────────

function TablaCobros({ cobros }: { cobros: CobroEpayco[] }) {
  if (cobros.length === 0) {
    return (
      <div className="rounded-xl border" style={{ borderColor: '#E5E7EB' }}>
        <div className="py-16 text-center">
          <CreditCard className="mx-auto mb-3 h-8 w-8" style={{ color: '#D1D5DB' }} />
          <p className="text-[13px]" style={{ color: '#9CA3AF' }}>
            No hay cobros ePayco para el período seleccionado.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border" style={{ borderColor: '#E5E7EB' }}>
      <table className="w-full text-left text-[12px]" style={{ minWidth: 720 }}>
        <thead>
          <tr style={{ backgroundColor: '#F9FAFB', borderBottom: '1px solid #E5E7EB' }}>
            <th className="px-4 py-2.5 font-semibold" style={{ color: '#6B7280' }}>Referencia</th>
            <th className="px-4 py-2.5 font-semibold" style={{ color: '#6B7280' }}>Negocio</th>
            <th className="px-4 py-2.5 font-semibold" style={{ color: '#6B7280' }}>Fecha</th>
            <th className="px-4 py-2.5 font-semibold" style={{ color: '#6B7280' }}>Tipo</th>
            <th className="px-4 py-2.5 text-right font-semibold" style={{ color: '#6B7280' }}>Monto bruto</th>
            <th className="px-4 py-2.5 text-right font-semibold" style={{ color: '#6B7280' }}>Comisión est.</th>
            <th className="px-4 py-2.5 text-right font-semibold" style={{ color: '#6B7280' }}>IVA est.</th>
            <th className="px-4 py-2.5 text-right font-semibold" style={{ color: '#6B7280' }}>Neto est.</th>
          </tr>
        </thead>
        <tbody>
          {cobros.map((c, i) => (
            <tr
              key={c.id}
              className="transition-colors hover:bg-gray-50"
              style={{ borderTop: i === 0 ? 'none' : '1px solid #F3F4F6' }}
            >
              {/* Referencia */}
              <td className="px-4 py-2.5">
                <a
                  href={`https://secure.epayco.co/collection/v2/details/${c.external_ref}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group inline-flex items-center gap-1 font-mono text-[11px] font-semibold hover:underline"
                  style={{ color: '#1A1A1A' }}
                >
                  {c.external_ref}
                  <ExternalLink className="h-3 w-3 opacity-0 transition group-hover:opacity-60" style={{ color: '#6B7280' }} />
                </a>
              </td>

              {/* Negocio */}
              <td className="px-4 py-2.5">
                <div className="flex flex-col gap-0.5">
                  <span className="font-semibold" style={{ color: '#1A1A1A' }}>
                    {c.negocio_codigo ?? '—'}
                  </span>
                  {c.negocio_nombre && (
                    <span className="text-[11px]" style={{ color: '#6B7280' }}>
                      {c.negocio_nombre}
                    </span>
                  )}
                </div>
              </td>

              {/* Fecha */}
              <td className="px-4 py-2.5 tabular-nums" style={{ color: '#374151' }}>
                {fmtFecha(c.fecha)}
              </td>

              {/* Tipo */}
              <td className="px-4 py-2.5">
                <span
                  className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold"
                  style={{ backgroundColor: '#F3F4F6', color: '#374151' }}
                >
                  {TIPO_LABELS[c.tipo_cobro] ?? c.tipo_cobro}
                </span>
              </td>

              {/* Monto bruto */}
              <td className="px-4 py-2.5 text-right font-semibold tabular-nums" style={{ color: '#1A1A1A' }}>
                {fmtCOP(c.monto)}
              </td>

              {/* Comisión estimada */}
              <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: '#DC2626' }}>
                {fmtCOP(c.comision_estimada)}
              </td>

              {/* IVA estimado */}
              <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: '#D97706' }}>
                {fmtCOP(c.iva_estimado)}
              </td>

              {/* Neto estimado */}
              <td className="px-4 py-2.5 text-right font-semibold tabular-nums" style={{ color: VERDE }}>
                {fmtCOP(c.neto_estimado)}
              </td>
            </tr>
          ))}
        </tbody>

        {/* Totales */}
        <tfoot>
          <tr style={{ borderTop: '2px solid #E5E7EB', backgroundColor: '#F9FAFB' }}>
            <td colSpan={4} className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide" style={{ color: '#6B7280' }}>
              Total ({cobros.length} cobros)
            </td>
            <td className="px-4 py-2.5 text-right font-bold tabular-nums" style={{ color: '#1A1A1A' }}>
              {fmtCOP(cobros.reduce((s, c) => s + c.monto, 0))}
            </td>
            <td className="px-4 py-2.5 text-right font-bold tabular-nums" style={{ color: '#DC2626' }}>
              {fmtCOP(cobros.reduce((s, c) => s + c.comision_estimada, 0))}
            </td>
            <td className="px-4 py-2.5 text-right font-bold tabular-nums" style={{ color: '#D97706' }}>
              {fmtCOP(cobros.reduce((s, c) => s + c.iva_estimado, 0))}
            </td>
            <td className="px-4 py-2.5 text-right font-bold tabular-nums" style={{ color: VERDE }}>
              {fmtCOP(cobros.reduce((s, c) => s + c.neto_estimado, 0))}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function EpaycoClient({
  data,
  mesActual,
}: {
  data: ConciliacionEpaycoData
  mesActual?: string
}) {
  const router = useRouter()
  const { cobros, resumen, meses_disponibles } = data

  function cambiarMes(nuevoMes: string) {
    const params = nuevoMes ? `?mes=${nuevoMes}` : ''
    router.push(`/conciliacion/epayco${params}`)
  }

  const mesLabel = mesActual ? labelMes(mesActual) : 'Todos los meses'

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6" style={FONT}>
      {/* ── Encabezado ── */}
      <div className="mb-6">
        <Link
          href="/conciliacion"
          className="mb-4 inline-flex items-center gap-1.5 text-[12px] font-semibold transition hover:opacity-80"
          style={{ color: '#6B7280' }}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Volver a Conciliación
        </Link>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" style={{ color: VERDE }} />
              <h1 className="text-lg font-bold" style={{ color: '#1A1A1A' }}>
                Panel ePayco
              </h1>
            </div>
            <p className="mt-1 text-[13px]" style={{ color: '#6B7280' }}>
              Cobros procesados por ePayco con estimado de comisiones e IVA. Los cálculos son aproximados
              (2.9% + IVA 19%); los valores exactos están en el panel de ePayco.
            </p>
          </div>

          {/* Selector de mes */}
          <div className="relative">
            <select
              value={mesActual ?? ''}
              onChange={(e) => cambiarMes(e.target.value)}
              className="appearance-none rounded-lg border py-2 pl-3 pr-8 text-[13px] font-semibold outline-none transition focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
              style={{ borderColor: '#D1D5DB', color: '#1A1A1A', backgroundColor: '#fff' }}
            >
              <option value="">Todos los meses</option>
              {meses_disponibles.map((m) => (
                <option key={m} value={m}>{labelMes(m)}</option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
              style={{ color: '#6B7280' }}
            />
          </div>
        </div>

        {/* Periodo activo */}
        {mesActual && (
          <div className="mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold" style={{ backgroundColor: '#D1FAE5', color: '#065F46' }}>
            Período: {mesLabel}
          </div>
        )}
      </div>

      {/* ── Tarjetas de resumen ── */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ResumenCard
          label="Total bruto"
          valor={resumen.total_bruto}
          icono={Banknote}
          color="#1A1A1A"
          sublabel={`${resumen.total_cobros} cobro${resumen.total_cobros !== 1 ? 's' : ''}`}
        />
        <ResumenCard
          label="Comisión ePayco"
          valor={resumen.total_comision}
          icono={TrendingDown}
          color="#DC2626"
          sublabel="2.9% estimado"
        />
        <ResumenCard
          label="IVA ePayco"
          valor={resumen.total_iva}
          icono={Receipt}
          color="#D97706"
          sublabel="19% s/ comisión"
        />
        <ResumenCard
          label="Neto recibido"
          valor={resumen.total_neto}
          icono={CreditCard}
          color={VERDE}
          sublabel="después de costos"
        />
      </div>

      {/* ── Tabla de cobros ── */}
      <TablaCobros cobros={cobros} />

      {/* ── Nota aclaratoria ── */}
      <p className="mt-4 text-[11px] leading-relaxed" style={{ color: '#9CA3AF' }}>
        Los valores de comisión e IVA son estimados con las tarifas estándar de ePayco (2.9% + IVA 19% sobre
        la comisión). Los valores reales pueden variar según el plan contratado. Verifica en el panel de ePayco
        para liquidación exacta.
      </p>
    </div>
  )
}
