/**
 * Un pantallazo de hotel con VARIAS habitaciones y un precio TOTAL (decisión de Mauricio,
 * 2026-10-14): *«Sí, mostramos el precio total y dejamos el registro de varias habitaciones.»*
 *
 *  · La lectura es UNA opción de hotel y su costo es el total del pantallazo. No se parte en
 *    precio por habitación: el total es lo que se ve en la tarjeta, en «Lo que suma» y en el PDF.
 *  · ONE guarda el REGISTRO de las habitaciones (cuántas, de qué tipo y con qué ocupación) en la
 *    misma lectura (`LecturaCasilla.habitacionesReserva`, dentro de `tarifa_pax`): sin migración.
 *  · Si la ocupación de la reserva no cuadra con los viajeros, se avisa en la lista. No bloquea.
 *
 * Distinto de R8 (`habitaciones.ts`): allí cada habitación es un PANTALLAZO y la opción suma sus
 * precios. Aquí es un solo pantallazo que ya trae la suma.
 *
 * ## La evidencia de que es una reserva y no una lista para elegir
 *
 * El modelo dice qué habitaciones ve (`OpcionesDeLectura.reservaVariasHabitaciones`), pero no se
 * le cree solo: si cada habitación muestra su precio, esos precios tienen que SUMAR el total que
 * leyó. Una grilla de habitaciones para escoger no tiene un total que las sume a todas, y ahí
 * sigue mandando RX1 («¿Cuál de estas?»): elegir mal cuesta el margen del viaje.
 *
 * Puro: sin red y sin base.
 */

import { parseMontoCop } from '@/lib/negocios/monto-cop'

import type { Composicion } from './tarifa-pasajero'

/** Una habitación de la reserva, tal como la dijo el modelo y todavía sin juzgar. */
export interface HabitacionDeReservaCruda {
  nombre: string
  ocupacion: string | null
  precio: string | null
}

/** Una habitación del registro que se guarda con la lectura. */
export interface HabitacionDeReserva {
  /** «Doble 1», tal como la nombra el pantallazo. */
  nombre: string
  /** Su texto de personas, tal cual («2 adultos, 1 niño, 1 infante»). `null` si no lo dice. */
  ocupacion: string | null
  /** Su precio, si el pantallazo lo muestra. Solo de registro: el costo es el TOTAL. */
  precio: number | null
}

/**
 * Cuánto se tolera entre la suma de las habitaciones y el total: una unidad por habitación, por
 * el redondeo del proveedor (Posada Enilda: 409.699 + 409.699 + 409.700 = 1.229.098).
 */
const TOLERANCIA_POR_HABITACION = 1

/**
 * El registro de la reserva, o `null` si la lectura no es una reserva de varias habitaciones.
 *
 * Es reserva con DOS o más habitaciones y un total legible. Si las habitaciones muestran su
 * precio, todos, y su suma da el total. Si ninguna lo muestra, el total es lo único que hay y
 * vale. Si unas sí y otras no, no se afirma nada: `null`.
 */
export function reservaDeVariasHabitaciones(
  crudas: readonly HabitacionDeReservaCruda[] | null | undefined,
  total: number | null,
): HabitacionDeReserva[] | null {
  const habs = (crudas ?? []).filter(h => h.nombre.trim() !== '')
  if (habs.length < 2 || total === null || !(total > 0)) return null
  const registro = habs.map(h => ({
    nombre: h.nombre.trim(),
    ocupacion: h.ocupacion?.trim() || null,
    precio: h.precio === null ? null : parseMontoCop(h.precio),
  }))
  const conPrecio = registro.filter(h => h.precio !== null)
  if (conPrecio.length > 0 && conPrecio.length < registro.length) return null
  if (conPrecio.length === registro.length) {
    const suma = registro.reduce((a, h) => a + (h.precio ?? 0), 0)
    if (Math.abs(suma - total) > TOLERANCIA_POR_HABITACION * registro.length) return null
  }
  return registro
}

// ── Lo que se muestra ────────────────────────────────────────────────────────

/** «Doble 1» → «doble»; «Cuádruple #2» → «cuádruple»; «Habitación 1» → «habitación». Sin número no cambia. */
function tipoDeNombre(nombre: string): string {
  return nombre.replace(/\s+(?:#\s*|n[°º.]\s*)?\d+\s*$/i, '').trim().toLowerCase()
}

/**
 * El plural de un tipo de habitación, en su primera palabra: «doble» → «dobles», «cuádruple
 * superior» → «cuádruples superior», «suite» → «suites». Lo que ya termina en «s» no cambia.
 */
function pluralTipo(tipo: string): string {
  const [primera, ...resto] = tipo.split(' ')
  const plural = /[aeiouáéíóú]$/i.test(primera) ? `${primera}s` : /s$/i.test(primera) ? primera : `${primera}es`
  return [plural, ...resto].join(' ')
}

/**
 * Cómo se nombra la reserva en la ficha, la frase de la bandeja y el PDF: «3 habitaciones
 * dobles», «2 habitaciones cuádruples», «3 habitaciones: 2 dobles y 1 triple». Sin un tipo que
 * se lea del nombre de las habitaciones, el que leyó el modelo: «3 habitaciones · Suite».
 */
export function resumenDeReserva(registro: readonly HabitacionDeReserva[], tipoLeido: string | null): string {
  const n = registro.length
  const tipos = registro.map(h => tipoDeNombre(h.nombre))
  const genericos = tipos.some(t => t === '' || /^(habitaci[oó]n|hab\.?|room)$/i.test(t))
  if (!genericos) {
    const cuenta = new Map<string, number>()
    for (const t of tipos) cuenta.set(t, (cuenta.get(t) ?? 0) + 1)
    if (cuenta.size === 1) return `${n} habitaciones ${pluralTipo(tipos[0])}`
    const partes = [...cuenta].map(([t, k]) => `${k} ${k === 1 ? t : pluralTipo(t)}`)
    return `${n} habitaciones: ${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`
  }
  const tipo = (tipoLeido ?? '').trim()
  return tipo ? `${n} habitaciones · ${tipo}` : `${n} habitaciones`
}

/** Cuántas personas dice el texto de una habitación. `null` si no dice ninguna. */
export function composicionDeTexto(texto: string | null | undefined): Composicion | null {
  if (!texto) return null
  const t = texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const contar = (re: RegExp) => [...t.matchAll(re)].reduce((a, m) => a + Number(m[1]), 0)
  const adultos = contar(/(\d+)\s*(?:adultos?|adults?|adt)\b/g)
  let ninos = contar(/(\d+)\s*(?:ninos?|menor(?:es)?|child(?:ren)?|kids?|chd)\b/g)
  let infantes = contar(/(\d+)\s*(?:infantes?|infants?|bebes?|babies|baby|inf)\b/g)
  // Un menor que la pantalla llama niño pero con edad 0 o 1 es infante (R8, `menoresDeDosAnios`).
  for (const g of t.matchAll(/(?:ninos?|menor(?:es)?|child(?:ren)?|kids?)\s*\(([^)]*)\)/g)) {
    for (const edad of g[1].matchAll(/\d+/g)) {
      if (Number(edad[0]) < 2 && ninos > 0) {
        ninos--
        infantes++
      }
    }
  }
  if (adultos + ninos + infantes === 0) return null
  return { adultos, ninos, infantes }
}

/**
 * A cuántos cubre la reserva: la suma de lo que dice cada habitación. `null` si alguna no dice a
 * cuántos cubre (entonces vale la ocupación que leyó el modelo para toda la reserva).
 */
export function ocupacionDeReserva(registro: readonly HabitacionDeReserva[]): Composicion | null {
  let suma: Composicion = { adultos: 0, ninos: 0, infantes: 0 }
  for (const h of registro) {
    const c = composicionDeTexto(h.ocupacion)
    if (!c) return null
    suma = { adultos: suma.adultos + c.adultos, ninos: suma.ninos + c.ninos, infantes: suma.infantes + c.infantes }
  }
  return suma
}

/** «2 adultos, 1 niño, 1 infante»: la forma de la ocupación que entiende la lectura de siempre. */
export function textoDeComposicion(c: Composicion): string {
  const partes: string[] = []
  if (c.adultos > 0) partes.push(`${c.adultos} ${c.adultos === 1 ? 'adulto' : 'adultos'}`)
  if (c.ninos > 0) partes.push(`${c.ninos} ${c.ninos === 1 ? 'niño' : 'niños'}`)
  if (c.infantes > 0) partes.push(`${c.infantes} ${c.infantes === 1 ? 'infante' : 'infantes'}`)
  return partes.join(', ')
}

/** El registro, de la lectura guardada. Vacío en toda lectura que no es una reserva de varias. */
export function registroDeReserva(lectura: { habitacionesReserva?: readonly HabitacionDeReserva[] | null } | null | undefined): readonly HabitacionDeReserva[] {
  const r = lectura?.habitacionesReserva
  return Array.isArray(r) && r.length >= 2 ? r : []
}
