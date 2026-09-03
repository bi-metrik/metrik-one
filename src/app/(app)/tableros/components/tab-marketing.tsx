'use client'

/**
 * Pestana Marketing: de donde vienen los negocios y cuanto costo traerlos.
 *
 * Sale de la reunion con Daniela Jativa del 2026-09-02. Lo que ella pidio, textual:
 * "lo importante es ver cuantos vamos cerrando de las campanas, cuanto dinero se ha
 * recaudado" y "que tan rentable estan siendo esas campanas para nosotros".
 *
 * DOS lentes, porque son dos preguntas y una sola tabla las confunde:
 *   · Mes     — de las ventas de este mes, cuantas trajo cada campana. Ordena caja.
 *   · Cohorte — de los leads que trajo esta campana, cuantos han cerrado. Es la unica
 *               que responde por la rentabilidad, porque un lead de julio cierra en
 *               septiembre.
 *
 * Las dos salen de las mismas filas; la aritmetica vive en `@/lib/tableros/marketing`
 * y esta probada aparte.
 */

import { useMemo, useState } from 'react'
import {
  cac,
  cohorteInmadura,
  conversion,
  cpl,
  lenteCohorte,
  lenteMes,
  mesesConDatos,
  roas,
  totales,
  type CampanaAgregada,
} from '@/lib/tableros/marketing'
import type { MarketingData } from '../marketing-actions'
import { MarketingDrawer, type CampanaSeleccionada } from './marketing-drawer'

const CARBON = '#1A1A1A'
const GRIS = '#6B7280'
const BORDE = '#E5E7EB'

const MESES_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

const fmtCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n)
const fmtNum = (n: number) => new Intl.NumberFormat('es-CO').format(n)
const fmtPct = (x: number) => `${(x * 100).toFixed(1)}%`
const RAYA = '—'

function etiquetaMes(mes: string): string {
  const [a, m] = mes.split('-')
  return `${MESES_ES[Number(m) - 1]} ${a}`
}

type Lente = 'mes' | 'cohorte'

export default function TabMarketing({ datos }: { datos: MarketingData }) {
  const meses = useMemo(() => mesesConDatos(datos.filas), [datos.filas])
  const [lente, setLente] = useState<Lente>('mes')
  // Arranca en el mes en curso si tiene algo; si no, en el mas reciente que si.
  const [mes, setMes] = useState<string>(
    meses.includes(datos.mesEnCurso) ? datos.mesEnCurso : (meses[0] ?? datos.mesEnCurso),
  )
  const [seleccion, setSeleccion] = useState<CampanaSeleccionada | null>(null)

  const filas = useMemo(
    () => (lente === 'mes' ? lenteMes(datos.filas, mes) : lenteCohorte(datos.filas)),
    [datos.filas, lente, mes],
  )
  const t = useMemo(() => totales(filas), [filas])

  const campanas = filas.filter(f => !f.sinRastro)
  const sinRastro = filas.find(f => f.sinRastro) ?? null
  const idx = meses.indexOf(mes)

  function abrir(c: CampanaAgregada) {
    setSeleccion({
      campaignId: c.campaignId,
      titulo: c.campana,
      mes: lente === 'mes' ? mes : null,
      alcance: lente === 'mes' ? `ventas de ${etiquetaMes(mes)}` : 'todos los negocios de la campaña',
    })
  }

  return (
    <div>
      {/* ── Controles ────────────────────────────────────────────────────── */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
          {(['mes', 'cohorte'] as const).map(l => (
            <button
              key={l}
              onClick={() => setLente(l)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                lente === l ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
              title={
                l === 'mes'
                  ? 'De las ventas de este mes, cuánto trajo cada campaña'
                  : 'De los leads que trajo cada campaña, cuántos han cerrado — sin importar en qué mes'
              }
            >
              {l === 'mes' ? 'Mes' : 'Cohorte'}
            </button>
          ))}
        </div>

        {lente === 'mes' && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMes(meses[idx + 1])}
              disabled={idx < 0 || idx + 1 >= meses.length}
              aria-label="Mes anterior"
              className="rounded border border-gray-200 px-2 py-1 text-sm hover:bg-gray-50 disabled:opacity-30"
            >←</button>
            <h2 className="text-sm font-bold" style={{ color: CARBON }}>{etiquetaMes(mes)}</h2>
            <button
              onClick={() => setMes(meses[idx - 1])}
              disabled={idx <= 0}
              aria-label="Mes siguiente"
              className="rounded border border-gray-200 px-2 py-1 text-sm hover:bg-gray-50 disabled:opacity-30"
            >→</button>
          </div>
        )}
      </div>

      {/* ── Encabezado ───────────────────────────────────────────────────── */}
      <div className="mb-2 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Cifra titulo="Leads" valor={fmtNum(t.leads)} />
        <Cifra titulo={lente === 'mes' ? 'Ventas de campaña' : 'Ventas de las cohortes'} valor={fmtNum(t.ventas)} />
        <Cifra titulo="Recaudo de campaña" valor={fmtCOP(t.recaudado)} />
        <Cifra
          titulo={lente === 'mes' ? '% de las ventas del mes' : '% del recaudo total'}
          valor={t.parteDeLasVentas === null ? RAYA : fmtPct(t.parteDeLasVentas)}
          nota="Solo lo que dejó huella de Meta. El resto no es «no vino de marketing»: es que no se pudo atribuir."
        />
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Cifra titulo="Inversión" valor={t.gastoConocido ? fmtCOP(t.gasto) : RAYA} />
        <Cifra
          titulo="CAC"
          valor={t.gastoConocido && t.ventas > 0 ? fmtCOP(t.gasto / t.ventas) : RAYA}
          nota="Inversión dividida entre las ventas atribuidas."
        />
      </div>

      {!datos.gastoSincronizado && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <strong>La inversión todavía no se ha sincronizado con Meta.</strong> Leads, ventas,
          conversión y recaudo son cifras completas; el gasto, el CPL, el CAC y el ROAS aparecen
          con raya hasta que corra el sync. Una raya dice «no lo sabemos»; un cero diría «no se
          invirtió», que es otra cosa.
        </p>
      )}

      {datos.monedas.length > 1 && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
          Las cuentas publicitarias reportan en monedas distintas ({datos.monedas.join(', ')}). La
          suma de la inversión no significa nada hasta resolverlo.
        </p>
      )}

      {/* ── Tabla (desde md) ─────────────────────────────────────────────── */}
      {campanas.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-6 text-center text-sm" style={{ color: GRIS }}>
          Ninguna campaña de Meta tuvo actividad en {etiquetaMes(mes)}.
          {sinRastro && <> Las {fmtNum(sinRastro.ventas)} ventas del mes no dejaron rastro de Meta.</>}
        </p>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-lg border md:block" style={{ borderColor: BORDE }}>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase" style={{ color: GRIS }}>
                <tr>
                  <th className="px-4 py-3 text-left">Campaña</th>
                  <th className="px-3 py-3 text-right">Gasto</th>
                  <th className="px-3 py-3 text-right">Leads</th>
                  <th className="px-3 py-3 text-right">CPL</th>
                  <th className="px-3 py-3 text-right">Ventas</th>
                  <th className="px-3 py-3 text-right">Conv.</th>
                  <th className="px-3 py-3 text-right">CAC</th>
                  <th className="px-3 py-3 text-right">Recaudo</th>
                  <th className="px-3 py-3 text-right">ROAS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {campanas.map(c => {
                  const inmadura = lente === 'cohorte' && cohorteInmadura(c.ultimoLead, datos.hoyISO)
                  const conv = conversion(c)
                  const r = roas(c)
                  return (
                    <tr
                      key={c.campaignId ?? 'sin'}
                      onClick={() => abrir(c)}
                      className="cursor-pointer hover:bg-[#F9FAFB]"
                    >
                      <td className="max-w-[16rem] truncate px-4 py-2.5" title={c.campana}>{c.campana}</td>
                      <Celda>{c.gastoConocido ? fmtCOP(c.gasto) : RAYA}</Celda>
                      <Celda>{fmtNum(c.leads)}</Celda>
                      <Celda>{cpl(c) === null ? RAYA : fmtCOP(cpl(c)!)}</Celda>
                      <Celda>{fmtNum(c.ventas)}</Celda>
                      <td
                        className={`px-3 py-2.5 text-right tabular-nums ${inmadura ? 'text-gray-400' : ''}`}
                        title={
                          inmadura
                            ? 'Cohorte sin madurar: sus leads llevan menos de 30 días y todavía no han tenido tiempo de cerrar. Este número no se puede juzgar.'
                            : undefined
                        }
                      >
                        {conv === null ? RAYA : fmtPct(conv)}
                      </td>
                      <Celda>{cac(c) === null ? RAYA : fmtCOP(cac(c)!)}</Celda>
                      <Celda>{fmtCOP(c.recaudado)}</Celda>
                      <Celda>{r === null ? RAYA : `${r.toFixed(1)}x`}</Celda>
                    </tr>
                  )
                })}

                {sinRastro && (
                  <tr
                    onClick={() => abrir(sinRastro)}
                    className="cursor-pointer border-t-2 bg-gray-50 hover:bg-gray-100"
                    style={{ borderColor: BORDE, color: GRIS }}
                    title="No significa que no vinieran de marketing: significa que no dejaron huella. Casi siempre porque el comercial creó un contacto nuevo en vez de enganchar el que ya existía."
                  >
                    <td className="px-4 py-2.5 italic">Sin rastro de Meta</td>
                    <Celda>{RAYA}</Celda>
                    <Celda>{RAYA}</Celda>
                    <Celda>{RAYA}</Celda>
                    <Celda>{fmtNum(sinRastro.ventas)}</Celda>
                    <Celda>{RAYA}</Celda>
                    <Celda>{RAYA}</Celda>
                    <Celda>{fmtCOP(sinRastro.recaudado)}</Celda>
                    <Celda>{RAYA}</Celda>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* ── Tarjetas (bajo md) ─────────────────────────────────────────
              Nueve columnas no caben en 375 px. No hay scroll horizontal ni
              columnas que se escondan solas: son las dos formas conocidas de
              volver ilegible una tabla en celular. */}
          <div className="space-y-2 md:hidden">
            {campanas.map(c => {
              const inmadura = lente === 'cohorte' && cohorteInmadura(c.ultimoLead, datos.hoyISO)
              const conv = conversion(c)
              const r = roas(c)
              return (
                <button
                  key={c.campaignId ?? 'sin'}
                  onClick={() => abrir(c)}
                  className="block w-full rounded-lg border p-3 text-left"
                  style={{ borderColor: BORDE }}
                >
                  <p className="truncate text-xs font-semibold" style={{ color: CARBON }} title={c.campana}>
                    {c.campana}
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]" style={{ color: GRIS }}>
                    <Par k="Gasto" v={c.gastoConocido ? fmtCOP(c.gasto) : RAYA} />
                    <Par k="Recaudo" v={fmtCOP(c.recaudado)} />
                    <Par k="Leads → ventas" v={`${fmtNum(c.leads)} → ${fmtNum(c.ventas)}`} />
                    <Par
                      k="Conv."
                      v={conv === null ? RAYA : fmtPct(conv)}
                      apagado={inmadura}
                      titulo={inmadura ? 'Cohorte sin madurar: menos de 30 días desde el último lead.' : undefined}
                    />
                    <Par k="CAC" v={cac(c) === null ? RAYA : fmtCOP(cac(c)!)} />
                    <Par k="ROAS" v={r === null ? RAYA : `${r.toFixed(1)}x`} />
                  </div>
                </button>
              )
            })}

            {sinRastro && (
              <button
                onClick={() => abrir(sinRastro)}
                className="block w-full rounded-lg border-2 bg-gray-50 p-3 text-left"
                style={{ borderColor: BORDE }}
              >
                <p className="text-xs font-semibold italic" style={{ color: GRIS }}>Sin rastro de Meta</p>
                <div className="mt-2 grid grid-cols-2 gap-x-3 text-[11px]" style={{ color: GRIS }}>
                  <Par k="Ventas" v={fmtNum(sinRastro.ventas)} />
                  <Par k="Recaudo" v={fmtCOP(sinRastro.recaudado)} />
                </div>
                <p className="mt-2 text-[10px]" style={{ color: GRIS }}>
                  No dejaron huella. No es lo mismo que «no vinieron de marketing».
                </p>
              </button>
            )}
          </div>
        </>
      )}

      <p className="mt-3 text-xs" style={{ color: GRIS }}>
        El <strong>ROAS está medido contra el recaudo atribuido</strong>, y la atribución solo
        alcanza a los negocios que dejaron huella de Meta. El retorno real es <em>mejor</em> que el
        que muestra la tabla, nunca peor: no apagues una campaña por este número solo.
      </p>
      <p className="text-xs" style={{ color: GRIS }}>
        Los leads son <strong>contactos distintos</strong>, no formularios: dos formularios del
        mismo número son una persona. Toca una fila para ver los negocios que hay detrás.
      </p>

      {seleccion && (
        <MarketingDrawer
          key={`${seleccion.campaignId ?? 'sin'}|${seleccion.mes ?? 'cohorte'}`}
          seleccion={seleccion}
          onClose={() => setSeleccion(null)}
        />
      )}
    </div>
  )
}

function Celda({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2.5 text-right tabular-nums">{children}</td>
}

function Cifra({ titulo, valor, nota }: { titulo: string; valor: string; nota?: string }) {
  return (
    <div className="rounded-lg border bg-white px-4 py-3" style={{ borderColor: BORDE }} title={nota}>
      <p className="text-[11px] uppercase tracking-wide" style={{ color: GRIS }}>{titulo}</p>
      <p className="mt-1 text-xl font-bold tabular-nums" style={{ color: CARBON }}>{valor}</p>
    </div>
  )
}

function Par({ k, v, apagado, titulo }: { k: string; v: string; apagado?: boolean; titulo?: string }) {
  return (
    <span title={titulo}>
      {k}: <strong className={`tabular-nums ${apagado ? 'text-gray-400' : ''}`} style={apagado ? undefined : { color: CARBON }}>{v}</strong>
    </span>
  )
}
