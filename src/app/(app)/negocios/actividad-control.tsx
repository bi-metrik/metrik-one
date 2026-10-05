'use client'

import { useState } from 'react'
import { toast } from 'sonner'

import { actualizarDiaDeItem, marcarActividadEnCotizacion } from '@/app/(app)/negocios/itinerario-actions'
import { BTN, BTN_ELEGIDO, INPUT, INPUT_DUDOSO } from '@/components/viaje/estilo'
import {
  avisoDiaFueraDelViaje,
  cambiosDeActividad,
  estadoDeActividad,
  opcionesDeDia,
  TEXTO_ACTIVIDAD_NO_VA,
  type EstadoActividad,
  type FechasDelViaje,
  type PedidoActividad,
} from '@/lib/cotizaciones/actividad-en-cotizacion'
import { useTransitionTolerante } from '@/hooks/use-transition-tolerante'

/**
 * Lo que la tarjeta de una actividad dice y deja hacer sobre qué va y qué no (brief del
 * 2026-10-05, punto 0, aprobado por Mauricio con Noor y Hana):
 *
 *  · el check «Va en la cotización», a la izquierda del nombre, con la tarjeta cerrada y abierta;
 *  · debajo, si va: «Incluida en el precio» u «Opcional, el cliente decide», con un clic;
 *  · si es Incluida, «Día del viaje» entre los días del viaje, cada uno con su fecha.
 *
 * Nada se mueve ni se cierra al tocarlos: la tarjeta se queda en su sitio y en gris si no va.
 * Lo que se tocó se pinta en el acto y se guarda detrás; si el servidor dice que no, vuelve.
 */

export interface ActividadDeTarjeta {
  /** Lo que dice la base. */
  estado: EstadoActividad
  dia: number | null
  /** «Adulto $176.471 · Infante $0»: lo que se muestra de una opcional. */
  precioPorPersona: string | null
  /** Cómo era antes de quitarle el check (`tarifa_pax.noVa`), para pintar la vuelta en el acto. */
  era: 'incluida' | 'opcional' | null
}

/** El estado que se pinta: lo pedido mientras el servidor no lo confirme, y si no, el guardado. */
export function useActividad(itemId: string, base: ActividadDeTarjeta, onCambio: () => void) {
  const [pedido, setPedido] = useState<{ estado: EstadoActividad; dia: number | null; antes: string } | null>(null)
  const [ocupado, startTransition] = useTransitionTolerante()
  const firmaBase = `${base.estado}|${base.dia ?? ''}`
  // Lo pedido vale mientras la página siga trayendo lo de antes del pedido.
  const vigente = pedido && pedido.antes === firmaBase ? pedido : null
  const estado = vigente?.estado ?? base.estado
  const dia = vigente ? vigente.dia : base.dia

  function marcar(p: PedidoActividad) {
    const cambios = cambiosDeActividad({ estado, dia, era: base.era }, p)
    if (!cambios) return
    // Al quitar el check, el día se queda; al volver, lo decide el servidor (con lo que guardó).
    const siguiente = estadoDeActividad(cambios)
    setPedido({ estado: siguiente, dia: cambios.dia_relativo === null ? null : dia, antes: firmaBase })
    startTransition(async () => {
      const r = await marcarActividadEnCotizacion(itemId, p)
      if (!r.success) { setPedido(null); toast.error(r.error ?? 'No se pudo guardar.'); return }
      onCambio()
    })
  }

  function ponerDia(nuevo: number | null) {
    if (nuevo === dia) return
    setPedido({ estado, dia: nuevo, antes: firmaBase })
    startTransition(async () => {
      const r = await actualizarDiaDeItem(itemId, { dia_relativo: nuevo })
      if (!r.success) { setPedido(null); toast.error(r.error ?? 'No se pudo guardar el día.'); return }
      onCambio()
    })
  }

  return { estado, dia, ocupado, marcar, ponerDia }
}

/** El check «Va en la cotización». Área de toque de 44 px: se toca bien en el celular. */
export function CheckVa({ va, editable, ocupado, onCambio }: { va: boolean; editable: boolean; ocupado: boolean; onCambio: (va: boolean) => void }) {
  return (
    <label
      className="-my-2 -ml-1.5 flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center"
      title={va ? 'Va en la cotización' : 'No va en la cotización'}
      data-check-va
    >
      <input
        type="checkbox"
        checked={va}
        disabled={!editable || ocupado}
        aria-label="Va en la cotización"
        onChange={e => onCambio(e.target.checked)}
        className="h-5 w-5 cursor-pointer accent-[#0E5C43] disabled:cursor-default"
      />
    </label>
  )
}

/** Debajo del nombre: Incluida u Opcional, el día, o «No va». */
export function ModoYDia({
  estado,
  dia,
  precioPorPersona,
  fechasViaje,
  editable,
  ocupado,
  onModo,
  onDia,
}: {
  estado: EstadoActividad
  dia: number | null
  precioPorPersona: string | null
  fechasViaje: FechasDelViaje | null
  editable: boolean
  ocupado: boolean
  onModo: (modo: 'incluida' | 'opcional') => void
  onDia: (dia: number | null) => void
}) {
  if (estado === 'no_va') {
    return <p className="m-0 text-xs font-semibold text-[#6E6A62]" data-actividad-no-va>{TEXTO_ACTIVIDAD_NO_VA}</p>
  }
  const opciones = opcionesDeDia(fechasViaje)
  const fuera = avisoDiaFueraDelViaje(dia, fechasViaje)
  const sinDia = estado === 'incluida' && dia === null
  const boton = (modo: 'incluida' | 'opcional', texto: string) => (
    <button
      type="button"
      aria-pressed={estado === modo}
      disabled={!editable || ocupado}
      onClick={() => onModo(modo)}
      className={`${estado === modo ? BTN_ELEGIDO : BTN} !px-2 !py-1 !text-xs`}
    >
      {texto}
    </button>
  )
  return (
    <div className="flex flex-col gap-1.5" data-actividad-modo={estado}>
      <span className="flex flex-wrap items-center gap-1.5" role="group" aria-label="¿Cómo va en la cotización?">
        {boton('incluida', 'Incluida en el precio')}
        {boton('opcional', 'Opcional, el cliente decide')}
      </span>
      {estado === 'opcional' && (
        <span className="text-xs text-[#6E6A62]" data-actividad-opcional>
          No suma al total{precioPorPersona ? ` · ${precioPorPersona} por persona` : ''}. Sale en «Opcionales» del PDF.
        </span>
      )}
      {estado === 'incluida' && (
        <label className="flex flex-wrap items-center gap-2 text-xs text-[#6E6A62]">
          <span className={sinDia ? 'font-semibold text-[#9A5F0C]' : ''}>Día del viaje</span>
          {opciones.length > 0 ? (
            <select
              value={dia ?? ''}
              disabled={!editable || ocupado}
              aria-label="Día del viaje"
              onChange={e => onDia(e.target.value === '' ? null : Number(e.target.value))}
              className={`${sinDia || fuera ? INPUT_DUDOSO : INPUT} !w-auto`}
              data-dia-del-viaje
            >
              <option value="">Sin día</option>
              {opciones.map(o => <option key={o.dia} value={o.dia}>{o.etiqueta}</option>)}
              {/* Un día que quedó fuera porque cambiaron las fechas se sigue viendo hasta corregirlo. */}
              {dia !== null && !opciones.some(o => o.dia === dia) && <option value={dia}>Día {dia}</option>}
            </select>
          ) : (
            <input
              type="number"
              min={1}
              step={1}
              defaultValue={dia ?? ''}
              key={dia ?? 'sin'}
              placeholder="Sin día"
              disabled={!editable || ocupado}
              aria-label="Día del viaje"
              onBlur={e => {
                const txt = e.target.value.trim()
                onDia(txt === '' ? null : Number(txt))
              }}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
              className={`${sinDia ? INPUT_DUDOSO : INPUT} !w-24`}
              data-dia-del-viaje
            />
          )}
          {sinDia && <span className="font-semibold text-[#9A5F0C]">Elige el día: ordena el itinerario.</span>}
        </label>
      )}
      {fuera && <span className="text-xs font-semibold text-[#9A5F0C]" data-aviso-dia>{fuera}</span>}
    </div>
  )
}
