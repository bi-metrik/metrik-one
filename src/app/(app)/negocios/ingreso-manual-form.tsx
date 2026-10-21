'use client'

import { useId, useState, type ReactNode } from 'react'

import { ATAJOS_OTRO_SERVICIO, avisoFechasFueraDelViaje, MONEDAS_MANUALES, montoConMiles, nochesEntre, type ErroresManual } from '@/lib/cotizaciones/ingreso-manual'
import { esAsistenciaMedica } from '@/lib/cotizaciones/asistencia-medica'
import type { Composicion } from '@/lib/cotizaciones/tarifa-pasajero'
import { BTN, BTN_ELEGIDO, BTN_PRIM, INPUT, INPUT_DUDOSO, SPIN } from '@/components/viaje/estilo'

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

/** «✎ Escríbelo a mano» de la cotización por pasos (C5): suma vuelo, actividad y «Otro servicio». */
export type TipoEscritoAMano = TipoManual | 'vuelo' | 'actividad' | 'otro'

/** El orden de los tipos en «✎ Escríbelo a mano» (Noor, Paso 1). */
export const TIPOS_A_MANO: readonly TipoEscritoAMano[] = ['vuelo', 'hotel', 'traslado', 'actividad', 'otro']
const ETIQUETA_TIPO: Record<TipoEscritoAMano, string> = { vuelo: 'Vuelo', hotel: 'Hotel', traslado: 'Traslado', actividad: 'Actividad', otro: 'Otro servicio' }

/** Lo que dice el formulario cuando el otro servicio es una asistencia médica (Noor, copys). */
export const NOTA_ASISTENCIA_MEDICA = 'Asistencia médica: además, el negocio la mostrará en «Documentos del viajero»'

/** Copys de Noor (sección 3, «Escribirlo a mano»). */
export const TITULO_A_MANO = '✎ Escríbelo a mano'
export const AYUDA_A_MANO = 'Sin pantallazo: para portafolios, tarifas por teléfono o lo que no se puede capturar.'
export const AYUDA_OBLIGATORIOS = 'Solo lo marcado con * es obligatorio. Lo demás se completa después con «✎ Corregir datos».'
export const FALTA_OBLIGATORIO = 'Falta lo marcado con *.'
export const ES_OPCIONAL = 'Es opcional: el cliente decide (no suma)'

export type RespuestaManual = { ok: true } | { ok: false; mensaje: string; errores?: ErroresManual }

export const AYUDA_NETO = 'Lo que te cobra el proveedor, sin sumarle nada. El margen lo pone ONE.'

/**
 * Empezar SIN COSTO cuando el precio va a salir del tarifario del proveedor (brief del 2026-10-20,
 * punto 1): antes «Adulto *» obligaba a escribir un número de relleno.
 */
export const SIN_COSTO_DEL_TARIFARIO = 'Todavía no tengo el costo: lo saco del tarifario del proveedor'
export const AYUDA_SIN_COSTO = 'La opción entra con el costo pendiente y se abre «Tarifas del proveedor» en ella. No se puede enviar hasta tener el costo.'

/**
 * Cómo viene el precio del traslado (brief del 2026-09-30). Sin opción marcada a propósito:
 * con «Ida y regreso» por defecto, un portafolio in-out de 45.000 quedaba en 90.000.
 */
export const PREGUNTA_PRECIO_TRASLADO = '¿Cómo viene el precio?'
export const OPCION_POR_TRAYECTO = 'Por trayecto'
export const OPCION_IN_OUT = 'Ida y regreso (in-out)'
export const AYUDA_IN_OUT = 'El precio ya incluye ida y regreso: ONE no lo multiplica.'

/** Lo interno: la fuente no sale en la cotización. */
export const AYUDA_FUENTE = 'Solo la ve tu equipo.'

/** Lo que lee el cliente si la edad se llena (`textoTarifaNino`). */
export const AYUDA_EDAD_NINO = 'Si la llenas, la cotización dice: Tarifa niño de 2 a 11 años cumplidos a la fecha del viaje.'

type Valores = Record<string, string>

/** Los montos del formulario: se ven con punto de miles mientras se escriben (`montoConMiles`). */
export const CAMPOS_MONTO: ReadonlySet<string> = new Set(['netoAdulto', 'netoNino', 'netoInfante', 'neto'])

/** Lo que queda en la casilla después de escribir: un monto, con su punto de miles. */
export function valorEscrito(campo: string, texto: string): string {
  return CAMPOS_MONTO.has(campo) ? montoConMiles(texto) : texto
}

function inicial(tipo: TipoEscritoAMano, grupo: Composicion | null): Valores {
  const pax = {
    adultos: String(grupo?.adultos ?? 2),
    ninos: String(grupo?.ninos ?? 0),
    infantes: String(grupo?.infantes ?? 0),
  }
  if (tipo === 'vuelo') {
    return {
      aerolinea: '', origen: '', destino: '', ida: '', horaSalida: '', horaLlegada: '', numero: '', tarifa: '',
      regreso: '', horaSalidaRegreso: '', horaLlegadaRegreso: '', numeroRegreso: '', ...pax,
      netoAdulto: '', netoNino: '', netoInfante: '', fuente: '',
    }
  }
  if (tipo === 'actividad') {
    return { nombre: '', ciudad: '', fecha: '', ...pax, netoAdulto: '', netoNino: '', netoInfante: '', opcional: '', fuente: '' }
  }
  if (tipo === 'otro') {
    return { nombre: '', proveedor: '', ...pax, cobro: 'por_persona', neto: '', fuente: '' }
  }
  return tipo === 'hotel'
    ? { hotel: '', ciudad: '', entrada: '', salida: '', habitacion: '', regimen: '', incluye: '', ...pax, netoAdulto: '', netoNino: '', netoInfante: '', edadDesde: '', edadHasta: '', fuente: '' }
    : { ruta: '', fecha: '', ...pax, cobro: 'por_persona', precio: '', neto: '', netoNino: '', netoInfante: '', idaYRegreso: 'si', moneda: 'COP', fuente: '' }
}

export default function IngresoManualForm({
  composicion,
  onEnviar,
  onCerrar,
  tipoInicial = 'hotel',
  fechasViaje = null,
  porPasos = false,
}: {
  /** El grupo del viaje: los pasajeros arrancan con él. */
  composicion: Composicion | null
  /** Las fechas del viaje: un hotel fuera de ellas se avisa ANTES de llevarlo a la bandeja. */
  fechasViaje?: { inicio: string | null; fin: string | null } | null
  /** Pide la lectura firmada y la pone en la bandeja. */
  onEnviar: (tipo: TipoManual, datos: Record<string, unknown>) => Promise<RespuestaManual>
  onCerrar: () => void
  /** Con qué arranca. La bandeja no lo pasa: empieza en hotel. */
  tipoInicial?: TipoEscritoAMano
  /**
   * «✎ Escríbelo a mano» de la cotización por pasos (C5): cinco tipos (vuelo, hotel, traslado,
   * actividad y «Otro servicio»), lo obligatorio marcado con * y la fuente opcional. Sin ella, el ingreso manual de
   * siempre, igual que hoy.
   */
  porPasos?: boolean
}) {
  const id = useId()
  const [tipo, setTipo] = useState<TipoEscritoAMano>(tipoInicial)
  const [v, setV] = useState<Valores>(() => inicial(tipoInicial, composicion))
  const [errores, setErrores] = useState<ErroresManual>({})
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  // Solo en la forma por pasos: el costo queda pendiente y sale del tarifario.
  const [sinCosto, setSinCosto] = useState(false)

  function cambiarTipo(t: TipoEscritoAMano) {
    if (t === tipo) return
    setTipo(t)
    setV(inicial(t, composicion))
    setErrores({})
    setMensaje(null)
  }

  const poner = (k: string) => (e: { target: { value: string } }) => setV(prev => ({ ...prev, [k]: valorEscrito(k, e.target.value) }))

  /**
   * `numerico`: un monto o una cantidad. Como en `FormHabitacion`: texto con teclado numérico
   * (no `type="number"`, que pone flechas y deja que la rueda del mouse cambie el valor).
   */
  function campo(k: string, label: string, extra: { tipo?: string; placeholder?: string; ayuda?: string; ancho?: string; numerico?: boolean; obligatorio?: boolean } = {}): ReactNode {
    const error = errores[k]
    const clase = error ? INPUT_DUDOSO : INPUT
    return (
      <label key={k} className={`flex flex-col gap-0.5 text-xs ${error ? 'text-[#9A5F0C]' : 'text-[#6E6A62]'} ${extra.ancho ?? ''}`}>
        <span>{porPasos && extra.obligatorio ? `${label} *` : label}</span>
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
    const base: Record<string, unknown> = tipo === 'hotel' || tipo === 'vuelo'
      ? { ...v }
      : tipo === 'actividad'
        ? { ...v, opcional: v.opcional === 'si' }
        : { ...v, idaYRegreso: v.idaYRegreso === 'si' }
    const datos: Record<string, unknown> = porPasos && sinCosto ? { ...base, sinCosto: true } : base
    const r = await (onEnviar as (t: TipoEscritoAMano, d: Record<string, unknown>) => Promise<RespuestaManual>)(tipo, datos)
    setEnviando(false)
    if (r.ok) {
      onCerrar()
      return
    }
    setErrores(r.errores ?? {})
    // «Falta lo marcado con *.»: en la forma por pasos, lo que falta se pinta en el campo.
    setMensaje(porPasos && r.errores && Object.keys(r.errores).some(k => k !== '_') ? FALTA_OBLIGATORIO : r.mensaje)
  }

  const noches = tipo === 'hotel' ? nochesEntre(v.entrada ?? '', v.salida ?? '') : 0
  // El mismo aviso que llevará la fila de la bandeja: avisa, no frena.
  const fueraDelViaje = tipo === 'hotel' ? avisoFechasFueraDelViaje(v.entrada ?? '', v.salida ?? '', fechasViaje) : null
  // «Otro servicio» por persona: los pasajeros salen del viaje (Noor, Paso 1).
  const viajeros = (Number(v.adultos) || 0) + (Number(v.ninos) || 0) + (Number(v.infantes) || 0)
  const titulo = (t: string) => <span className="col-span-full mt-1 text-[11px] font-bold uppercase tracking-[.08em] text-[#6E6A62]">{t}</span>
  // H20 · el traslado escrito a mano entra en la moneda del proveedor; la tasa se escribe después,
  // en la opción, igual que con un pantallazo en EUR o USD.
  const monedaDelTraslado = (
    <div className="col-span-full flex flex-wrap items-center gap-x-4 gap-y-1" role="radiogroup" aria-label="Moneda" data-campo-manual="moneda">
      <span className="text-xs text-[#6E6A62]">Moneda del proveedor</span>
      {MONEDAS_MANUALES.map(m => opcion('moneda', m, m))}
      {v.moneda && v.moneda !== 'COP' && (
        <span className="text-[11px] text-[#6E6A62]">Escribe el valor en {v.moneda}. La tasa de cambio se pone en la opción, como con un pantallazo.</span>
      )}
    </div>
  )

  // «Todavía no tengo el costo»: la casilla, y lo que esconde cuando está marcada.
  const casillaSinCosto = (
    <label className="col-span-full inline-flex items-start gap-1.5 text-[13px] text-[#191713]" data-sin-costo>
      <input type="checkbox" className="mt-0.5 accent-[#0E5C43]" checked={sinCosto} onChange={e => setSinCosto(e.target.checked)} data-campo-manual="sinCosto" />
      <span>
        {SIN_COSTO_DEL_TARIFARIO}
        {sinCosto && <span className="block text-[11px] text-[#6E6A62]">{AYUDA_SIN_COSTO}</span>}
      </span>
    </label>
  )
  const conCosto = (n: ReactNode) => (sinCosto ? null : n)

  if (porPasos) {
    return (
      <form onSubmit={enviar} className="flex flex-col gap-2.5 rounded-lg border border-[#CFCAC0] bg-[#F8F7F3] p-3" aria-label="Escríbelo a mano" data-escrito-a-mano>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{TITULO_A_MANO}</span>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Qué es">
            {TIPOS_A_MANO.map(t => (
              <button key={t} type="button" onClick={() => cambiarTipo(t)} aria-pressed={tipo === t} className={tipo === t ? BTN_ELEGIDO : BTN} data-tipo-a-mano={t}>
                {ETIQUETA_TIPO[t]}
              </button>
            ))}
          </div>
        </div>
        <p className="m-0 text-xs text-[#6E6A62]">{AYUDA_A_MANO} {AYUDA_OBLIGATORIOS}</p>
        {tipo === 'vuelo' ? (
          <div className="grid grid-cols-3 gap-x-3 gap-y-2 max-sm:grid-cols-2">
            {campo('aerolinea', 'Aerolínea', { placeholder: 'Avianca' })}
            {campo('origen', 'Origen', { obligatorio: true, placeholder: 'Bogotá BOG' })}
            {campo('destino', 'Destino', { obligatorio: true, placeholder: 'San Andrés ADZ' })}
            {titulo('Ida')}
            {campo('ida', 'Fecha', { tipo: 'date', obligatorio: true })}
            {campo('horaSalida', 'Sale', { placeholder: '06:50' })}
            {campo('horaLlegada', 'Llega', { placeholder: '09:00' })}
            {campo('numero', 'Nº de vuelo', { placeholder: 'AV 9782' })}
            {campo('tarifa', 'Tarifa', { placeholder: 'Classic' })}
            {titulo('Regreso (vacío = solo ida)')}
            {campo('regreso', 'Fecha', { tipo: 'date' })}
            {campo('horaSalidaRegreso', 'Sale', { placeholder: '18:45' })}
            {campo('horaLlegadaRegreso', 'Llega', { placeholder: '20:55' })}
            {campo('numeroRegreso', 'Nº de vuelo', { placeholder: 'AV 9779' })}
            {titulo('Pasajeros')}
            {campo('adultos', 'Adultos', { numerico: true })}
            {campo('ninos', 'Niños', { numerico: true })}
            {campo('infantes', 'Infantes', { numerico: true })}
            {titulo('Costo neto por pasajero (ida y regreso)')}
            {casillaSinCosto}
            {conCosto(<>
              <p className="col-span-full m-0 text-xs text-[#6E6A62]">{AYUDA_NETO}</p>
              {campo('netoAdulto', 'Adulto', { numerico: true, obligatorio: true })}
              {campo('netoNino', 'Niño', { numerico: true, placeholder: 'vacío = falta' })}
              {campo('netoInfante', 'Infante', { numerico: true, placeholder: 'vacío = falta', ayuda: '0 si no paga' })}
              {campo('fuente', 'Fuente de la tarifa', { ancho: 'col-span-2 max-sm:col-span-2', placeholder: 'Teléfono de la aerolínea', ayuda: AYUDA_FUENTE })}
            </>)}
          </div>
        ) : tipo === 'actividad' ? (
          <div className="grid grid-cols-3 gap-x-3 gap-y-2 max-sm:grid-cols-2">
            {campo('nombre', 'Actividad', { obligatorio: true, ancho: 'col-span-2 max-sm:col-span-2', placeholder: 'Cayo Cangrejo en lancha' })}
            {campo('ciudad', 'Dónde', { placeholder: 'Providencia' })}
            {campo('fecha', 'Fecha', { tipo: 'date' })}
            {titulo('Pasajeros')}
            {campo('adultos', 'Adultos', { numerico: true })}
            {campo('ninos', 'Niños', { numerico: true })}
            {campo('infantes', 'Infantes', { numerico: true })}
            {titulo('Costo neto por persona')}
            {casillaSinCosto}
            {conCosto(<>
              <p className="col-span-full m-0 text-xs text-[#6E6A62]">{AYUDA_NETO}</p>
              {campo('netoAdulto', 'Adulto', { numerico: true, obligatorio: true })}
              {campo('netoNino', 'Niño', { numerico: true, placeholder: 'vacío = falta' })}
              {campo('netoInfante', 'Infante', { numerico: true, placeholder: 'vacío = falta', ayuda: '0 si no paga' })}
            </>)}
            <label className="col-span-full inline-flex items-center gap-1.5 text-[13px] text-[#191713]">
              <input type="checkbox" className="accent-[#0E5C43]" checked={v.opcional === 'si'} onChange={e => setV(prev => ({ ...prev, opcional: e.target.checked ? 'si' : '' }))} data-campo-manual="opcional" />
              {ES_OPCIONAL}
            </label>
            {conCosto(campo('fuente', 'Fuente de la tarifa', { ancho: 'col-span-2 max-sm:col-span-2', placeholder: 'Operador local', ayuda: AYUDA_FUENTE }))}
          </div>
        ) : tipo === 'otro' ? (
          <div className="grid grid-cols-3 gap-x-3 gap-y-2 max-sm:grid-cols-2">
            <div className="col-span-full flex flex-wrap items-center gap-1" role="group" aria-label="Qué es">
              {ATAJOS_OTRO_SERVICIO.map(a => (
                <button key={a} type="button" onClick={() => setV(prev => ({ ...prev, nombre: a }))} aria-pressed={v.nombre === a} className={v.nombre === a ? BTN_ELEGIDO : BTN} data-atajo-otro={a}>
                  {a}
                </button>
              ))}
            </div>
            {campo('nombre', 'Nombre', { obligatorio: true, placeholder: 'Asistencia médica' })}
            {campo('proveedor', 'Proveedor o detalle', { ancho: 'col-span-2 max-sm:col-span-2', placeholder: 'Assist Card, plan Básico' })}
            <div className="col-span-full flex flex-wrap gap-x-4 gap-y-1" role="radiogroup" aria-label="Cómo cobra">
              {opcion('cobro', 'por_persona', `Por persona (${viajeros} ${viajeros === 1 ? 'viajero' : 'viajeros'})`)}
              {opcion('cobro', 'total', 'Un valor por todo')}
            </div>
            {!composicion && (
              <>
                {titulo('Pasajeros')}
                {campo('adultos', 'Adultos', { numerico: true })}
                {campo('ninos', 'Niños', { numerico: true })}
                {campo('infantes', 'Infantes', { numerico: true })}
              </>
            )}
            {casillaSinCosto}
            {conCosto(<>
              <p className="col-span-full m-0 text-xs text-[#6E6A62]">{AYUDA_NETO}</p>
              {campo('neto', v.cobro === 'total' ? 'Costo total' : 'Costo por persona', { numerico: true, obligatorio: true })}
              {campo('fuente', 'Fuente de la tarifa', { ancho: 'col-span-2 max-sm:col-span-2', placeholder: 'Portafolio 2026, llamada con el proveedor…', ayuda: AYUDA_FUENTE })}
            </>)}
            {esAsistenciaMedica(v.nombre) && <p className="col-span-full m-0 text-xs text-[#0E5C43]" data-nota-asistencia>{NOTA_ASISTENCIA_MEDICA}</p>}
          </div>
        ) : tipo === 'hotel' ? (
          <div className="grid grid-cols-3 gap-x-3 gap-y-2 max-sm:grid-cols-2">
            {campo('hotel', 'Hotel', { obligatorio: true })}
            {campo('ciudad', 'Dónde', { placeholder: 'Providencia' })}
            {campo('entrada', 'Entrada', { tipo: 'date', obligatorio: true })}
            {campo('salida', 'Salida', { tipo: 'date', obligatorio: true, ayuda: noches > 0 ? `${noches} ${noches === 1 ? 'noche' : 'noches'}` : undefined })}
            {campo('habitacion', 'Habitación', { obligatorio: true, placeholder: 'Doble estándar' })}
            {campo('regimen', 'Régimen', { placeholder: 'Todo incluido, desayuno y cena…' })}
            {titulo('Pasajeros de la habitación')}
            {campo('adultos', 'Adultos', { numerico: true })}
            {campo('ninos', 'Niños', { numerico: true })}
            {campo('infantes', 'Infantes', { numerico: true })}
            {titulo('Costo neto por persona por noche')}
            {casillaSinCosto}
            {conCosto(<>
              <p className="col-span-full m-0 text-xs text-[#6E6A62]">{AYUDA_NETO}</p>
              {campo('netoAdulto', 'Adulto', { numerico: true, obligatorio: true })}
              {campo('netoNino', 'Niño', { numerico: true })}
              {campo('netoInfante', 'Infante', { numerico: true, placeholder: '0' })}
              {campo('fuente', 'Fuente de la tarifa', { ancho: 'col-span-2 max-sm:col-span-2', placeholder: 'Portafolio del hotel', ayuda: AYUDA_FUENTE })}
            </>)}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-x-3 gap-y-2 max-sm:grid-cols-2">
            {campo('ruta', 'Recorrido', { obligatorio: true, placeholder: 'Aeropuerto – hotel' })}
            {campo('fecha', 'Fecha', { tipo: 'date' })}
            {titulo('Pasajeros')}
            {campo('adultos', 'Adultos', { numerico: true })}
            {campo('ninos', 'Niños', { numerico: true })}
            {campo('infantes', 'Infantes', { numerico: true })}
            {casillaSinCosto}
            {conCosto(<>
            <div className="col-span-full flex flex-col gap-0.5" data-campo-manual="precio">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1" role="radiogroup" aria-label={PREGUNTA_PRECIO_TRASLADO}>
                <span className={`text-xs ${errores.precio ? 'text-[#9A5F0C]' : 'text-[#6E6A62]'}`}>{PREGUNTA_PRECIO_TRASLADO} *</span>
                {opcion('precio', 'por_trayecto', OPCION_POR_TRAYECTO)}
                {opcion('precio', 'in_out', OPCION_IN_OUT)}
              </div>
              {errores.precio && <span className="text-xs text-[#B3382C]">{errores.precio}</span>}
            </div>
            {monedaDelTraslado}
            <div className="col-span-full flex flex-wrap gap-x-4 gap-y-1" role="radiogroup" aria-label="Cómo cobra">
              {opcion('cobro', 'por_persona', 'Por persona')}
              {opcion('cobro', 'por_vehiculo', 'Por vehículo')}
            </div>
            {v.cobro === 'por_vehiculo'
              ? campo('neto', 'Costo por vehículo', { numerico: true, obligatorio: true })
              : (
                <>
                  {campo('neto', 'Adulto', { numerico: true, obligatorio: true })}
                  {campo('netoNino', 'Niño', { numerico: true })}
                  {campo('netoInfante', 'Infante', { numerico: true, placeholder: '0' })}
                </>
              )}
            {v.precio !== 'in_out' && (
              <div className="col-span-2 flex flex-wrap items-end gap-x-4 gap-y-1 pb-1.5" role="radiogroup" aria-label="Trayectos">
                {opcion('idaYRegreso', 'no', 'Solo ida')}
                {opcion('idaYRegreso', 'si', 'Ida y regreso')}
              </div>
            )}
            {campo('fuente', 'Fuente de la tarifa', { ancho: 'col-span-2 max-sm:col-span-2', placeholder: 'Portafolio del proveedor', ayuda: AYUDA_FUENTE })}
            </>)}
          </div>
        )}
        {fueraDelViaje && <p className="m-0 text-xs font-medium text-[#9A5F0C]" data-aviso-fechas>{fueraDelViaje}</p>}
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

  return (
    <form onSubmit={enviar} className="flex flex-col gap-2.5 rounded-lg border border-[#CFCAC0] bg-[#F8F7F3] p-3" aria-label="Ingresar a mano" data-ingreso-manual>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">Ingresar a mano</span>
        <div className="flex gap-1" role="group" aria-label="Qué vas a ingresar">
          {(['hotel', 'traslado'] as const).map(t => (
            <button key={t} type="button" onClick={() => cambiarTipo(t)} aria-pressed={tipo === t} className={tipo === t ? BTN_ELEGIDO : BTN}>
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
          {titulo(v.precio === 'in_out' ? 'Costo neto ida y regreso' : 'Costo neto por trayecto')}
          <p className="col-span-full m-0 text-xs text-[#6E6A62]">{AYUDA_NETO}</p>
          <div className="col-span-full flex flex-col gap-0.5" data-campo-manual="precio">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1" role="radiogroup" aria-label={PREGUNTA_PRECIO_TRASLADO}>
              <span className={`text-xs ${errores.precio ? 'text-[#9A5F0C]' : 'text-[#6E6A62]'}`}>{PREGUNTA_PRECIO_TRASLADO}</span>
              {opcion('precio', 'por_trayecto', OPCION_POR_TRAYECTO)}
              {opcion('precio', 'in_out', OPCION_IN_OUT)}
            </div>
            {errores.precio
              ? <span className="text-xs text-[#B3382C]">{errores.precio}</span>
              : v.precio === 'in_out' && <span className="text-[11px] text-[#6E6A62]">{AYUDA_IN_OUT}</span>}
          </div>
          {monedaDelTraslado}
          <div className="col-span-full flex flex-wrap gap-x-4 gap-y-1" role="radiogroup" aria-label="Cómo cobra">
            {opcion('cobro', 'por_persona', 'Por persona')}
            {opcion('cobro', 'por_vehiculo', 'Por vehículo')}
          </div>
          {/* Por persona, como el hotel: adulto, niño e infante (el infante vacío es 0). */}
          {v.cobro === 'por_vehiculo' ? (
            campo('neto', 'Costo por vehículo', { numerico: true })
          ) : (
            <>
              {campo('neto', 'Adulto', { numerico: true })}
              {campo('netoNino', 'Niño', { numerico: true })}
              {campo('netoInfante', 'Infante', { numerico: true, placeholder: '0' })}
            </>
          )}
          {/* In-out ya es ida y regreso: los trayectos solo se preguntan con precio por trayecto. */}
          {v.precio !== 'in_out' && (
            <div className="col-span-2 flex flex-wrap items-end gap-x-4 gap-y-1 pb-1.5" role="radiogroup" aria-label="Trayectos">
              {opcion('idaYRegreso', 'no', 'Solo ida')}
              {opcion('idaYRegreso', 'si', 'Ida y regreso')}
            </div>
          )}
          {campo('fuente', 'Fuente de la tarifa', { ancho: 'col-span-2 max-sm:col-span-2', placeholder: 'Portafolio Dolphins 2026', ayuda: AYUDA_FUENTE })}
        </div>
      )}

      {fueraDelViaje && <p className="m-0 text-xs font-medium text-[#9A5F0C]" data-aviso-fechas>{fueraDelViaje}</p>}
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
