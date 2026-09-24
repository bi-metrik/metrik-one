'use client'

import { useState } from 'react'

import { adicionalEnLaFicha, aAdicional, type FilaAdicional } from '@/lib/cotizaciones/adicionales'
import { hotelesDeItems, type ItemConLectura } from '@/lib/cotizaciones/detalle-viaje'
import type { PreciosAMano, TarifaConfirmada } from '@/lib/cotizaciones/tarifa-pasajero'
import { filasDeCosto, pesos } from '@/lib/cotizaciones/tarjeta-opcion'
import { TOKENS, textosDeTarjetaHotel } from '@/lib/pdf/cotizacion-trappvel-formato'

/**
 * «Así lo ve el cliente» (prototipo de la tarjeta, 2026-09-24): la opción de hotel como sale en
 * la hoja de la cotización de Trappvel, con los colores y la letra del documento, y la nota
 * para el cliente escrita encima de la hoja.
 *
 * ⚠️ Los textos NO se arman aquí: la tarjeta del hotel sale de `textosDeTarjetaHotel` (la misma
 * función que pinta el PDF) y el precio de cada pasajero de `filasDeCosto`, que reparte con la
 * regla del documento (`precioPorPasajero` / `precioPorHabitacion`). Si el PDF cambia, esto
 * cambia con él.
 */

const HELVETICA = '"Helvetica Neue", Helvetica, Arial, sans-serif'
const PLACEHOLDER_NOTA = 'Agrega una nota para el cliente…'

export default function HojaCliente({
  item,
  numero,
  bloqueTitulo,
  general,
  adicionales,
  confirmada,
  preciosAMano,
  precioLinea,
  precioOpcion,
  editable,
  onGuardarNota,
}: {
  /** La opción, con su descripción: la nota sale de ahí (`notaDeLaLinea`). */
  item: ItemConLectura
  numero: number
  /** «Hotel en Providencia»: el renglón magenta sobre la tarjeta. */
  bloqueTitulo: string
  /** El nivel de detalle «general» no nombra habitación ni régimen (igual que el PDF). */
  general: boolean
  adicionales: FilaAdicional[]
  confirmada: TarifaConfirmada | null
  preciosAMano: PreciosAMano | undefined
  precioLinea: number
  precioOpcion: number
  editable: boolean
  onGuardarNota: (texto: string) => void
}) {
  const [h] = hotelesDeItems([{ ...item, adicionales: adicionales.map(f => adicionalEnLaFicha(aAdicional(f))) }])
  const [editando, setEditando] = useState(false)
  if (!h) return null
  const t = textosDeTarjetaHotel(h, general)
  const porPasajero = filasDeCosto({ confirmada, precioLinea, preciosAMano })
    .map(f => `${f.nombre}${f.det ? ` (${f.det})` : ''} ${pesos(f.precioUnitario)}`)
    .join('  ·  ')

  return (
    <section aria-label="Así lo ve el cliente" className="flex flex-col gap-2.5" data-hoja-cliente>
      <p className="m-0 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.08em] text-[#6E6A62]">
        Así lo ve el cliente<span className="h-px flex-1 bg-[#E2DED5]" />
      </p>
      <div className="rounded-[10px] bg-[#EEEBE4] p-[18px] max-sm:p-2.5">
        <div
          className="mx-auto flex max-w-[600px] flex-col gap-3 rounded-[2px] bg-white px-7 pb-[22px] pt-[26px] shadow-[0_1px_1px_rgba(22,26,51,.06),0_8px_24px_rgba(22,26,51,.14)] max-sm:px-4 max-sm:pb-4 max-sm:pt-[18px]"
          style={{ fontFamily: HELVETICA, color: TOKENS.texto, colorScheme: 'light' }}
          data-hoja
        >
          <span className="flex items-center gap-1.5 text-[10px] font-bold tracking-[.14em]" style={{ color: TOKENS.magenta }}>
            <i className="h-1.5 w-1.5 rounded-full" style={{ background: TOKENS.magenta }} />
            {bloqueTitulo.toUpperCase()}
          </span>
          <div className="flex flex-col gap-1 rounded-lg px-3.5 py-3" style={{ background: TOKENS.tarjeta }}>
            <span className="self-start rounded-full px-[7px] py-0.5 text-[8.5px] font-bold tracking-[.08em] text-white" style={{ background: TOKENS.magenta }}>
              OPCIÓN {numero}
            </span>
            <h5 className="m-0 mt-0.5 flex flex-wrap items-center gap-1.5 text-base font-bold" style={{ color: TOKENS.tinta }}>
              {t.nombre}
              {t.estrellas ? <span className="text-[11px] tracking-[1px] text-[#F5B400]">{'★'.repeat(t.estrellas)}</span> : null}
            </h5>
            {t.resumen !== '' && <span className="text-[12.5px]" style={{ color: TOKENS.texto }}>{t.resumen}</span>}
            {t.condiciones !== '' && <span className="text-[11.5px]" style={{ color: TOKENS.gris }}>{t.condiciones}</span>}
            {t.adicionales && <span className="text-[11.5px]" style={{ color: TOKENS.gris }}>{t.adicionales}</span>}
            <div className="mt-1" data-nota-cliente>
              {editando && editable ? (
                <textarea
                  autoFocus
                  defaultValue={t.nota ?? ''}
                  maxLength={500}
                  placeholder={PLACEHOLDER_NOTA}
                  aria-label="Nota para el cliente"
                  className="min-h-14 w-full resize-y rounded-md border-[1.5px] bg-[#FFFDF6] px-[9px] py-[7px] text-[11.5px] text-[#3A3F55] outline-none"
                  style={{ fontFamily: HELVETICA, borderColor: TOKENS.magenta }}
                  onFocus={e => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
                  onBlur={e => {
                    setEditando(false)
                    const val = e.target.value.trim()
                    if (val !== (t.nota ?? '')) onGuardarNota(val)
                  }}
                />
              ) : t.nota ? (
                <button
                  type="button"
                  disabled={!editable}
                  onClick={() => setEditando(true)}
                  aria-label="Editar la nota para el cliente"
                  className="w-full cursor-text rounded border-0 bg-transparent p-0 text-left hover:bg-[#FFF7FB] disabled:cursor-default disabled:hover:bg-transparent"
                >
                  <p className="m-0 mt-0.5 whitespace-pre-wrap text-[11.5px]" style={{ color: TOKENS.texto }}>{t.nota}</p>
                </button>
              ) : editable ? (
                <button
                  type="button"
                  onClick={() => setEditando(true)}
                  className="w-full rounded-md border-[1.5px] border-dashed border-[#C9C6D6] bg-transparent px-[9px] py-[7px] text-left text-[11.5px] text-[#8A8FA3] hover:border-[#E63380] hover:text-[#E63380]"
                  style={{ fontFamily: HELVETICA }}
                >
                  {PLACEHOLDER_NOTA}
                </button>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-end justify-between gap-3 border-t pt-2.5" style={{ borderColor: TOKENS.linea }}>
            <div>
              <small className="block text-[9.5px] font-bold tracking-[.12em]" style={{ color: TOKENS.gris }}>INVERSIÓN</small>
              {porPasajero !== '' && <div className="mt-0.5 whitespace-pre-wrap text-[11px] tabular-nums" style={{ color: TOKENS.purpura }}>{porPasajero}</div>}
            </div>
            <div className="text-right text-lg font-bold tabular-nums" style={{ color: TOKENS.tinta }}>{pesos(precioOpcion)}</div>
          </div>
        </div>
        <p className="m-0 mt-2.5 text-center text-xs text-[#6E6A62]">Así sale esta opción en la cotización que recibe el cliente.</p>
      </div>
    </section>
  )
}
