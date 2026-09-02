'use client'

import { useState, useTransition } from 'react'
import { getDirectivo, type DirectivoData } from '../directivo-actions'
import { COLUMNAS_DIRECTIVO } from '@/lib/dian/agrupacion-directivo'

const MESES_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

const fmtCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n)

/**
 * Pestana Direccion: la replica de lo que Juan David lleva a mano en el Sheet
 * "Directivo SOENA".
 *
 * Lo que el Sheet tiene y esta pantalla NO puede tener todavia sale declarado abajo,
 * en la nota. No se dibuja en cero: un cero en "certificados con error" se leeria como
 * calidad perfecta, que es justo lo que nadie puede afirmar hoy.
 *
 * ⚠️ Para los reprocesos, ese "no puede" caduco el 2026-08-31: la razon era que
 * `reproceso_eventos` estaba vacia, y estaba vacia porque el insert fallaba con 42501,
 * no porque no hubiera reprocesos — habia 7. Repuestos por
 * `scripts/backfill-reproceso-eventos.ts`. Lo que falta ahora es que la RPC
 * `get_directivo_soena` los devuelva y esta pantalla los dibuje; el dato ya existe.
 */
export default function TabDireccion({ inicial }: { inicial: DirectivoData }) {
  const [datos, setDatos] = useState(inicial)
  const [cargando, startTransition] = useTransition()

  function irAMes(delta: number) {
    const d = new Date(datos.anio, datos.mes - 1 + delta, 1)
    const anio = d.getFullYear()
    const mes = d.getMonth() + 1
    startTransition(async () => {
      const nuevo = await getDirectivo(anio, mes)
      if (nuevo) setDatos(nuevo)
    })
  }

  const { comercial: c, metas: m } = datos

  return (
    <div className={cargando ? 'opacity-60 transition-opacity' : ''}>
      <div className="mb-4 flex items-center gap-3">
        <button onClick={() => irAMes(-1)} aria-label="Mes anterior"
          className="rounded border border-gray-200 px-2 py-1 text-sm hover:bg-gray-50">←</button>
        <h2 className="text-sm font-bold text-gray-900">
          {MESES_ES[datos.mes - 1]} {datos.anio}
        </h2>
        <button onClick={() => irAMes(1)} aria-label="Mes siguiente"
          className="rounded border border-gray-200 px-2 py-1 text-sm hover:bg-gray-50">→</button>
      </div>

      {/* ── Comercial ─────────────────────────────────────────────────────── */}
      <h3 className="mb-2 text-sm font-bold text-gray-900">Comercial · B2C</h3>
      <div className="mb-2 overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3 text-left">Indicador</th>
              <th className="px-4 py-3 text-right">Valor</th>
              <th className="px-4 py-3 text-right">Meta</th>
              <th className="px-4 py-3 text-right">Cumplimiento</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            <FilaKpi nombre="Leads generados" valor={c.leads_generados} meta={m.meta_leads_mensual} />
            <FilaKpi nombre="Leads calificados" valor={c.leads_calificados} meta={m.meta_leads_calificados_mensual}
              nota="Negocios que superaron Validación" />
            <FilaKpi nombre="Negocios cerrados" valor={c.negocios_cerrados} meta={m.meta_negocios_mensual} />
            <FilaKpi nombre="Ingresos primer pago" valor={c.primer_pago} meta={null} moneda />
            <FilaKpi nombre="Ingresos segundo pago" valor={c.segundo_pago} meta={null} moneda />
            <FilaKpi nombre="Ventas totales" valor={c.ventas_totales} meta={m.meta_ventas_mensual} moneda destacada />
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        Las tres cifras de dinero van <strong>sin IVA</strong>: es lo que queda como ingreso, no
        lo que entró a la cuenta. El IVA se recauda para la DIAN y se previsiona aparte. La meta
        de ventas también está declarada sin IVA, así que el cumplimiento compara lo mismo contra
        lo mismo.
      </p>
      <p className="mb-8 text-xs text-gray-500">
        El Sheet parte estas cifras por ciudad. Aquí no: la seccional aparece con el RUT, en
        Documentación, y un lead recién entrado todavía no tiene ninguna. Repartirlos sería
        inventar una distribución que nadie midió.
      </p>

      {/* ── Operaciones ───────────────────────────────────────────────────── */}
      <h3 className="mb-2 text-sm font-bold text-gray-900">Operaciones · B2C</h3>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3 text-left">Etapa del proceso</th>
              {COLUMNAS_DIRECTIVO.map(col => (
                <th key={col} className="px-3 py-3 text-right">{col}</th>
              ))}
              <th className="px-4 py-3 text-right font-bold">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {datos.operaciones.map(f => (
              <tr key={f.orden} className={f.nombre === 'Fuera del proceso operativo' ? 'bg-gray-50 text-gray-500' : ''}>
                <td className="px-4 py-2.5">{f.nombre}</td>
                {COLUMNAS_DIRECTIVO.map(col => (
                  <td key={col} className="px-3 py-2.5 text-right tabular-nums">
                    {f.columnas[col] || <span className="text-gray-300">—</span>}
                  </td>
                ))}
                <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{f.total}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-gray-200 bg-gray-50 font-bold">
              <td className="px-4 py-2.5">Total en el proceso</td>
              {COLUMNAS_DIRECTIVO.map(col => (
                <td key={col} className="px-3 py-2.5 text-right tabular-nums">
                  {datos.operaciones.reduce((s, f) => s + f.columnas[col], 0)}
                </td>
              ))}
              <td className="px-4 py-2.5 text-right tabular-nums">{datos.totalCartera}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-2 mb-8 text-xs text-gray-500">
        Es una foto de dónde está parado cada caso hoy, no un acumulado del mes — igual que el
        Sheet. La última fila recoge las etapas que el Sheet no nombra (las cinco comerciales,
        Precobro, Cobro y Entrega) para que la matriz sume todo en vez de perder casos en
        silencio. El total son los casos abiertos más los que ya terminaron el proceso; los
        perdidos y los cancelados no entran, por eso no coincide con los abiertos de Negocios.
      </p>

      {/* ── Citas ─────────────────────────────────────────────────────────── */}
      <h3 className="mb-2 text-sm font-bold text-gray-900">
        Citas de la DIAN con fecha en {MESES_ES[datos.mes - 1]}
      </h3>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              {COLUMNAS_DIRECTIVO.map(col => <th key={col} className="px-3 py-3 text-right">{col}</th>)}
              <th className="px-4 py-3 text-right font-bold">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              {COLUMNAS_DIRECTIVO.map(col => (
                <td key={col} className="px-3 py-2.5 text-right tabular-nums">
                  {datos.citas.columnas[col] || <span className="text-gray-300">—</span>}
                </td>
              ))}
              <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{datos.citas.total}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-2 mb-8 text-xs text-gray-500">
        Cuenta las citas cuya <strong>fecha cae en el mes</strong>. El Sheet cuenta las que se
        agendaron durante el mes, y esa cifra no es recuperable: la marca de tiempo de los 104
        bloques quedó estampada por la migración de agosto, no por el trabajo real.
      </p>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
        <p className="mb-1 font-semibold">Tres bloques del Sheet no están aquí, y no es un olvido:</p>
        <ul className="list-disc space-y-1 pl-4">
          <li><strong>Certificados UPME erróneos</strong> y <strong>devoluciones de la DIAN</strong>:{' '}
            Deisy <strong>ya los registra en ONE</strong> —el primero es del 13 de agosto—, pero esta pantalla
            todavía no los trae. Falta traerlos, no capturarlos.</li>
          <li><strong>Inversión de marketing y CAC por campaña</strong>: se teclean desde Meta Ads; no hay
            integración que los traiga.</li>
          <li><strong>Bonos y comisiones</strong>: la mecánica comercial sigue pendiente de cerrar.</li>
        </ul>
      </div>
    </div>
  )
}

function FilaKpi({ nombre, valor, meta, moneda, nota, destacada }: {
  nombre: string; valor: number; meta?: number | null
  moneda?: boolean; nota?: string; destacada?: boolean
}) {
  const cumple = meta ? valor / meta : null
  return (
    <tr className={destacada ? 'bg-gray-50 font-semibold' : ''}>
      <td className="px-4 py-2.5">
        {nombre}
        {nota && <span className="ml-2 text-xs font-normal text-gray-400">{nota}</span>}
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums">{moneda ? fmtCOP(valor) : valor}</td>
      <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">
        {meta ? (moneda ? fmtCOP(meta) : meta) : <span className="text-gray-300">sin meta</span>}
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums">
        {cumple === null
          ? <span className="text-gray-300">—</span>
          : <span className={cumple >= 1 ? 'text-green-600' : cumple >= 0.7 ? 'text-amber-600' : 'text-red-600'}>
              {Math.round(cumple * 100)}%
            </span>}
      </td>
    </tr>
  )
}
