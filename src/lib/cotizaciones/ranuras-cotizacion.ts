/**
 * La RANURA como entidad de la cotización (Parte B, bloque B1, del brief
 * `proyectos/trappvel/clarity/docs/diseno/brief-max-captura-cotizacion-2026-09-23.md`).
 *
 * ## Qué es y qué no cambia
 *
 * Una ranura es lo que el cliente compra UNA vez: «Hotel en Cancún», «Vuelo Bogotá–Cancún».
 * Sus opciones son HERMANAS (cada una un `item` con `ranura_id`) y compiten por entrar en
 * cada tarifa; ninguna es titular. Hasta hoy la ranura vivía embebida en el texto
 * `items.grupo` y las alternativas colgaban de una línea titular (`opcion_de`), así que la
 * alternativa nacía con el nombre de la vecina y el encabezado de la tabla decía «ponle
 * nombre…».
 *
 * ⚠️ **El motor de tarifas sigue agrupando por `items.grupo`** (`itinerarios.ts`), y a
 * propósito. `grupo` pasa a ser la CLAVE DERIVADA de la ranura: la escribe siempre el mismo
 * camino (`grupoDeRanura`), así que las dos no se pueden separar. Reescribir el motor para
 * agrupar por `ranura_id` habría movido de golpe el total, la cobertura, el registro de
 * decisiones y el documento de todas las cotizaciones vivas; así, una cotización con o sin
 * ranuras suma exactamente lo mismo.
 *
 * Todo lo de este archivo es PURO: nombres, la clave del grupo, los bloques de la pantalla
 * y el reparto por precio. Lo que toca la base vive en `ranuras-datos.ts`.
 */

import {
  etiquetaDeRanura,
  grupoDeInstancia,
  ranuraPorSlug,
  resolverRanura,
  type DefinicionRanura,
} from './ranuras-pantallazo'
import { normalizarGrupo } from './itinerarios'
import { NOMBRES_TARIFA } from './tarifas'

// ── Los tipos de ranura ───────────────────────────────────────────────────────

/** El tipo, escrito como el primer sinónimo del catálogo: es lo que guarda la base. */
export const TIPOS_RANURA = ['vuelo', 'hotel', 'actividad', 'traslado'] as const
export type TipoRanura = (typeof TIPOS_RANURA)[number]

const SLUG_POR_TIPO: Record<TipoRanura, string> = {
  vuelo: 'vuelo_detalle',
  hotel: 'hotel_detalle',
  actividad: 'actividad_detalle',
  traslado: 'traslado_detalle',
}

export function esTipoRanura(v: unknown): v is TipoRanura {
  return typeof v === 'string' && (TIPOS_RANURA as readonly string[]).includes(v)
}

/** El contrato de captura del tipo. Nunca `null` para un tipo válido. */
export function definicionDeTipo(tipo: TipoRanura): DefinicionRanura {
  const def = ranuraPorSlug(SLUG_POR_TIPO[tipo])
  if (!def) throw new Error(`El catálogo no declara el tipo de ranura «${tipo}»`)
  return def
}

/** El tipo de una definición del catálogo (`vuelo_detalle` → `vuelo`). */
export function tipoDeDefinicion(def: DefinicionRanura | null | undefined): TipoRanura | null {
  if (!def) return null
  const tipo = def.grupos[0]
  return esTipoRanura(tipo) ? tipo : null
}

// ── La ranura y su grupo ──────────────────────────────────────────────────────

/** Lo que define una ranura: su tipo, su ordinal y su nombre. */
export interface FormaDeRanura {
  tipo: TipoRanura
  /** `null` = la primera del tipo. Desde 2 en adelante («Vuelo 2»). */
  numero: number | null
  /** `null` = se llama como su tipo. */
  nombre: string | null
}

/**
 * El `items.grupo` que le corresponde a una ranura: la clave con la que el motor agrupa.
 *
 * Se escribe SIEMPRE desde aquí. Dos caminos que armaran el grupo cada uno a su manera
 * volverían dos ranuras lo que es una sola, y el total la sumaría dos veces.
 */
export function grupoDeRanura(r: FormaDeRanura): string {
  return grupoDeInstancia(definicionDeTipo(r.tipo), { numero: r.numero, nombre: r.nombre })
}

/**
 * La forma de la ranura que le corresponde a un grupo, o `null` si el grupo no es una
 * ranura del catálogo (`dia-1`, `seguro`, `avianca bog - adz`). Es la misma gramática de
 * `resolverRanura`, que es también la que replica el backfill en SQL.
 */
export function formaDesdeGrupo(grupo: string | null | undefined): FormaDeRanura | null {
  const inst = resolverRanura(normalizarGrupo(grupo))
  const tipo = tipoDeDefinicion(inst?.definicion)
  if (!inst || !tipo) return null
  const numero = inst.numero !== null && inst.numero >= 2 ? inst.numero : null
  return { tipo, numero, nombre: inst.nombre }
}

/**
 * El ordinal que le toca a la siguiente ranura de un tipo, dados los grupos en uso.
 * `null` para la primera. Mismo criterio que `siguienteGrupoDeTipo`: basta UNA ranura del
 * tipo, con el nombre que sea, para que la siguiente arranque en 2.
 */
export function siguienteNumeroDeTipo(
  tipo: TipoRanura,
  gruposEnUso: readonly (string | null | undefined)[],
): number | null {
  const delTipo = gruposEnUso.map(formaDesdeGrupo).filter((f): f is FormaDeRanura => f !== null && f.tipo === tipo)
  if (delTipo.length === 0) return null
  const ocupados = new Set(delTipo.map(f => f.numero ?? 1))
  let n = 2
  while (ocupados.has(n)) n += 1
  return n
}

// ── El nombre automático ──────────────────────────────────────────────────────

const CONECTORES = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'en', 'a'])

/**
 * Un nombre de lugar escrito como nombre propio: «CANCÚN» → «Cancún», «san andrés» →
 * «San Andrés». Solo se toca si viene TODO en mayúscula (la etapa 1 de Trappvel guarda en
 * mayúscula) o todo en minúscula (tecleado de corrido); una caja mezclada es de alguien que
 * la escribió así a propósito y se respeta.
 */
export function comoNombrePropio(texto: string): string {
  const t = texto.trim().replace(/\s+/g, ' ')
  const todoMayuscula = t === t.toLocaleUpperCase('es-CO')
  const todoMinuscula = t === t.toLocaleLowerCase('es-CO')
  if (t === '' || (!todoMayuscula && !todoMinuscula)) return t
  return t
    .toLocaleLowerCase('es-CO')
    .split(' ')
    .map((palabra, i) => {
      if (i > 0 && CONECTORES.has(palabra)) return palabra
      return palabra.charAt(0).toLocaleUpperCase('es-CO') + palabra.slice(1)
    })
    .join(' ')
}

/**
 * La ciudad de un lugar leído, sin el país ni el código del aeropuerto: «Cancún, México» →
 * «Cancún», «Bogotá BOG» → «Bogotá». Un código solo («BOG») se deja como está: es lo único
 * que hay y dice algo.
 */
export function ciudadCorta(lugar: string | null | undefined): string | null {
  let t = (lugar ?? '').trim()
  if (t === '') return null
  const coma = t.indexOf(',')
  if (coma > 0) t = t.slice(0, coma).trim()
  const conCodigo = /^(.*\S)\s+\(?([A-Z]{3})\)?$/.exec(t)
  if (conCodigo) t = conCodigo[1]
  return t === '' ? null : comoNombrePropio(t)
}

function clave(texto: string): string {
  return texto.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/**
 * El nombre con que nace una ranura: el tipo y el lugar.
 *
 *  · Hotel, actividad, traslado: «Hotel en Cancún». El lugar es el que leyó la captura y,
 *    si no leyó ninguno, el destino del negocio.
 *  · Vuelo: «Vuelo Bogotá–Cancún» con la ruta leída; «Vuelo a Cancún» con solo el destino.
 *  · Sin ningún lugar: el tipo a secas («Hotel»).
 *
 * ⚠️ Si ya hay una ranura con ese nombre, la nueva lleva su ordinal pegado al tipo («Hotel 2
 * en Cancún»). Dos ranuras llamadas igual se leerían como la misma, y son dos cosas que el
 * cliente paga por separado.
 */
export function nombreAutomaticoDeRanura(args: {
  tipo: TipoRanura
  lugar?: string | null
  origen?: string | null
  destino?: string | null
  numero?: number | null
  nombresEnUso?: readonly string[]
}): string {
  const def = definicionDeTipo(args.tipo)
  const etiqueta = def.label
  const enUso = new Set((args.nombresEnUso ?? []).map(clave))

  const armar = (cabeza: string): string => {
    if (args.tipo === 'vuelo') {
      const origen = ciudadCorta(args.origen)
      const destino = ciudadCorta(args.destino ?? args.lugar)
      if (origen && destino) return `${cabeza} ${origen}–${destino}`
      if (destino) return `${cabeza} a ${destino}`
      return cabeza
    }
    const lugar = ciudadCorta(args.lugar)
    return lugar ? `${cabeza} en ${lugar}` : cabeza
  }

  const base = armar(etiqueta)
  if (!enUso.has(clave(base))) return base
  const n = args.numero && args.numero >= 2 ? args.numero : 2
  return armar(`${etiqueta} ${n}`)
}

// ── El nombre de una opción ───────────────────────────────────────────────────

/**
 * El nombre con que nace una opción: «Opción 2». La lectura del pantallazo lo reemplaza
 * por el hotel o la aerolínea (`nombre-linea.ts` lo reconoce como relleno). Nunca copia el
 * nombre de la opción vecina: con «RIU… (alternativa)» la pantalla mostraba el hotel
 * equivocado hasta que alguien pegara la captura.
 */
export function nombreDeOpcion(n: number): string {
  return `Opción ${n}`
}

/** ¿Es el nombre de relleno de una opción? Sin tildes ni mayúsculas: «OPCIÓN 2» cuenta. */
export function esNombreDeOpcion(nombre: string | null | undefined): boolean {
  return /^opcion \d+$/.test(clave(nombre ?? '').replace(/\s+/g, ' '))
}

/**
 * El número de la siguiente opción de una ranura: uno más que las que ya tiene, y nunca
 * uno que ya se esté usando como nombre (borrar la opción 2 y crear otra no puede dejar
 * dos «Opción 3»).
 */
export function siguienteNumeroDeOpcion(nombresDeLaRanura: readonly (string | null | undefined)[]): number {
  let mayor = nombresDeLaRanura.length
  for (const n of nombresDeLaRanura) {
    const m = /^opcion (\d+)$/.exec(clave(n ?? '').replace(/\s+/g, ' '))
    if (m) mayor = Math.max(mayor, Number(m[1]))
  }
  return mayor + 1
}

// ── Los bloques de la pantalla ────────────────────────────────────────────────

/** Lo mínimo de una línea para ubicarla en su bloque. */
export interface LineaParaBloque {
  id: string
  grupo?: string | null
  es_ajuste?: boolean | null
}

export interface BloqueDeLineas<T> {
  /** El grupo de la ranura; `null` = línea suelta (va sola, en su sitio). */
  grupo: string | null
  /** Cómo se llama la ranura en la pantalla. `null` en una línea suelta. */
  etiqueta: string | null
  tipo: TipoRanura | null
  lineas: T[]
}

/**
 * Las líneas agrupadas por ranura, en el orden en que aparecen.
 *
 * Cada ranura del catálogo es UN bloque («Hotel en Cancún» y adentro sus opciones), en la
 * posición de su primera línea. Una línea sin ranura (el recargo, «otro componente») va sola
 * y conserva su sitio: reordenar la lista para agruparla movería de lugar cosas que nadie
 * pidió mover.
 *
 * ⚠️ Agrupa por el MISMO texto que agrupa el motor (`normalizarGrupo`). Si la pantalla
 * agrupara distinto, mostraría como una ranura dos cosas que el total suma por separado.
 */
export function bloquesPorRanura<T extends LineaParaBloque>(lineas: readonly T[]): BloqueDeLineas<T>[] {
  const bloques: BloqueDeLineas<T>[] = []
  const porGrupo = new Map<string, BloqueDeLineas<T>>()
  for (const linea of lineas) {
    if (linea.es_ajuste === true) continue
    const grupo = normalizarGrupo(linea.grupo)
    const forma = formaDesdeGrupo(grupo)
    if (!grupo || !forma) {
      bloques.push({ grupo: null, etiqueta: null, tipo: null, lineas: [linea] })
      continue
    }
    const existente = porGrupo.get(grupo)
    if (existente) {
      existente.lineas.push(linea)
      continue
    }
    const nuevo: BloqueDeLineas<T> = { grupo, etiqueta: etiquetaDeRanura(grupo), tipo: forma.tipo, lineas: [linea] }
    porGrupo.set(grupo, nuevo)
    bloques.push(nuevo)
  }
  return bloques
}

/**
 * Las ranuras de un tipo que ya tiene la cotización, en orden: es lo que se ofrece al pegar
 * un pantallazo de ese tipo («¿Otra opción de Hotel en Cancún?»).
 */
export function ranurasDelTipo<T extends LineaParaBloque>(
  lineas: readonly T[],
  tipo: TipoRanura,
): { grupo: string; etiqueta: string; opciones: number }[] {
  return bloquesPorRanura(lineas)
    .filter(b => b.grupo !== null && b.tipo === tipo)
    .map(b => ({ grupo: b.grupo as string, etiqueta: b.etiqueta as string, opciones: b.lineas.length }))
}

// ── El reparto por precio (paso 4 del flujo de Noor) ─────────────────────────

/**
 * Qué opción de cada ranura lleva cada tarifa, repartidas por precio: la más barata en la
 * Económica, la del medio en la Recomendada y la más cara en la Premium.
 *
 * Posición dentro de las `n` opciones con precio, de la más barata a la más cara:
 *  · Económica: la primera.
 *  · Premium: la última.
 *  · Recomendada: la del medio; con un número PAR, la más barata de las dos del medio
 *    (`floor((n-1)/2)`). Con dos opciones, la Recomendada lleva la misma que la Económica.
 *
 * ⚠️ Una opción sin precio (todavía no se pegó su captura) NO entra al reparto: ponerla en la
 * Económica por «costar cero» sería elegir la opción que nadie ha costeado. Una ranura sin
 * ninguna opción con precio queda sin elegir, y la tarifa se ve incompleta —que es verdad—.
 *
 * ⚠️ A igual precio decide el orden de las opciones, para que el resultado no dependa del
 * azar de la consulta.
 *
 * Devuelve, por nombre de tarifa, los ids elegidos (uno por ranura que se pudo repartir).
 */
export function repartoPorPrecio(
  ranuras: readonly { grupo: string; candidatos: readonly string[] }[],
  precioDe: (itemId: string) => number | null,
): Record<(typeof NOMBRES_TARIFA)[number], string[]> {
  const reparto = Object.fromEntries(NOMBRES_TARIFA.map(n => [n, [] as string[]])) as Record<
    (typeof NOMBRES_TARIFA)[number],
    string[]
  >
  for (const ranura of ranuras) {
    const conPrecio = ranura.candidatos
      .map((id, orden) => ({ id, orden, precio: precioDe(id) }))
      .filter((c): c is { id: string; orden: number; precio: number } => c.precio !== null && c.precio > 0)
      .sort((a, b) => (a.precio - b.precio) || (a.orden - b.orden))
    const n = conPrecio.length
    if (n === 0) continue
    const posicion: Record<(typeof NOMBRES_TARIFA)[number], number> = {
      Económica: 0,
      Recomendada: Math.floor((n - 1) / 2),
      Premium: n - 1,
    }
    for (const nombre of NOMBRES_TARIFA) reparto[nombre].push(conPrecio[posicion[nombre]].id)
  }
  return reparto
}
