/**
 * Las comparaciones de la validación de un documento (`config_extra.cross_check` del
 * bloque): lo que se extrajo del archivo contra lo que el negocio ya tenía.
 *
 * Vivían dentro de `documento-actions.ts`, que es `'use server'` y no puede exportarlas.
 * Por eso tenían su propia normalización y su propia regla de nombres, distintas de las
 * de los cruces de la línea (`negocios/comparar-valores.ts`), y el mismo par de valores
 * podía avisar en el bloque y pasar en la tarjeta de datos clave, o al revés. Desde el
 * 2026-10-01 las dos usan las mismas: la normalización de `texto-normalizado.ts`, la
 * regla de nombres de `nombresCoinciden` y la del documento de `mismoDocumento`.
 *
 * Puro: sin servidor ni base. Lo usan la carga del documento (que guarda el veredicto
 * en `_cross_check`) y la lectura del negocio (que lo vuelve a mirar, ver
 * `relectura-cross-check.ts`).
 */

import { estadoVigencia, type CriterioVigencia, type EstadoVigencia } from './vigencia'
import { montosCoinciden } from '@/lib/negocios/monto-cop'
import { TOLERANCIA_SALDO_COP } from '@/lib/negocios/tolerancia-saldo'
import { nombresCoinciden } from '@/lib/negocios/comparar-valores'
import { normalizarTexto } from '@/lib/negocios/texto-normalizado'
import { mismoDocumento } from '@/lib/negocios/fuentes-negocio'

export type CrossCheckMatchMode = 'exact' | 'tokens' | 'subset' | 'id_prefix' | 'overlap' | 'vigencia' | 'monto'

// Fuente de datos para un check: una etapa + bloque + cómo resolver el valor
// esperado (un campo, varios concatenados, o varias alternativas de campo).
export type CrossCheckSource = {
  // Referencia ESTABLE al bloque fuente por su slug (atado a la identidad del
  // bloque, no a su posición ni a su nombre editable). Prioritario sobre el par
  // (source_etapa_orden, source_bloque_nombre), que queda como fallback legacy
  // para refs aún no migradas. Ver docs/specs/2026-05-26_block-references-by-slug.md
  source_bloque_slug?: string
  source_etapa_orden: number
  source_bloque_nombre: string
  source_field?: string
  source_fields?: string[]
  source_field_alternatives?: string[]
  join?: string
}

/**
 * Un check tiene TRES desenlaces, no dos.
 *
 * `ok`             — se comparó y coincide.
 * `falla`          — se comparó y no coincide.
 * `no_comprobable` — faltó un dato para comparar (hoy solo pasa en `vigencia`,
 *                    cuando el negocio aún no tiene fecha objetivo).
 *
 * ⚠️ `no_comprobable` NO es `ok`. Colapsarlo dejó 87 certificados vencidos pasando
 * el check sin que nadie los viera: no es que el control los aprobara, es que ni
 * siquiera los evaluaba. Tampoco es `falla`: no hay evidencia de que el documento
 * esté mal, así que **no bloquea** — se reporta para que la pantalla lo muestre.
 */
export type EstadoCheck = 'ok' | 'falla' | 'no_comprobable'

export type OpcionesCheck = {
  vigencia_dias?: number
  tolerancia_cop?: number
  hoy_iso?: string
  margen_sin_cita_dias?: number
}

export type VeredictoCheck = {
  estado: EstadoCheck
  pedirDesde?: string | null
  vigencia?: EstadoVigencia
  criterio?: CriterioVigencia
}

/** Palabras con letras de 3 o más caracteres, más las parejas seguidas pegadas. */
function significativas(s: string): Set<string> {
  const ps = normalizarTexto(s).split(' ').filter(Boolean)
  const conPegadas = [...ps]
  for (let i = 0; i + 1 < ps.length; i++) conPegadas.push(ps[i] + ps[i + 1])
  return new Set(conPegadas.filter(t => t.length >= 3 && !/^\d+$/.test(t)))
}

/** ¿El valor esperado y el extraído dicen lo mismo, en este modo? */
export function compararCheck(
  expected: string,
  extracted: string,
  mode: CrossCheckMatchMode = 'exact',
  opts?: OpcionesCheck,
): boolean {
  // El dinero se compara como NÚMERO y con margen, nunca como texto: "$ 701.812"
  // y "701812" son el mismo monto, y "350906.00" no son 35 millones. Ver `monto-cop.ts`.
  if (mode === 'monto') {
    return montosCoinciden(expected, extracted, opts?.tolerancia_cop ?? TOLERANCIA_SALDO_COP)
  }
  // La vigencia se evalúa ANTES del guard de vacíos: en una seccional que no exige
  // cita no hay fecha objetivo. Ese caso NO es "cumple": es "no se pudo comprobar",
  // y lo resuelve `evaluarCheck` con su propio estado. Aquí solo interesa el
  // veredicto binario para los consumidores que aún esperan un booleano.
  if (mode === 'vigencia') {
    // Se delega en `estadoVigencia` (la MISMA función que usa `evaluarCheck`): dos
    // implementaciones del mismo juicio se desincronizan.
    const v = estadoVigencia(extracted, expected, {
      vigenciaDias: opts?.vigencia_dias,
      hoyISO: opts?.hoy_iso,
      margenSinObjetivoDias: opts?.margen_sin_cita_dias,
    })
    return v.estado !== 'reemplazar' && v.estado !== 'esperar'
  }
  if (!expected || !extracted) return false
  // El documento: solo dígitos, con el DV pegado o el código del tipo («13») delante.
  if (mode === 'id_prefix') return mismoDocumento(expected, extracted)
  const a = normalizarTexto(expected)
  const b = normalizarTexto(extracted)
  if (!a || !b) return false
  // El mismo texto coincide en todo modo de texto (también el modelo «X», de una letra).
  if (a === b) return true
  if (mode === 'tokens') return nombresCoinciden(expected, extracted)
  if (mode === 'subset') {
    const x = new Set(a.split(' '))
    const y = new Set(b.split(' '))
    return [...y].every(t => x.has(t)) || [...x].every(t => y.has(t))
  }
  if (mode === 'overlap') {
    // Tolerante a palabras extra: pasa si comparten al menos un token alfabético
    // significativo (≥3 letras, excluye años/números). Útil para línea/modelo,
    // donde el certificado UPME replica la factura con descripción más larga
    // ("Escape 2025" vs "Escape Platinum 2025") o con otros espacios ("RAV4" vs "RAV 4").
    const x = significativas(expected)
    const y = significativas(extracted)
    return [...x].some(t => y.has(t))
  }
  return false
}

/**
 * Evalúa un check y devuelve su estado real, distinguiendo el caso en que no se
 * pudo comprobar. Solo `vigencia` puede quedar `no_comprobable`: los demás modos
 * comparan textos o montos y siempre concluyen.
 *
 * `hoy_iso` viaja como parámetro (no se lee el reloj aquí) para que todo el lote
 * comparta una sola marca y para poder probarlo; ver `estadoVigencia`.
 */
export function evaluarCheck(
  expected: string,
  extracted: string,
  mode: CrossCheckMatchMode,
  opts?: OpcionesCheck,
): VeredictoCheck {
  if (mode === 'vigencia') {
    const v = estadoVigencia(extracted, expected, {
      vigenciaDias: opts?.vigencia_dias,
      hoyISO: opts?.hoy_iso,
      margenSinObjetivoDias: opts?.margen_sin_cita_dias,
    })
    if (v.estado === 'no_comprobable') {
      return { estado: 'no_comprobable', pedirDesde: null, vigencia: v.estado }
    }
    return {
      estado: v.estado === 'vigente' ? 'ok' : 'falla',
      pedirDesde: v.pedirDesde,
      vigencia: v.estado,
      ...(v.criterio ? { criterio: v.criterio } : {}),
    }
  }
  return { estado: compararCheck(expected, extracted, mode, opts) ? 'ok' : 'falla' }
}

/**
 * El valor esperado de UNA fuente (campo único, varios concatenados, o alternativas de
 * campo) contra los datos ya cargados de su bloque, y su veredicto.
 */
export function resolverDesdeFuente(
  src: CrossCheckSource,
  srcData: Record<string, unknown>,
  extractedRaw: string,
  mode: CrossCheckMatchMode,
  opts?: OpcionesCheck,
): VeredictoCheck & { expected: string } {
  if (src.source_fields && src.source_fields.length > 0) {
    const join = src.join ?? ' '
    const expected = src.source_fields.map(f => String(srcData[f] ?? '')).filter(s => s).join(join)
    return { expected, ...evaluarCheck(expected, extractedRaw, mode, opts) }
  }
  if (src.source_field_alternatives && src.source_field_alternatives.length > 0) {
    // Probar cada alternativa de campo; pasar si CUALQUIERA matchea. Se evalúa una
    // sola vez por candidato y se conserva el veredicto completo: quedarse solo con
    // `estado: 'ok'` perdería el detalle de vigencia del candidato que sí pasó.
    const candidates = src.source_field_alternatives.map(f => String(srcData[f] ?? '')).filter(s => s)
    const evaluados = candidates.map(c => ({ expected: c, ...evaluarCheck(c, extractedRaw, mode, opts) }))
    const matched = evaluados.find(e => e.estado === 'ok')
    if (matched) return matched
    const primero = evaluados[0]
    return primero ?? { expected: '', ...evaluarCheck('', extractedRaw, mode, opts) }
  }
  if (src.source_field) {
    const expected = String(srcData[src.source_field] ?? '')
    return { expected, ...evaluarCheck(expected, extractedRaw, mode, opts) }
  }
  return { expected: '', estado: 'falla' }
}
