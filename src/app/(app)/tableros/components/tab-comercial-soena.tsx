'use client'

import { useState, useTransition } from 'react'
import { ChevronLeft, ChevronRight, Target } from 'lucide-react'
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  Tooltip, CartesianGrid,
} from 'recharts'
import type {
  ComercialResumenRow,
  ComercialMesResponse,
  ComercialSerieResponse,
  MetaComercial,
} from '../../equipo/comercial-types'
import { MESES_ES } from '../../equipo/comercial-types'
import { getComercialMes } from '../../equipo/comercial-actions'
import MetasModal from '../../equipo/metas-modal'

const GREEN = '#059669'
const BLUE = '#2563EB'
const GRAY = '#9CA3AF'

function fmtCOP(n: number): string {
  return `$${Math.round(n).toLocaleString('es-CO')}`
}
function fmtCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000)}K`
  return `$${Math.round(n)}`
}
function nombreCorto(s: string): string {
  return s.split(' ').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ')
}
function pct(n: number | null): string {
  return n === null ? 'sin dato' : `${n}%`
}

export interface TabComercialSoenaProps {
  equipo: ComercialResumenRow[]
  mesInicial: ComercialMesResponse | null
  serie: ComercialSerieResponse | null
  metasIniciales: MetaComercial[]
  anioInicial: number
  mesNumInicial: number
  puedeEditarMetas: boolean
}

export function TabComercialSoena({
  equipo,
  mesInicial,
  serie,
  metasIniciales,
  anioInicial,
  mesNumInicial,
  puedeEditarMetas,
}: TabComercialSoenaProps) {
  const [anio, setAnio] = useState(anioInicial)
  const [mes, setMes] = useState(mesNumInicial)
  const [mesData, setMesData] = useState<ComercialMesResponse | null>(mesInicial)
  const [metasModalOpen, setMetasModalOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  function cambiarMes(delta: number) {
    let nm = mes + delta
    let na = anio
    if (nm < 1) { nm = 12; na -= 1 }
    if (nm > 12) { nm = 1; na += 1 }
    setMes(nm)
    setAnio(na)
    startTransition(async () => {
      const d = await getComercialMes(na, nm)
      setMesData(d)
    })
  }

  const kpis = mesData?.kpis
  const vendedoresMes = mesData?.porVendedor ?? []

  const totalHonorario = equipo.reduce((s, v) => s + v.honorario_recaudado, 0)
  const totalTarifa = equipo.reduce((s, v) => s + v.tarifa_recaudada, 0)
  const totalAprobado = equipo.reduce((s, v) => s + v.valor_aprobado, 0)

  const serieData = serie?.serie ?? []

  return (
    <div>
      {/* Encabezado interno de la pestana + accion de metas */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          El recaudo es honorario (ingreso real); la tarifa UPME se reporta aparte como plata de terceros.
        </p>
        {puedeEditarMetas && (
          <button
            onClick={() => setMetasModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            <Target className="h-4 w-4" /> Metas del mes
          </button>
        )}
      </div>

      {/* Selector de mes */}
      <div className="mb-5 flex items-center gap-3">
        <button
          onClick={() => cambiarMes(-1)}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
          aria-label="Mes anterior"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="min-w-[9rem] text-center text-sm font-bold text-gray-900">
          {MESES_ES[mes - 1]} {anio}
        </span>
        <button
          onClick={() => cambiarMes(1)}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
          aria-label="Mes siguiente"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        {pending && <span className="text-xs text-gray-400">Actualizando...</span>}
      </div>

      {/* Panel KPIs del mes */}
      {kpis && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Kpi label="Ventas del mes" value={String(kpis.num_ventas)}
               sub={kpis.meta_num_ventas ? `meta ${kpis.meta_num_ventas} · ${pct(kpis.cumplimiento_num)}` : undefined} />
          <Kpi label="Valor vendido (sin IVA)" value={fmtCompact(kpis.valor_sin_iva)} color={GREEN}
               sub={kpis.meta_valor ? `meta ${fmtCompact(kpis.meta_valor)} · ${pct(kpis.cumplimiento_valor)}` : undefined} />
          <Kpi label="Ticket promedio" value={fmtCompact(kpis.ticket_promedio)} />
          <Kpi label="Casos completos" value={`${kpis.casos_completos}`} sub={pct(kpis.tasa_casos_completos)} />
          <Kpi label="Mejor dia" value={kpis.mejor_dia ? kpis.mejor_dia.slice(8) + '/' + kpis.mejor_dia.slice(5, 7) : 'sin dato'}
               sub={kpis.mejor_dia_ventas ? `${kpis.mejor_dia_ventas} ventas` : undefined} />
          <Kpi label="Promedio ventas/dia" value={String(kpis.promedio_ventas_dia)} />
          <Kpi label="Ventas proyectadas" value={String(kpis.ventas_proyectadas)} sub="run-rate del mes" />
          <Kpi label="Tasa cancelacion" value={pct(kpis.tasa_cancelacion)} sub={`${kpis.n_perdidos} perdidos`} />
        </div>
      )}

      {/* Tabla por vendedor del mes */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-bold text-gray-900">
          Por vendedor · {MESES_ES[mes - 1]} {anio}
        </h2>
        <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60 text-[11px] font-bold uppercase tracking-wide text-gray-400">
                  <th className="px-4 py-3 text-left">Vendedor</th>
                  <th className="px-4 py-3 text-right">Ventas</th>
                  <th className="px-4 py-3 text-right">Valor (sin IVA)</th>
                  <th className="hidden px-4 py-3 text-right md:table-cell">Valor (con IVA)</th>
                  <th className="hidden px-4 py-3 text-right sm:table-cell">1er pago</th>
                  <th className="hidden px-4 py-3 text-right lg:table-cell">2o pago</th>
                  <th className="px-4 py-3 text-right">Completos</th>
                  <th className="hidden px-4 py-3 text-right sm:table-cell">Particip.</th>
                </tr>
              </thead>
              <tbody>
                {vendedoresMes.map((v) => (
                  <tr key={v.responsable_id ?? 'sin'} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3">
                      <span className="font-medium text-gray-900">
                        {v.sin_responsable ? 'Sin responsable' : nombreCorto(v.nombre)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900 tabular-nums">
                      {v.num_ventas}
                      {v.meta_num_ventas ? <span className="ml-1 text-[10px] text-gray-400">/{v.meta_num_ventas}</span> : null}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums" style={{ color: GREEN }}>
                      {fmtCOP(v.valor_sin_iva)}
                    </td>
                    <td className="hidden px-4 py-3 text-right text-gray-500 tabular-nums md:table-cell">
                      {fmtCOP(v.valor_con_iva)}
                    </td>
                    <td className="hidden px-4 py-3 text-right text-gray-600 tabular-nums sm:table-cell">
                      {fmtCOP(v.primer_pago)}
                    </td>
                    <td className="hidden px-4 py-3 text-right text-gray-600 tabular-nums lg:table-cell">
                      {fmtCOP(v.segundo_pago)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                      {v.casos_completos}
                      <span className="ml-1 text-[10px] text-gray-400">{pct(v.tasa_casos_completos)}</span>
                    </td>
                    <td className="hidden px-4 py-3 text-right tabular-nums text-gray-600 sm:table-cell">
                      {pct(v.participacion_pct)}
                    </td>
                  </tr>
                ))}
                {vendedoresMes.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-400">
                      Sin ventas registradas este mes.
                    </td>
                  </tr>
                )}
              </tbody>
              {kpis && vendedoresMes.length > 0 && (
                <tfoot>
                  <tr className="border-t border-gray-100 bg-gray-50/40 font-bold text-gray-900">
                    <td className="px-4 py-3">TOTAL</td>
                    <td className="px-4 py-3 text-right tabular-nums">{kpis.num_ventas}</td>
                    <td className="px-4 py-3 text-right tabular-nums" style={{ color: GREEN }}>{fmtCOP(kpis.valor_sin_iva)}</td>
                    <td className="hidden px-4 py-3 text-right tabular-nums md:table-cell">{fmtCOP(kpis.valor_con_iva)}</td>
                    <td className="hidden px-4 py-3 text-right tabular-nums sm:table-cell">{fmtCOP(kpis.primer_pago)}</td>
                    <td className="hidden px-4 py-3 text-right tabular-nums lg:table-cell">{fmtCOP(kpis.segundo_pago)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{kpis.casos_completos}</td>
                    <td className="hidden px-4 py-3 text-right tabular-nums sm:table-cell">100%</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </section>

      {/* Series historicas */}
      {serieData.length > 0 && (
        <section className="mb-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-gray-900">Historico mensual</h2>
            {serie?.tasa_recaudo_global !== null && serie?.tasa_recaudo_global !== undefined && (
              <span className="text-xs text-gray-500">
                Tasa de recaudo global: <span className="font-semibold text-gray-700">{serie.tasa_recaudo_global}%</span>
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard title="Ventas por mes">
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={serieData} margin={{ left: -10, right: 12, top: 8 }}>
                  <CartesianGrid vertical={false} stroke="#F3F4F6" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip formatter={(v) => [`${v}`, 'Ventas']} />
                  <Line type="monotone" dataKey="num_ventas" stroke={GREEN} strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Valor de negocio por mes (sin IVA)">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={serieData} margin={{ left: -4, right: 12, top: 8 }}>
                  <CartesianGrid vertical={false} stroke="#F3F4F6" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} tickFormatter={fmtCompact} width={48} />
                  <Tooltip formatter={(v) => [fmtCOP(Number(v)), 'Valor sin IVA']} />
                  <Bar dataKey="valor_sin_iva" fill={GREEN} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Recaudo por mes (honorario)">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={serieData} margin={{ left: -4, right: 12, top: 8 }}>
                  <CartesianGrid vertical={false} stroke="#F3F4F6" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} tickFormatter={fmtCompact} width={48} />
                  <Tooltip formatter={(v) => [fmtCOP(Number(v)), 'Recaudo']} />
                  <Bar dataKey="honorario_recaudado" fill={BLUE} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Primer vs segundo pago por mes">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={serieData} margin={{ left: -4, right: 12, top: 8 }}>
                  <CartesianGrid vertical={false} stroke="#F3F4F6" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} tickFormatter={fmtCompact} width={48} />
                  <Tooltip formatter={(v, name) => [fmtCOP(Number(v)), name === 'primer_pago' ? '1er pago' : '2o pago']} />
                  <Bar dataKey="primer_pago" stackId="p" fill={GREEN} radius={[0, 0, 0, 0]} />
                  <Bar dataKey="segundo_pago" stackId="p" fill={GRAY} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        </section>
      )}

      {/* Totales historicos + embudo por vendedor */}
      <section>
        <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <ResumenTotal label="Valor aprobado (historico)" value={fmtCOP(totalAprobado)} />
          <ResumenTotal label="Honorario recaudado" value={fmtCOP(totalHonorario)} color={GREEN} />
          <ResumenTotal label="Tarifa UPME (terceros)" value={fmtCOP(totalTarifa)} muted />
        </div>
        <h2 className="mb-3 text-sm font-bold text-gray-900">Embudo por vendedor (todo el historico)</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {equipo.map((v) => (
            <div
              key={v.responsable_id ?? 'sin-responsable'}
              className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm"
            >
              <div className="mb-4">
                <p className="truncate font-semibold text-gray-900">
                  {v.sin_responsable ? 'Sin responsable' : nombreCorto(v.nombre)}
                </p>
                <p className="truncate text-xs text-gray-400">
                  {v.sin_responsable ? 'Negocios sin asignar' : v.position ?? 'Comercial'}
                </p>
              </div>
              <div className="mb-4 grid grid-cols-3 gap-2">
                <StageCount label="Venta" n={v.en_venta} />
                <StageCount label="Ejecucion" n={v.en_ejecucion} />
                <StageCount label="Cobro" n={v.en_cobro} />
              </div>
              <div className="space-y-2 border-t border-gray-50 pt-3">
                <Row label="Negocios activos" value={String(v.negocios_abiertos)} />
                <Row label="Valor aprobado" value={fmtCOP(v.valor_aprobado)} />
                <Row label="Honorario recaudado" value={fmtCOP(v.honorario_recaudado)} strong color={GREEN} />
                <Row label="Tarifa UPME (terceros)" value={fmtCOP(v.tarifa_recaudada)} muted />
              </div>
            </div>
          ))}
        </div>
      </section>

      {metasModalOpen && (
        <MetasModal
          anio={anio}
          mes={mes}
          equipo={equipo}
          metasIniciales={metasIniciales}
          onClose={() => setMetasModalOpen(false)}
        />
      )}
    </div>
  )
}

function Kpi({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums text-gray-900" style={color ? { color } : undefined}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-gray-400">{sub}</p>}
    </div>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-400">{title}</p>
      {children}
    </div>
  )
}

function ResumenTotal({ label, value, color, muted }: { label: string; value: string; color?: string; muted?: boolean }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`mt-1 text-xl tabular-nums ${muted ? 'font-semibold text-gray-500' : 'font-bold text-gray-900'}`} style={color ? { color } : undefined}>
        {value}
      </p>
    </div>
  )
}

function StageCount({ label, n }: { label: string; n: number }) {
  return (
    <div className="rounded-lg bg-gray-50 py-2 text-center">
      <p className="text-lg font-bold leading-none tabular-nums text-gray-900">{n}</p>
      <p className="mt-1 text-[10px] uppercase tracking-wide text-gray-400">{label}</p>
    </div>
  )
}

function Row({ label, value, strong, muted, color }: { label: string; value: string; strong?: boolean; muted?: boolean; color?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-gray-500">{label}</span>
      <span
        className={`tabular-nums whitespace-nowrap ${strong ? 'font-bold' : muted ? 'text-sm text-gray-400' : 'text-sm font-semibold text-gray-900'}`}
        style={color ? { color } : undefined}
      >
        {value}
      </span>
    </div>
  )
}
