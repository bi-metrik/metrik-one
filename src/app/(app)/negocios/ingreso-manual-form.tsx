'use client'

import { useId, useState, type ReactNode } from 'react'

import { nochesEntre, type ErroresManual } from '@/lib/cotizaciones/ingreso-manual'
import type { Composicion } from '@/lib/cotizaciones/tarifa-pasajero'
import { BTN, BTN_PRIM, INPUT, INPUT_DUDOSO, SPIN } from '@/components/viaje/estilo'

/** El spinner dentro de un botón: el botón ya separa con `gap-1.5`, sin el margen propio. */
const SPIN_BOTON = SPIN.replace('mr-1.5 ', '')

/**
 * El formulario de ingreso manual de la bandeja (brief del 2026-09-28): un hotel por habitación,
 * o un traslado, con lo que da el portafolio del proveedor o la tarifa por teléfono.
 *
 * No escribe nada: lo que devuelve el servidor es una lectura firmada, igual a la de un
 * pantallazo, y entra a la bandeja como una fila más que se revisa y se acepta
 * (`ingreso-manual.ts`).
 *
 * ⚠️ El costo es NETO: «lo que te cobra el proveedor». El margen lo pone ONE. Si la persona
 * infla el neto (el traslado de 45.000 escrito como 60.000), el margen queda escondido.
 */

export type TipoManual = 'hotel' | 'traslado'

export type RespuestaManual = { ok: true } | { ok: false; mensaje: string; errores?: ErroresManual }

export const AYUDA_NETO = 'Lo que te cobra el proveedor, sin sumarle nada. El margen lo pone ONE.'

/** Lo interno: la fuente no sale en la cotización. */
export const AYUDA_FUENTE = 'Solo la ve tu equipo.'

/** Lo que lee el cliente si la edad se llena (`textoTarifaNino`). */
export const AYUDA_EDAD_NINO = 'Si la llenas, la cotización dice: Tarifa niño de 2 a 11 años cumplidos a la fecha del viaje.'

type Valores = Record<string, string>

function inicial(tipo: TipoManual, grupo: Composicion | null): Valores {
  const pax = {
    adultos: String(grupo?.adultos ?? 2),
    ninos: String(grupo?.ninos ?? 0),
    infantes: String(grupo?.infantes ?? 0),
  }
  return tipo === 'hotel'
    ? { hotel: '', ciudad: '', entrada: '', salida: '', habitacion: '', regimen: '', incluye: '', ...pax, netoAdulto: '', netoNino: '', netoInfante: '', edadDesde: '', edadHasta: '', fuente: '' }
    : { ruta: '', fecha: '', ...pax, cobro: 'por_persona', neto: '', idaYRegreso: 'si', fuente: '' }
}

export default function IngresoManualForm({
  composicion,
  onEnviar,
  onCerrar,
}: {
  /** El grupo del viaje: los pasajeros arrancan con él. */
  composicion: Composicion | null
  /** Pide la lectura firmada y la pone en la bandeja. */
  onEnviar: (tipo: TipoManual, datos: Record<string, unknown>) => Promise<RespuestaManual>
  onCerrar: () => void
}) {
  const id = useId()
  const [tipo, setTipo] = useState<TipoManual>('hotel')
  const [v, setV] = useState<Valores>(() => inicial('hotel', composicion))
  const [errores, setErrores] = useState<ErroresManual>({})
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  function cambiarTipo(t: TipoManual) {
    if (t === tipo) return
    setTipo(t)
    setV(inicial(t, composicion))
    setErrores({})
    setMensaje(null)
  }

  const poner = (k: string) => (e: { target: { value: string } }) => setV(prev => ({ ...prev, [k]: e.target.value }))

  /**
   * `numerico`: un monto o una cantidad. Como en `FormHabitacion`: texto con teclado numérico
   * (no `type="number"`, que pone flechas y deja que la rueda del mouse cambie el valor).
   */
  function campo(k: string, label: string, extra: { tipo?: string; placeholder?: string; ayuda?: string; ancho?: string; numerico?: boolean } = {}): ReactNode {
    const error = errores[k]
    const clase = error ? INPUT_DUDOSO : INPUT
    return (
      <label key={k} className={`flex flex-col gap-0.5 text-xs ${error ? 'text-[#9A5F0C]' : 'text-[#6E6A62]'} ${extra.ancho ?? ''}`}>
        <span>{label}</span>
        <input
          type={extra.numerico ? 'text' : (extra.tipo ?? 'text')}
          inputMode={extra.numerico ? 'numeric' : undefined}
          value={v[k] ?? ''}
          placeholder={extra.placeholder}
          onChange={poner(k)}
          className={extra.numerico ? `${clase} tabular-nums` : clase}
          data-campo-manual={k}
        />
        {extra.ayuda && !error && <span className="text-[11px] text-[#6E6A62]">{extra.ayuda}</span>}
        {error && <span className="text-xs text-[#B3382C]">{error}</span>}
      </label>
    )
  }

  function opcion(k: string, valor: string, label: string) {
    return (
      <label key={`${k}-${valor}`} className="inline-flex items-center gap-1.5 text-[13px] text-[#191713]">
        <input type="radio" className="accent-[#0E5C43]" name={`${id}-${k}`} checked={v[k] === valor} onChange={() => setV(prev => ({ ...prev, [k]: valor }))} />
        {label}
      </label>
    )
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    if (enviando) return
    setEnviando(true)
    setMensaje(null)
    const datos: Record<string, unknown> = tipo === 'hotel' ? { ...v } : { ...v, idaYRegreso: v.idaYRegreso === 'si' }
    const r = await onEnviar(tipo, datos)
    setEnviando(false)
    if (r.ok) {
      onCerrar()
      return
    }
    setErrores(r.errores ?? {})
    setMensaje(r.mensaje)
  }

  const noches = tipo === 'hotel' ? nochesEntre(v.entrada ?? '', v.salida ?? '') : 0
  const titulo = (t: string) => <span className="col-span-full mt-1 text-[11px] font-bold uppercase tracking-[.08em] text-[#6E6A62]">{t}</span>

  return (
    <form onSubmit={enviar} className="flex flex-col gap-2.5 rounded-lg border border-[#CFCAC0] bg-[#F8F7F3] p-3" aria-label="Ingresar a mano" data-ingreso-manual>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">Ingresar a mano</span>
        <div className="flex gap-1" role="group" aria-label="Qué vas a ingresar">
          {(['hotel', 'traslado'] as const).map(t => (
            <button key={t} type="button" onClick={() => cambiarTipo(t)} aria-pressed={tipo === t} className={tipo === t ? `${BTN} border-[#0E5C43] bg-[#EAF1EE] text-[#0E5C43]` : BTN}>
              {t === 'hotel' ? 'Hotel' : 'Traslado'}
            </button>
          ))}
        </div>
      </div>
      <p className="m-0 text-xs text-[#6E6A62]">
        {tipo === 'hotel'
          ? 'Una habitación a la vez. ONE multiplica por noches y pasajeros.'
          : 'Un traslado a la vez. ONE hace la cuenta con pasajeros y trayectos.'}
      </p>

      {tipo === 'hotel' ? (
        <div className="grid grid-cols-3 gap-x-3 gap-y-2 max-sm:grid-cols-2">
          {campo('hotel', 'Hotel')}
          {campo('ciudad', 'Ciudad')}
          {campo('entrada', 'Check-in', { tipo: 'date' })}
          {campo('salida', 'Check-out', { tipo: 'date', ayuda: noches > 0 ? `${noches} ${noches === 1 ? 'noche' : 'noches'}` : undefined })}
          {campo('habitacion', 'Habitación', { placeholder: 'Doble estándar' })}
          {campo('regimen', 'Régimen', { placeholder: 'Todo incluido, desayuno y cena…' })}
          {campo('incluye', 'Qué más incluye', { ancho: 'col-span-2 max-sm:col-span-2', placeholder: 'Wifi, coctel de bienvenida', ayuda: 'Sale en la cotización del cliente.' })}
          {titulo('Pasajeros de la habitación')}
          {campo('adultos', 'Adultos', { numerico: true })}
          {campo('ninos', 'Niños', { numerico: true })}
          {campo('infantes', 'Infantes', { numerico: true })}
          {titulo('Costo neto por persona por noche')}
          <p className="col-span-full m-0 text-xs text-[#6E6A62]">{AYUDA_NETO}</p>
          {campo('netoAdulto', 'Adulto', { numerico: true })}
          {campo('netoNino', 'Niño', { numerico: true })}
          {campo('netoInfante', 'Infante', { numerico: true, placeholder: '0' })}
          {titulo('Edad de niño según el hotel (opcional)')}
          <p className="col-span-full m-0 text-xs text-[#6E6A62]">{AYUDA_EDAD_NINO}</p>
          {campo('edadDesde', 'Desde (años)', { numerico: true })}
          {campo('edadHasta', 'Hasta (años)', { numerico: true })}
          {campo('fuente', 'Fuente de la tarifa', { ancho: 'col-span-2 max-sm:col-span-2', placeholder: 'Portafolio Verdemar 2026', ayuda: AYUDA_FUENTE })}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-x-3 gap-y-2 max-sm:grid-cols-2">
          {campo('ruta', 'Trayecto', { placeholder: 'Aeropuerto – hotel' })}
          {campo('fecha', 'Fecha', { tipo: 'date' })}
          {titulo('Pasajeros')}
          {campo('adultos', 'Adultos', { numerico: true })}
          {campo('ninos', 'Niños', { numerico: true })}
          {campo('infantes', 'Infantes', { numerico: true })}
          {titulo('Costo neto por trayecto')}
          <p className="col-span-full m-0 text-xs text-[#6E6A62]">{AYUDA_NETO}</p>
          <div className="col-span-full flex flex-wrap gap-x-4 gap-y-1" role="radiogroup" aria-label="Cómo cobra">
            {opcion('cobro', 'por_persona', 'Por persona')}
            {opcion('cobro', 'por_vehiculo', 'Por vehículo')}
          </div>
          {campo('neto', v.cobro === 'por_vehiculo' ? 'Costo por vehículo' : 'Costo por persona', { numerico: true })}
          <div className="col-span-2 flex flex-wrap items-end gap-x-4 gap-y-1 pb-1.5" role="radiogroup" aria-label="Trayectos">
            {opcion('idaYRegreso', 'no', 'Solo ida')}
            {opcion('idaYRegreso', 'si', 'Ida y regreso')}
          </div>
          {campo('fuente', 'Fuente de la tarifa', { ancho: 'col-span-2 max-sm:col-span-2', placeholder: 'Portafolio Dolphins 2026', ayuda: AYUDA_FUENTE })}
        </div>
      )}

      {mensaje && <p className="m-0 text-xs font-medium text-[#B3382C]" role="alert">{mensaje}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={BTN_PRIM} disabled={enviando}>
          {enviando && <span className={SPIN_BOTON} aria-hidden />}
          Llevar a la bandeja
        </button>
        <button type="button" className={BTN} onClick={onCerrar} disabled={enviando}>Cancelar</button>
      </div>
    </form>
  )
}
