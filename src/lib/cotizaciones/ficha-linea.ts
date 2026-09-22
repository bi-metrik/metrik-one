/**
 * La FICHA de una línea con pantallazo: cada campo, lo que leyó la IA, lo que corrigió una
 * persona, y cómo se valida una corrección.
 *
 * Brief del 2026-09-22 (`brief-max-2026-09-22-estrellas-y-campos-editables.md`, punto 3).
 * Los datos viven en `correcciones.ts`; aquí está lo que decide la pantalla y la server
 * action, para que las dos digan lo mismo por construcción.
 *
 * Puro: sin red y sin base.
 */

import type { CampoRanura, DefinicionRanura } from './ranuras-pantallazo'
import {
  aplicarCorrecciones,
  camposCorregibles,
  leidosPorSlug,
  type CorreccionCampo,
  type Correcciones,
} from './correcciones'
import { resumenDeLinea, numeroLeido, type CampoLeido } from './lectura-pantallazo'
import type { CasillasLeidas } from './tarifa-pasajero'
import { horaCorta } from './detalle-viaje'
import { estrellasDesdeTexto } from './estrellas'

// ── Validar lo que escribe una persona ───────────────────────────────────────

/** Tope de un texto corregido. Un campo de la ficha no es un párrafo. */
const MAX_TEXTO = 200

export type ResultadoValidacion = { ok: true; valor: string | null } | { ok: false; error: string }

/**
 * Normaliza lo que escribió una persona en un campo, o dice por qué no se puede guardar.
 *
 * El valor se guarda en la MISMA forma en que lo guarda la lectura (fechas `AAAA-MM-DD`,
 * horas `HH:MM`, booleanos `true`/`false`, estrellas como entero): el documento y la ficha
 * lo leen igual venga de donde venga, y no hay una segunda forma de escribir el mismo dato.
 *
 * Un texto vacío es `null`: la persona deja el campo vacío a propósito.
 */
export function validarCorreccion(def: CampoRanura, entrada: string | null | undefined): ResultadoValidacion {
  const t = (entrada ?? '').trim()
  if (t === '') return { ok: true, valor: null }

  if (def.slug === 'estrellas') {
    const n = estrellasDesdeTexto(t)
    return n === null
      ? { ok: false, error: 'La categoría es un número entero de 1 a 5.' }
      : { ok: true, valor: String(n) }
  }
  if (def.slug.startsWith('hora_')) {
    const h = horaCorta(t)
    return h === null ? { ok: false, error: 'Escribe la hora como 07:45 o 7:45 pm.' } : { ok: true, valor: h }
  }
  if (def.tipo === 'fecha') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t)
    const d = m ? new Date(`${t}T00:00:00Z`) : null
    const valida = !!m && !!d && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === t
    return valida ? { ok: true, valor: t } : { ok: false, error: 'La fecha no es válida.' }
  }
  if (def.tipo === 'boolean') {
    const v = t.toLowerCase()
    if (v === 'true' || v === 'sí' || v === 'si') return { ok: true, valor: 'true' }
    if (v === 'false' || v === 'no') return { ok: true, valor: 'false' }
    return { ok: false, error: 'Elige sí o no.' }
  }
  if (def.tipo === 'numero') {
    const n = Number(t.replace(',', '.'))
    const minimo = def.slug === 'noches' ? 1 : 0
    return Number.isInteger(n) && n >= minimo
      ? { ok: true, valor: String(n) }
      : { ok: false, error: `Escribe un número entero${minimo > 0 ? ' mayor que cero' : ''}.` }
  }
  if (def.tipo === 'currency') {
    const n = numeroDeMonto(t)
    return n !== null && n >= 0 ? { ok: true, valor: String(n) } : { ok: false, error: 'Escribe solo el valor, sin símbolo.' }
  }
  if (t.length > MAX_TEXTO) return { ok: false, error: `Máximo ${MAX_TEXTO} caracteres.` }
  return { ok: true, valor: t }
}

/**
 * Un monto escrito a mano: «329,44», «1.234,56», «1,234.56» o «329.44».
 *
 * El último separador con dos cifras o menos detrás es el decimal; los demás son de miles.
 */
function numeroDeMonto(t: string): number | null {
  const limpio = t.replace(/[^\d.,]/g, '')
  if (!/\d/.test(limpio)) return null
  const ultimo = Math.max(limpio.lastIndexOf('.'), limpio.lastIndexOf(','))
  const decimales = ultimo >= 0 ? limpio.length - ultimo - 1 : 0
  const normal = ultimo >= 0 && decimales <= 2
    ? `${limpio.slice(0, ultimo).replace(/[.,]/g, '')}.${limpio.slice(ultimo + 1)}`
    : limpio.replace(/[.,]/g, '')
  const n = Number(normal)
  return Number.isFinite(n) ? n : null
}

// ── Lo que ve la persona ─────────────────────────────────────────────────────

export interface CampoDeFicha {
  slug: string
  label: string
  tipo: CampoRanura['tipo']
  /** Lo que leyó la IA, tal como quedó guardado (con «(del viaje)» si lo puso el ítem). */
  leido: string | null
  /** Lo que se usa: lo corregido si hay corrección, si no lo leído (sin el marcador). */
  vigente: string | null
  /** La corrección de una persona, si la hay. */
  correccion: CorreccionCampo | null
}

/**
 * La ficha de la línea: todos los campos corregibles de la ranura, leídos o no.
 *
 * Se muestran también los que la IA NO leyó: un hueco (la categoría que la captura no
 * mostraba) se llena en el mismo sitio donde se corrige un error.
 */
export function fichaDeLinea(
  ranura: DefinicionRanura,
  campos: { label: string; valor: string }[] | undefined,
  correcciones: Correcciones | null | undefined,
): CampoDeFicha[] {
  const crudo = new Map((campos ?? []).map(c => [c.label, c.valor]))
  const leidos = leidosPorSlug(ranura, campos)
  const vigentes = aplicarCorrecciones(leidos, correcciones)
  return camposCorregibles(ranura).map(def => ({
    slug: def.slug,
    label: def.label,
    tipo: def.tipo,
    leido: crudo.get(def.label) ?? null,
    vigente: vigentes[def.slug] ?? null,
    correccion: correcciones?.[def.slug] ?? null,
  }))
}

/** Cómo se lee un valor en la ficha: «Sí»/«No» para los booleanos, el resto tal cual. */
export function valorLegible(tipo: CampoRanura['tipo'], valor: string | null): string {
  if (valor === null || valor.trim() === '') return '—'
  if (tipo === 'boolean') return valor === 'true' ? 'Sí' : valor === 'false' ? 'No' : valor
  return valor
}

// ── La descripción de la línea ───────────────────────────────────────────────

/**
 * La descripción que el sistema escribe en `items.descripcion` al confirmar, con lo
 * corregido encima de lo leído.
 *
 * Sin correcciones es EXACTAMENTE la de siempre: la de la casilla 1 más las notas al cliente
 * de todas las casillas. Con correcciones se rearma con `resumenDeLinea` sobre los valores
 * vigentes, para que «Día a día» no diga una hora que la ficha ya corrigió.
 *
 * `respaldo` es la descripción que ya tenía la línea: sin casilla 1, o con una casilla 1 que
 * no dejó descripción, se usa esa de base. Es lo que hacía la confirmación antes.
 */
export function descripcionDeLinea(
  ranura: DefinicionRanura,
  casillas: CasillasLeidas,
  correcciones: Correcciones | null | undefined,
  respaldo: string | null = null,
): string {
  const primera = casillas.grupo_completo
  const hayCorrecciones = Object.keys(correcciones ?? {}).length > 0
  const notasLeidas = [...new Set(Object.values(casillas).flatMap(l => l?.notasCliente ?? []))]

  if (!primera || !hayCorrecciones) {
    const base = (primera?.descripcion ?? '').trim() || (respaldo ?? '').trim()
    return [base, ...notasLeidas.filter(n => !base.includes(n))].filter(Boolean).join(' · ')
  }

  const vigentes = aplicarCorrecciones(leidosPorSlug(ranura, primera.campos), correcciones)
  const campos: CampoLeido[] = ranura.campos.map(def => ({
    slug: def.slug,
    label: def.label,
    valor: vigentes[def.slug] ?? null,
    confidence: 1,
    alertaRevision: false,
  }))
  const base = resumenDeLinea(ranura, campos).descripcion.trim() || (respaldo ?? '').trim()
  // La nota de impuestos en destino sale de la lectura; si alguien los corrigió, la nota se
  // rearma con lo corregido. Las demás notas se conservan.
  const tocaImpuestos = !!correcciones?.impuestos_destino_valor || !!correcciones?.impuestos_destino_moneda
  const notas = tocaImpuestos
    ? [...notasLeidas.filter(n => !/impuestos y tasas a pagar en destino/i.test(n)), ...notaImpuestosDestino(vigentes, primera.moneda)]
    : notasLeidas
  return [base, ...notas.filter(n => !base.includes(n))].filter(Boolean).join(' · ')
}

/** La misma nota que arma la lectura (`lectura-casilla.ts`), con los valores vigentes. */
function notaImpuestosDestino(d: Record<string, string>, monedaCaptura: string): string[] {
  const valor = numeroLeido(d.impuestos_destino_valor ?? null)
  if (valor === null || valor <= 0) return []
  const moneda = (d.impuestos_destino_moneda ?? monedaCaptura ?? '').toUpperCase()
  return [
    `Impuestos y tasas a pagar en destino: ${valor.toLocaleString('es-CO', { maximumFractionDigits: 2 })} ` +
    `${moneda}, no incluidos en el precio.`,
  ]
}

/**
 * ¿La descripción que tiene hoy la línea la puede reescribir el sistema?
 *
 * Mismo criterio que el nombre (`nombre-linea.ts`) y que el margen: lo que escribió una
 * persona no se toca, ni al volver a confirmar ni al corregir un campo de la ficha (regla 4
 * del brief). Se decide comparando el VALOR con el que el sistema escribió la última vez
 * (`TarifaPax.descripcionDelSistema`):
 *
 *  · vacía → sí, no hay nada que proteger;
 *  · con marca → solo si sigue siendo la que escribió el sistema;
 *  · sin marca y con una tarifa ya confirmada → sí: es una línea confirmada antes de que
 *    existiera la marca, y así se comportaba; sin la marca no hay forma de saber si alguien
 *    la editó, y cambiarle la conducta sería peor que conservarla;
 *  · sin marca y sin confirmar nunca → no: lo que haya lo escribió una persona.
 */
export function descripcionReescribible(
  actual: string | null | undefined,
  delSistema: string | null | undefined,
  hayConfirmada: boolean,
): boolean {
  const a = (actual ?? '').trim()
  if (a === '') return true
  if (delSistema === undefined) return hayConfirmada
  return delSistema !== null && a === delSistema.trim()
}
