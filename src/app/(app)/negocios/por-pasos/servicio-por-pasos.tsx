'use client'

import type { ReactNode } from 'react'
import { BedDouble, Car, Package, Plane, Ticket } from 'lucide-react'

import { ItemMenu, MenuAcciones, SeparadorMenu } from '@/components/viaje/menu-acciones'
import { pesos } from '@/lib/cotizaciones/tarjeta-opcion'
import { ETIQUETA_ESTADO, type EstadoServicio } from '@/lib/cotizaciones/estado-servicio'
import type { ServicioDelViaje } from '@/lib/cotizaciones/por-pasos-vista'

/**
 * La tarjeta de un SERVICIO en «Armar el viaje» (diseño, Paso 1, «Trabajar dentro de un
 * servicio» y sección 10): toda la cabecera abre y cierra (chevron que gira); el tipo arriba del
 * nombre; a la derecha el precio en la Recomendada, grande y siempre en el mismo sitio, con el
 * estado discreto debajo (Incluido · Opcional · No va); el «⋯» del servicio. Abierta, sus
 * opciones (la tarjeta de siempre de cada opción) y «+ Otra opción» al pie.
 */

const ICONO: Record<ServicioDelViaje['tipo'], typeof Plane> = { vuelo: Plane, hotel: BedDouble, traslado: Car, actividad: Ticket, otro: Package }
const NOMBRE_TIPO: Record<ServicioDelViaje['tipo'], string> = { vuelo: 'Vuelo', hotel: 'Hotel', traslado: 'Traslado', actividad: 'Actividad', otro: 'Otro' }

export function ServicioPorPasos({
  servicio,
  precio,
  sinCosto,
  resumen,
  abierto,
  editable,
  ocupado,
  estados,
  juntables,
  aviso,
  onAlternar,
  onEstado,
  onJuntar,
  onBorrar,
  onOtraOpcion,
  children,
}: {
  servicio: ServicioDelViaje
  precio: number
  sinCosto: boolean
  resumen: string
  abierto: boolean
  editable: boolean
  ocupado: boolean
  estados: EstadoServicio[]
  /** Otros servicios del mismo tipo: «Juntar como opción de…». */
  juntables: { grupo: string; nombre: string }[]
  /** El aviso rojo o ámbar del servicio (falta el costo, falta un precio…), si lo hay. */
  aviso: string | null
  onAlternar: () => void
  onEstado: (e: EstadoServicio) => void
  onJuntar: (grupoDestino: string) => void
  onBorrar: () => void
  onOtraOpcion: () => void
  children: ReactNode
}) {
  const Icono = ICONO[servicio.tipo]
  const fuera = servicio.estado !== 'incluido'
  return (
    <section
      id={`svc-${servicio.grupo}`}
      data-servicio={servicio.grupo}
      data-estado-servicio={servicio.estado}
      className={`scroll-mt-40 rounded-xl border bg-white ${abierto ? 'border-[#0E5C43]' : 'border-[#E2DED5]'} ${fuera ? 'opacity-[.72]' : ''}`}
      style={{ borderLeftWidth: 4, borderLeftColor: `var(--tipo-${servicio.tipo})` }}
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={abierto}
        onClick={onAlternar}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAlternar() } }}
        className="flex cursor-pointer flex-wrap items-start gap-2 px-3 py-2.5"
      >
        <span className="min-w-[180px] flex-1">
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-white"
            style={{ backgroundColor: `var(--tipo-${servicio.tipo})` }}
          >
            <Icono className="h-3 w-3" aria-hidden />{NOMBRE_TIPO[servicio.tipo]}
          </span>
          <b className={`mt-0.5 block text-[15px] ${servicio.estado === 'no' ? 'line-through' : ''}`}>{servicio.nombre}</b>
          {!abierto && <small className="block text-xs text-[#6E6A62]">{resumen}</small>}
        </span>
        <span className="flex flex-col items-end max-sm:order-last max-sm:w-full" onClick={e => e.stopPropagation()}>
          <span className={`text-[19px] font-bold tabular-nums ${servicio.estado === 'no' ? 'text-[#6E6A62] line-through' : ''}`} data-precio-servicio>
            {sinCosto ? <span className="text-sm text-[#B3382C]">sin costo</span> : pesos(precio)}
          </span>
          {estados.length > 0 && (
            <select
              aria-label={`¿Va en la cotización? ${servicio.nombre}`}
              value={servicio.estado}
              disabled={!editable || ocupado}
              onChange={e => onEstado(e.target.value as EstadoServicio)}
              data-estado-select
              className={`mt-0.5 cursor-pointer rounded border-0 bg-transparent py-0 pl-1 pr-5 text-right text-xs font-semibold ${
                servicio.estado === 'no'
                  ? 'bg-[#FBEDEB] text-[#B3382C]'
                  : servicio.estado === 'opcional' ? 'bg-[#FBF1E2] text-[#9A5F0C]' : 'text-[#6E6A62]'
              }`}
            >
              {estados.map(v => <option key={v} value={v}>{ETIQUETA_ESTADO[v]}</option>)}
            </select>
          )}
        </span>
        {editable && (
          <span onClick={e => e.stopPropagation()}>
            <MenuAcciones
              etiqueta={`Más acciones del servicio ${servicio.nombre}`}
              contenido={cerrar => (
                <>
                  <ItemMenu onClick={() => { cerrar(); onOtraOpcion() }}>+ Agregar otra opción</ItemMenu>
                  {juntables.length > 0 && (
                    <>
                      <span className="px-2.5 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#6E6A62]">Juntar como opción de</span>
                      {juntables.map(j => (
                        <ItemMenu key={j.grupo} onClick={() => { cerrar(); onJuntar(j.grupo) }}>{j.nombre}</ItemMenu>
                      ))}
                    </>
                  )}
                  <SeparadorMenu />
                  <ItemMenu peligro onClick={() => { cerrar(); onBorrar() }}>Borrar el servicio</ItemMenu>
                </>
              )}
            />
          </span>
        )}
        <span aria-hidden className={`self-center text-lg text-[#6E6A62] transition-transform ${abierto ? 'rotate-90' : ''}`}>›</span>
      </div>
      {servicio.estado === 'no' && (
        <p className="m-0 mx-3 mb-2 rounded-lg bg-[#FBEDEB] px-2.5 py-1.5 text-[12.5px] text-[#B3382C]">
          No va: sale del precio y del PDF. Queda aquí por si lo vuelves a poner.{servicio.tipo === 'vuelo' ? ' Se quita el vuelo entero, con ida y regreso.' : ''}
        </p>
      )}
      {servicio.estado === 'opcional' && (
        <p className="m-0 mx-3 mb-2 rounded-lg bg-[#FBF1E2] px-2.5 py-1.5 text-[12.5px] text-[#9A5F0C]">
          Opcional: no suma al total. El cliente lo ve aparte, con su precio, en «Opcionales».
        </p>
      )}
      {aviso && servicio.estado === 'incluido' && (
        <p className="m-0 mx-3 mb-2 rounded-lg bg-[#FBEDEB] px-2.5 py-1.5 text-[12.5px] font-semibold text-[#B3382C]" data-aviso-servicio>{aviso}</p>
      )}
      {abierto && (
        <div className="flex flex-col gap-2 border-t border-[#E2DED5] px-3 pb-3 pt-2.5">
          {servicio.opciones.length > 1 && servicio.estado !== 'no' && (
            <p className="m-0 text-[12.5px] text-[#6E6A62]">{servicio.opciones.length} opciones. En cada tarifa va una sola: lo escoges en Tarifas.</p>
          )}
          {children}
          {editable && (
            <div>
              <button type="button" onClick={onOtraOpcion} disabled={ocupado} className="rounded-lg border border-[#CFCAC0] bg-white px-3 py-1.5 text-xs font-semibold hover:bg-[#EEEBE4] disabled:opacity-50">
                + Otra opción
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
