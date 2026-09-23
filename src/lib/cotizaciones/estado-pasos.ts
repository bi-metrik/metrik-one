/**
 * El estado de cada uno de los cuatro pasos del editor de Trappvel (brief del 2026-09-23), y
 * el encabezado del viaje.
 *
 * Puro: la pantalla le pasa lo que ya tiene calculado y esto decide si cada paso está hecho,
 * pendiente o con error, y la línea que lo explica. Vive aparte del JSX para que la regla de
 * «cuándo está hecho» tenga su prueba y no dependa de cómo se pinte.
 *
 *  · El viaje NO es un paso (P9, decisión de Mauricio del 2026-09-23): destino, fechas y
 *    pasajeros salen del negocio y aquí no hay nada que decidir. Es el encabezado fijo de la
 *    cotización (`encabezadoDelViaje`), en ámbar si al negocio le faltan fechas o pasajeros.
 *  1. Componentes: hecho cuando cada ranura tiene al menos una opción con costo.
 *  2. Tarifas: hecho con al menos una tarifa en la propuesta.
 *  3. Texto para el cliente: hecho cuando se guardó revisado (o si la plantilla no lo lleva).
 *  4. Revisar y enviar: error si algo impide enviar; pendiente con lo que le falta al viaje;
 *     hecho cuando ya salió de borrador.
 */

import { describirOcupacion, type Composicion } from './tarifa-pasajero'
import type { EstadoTexto } from './documento-cliente'

export type EstadoDePaso = 'hecho' | 'pendiente' | 'error'

export interface ResultadoPaso {
  estado: EstadoDePaso
  problemas?: number
  detalle: string | null
}

export interface EntradaPasos {
  viaje: { destino: string | null; fechas: { inicio: string | null; fin: string | null } | null; composicion: Composicion | null }
  /** Las ranuras de la cotización, con cuántas opciones tienen costo. */
  ranuras: { etiqueta: string; opciones: number; conCosto: number }[]
  /** Líneas sueltas (sin ranura, sin cuadre) que no tienen ni costo ni precio. */
  sueltasSinCosto: number
  tarifasEnPropuesta: number
  /** `null` = la plantilla no lleva texto para el cliente. */
  texto: EstadoTexto | null
  /** Por qué no se puede enviar hoy. `null` = nada lo impide. */
  bloqueoEnvio: string | null
  estadoCotizacion: string | null
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

function partes(iso: string | null | undefined): { a: number; m: number; d: number } | null {
  const r = /^(\d{4})-(\d{2})-(\d{2})/.exec((iso ?? '').trim())
  return r ? { a: Number(r[1]), m: Number(r[2]) - 1, d: Number(r[3]) } : null
}

/** «9 al 13 nov 2026», «28 dic 2026 al 3 ene 2027». */
export function rangoDelViaje(inicio: string | null | undefined, fin: string | null | undefined): string | null {
  const a = partes(inicio)
  const b = partes(fin)
  if (!a && !b) return null
  if (a && !b) return `${a.d} ${MESES[a.m]} ${a.a}`
  if (!a && b) return `hasta el ${b.d} ${MESES[b.m]} ${b.a}`
  const x = a as { a: number; m: number; d: number }
  const y = b as { a: number; m: number; d: number }
  if (x.a === y.a && x.m === y.m) return `${x.d} al ${y.d} ${MESES[y.m]} ${y.a}`
  if (x.a === y.a) return `${x.d} ${MESES[x.m]} al ${y.d} ${MESES[y.m]} ${y.a}`
  return `${x.d} ${MESES[x.m]} ${x.a} al ${y.d} ${MESES[y.m]} ${y.a}`
}

/** «Providencia · 9 al 13 nov 2026 · 2 adultos, 1 infante». Lo que no está, no sale. */
export function resumenDelViaje(e: EntradaPasos['viaje']): string {
  return [
    e.destino?.trim() || null,
    rangoDelViaje(e.fechas?.inicio, e.fechas?.fin),
    e.composicion ? describirOcupacion(e.composicion) : null,
  ].filter(Boolean).join(' · ')
}

export interface EncabezadoDelViaje {
  /** «Providencia · 9 al 13 nov 2026 · 2 adultos, 1 infante». Vacío si el negocio no dice nada. */
  resumen: string
  /** Por qué va en ámbar: «Faltan las fechas del viaje en el negocio». `null` = completo. */
  motivo: string | null
}

/** El encabezado fijo de la cotización de viaje (P9). */
export function encabezadoDelViaje(v: EntradaPasos['viaje']): EncabezadoDelViaje {
  const sinFechas = !v.fechas?.inicio && !v.fechas?.fin
  const sinPasajeros = !v.composicion
  const falta = sinFechas && sinPasajeros
    ? 'las fechas y los pasajeros'
    : sinFechas
      ? 'las fechas del viaje'
      : sinPasajeros
        ? 'los pasajeros'
        : null
  return { resumen: resumenDelViaje(v), motivo: falta ? `Faltan ${falta} en el negocio` : null }
}

export function estadoDePasos(e: EntradaPasos): Record<'componentes' | 'tarifas' | 'texto' | 'revisar', ResultadoPaso> {

  const sinCosto = e.ranuras.filter(r => r.conCosto === 0)
  const problemasComp = sinCosto.length + e.sueltasSinCosto
  const componentes: ResultadoPaso = e.ranuras.length === 0 && e.sueltasSinCosto === 0
    ? { estado: 'pendiente', detalle: 'Pega el primer pantallazo' }
    : problemasComp > 0
      ? {
          estado: 'error',
          problemas: problemasComp,
          detalle: problemasComp === 1
            ? `Falta el costo de ${sinCosto[0]?.etiqueta ?? 'un componente'}`
            : `${problemasComp} componentes sin costo`,
        }
      : { estado: 'hecho', detalle: `${e.ranuras.length} ${e.ranuras.length === 1 ? 'componente' : 'componentes'}` }

  const tarifas: ResultadoPaso = e.tarifasEnPropuesta > 0
    ? { estado: 'hecho', detalle: `${e.tarifasEnPropuesta} ${e.tarifasEnPropuesta === 1 ? 'tarifa' : 'tarifas'} en la propuesta` }
    : { estado: 'pendiente', detalle: 'Marca al menos una tarifa para la propuesta' }

  const texto: ResultadoPaso = e.texto === null || e.texto === 'revisado'
    ? { estado: 'hecho', detalle: e.texto === null ? null : 'Revisado' }
    : { estado: 'pendiente', detalle: e.texto === 'borrador' ? 'Borrador de ONE sin revisar' : 'Sin texto' }

  const yaSalio = !!e.estadoCotizacion && e.estadoCotizacion !== 'borrador'
  // Lo que le falta al viaje se lista aquí como pendiente: el encabezado lo dice arriba,
  // pero es este paso el que se revisa antes de mandar algo al cliente.
  const faltaViaje = encabezadoDelViaje(e.viaje).motivo
  const revisar: ResultadoPaso = yaSalio
    ? { estado: 'hecho', detalle: 'Enviada' }
    : e.bloqueoEnvio
      ? { estado: 'error', problemas: 1, detalle: faltaViaje ? `${e.bloqueoEnvio} · ${faltaViaje}` : e.bloqueoEnvio }
      : faltaViaje
        ? { estado: 'pendiente', detalle: faltaViaje }
        : { estado: 'pendiente', detalle: 'Lista para revisar y enviar' }

  return { componentes, tarifas, texto, revisar }
}
