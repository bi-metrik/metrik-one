'use client'

/**
 * Pestaña "Reporte Supertransporte": la información objetiva SARLAFT/RMS que la oficial de
 * cumplimiento radica a mano en VIGÍA (CE 20265330000054 num. 5.3.1.3, modificada por la
 * CE 20265330000134).
 *
 * Este componente solo pinta. Las cifras salen de `@/lib/compliance/reporte-supertransporte`
 * (puro y probado) en el servidor; el periodo vive en la URL, así que elegir otro es navegar
 * y el servidor recalcula. El Excel de soporte usa los mismos parámetros.
 */

import { useState, useTransition } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { AlertTriangle, CalendarClock, Download, Info } from 'lucide-react'
import { ChartCard } from './chart-card'
import type { VistaSupertransporte } from '@/lib/compliance/reporte-supertransporte/servidor'
import type { LiteralReporte } from '@/lib/compliance/reporte-supertransporte/conteo'
import {
  etiquetaFecha,
  etiquetaMes,
  esFechaValida,
  finDeMes,
  mesesDelRango,
  paramsDePeriodo,
  type ModoPeriodo,
} from '@/lib/compliance/reporte-supertransporte/periodos'

const PESTANA = 'supertransporte'
/** Primer mes que ofrece el selector: el inicio del esquema de la CE 054. */
const PRIMER_MES = '2026-05'

const entero = (n: number) => n.toLocaleString('es-CO')

function diasHasta(desde: string, hasta: string): number {
  const a = Date.UTC(+desde.slice(0, 4), +desde.slice(5, 7) - 1, +desde.slice(8, 10))
  const b = Date.UTC(+hasta.slice(0, 4), +hasta.slice(5, 7) - 1, +hasta.slice(8, 10))
  return Math.round((b - a) / 86_400_000)
}

export default function TabReporteSupertransporte({ vista }: { vista: VistaSupertransporte }) {
  const { reporte, atajos, hoy } = vista
  const p = reporte.periodo
  const router = useRouter()
  const pathname = usePathname()
  const [pendiente, startTransition] = useTransition()

  const [modo, setModo] = useState<ModoPeriodo>(p.modo)
  const [mesesSel, setMesesSel] = useState<string[]>(p.modo === 'meses' ? p.meses : [])
  const [desde, setDesde] = useState(p.desde)
  const [hasta, setHasta] = useState(p.hasta)

  const mesesDisponibles = mesesDelRango(`${PRIMER_MES}-01`, hoy).reverse()
  const query = new URLSearchParams(paramsDePeriodo(p)).toString()

  function ir(params: Record<string, string>) {
    const q = new URLSearchParams({ tab: PESTANA, ...params })
    startTransition(() => {
      router.replace(`${pathname}?${q.toString()}`, { scroll: false })
    })
  }

  const rangoValido = esFechaValida(desde) && esFechaValida(hasta) && desde <= hasta

  return (
    <div className={`space-y-6 transition-opacity ${pendiente ? 'opacity-60' : ''}`} aria-busy={pendiente}>
      {/* ── Selector de periodo ── */}
      <ChartCard title="Periodo del reporte" subtitle="Tú eliges el corte. Se aplica igual a las cifras y al Excel de soporte.">
        <div className="mb-4 flex gap-1 rounded-xl bg-gray-100 p-1 text-sm w-full sm:w-fit">
          {([
            ['atajo', 'Periodo regulatorio'],
            ['meses', 'Por meses'],
            ['rango', 'Rango libre'],
          ] as [ModoPeriodo, string][]).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setModo(k)}
              className={`flex-1 whitespace-nowrap rounded-lg px-3 py-1.5 font-medium transition-all sm:flex-none ${
                modo === k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {modo === 'atajo' && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {[...atajos].reverse().map((a) => {
              const activo = p.atajoId === a.id
              const vencido = a.fechaLimite < hoy
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => ir({ periodo: a.id })}
                  className={`rounded-xl border px-3 py-2.5 text-left transition-all ${
                    activo ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white hover:border-gray-400'
                  }`}
                >
                  <span className="block text-sm font-semibold">{a.etiqueta}</span>
                  <span className={`block text-xs ${activo ? 'text-gray-300' : vencido ? 'text-gray-400' : 'text-gray-600'}`}>
                    {vencido ? 'Venció' : 'Vence'} el {etiquetaFecha(a.fechaLimite)}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {modo === 'meses' && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {mesesDisponibles.map((m) => {
                const sel = mesesSel.includes(m)
                return (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={sel}
                    onClick={() => setMesesSel((prev) => (sel ? prev.filter((x) => x !== m) : [...prev, m]))}
                    className={`rounded-lg border px-3 py-1.5 text-sm transition-all ${
                      sel ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-400'
                    }`}
                  >
                    {etiquetaMes(m)}
                  </button>
                )
              })}
            </div>
            <button
              type="button"
              disabled={mesesSel.length === 0}
              onClick={() => ir({ meses: [...mesesSel].sort().join(',') })}
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              Ver {mesesSel.length === 1 ? 'el mes' : `${mesesSel.length} meses`}
            </button>
          </div>
        )}

        {modo === 'rango' && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="text-sm text-gray-600">
              Desde
              <input
                type="date"
                value={desde}
                onChange={(e) => setDesde(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-gray-900"
              />
            </label>
            <label className="text-sm text-gray-600">
              Hasta
              <input
                type="date"
                value={hasta}
                onChange={(e) => setHasta(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-gray-900"
              />
            </label>
            <button
              type="button"
              disabled={!rangoValido}
              onClick={() => ir({ desde, hasta })}
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              Ver rango
            </button>
          </div>
        )}
      </ChartCard>

      {/* ── Encabezado del periodo elegido ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{p.etiqueta}</h2>
          <p className="text-sm text-gray-500">
            Del {etiquetaFecha(p.desde)} al {etiquetaFecha(p.hasta)}
          </p>
          {p.fechaLimite && (
            <p className="mt-1 flex items-center gap-1.5 text-sm text-gray-700">
              <CalendarClock className="h-4 w-4" aria-hidden="true" />
              Fecha límite de radicación en VIGÍA: <b>{etiquetaFecha(p.fechaLimite)}</b>
              {p.fechaLimite >= hoy && (
                <span className="text-gray-500">
                  {' '}· {diasHasta(hoy, p.fechaLimite) === 0 ? 'vence hoy' : `faltan ${diasHasta(hoy, p.fechaLimite)} días`}
                </span>
              )}
            </p>
          )}
        </div>
        <a
          href={`/api/compliance/reporte-supertransporte?${query}`}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-800 shadow-sm hover:border-gray-400"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Exportar soporte (Excel)
        </a>
      </div>

      {p.enCurso && (
        <Aviso>
          El periodo todavía no cierra: las cifras van a cambiar hasta el {etiquetaFecha(p.hasta)}.
        </Aviso>
      )}

      {/* ── Tarjetas por literal, en el orden de VIGÍA ── */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {reporte.literales.map((l) => (
          <TarjetaLiteral key={l.letra} literal={l} />
        ))}
      </div>

      <p className="flex items-start gap-1.5 text-xs text-gray-500">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          Se cuentan contrapartes distintas (proveedores, clientes y empleados) por número de documento, no consultas.
          Quedan fuera {entero(reporte.excluidas.metrik)} consulta{reporte.excluidas.metrik === 1 ? '' : 's'} de prueba
          de MéTRIK y {entero(reporte.excluidas.error)} con error. Revisa las cifras antes de radicar.
        </span>
      </p>

      {/* ── Detalle mes a mes ── */}
      <ChartCard title="Mes a mes" subtitle="Contrapartes distintas dentro de cada mes. Una contraparte consultada en dos meses cuenta en los dos aquí, pero una sola vez arriba.">
        <div className="-mx-4 overflow-x-auto sm:mx-0">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-2 font-medium sm:px-2">Mes</th>
                <th className="px-2 py-2 text-right font-medium">Consultas</th>
                <th className="px-2 py-2 text-right font-medium">Contrapartes</th>
                <th className="px-2 py-2 text-right font-medium">Con coincidencia</th>
                {reporte.segmentos.map((s) => (
                  <th key={s} className="px-2 py-2 text-right font-medium whitespace-nowrap">{s}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reporte.mensual.map((m) => {
                // En un rango libre el primer y el último mes pueden ir recortados: se dice.
                return (
                  <tr key={m.mes} className="border-b border-gray-50 last:border-0">
                    <td className="px-4 py-2 whitespace-nowrap text-gray-900 sm:px-2">
                      {etiquetaMes(m.mes)}
                      {(m.desde !== `${m.mes}-01` || m.hasta < finDeMes(m.mes)) && (
                        <span className="block text-xs text-gray-400">
                          {Number(m.desde.slice(8))}–{Number(m.hasta.slice(8))}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-gray-600">{entero(m.consultas)}</td>
                    <td className="px-2 py-2 text-right tabular-nums font-semibold text-gray-900">{entero(m.contrapartes)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-gray-900">{entero(m.conCoincidencia)}</td>
                    {reporte.segmentos.map((s) => (
                      <td key={s} className="px-2 py-2 text-right tabular-nums text-gray-600">{entero(m.porSegmento[s] ?? 0)}</td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </ChartCard>
    </div>
  )
}

function TarjetaLiteral({ literal: l }: { literal: LiteralReporte }) {
  const sinDato = l.estado === 'sin_dato'
  const valor = l.valor === null ? null : l.unidad === 'porcentaje' ? `${l.valor.toLocaleString('es-CO')} %` : entero(l.valor)
  const fmt = (v: number | null) =>
    v === null ? 'Sin dato' : l.unidad === 'porcentaje' ? `${v.toLocaleString('es-CO')} %` : entero(v)

  return (
    <div
      className={`rounded-2xl border p-4 shadow-sm sm:p-5 ${
        sinDato ? 'border-gray-200 bg-gray-50' : 'border-gray-100 bg-white'
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
            sinDato ? 'bg-gray-200 text-gray-500' : 'bg-gray-900 text-white'
          }`}
        >
          {l.letra}
        </span>
        <p className={`text-sm leading-snug ${sinDato ? 'text-gray-500' : 'text-gray-700'}`}>{l.titulo}</p>
      </div>

      <p className={`mt-3 text-3xl font-bold tabular-nums ${sinDato ? 'text-gray-400' : 'text-gray-900'}`}>
        {valor ?? 'Sin dato'}
      </p>

      {l.causa && (
        <p className={`mt-2 flex items-start gap-1.5 text-xs ${sinDato ? 'text-gray-500' : 'text-amber-700'}`}>
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{l.causa}</span>
        </p>
      )}

      {l.desglose.length > 0 && (
        <dl className="mt-3 space-y-1 border-t border-gray-100 pt-3 text-sm">
          {l.desglose.map((d) => (
            <div key={d.segmento} className="flex justify-between gap-2">
              <dt className="text-gray-500">{d.segmento}</dt>
              <dd className={`tabular-nums ${d.valor === null ? 'text-gray-400' : 'font-medium text-gray-900'}`}>{fmt(d.valor)}</dd>
            </div>
          ))}
        </dl>
      )}

      {l.detalle.length > 0 && (
        <ul className="mt-3 space-y-0.5 text-xs text-gray-500">
          {l.detalle.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </div>
  )
}
