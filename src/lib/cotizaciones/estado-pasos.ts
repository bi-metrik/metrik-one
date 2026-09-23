/**
 * El estado de cada uno de los cinco pasos del editor de Trappvel (brief del 2026-09-23).
 *
 * Puro: la pantalla le pasa lo que ya tiene calculado y esto decide si cada paso está hecho,
 * pendiente o con error, y la línea que lo explica. Vive aparte del JSX para que la regla de
 * «cuándo está hecho» tenga su prueba y no dependa de cómo se pinte.
 *
 *  1. Viaje: hecho con quiénes viajan y el destino o las fechas (salen de DA1, no se editan aquí).
 *  2. Componentes: hecho cuando cada ranura tiene al menos una opción con costo.
 *  3. Tarifas: hecho con al menos una tarifa en la propuesta.
 *  4. Texto para el cliente: hecho cuando se guardó revisado (o si la plantilla no lo lleva).
 *  5. Revisar y enviar: error si algo impide enviar; hecho cuando ya salió de borrador.
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

export function estadoDePasos(e: EntradaPasos): Record<'viaje' | 'componentes' | 'tarifas' | 'texto' | 'revisar', ResultadoPaso> {
  const viajeListo = !!e.viaje.composicion && (!!e.viaje.destino?.trim() || !!e.viaje.fechas?.inicio)
  const viaje: ResultadoPaso = viajeListo
    ? { estado: 'hecho', detalle: resumenDelViaje(e.viaje) }
    : { estado: 'pendiente', detalle: 'Faltan las condiciones del viaje en el negocio' }

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
  const revisar: ResultadoPaso = yaSalio
    ? { estado: 'hecho', detalle: 'Enviada' }
    : e.bloqueoEnvio
      ? { estado: 'error', problemas: 1, detalle: e.bloqueoEnvio }
      : { estado: 'pendiente', detalle: 'Lista para revisar y enviar' }

  return { viaje, componentes, tarifas, texto, revisar }
}
