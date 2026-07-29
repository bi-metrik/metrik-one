'use client'

import { useState } from 'react'
import { ArrowDown, ArrowUp, Minus, Info } from 'lucide-react'
import type { ProcesoSemanalData, ProcesoSeccionalData, ProcesoSeccionalEtapa } from '../types'
import { ChartCard } from './chart-card'

// Paleta MeTRIK (tokens del manual de marca, no Tailwind generico).
const VERDE = '#10B981'
const CARBON = '#1A1A1A'
const GRIS = '#6B7280'
const BORDE = '#E5E7EB'
const AMBAR = '#F59E0B'

/**
 * Foto del proceso: cuantos negocios abiertos hay en cada etapa, y como cambio
 * esa fila contra la semana pasada.
 *
 * El valor no esta en el conteo (eso ya se ve en /negocios) sino en el delta: es
 * lo que permite decir "aqui se esta represando" en la reunion de los lunes.
 */
export function TabProceso({ data }: { data: ProcesoSemanalData }) {
  const { etapas, totalAbiertos, fechaFotoPrevia, etapasConSla, etapasTotales } = data

  // Etapa con mas acumulado: es el cuello de botella del momento.
  const maxAbiertos = etapas.reduce((m, e) => Math.max(m, e.abiertos), 0)
  const cuello = etapas.find(e => e.abiertos === maxAbiertos)

  const slaIncompleto = etapasConSla < etapasTotales

  return (
    <div className="space-y-6">

      <ChartCard title="Foto del proceso" accentColor={VERDE}>
        {etapas.length === 0 ? (
          <p className="py-4 text-center text-sm" style={{ color: GRIS }}>
            No hay negocios abiertos.
          </p>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-baseline gap-x-6 gap-y-1">
              <div>
                <span className="text-2xl font-bold tabular-nums" style={{ color: CARBON }}>
                  {totalAbiertos}
                </span>
                <span className="ml-1.5 text-xs" style={{ color: GRIS }}>
                  negocios abiertos en {etapas.length} etapas
                </span>
              </div>
              {cuello && cuello.abiertos > 0 && (
                <div className="text-xs" style={{ color: GRIS }}>
                  Mayor acumulado: <strong style={{ color: CARBON }}>{cuello.nombre}</strong> ({cuello.abiertos})
                </div>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="border-b" style={{ borderColor: BORDE }}>
                    <th className="pb-2 text-left text-[10px] font-medium uppercase tracking-wide" style={{ color: GRIS }}>
                      Etapa
                    </th>
                    <th className="pb-2 text-right text-[10px] font-medium uppercase tracking-wide" style={{ color: GRIS }}>
                      Ahora
                    </th>
                    <th className="pb-2 text-right text-[10px] font-medium uppercase tracking-wide" style={{ color: GRIS }}>
                      {fechaFotoPrevia ? 'Foto previa' : 'Sin comparacion'}
                    </th>
                    <th className="pb-2 text-right text-[10px] font-medium uppercase tracking-wide" style={{ color: GRIS }}>
                      Cambio
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {etapas.map(e => {
                    const pct = maxAbiertos > 0 ? (e.abiertos / maxAbiertos) * 100 : 0
                    return (
                      <tr key={e.etapaId} className="border-b last:border-0" style={{ borderColor: BORDE }}>
                        <td className="py-2 pr-3">
                          <div className="flex items-center gap-2">
                            <span className="min-w-0 truncate" style={{ color: CARBON }}>{e.nombre}</span>
                          </div>
                          {/* Barra proporcional: hace saltar a la vista donde se acumula. */}
                          <div className="mt-1 h-1 w-full rounded-full" style={{ backgroundColor: BORDE }}>
                            <div
                              className="h-1 rounded-full"
                              style={{ width: `${pct}%`, backgroundColor: VERDE }}
                            />
                          </div>
                        </td>
                        <td className="py-2 text-right align-top tabular-nums font-medium" style={{ color: CARBON }}>
                          {e.abiertos}
                        </td>
                        <td className="py-2 text-right align-top tabular-nums" style={{ color: GRIS }}>
                          {e.antes ?? '—'}
                        </td>
                        <td className="py-2 text-right align-top">
                          <Delta delta={e.delta} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {!fechaFotoPrevia && (
              <p className="mt-3 flex items-start gap-1.5 text-[11px]" style={{ color: GRIS }}>
                <Info className="mt-0.5 h-3 w-3 shrink-0" />
                <span>
                  Esta es la primera foto. La comparacion aparece cuando se tome la siguiente:
                  el historico se construye hacia adelante, no se reconstruye hacia atras.
                </span>
              </p>
            )}
          </>
        )}
      </ChartCard>

      {/* El conteo de vencidos solo significa algo si las etapas tienen SLA. Decirlo
          en pantalla evita que un cero se lea como "vamos al dia". */}
      {slaIncompleto && (
        <div
          className="flex items-start gap-2 rounded-lg border p-3 text-[11px]"
          style={{ borderColor: BORDE, backgroundColor: '#FFFBEB', color: CARBON }}
        >
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: AMBAR }} />
          <span>
            Solo <strong>{etapasConSla} de {etapasTotales}</strong> etapas tienen tiempo maximo
            configurado. Mientras falten, el conteo de atrasados no cubre todo el proceso:
            una etapa sin configurar nunca aparece como atrasada, aunque tenga casos represados.
          </span>
        </div>
      )}
    </div>
  )
}

/** `null` = no hay foto previa con que comparar. Distinto de un cambio de cero. */
function Delta({ delta }: { delta: number | null }) {
  if (delta == null) return <span className="text-xs" style={{ color: GRIS }}>—</span>
  if (delta === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs" style={{ color: GRIS }}>
        <Minus className="h-3 w-3" /> 0
      </span>
    )
  }
  // Que suba no es malo por si solo (puede ser que entraron negocios nuevos), asi
  // que se marca en ambar, no en rojo: es una senal para mirar, no un veredicto.
  const subio = delta > 0
  return (
    <span
      className="inline-flex items-center gap-0.5 text-xs font-medium tabular-nums"
      style={{ color: subio ? AMBAR : VERDE }}
    >
      {subio ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      {subio ? '+' : ''}{delta}
    </span>
  )
}

/**
 * Casos por seccional y etapa.
 *
 * Pedido por Juan David: saber cuántos casos hay en cada una de las 4 ciudades que
 * exigen cita previa en la DIAN, y cuántos en seccionales que no la exigen. Es lo que
 * le permite decidir dónde puede seguir vendiendo: la cita es el cuello de botella
 * (la DIAN emite ~200 al mes en Bogotá para todo el país).
 */
export function ProcesoPorSeccional({ data }: { data: ProcesoSeccionalData }) {
  const { etapas, conCita, sinCita, sinRegistrar, total, fechaFotoPrevia } = data
  // Dos lecturas del mismo cuadro: cuantos casos hay, o cuantos van tarde.
  const [metrica, setMetrica] = useState<'abiertos' | 'vencidos'>('abiertos')

  const valorDe = (c: { abiertos: number; vencidos: number } | undefined) =>
    c ? (metrica === 'abiertos' ? c.abiertos : c.vencidos) : 0
  const antesDe = (c: { abiertosAntes: number | null; vencidosAntes: number | null } | undefined) =>
    c ? (metrica === 'abiertos' ? c.abiertosAntes : c.vencidosAntes) : null

  const celda = (e: ProcesoSeccionalEtapa, nombre: string | null) =>
    e.celdas.find(c => c.seccional === nombre)

  const sumaGrupo = (e: ProcesoSeccionalEtapa, nombres: string[]) => {
    let hoy = 0
    let antes: number | null = null
    for (const n of nombres) {
      const c = celda(e, n)
      hoy += valorDe(c)
      const a = antesDe(c)
      if (a !== null) antes = (antes ?? 0) + a
    }
    return { hoy, antes }
  }

  const totalCol = (nombre: string | null) => {
    let hoy = 0
    let antes: number | null = null
    for (const e of etapas) {
      const c = celda(e, nombre)
      hoy += valorDe(c)
      const a = antesDe(c)
      if (a !== null) antes = (antes ?? 0) + a
    }
    return { hoy, antes }
  }

  const totalGrupo = (nombres: string[]) => {
    let hoy = 0
    let antes: number | null = null
    for (const n of nombres) {
      const t = totalCol(n)
      hoy += t.hoy
      if (t.antes !== null) antes = (antes ?? 0) + t.antes
    }
    return { hoy, antes }
  }

  const tConCita = totalGrupo(conCita)
  const tSinCita = totalGrupo(sinCita)
  const tSinReg = totalCol(null)

  return (
    <ChartCard title="Casos por seccional" accentColor={VERDE}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs" style={{ color: GRIS }}>
          <span>
            <strong style={{ color: CARBON }}>{tConCita.hoy}</strong> requieren cita
          </span>
          <span>
            <strong style={{ color: CARBON }}>{tSinCita.hoy}</strong> sin cita
          </span>
          {sinRegistrar > 0 && (
            <span style={{ color: '#92400E' }}>
              <strong>{sinRegistrar}</strong> sin seccional
            </span>
          )}
        </div>
        <div className="flex gap-1 rounded-lg bg-gray-100 p-0.5">
          {(['abiertos', 'vencidos'] as const).map(m => (
            <button
              key={m}
              type="button"
              onClick={() => setMetrica(m)}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-all ${
                metrica === m ? 'bg-white shadow-sm' : ''
              }`}
              style={{ color: metrica === m ? CARBON : GRIS }}
            >
              {m === 'abiertos' ? 'Casos' : 'Solo atrasados'}
            </button>
          ))}
        </div>
      </div>

      <p className="mb-2 text-[11px]" style={{ color: GRIS }}>
        {fechaFotoPrevia
          ? `Cada celda muestra hoy / ${fechaFotoPrevia}`
          : 'La comparación aparece cuando se tome la siguiente foto semanal.'}
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-sm">
          <thead>
            <tr className="border-b" style={{ borderColor: BORDE }}>
              <th className="pb-2 text-left text-[10px] font-medium uppercase tracking-wide" style={{ color: GRIS }}>
                Etapa
              </th>
              {conCita.map(c => (
                <th
                  key={c}
                  className="pb-2 text-right text-[10px] font-bold uppercase tracking-wide"
                  style={{ color: AMBAR }}
                  title="Seccional que exige cita previa en la DIAN"
                >
                  {c}
                </th>
              ))}
              <th
                className="pb-2 text-right text-[10px] font-medium uppercase tracking-wide"
                style={{ color: GRIS }}
                title={sinCita.join(', ') || 'Sin casos'}
              >
                Sin cita
              </th>
              <th className="pb-2 text-right text-[10px] font-medium uppercase tracking-wide" style={{ color: '#92400E' }}>
                Sin registrar
              </th>
            </tr>
          </thead>
          <tbody>
            {etapas.map(e => (
              <tr key={e.etapaId} className="border-b last:border-0" style={{ borderColor: BORDE }}>
                <td className="py-2 pr-3 text-xs" style={{ color: CARBON }}>
                  <span className="tabular-nums" style={{ color: GRIS }}>
                    {String(e.numero).padStart(2, '0')}
                  </span>{' '}
                  {e.nombre}
                </td>
                {conCita.map(c => {
                  const cel = celda(e, c)
                  return <Celda key={c} hoy={valorDe(cel)} antes={antesDe(cel)} destacar />
                })}
                <Celda {...sumaGrupo(e, sinCita)} />
                <Celda {...{ hoy: valorDe(celda(e, null)), antes: antesDe(celda(e, null)) }} alerta />
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2" style={{ borderColor: BORDE }}>
              <td className="pt-2 text-[10px] font-bold uppercase tracking-wide" style={{ color: GRIS }}>
                Total ({total})
              </td>
              {conCita.map(c => {
                const t = totalCol(c)
                return <Celda key={c} hoy={t.hoy} antes={t.antes} destacar negrita />
              })}
              <Celda hoy={tSinCita.hoy} antes={tSinCita.antes} negrita />
              <Celda hoy={tSinReg.hoy} antes={tSinReg.antes} alerta negrita />
            </tr>
          </tfoot>
        </table>
      </div>

      {sinRegistrar > 0 && metrica === 'abiertos' && (
        <p className="mt-3 flex items-start gap-1.5 text-[11px]" style={{ color: '#92400E' }}>
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            <strong>{sinRegistrar} de {total}</strong> casos no tienen seccional registrada, así que
            no se sabe todavía si necesitan cita. La seccional se toma del RUT (casilla 12) y el
            cargue de los casos antiguos está pendiente.
          </span>
        </p>
      )}
    </ChartCard>
  )
}

/** Celda "hoy / antes". El antes va atenuado: el dato que manda es el de hoy. */
function Celda({
  hoy,
  antes,
  destacar,
  alerta,
  negrita,
}: {
  hoy: number
  antes: number | null
  destacar?: boolean
  alerta?: boolean
  negrita?: boolean
}) {
  const color = hoy > 0 ? (alerta ? '#92400E' : destacar ? AMBAR : CARBON) : BORDE
  return (
    <td className="py-2 text-right tabular-nums">
      <span style={{ color, fontWeight: negrita || hoy > 0 ? 600 : 400 }}>{hoy || '·'}</span>
      {antes !== null && (
        <span className="text-[11px]" style={{ color: BORDE }}>
          {' / '}
          <span style={{ color: GRIS }}>{antes}</span>
        </span>
      )}
    </td>
  )
}
