/**
 * Mínimo y deseable de una solicitud: qué tanto de lo que hace falta ya está.
 *
 * Nació con Trappvel (2026-09-28). La solicitud de viaje se empieza a cotizar con un
 * MÍNIMO y se cierra la cotización final con un DESEABLE. Qué dato es cuál, y cuándo se
 * pide, todavía lo decide el cliente: por eso vive en la configuración de cada campo
 * (`config_extra.fields[i]` de un bloque `datos`) y no en código. Cuando cambie la
 * decisión se edita la config y no hay PR.
 *
 * Tres propiedades nuevas del campo, todas opcionales. Un campo sin ellas se comporta
 * exactamente como antes y NO suma a ninguna barra:
 *
 *   · `nivel`     'minimo' | 'deseable' — a qué barra suma.
 *   · `pedir_si`  condición sobre otros campos para que el campo cuente (ver abajo).
 *   · `pregunta`  cómo se le pide el dato a una persona («¿Qué edad tiene cada niño?»).
 *                 Es lo que se muestra en «lo que falta», en pantalla y en el bot.
 *                 Sin `pregunta`, se usa el `label`.
 *
 * ── `pedir_si` ──────────────────────────────────────────────────────────────────────
 *
 * Declarativo, sin evaluar texto como código. Reusa el vocabulario que ONE ya tiene en las
 * `condition` de los bloques (`field`, `value`, `value_in`, con la MISMA comparación de
 * `condicion-bloque.ts`) y en los campos suma (`suma_de`), y le agrega dos comparaciones
 * numéricas:
 *
 *     { "field": "destino_tipo", "value": "internacional" }
 *     { "field": "tipo_viaje", "value_in": ["playa", "crucero"] }
 *     { "field": "numero_pasajeros", "al_menos": 6 }
 *     { "suma_de": ["ninos", "infantes"], "mayor_que": 0 }
 *     { "field": "fecha_salida", "vacio": true }   ← cuenta mientras la fecha NO está
 *     [ {…}, {…} ]                       ← lista: tienen que cumplirse TODAS
 *
 * Cada condición lleva `field` o `suma_de` (uno solo) y al menos una comparación
 * (`value`, `value_in`, `distinto_de`, `al_menos`, `mayor_que`). Si trae varias, se
 * exigen todas.
 *
 * `vacio` es la única comparación que mira la AUSENCIA: `true` se cumple cuando el dato no
 * está (vacío, nulo; en una suma, ninguna parte con número) y `false` cuando sí está. Va
 * sola: combinada con otra comparación no significaría nada y se rechaza. Nació con
 * «flexibilidad de fechas»: solo se pregunta mientras no haya fecha de salida.
 *
 * ⚠️ Salvo `vacio`, un dato que todavía no está NO cumple la condición. «Permiso de salida de menores si
 * hay menores»: si nadie ha dicho cuántos niños viajan, el permiso no se pide todavía —
 * lo que falta es el número de niños, que es de su propia barra. Así la barra no cambia
 * de tamaño por adivinar, y la pregunta que sale primero es la de la fuente.
 *
 * ⚠️ Una condición mal escrita NO esconde el campo: se cuenta como si aplicara y se
 * reporta en `errores`. Ante la duda se pregunta; esconder un dato por un error de config
 * es la forma en que un campo deja de pedirse sin que nadie lo note.
 *
 * Qué pasa cuando el mínimo está incompleto NO se decide aquí: por defecto es un aviso, y
 * si la etapa declara el gate `solicitud_minimo` en `config_extra.gates` frena el avance
 * con el mismo mecanismo (y el mismo «omitir con motivo») que los demás gates de etapa.
 */

import { campoRequeridoCumplido, campoVisible, type CampoConfig } from './campo-completo'
import { valorCumpleCondicion } from './condicion-bloque'
import { parsearNumeroColombiano } from './numero-colombiano'

export type NivelCampo = 'minimo' | 'deseable'

export const NIVELES: readonly NivelCampo[] = ['minimo', 'deseable']

export interface CondicionPedirSi {
  field?: string
  suma_de?: string[]
  value?: string
  value_in?: unknown[]
  distinto_de?: unknown[]
  al_menos?: number
  mayor_que?: number
  vacio?: boolean
}

export type PedirSi = CondicionPedirSi | CondicionPedirSi[]

/** Lo que este módulo lee de un `config_extra.fields[i]`. */
export interface CampoConNivel extends CampoConfig {
  nivel?: unknown
  pedir_si?: unknown
  pregunta?: unknown
  default?: unknown
}

export interface Faltante {
  slug: string
  /** La pregunta de conversación, o el `label` si el campo no la declara. */
  pregunta: string
  label: string
}

export interface Barra {
  completos: number
  total: number
  /** En el orden de la configuración. */
  faltan: Faltante[]
}

export interface NivelesSolicitud {
  minimo: Barra
  deseable: Barra
  /** Problemas de configuración, legibles. Vacío si todo está bien escrito. */
  errores: string[]
}

const COMPARACIONES = ['value', 'value_in', 'distinto_de', 'al_menos', 'mayor_que', 'vacio'] as const
const LLAVES_CONDICION = new Set<string>(['field', 'suma_de', ...COMPARACIONES])

const vacio = (v: unknown) => v === '' || v === null || v === undefined

/**
 * Valida y normaliza un `pedir_si`. Devuelve la lista de condiciones (vacía = sin
 * condición) o el motivo por el que no se puede leer.
 */
export function leerPedirSi(raw: unknown): { condiciones: CondicionPedirSi[] } | { error: string } {
  if (raw === undefined || raw === null) return { condiciones: [] }
  const lista = Array.isArray(raw) ? raw : [raw]
  if (lista.length === 0) return { error: 'es una lista vacía' }

  const condiciones: CondicionPedirSi[] = []
  for (const c of lista) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) return { error: 'cada condición tiene que ser un objeto' }
    const o = c as Record<string, unknown>
    const ajenas = Object.keys(o).filter(k => !LLAVES_CONDICION.has(k))
    if (ajenas.length > 0) return { error: `llave desconocida: ${ajenas.join(', ')}` }

    const tieneField = typeof o.field === 'string' && o.field.trim() !== ''
    const tieneSuma = Array.isArray(o.suma_de) && o.suma_de.length > 0 && o.suma_de.every(s => typeof s === 'string' && s !== '')
    if (tieneField === tieneSuma) return { error: 'cada condición lleva `field` o `suma_de`, uno solo' }
    if (o.field !== undefined && !tieneField) return { error: '`field` tiene que ser un texto' }
    if (o.suma_de !== undefined && !tieneSuma) return { error: '`suma_de` tiene que ser una lista de slugs' }

    if (!COMPARACIONES.some(k => o[k] !== undefined)) {
      return { error: 'falta la comparación (value, value_in, distinto_de, al_menos, mayor_que o vacio)' }
    }
    if (o.vacio !== undefined) {
      if (typeof o.vacio !== 'boolean') return { error: '`vacio` tiene que ser true o false' }
      if (COMPARACIONES.some(k => k !== 'vacio' && o[k] !== undefined)) {
        return { error: '`vacio` va solo, sin otra comparación' }
      }
    }
    if (o.value !== undefined && typeof o.value !== 'string') return { error: '`value` tiene que ser un texto' }
    for (const k of ['value_in', 'distinto_de'] as const) {
      if (o[k] !== undefined && !Array.isArray(o[k])) return { error: `\`${k}\` tiene que ser una lista` }
    }
    for (const k of ['al_menos', 'mayor_que'] as const) {
      if (o[k] !== undefined && (typeof o[k] !== 'number' || !Number.isFinite(o[k]))) {
        return { error: `\`${k}\` tiene que ser un número` }
      }
    }
    // Una suma solo se compara con números: «value» sobre una suma no significa nada.
    if (tieneSuma && (o.value !== undefined || o.value_in !== undefined || o.distinto_de !== undefined)) {
      return { error: '`suma_de` solo se compara con al_menos o mayor_que' }
    }
    condiciones.push(o as CondicionPedirSi)
  }
  return { condiciones }
}

/** ¿Se cumple UNA condición con estos valores? Un dato ausente no la cumple, salvo `vacio`. */
function cumpleUna(c: CondicionPedirSi, valores: Record<string, unknown>): boolean {
  if (c.vacio !== undefined) {
    const ausente = c.suma_de
      ? c.suma_de.every(s => parsearNumeroColombiano(valores[s]) === null)
      : vacio(valores[c.field as string])
    return c.vacio ? ausente : !ausente
  }
  let numero: number | null
  let crudo: unknown = undefined
  if (c.suma_de) {
    const partes = c.suma_de.map(s => parsearNumeroColombiano(valores[s]))
    if (partes.every(n => n === null)) return false
    numero = partes.reduce<number>((a, n) => a + (n ?? 0), 0)
  } else {
    crudo = valores[c.field as string]
    if (vacio(crudo)) return false
    numero = parsearNumeroColombiano(crudo)
  }

  if (c.value !== undefined && !valorCumpleCondicion(crudo, { value: c.value })) return false
  if (c.value_in !== undefined && !valorCumpleCondicion(crudo, { value_in: c.value_in })) return false
  if (c.distinto_de !== undefined && valorCumpleCondicion(crudo, { value_in: c.distinto_de })) return false
  if (c.al_menos !== undefined && (numero === null || numero < c.al_menos)) return false
  if (c.mayor_que !== undefined && (numero === null || numero <= c.mayor_que)) return false
  return true
}

/** ¿Algún campo de esta lista declara un nivel? Si ninguno, la pantalla no pinta barras. */
export function declaraNiveles(fields: ReadonlyArray<{ nivel?: unknown }> | null | undefined): boolean {
  return (fields ?? []).some(f => f.nivel !== undefined && f.nivel !== null)
}

/**
 * Las dos barras de una solicitud.
 *
 * @param fields  los `config_extra.fields` (de uno o varios bloques `datos`, ya en orden).
 * @param valores los datos guardados, por slug de campo (`negocio_bloques.data`).
 *
 * Un campo cuenta si declara `nivel`, está visible (`showIf`) y su `pedir_si` se cumple.
 * Está completo con la MISMA regla que usa un campo obligatorio (`campoRequeridoCumplido`:
 * respeta `no_cero` y exige verdadero en una confirmación). Si el campo no tiene valor y
 * declara `default`, cuenta el default: es lo que la pantalla muestra escrito.
 */
export function calcularNiveles(
  fields: ReadonlyArray<CampoConNivel> | null | undefined,
  valores: Record<string, unknown>,
): NivelesSolicitud {
  const res: NivelesSolicitud = {
    minimo: { completos: 0, total: 0, faltan: [] },
    deseable: { completos: 0, total: 0, faltan: [] },
    errores: [],
  }
  const lista = fields ?? []

  // Los defaults cuentan como escritos, igual que en la pantalla.
  const efectivos: Record<string, unknown> = { ...valores }
  for (const f of lista) {
    if (vacio(efectivos[f.slug]) && f.default !== undefined) efectivos[f.slug] = f.default
  }

  for (const f of lista) {
    if (f.nivel === undefined || f.nivel === null) continue
    if (!NIVELES.includes(f.nivel as NivelCampo)) {
      res.errores.push(`${f.slug}: nivel «${String(f.nivel)}» no existe (minimo o deseable)`)
      continue
    }
    if (!campoVisible(f, efectivos)) continue

    const pedir = leerPedirSi(f.pedir_si)
    if ('error' in pedir) {
      res.errores.push(`${f.slug}: pedir_si ${pedir.error}`)
    } else if (!pedir.condiciones.every(c => cumpleUna(c, efectivos))) {
      continue
    }

    const barra = res[f.nivel as NivelCampo]
    barra.total++
    if (campoRequeridoCumplido(f, efectivos[f.slug])) {
      barra.completos++
    } else {
      const label = f.label ?? f.slug
      const pregunta = typeof f.pregunta === 'string' && f.pregunta.trim() !== '' ? f.pregunta.trim() : label
      barra.faltan.push({ slug: f.slug, pregunta, label })
    }
  }
  return res
}

/**
 * Los campos y los valores de varios bloques `datos` como si fueran uno: los campos en el
 * orden de los bloques, los valores aplanados por slug (así los leen ya `viaje-negocio.ts`
 * y el gate `campos_alguno`). Un slug repetido en dos bloques se queda con el primero.
 */
export function aplanarBloques(
  bloques: ReadonlyArray<{ fields: unknown; data: unknown }>,
): { fields: CampoConNivel[]; valores: Record<string, unknown> } {
  const fields: CampoConNivel[] = []
  const vistos = new Set<string>()
  const valores: Record<string, unknown> = {}
  for (const b of bloques) {
    for (const f of (Array.isArray(b.fields) ? b.fields : []) as CampoConNivel[]) {
      if (!f || typeof f.slug !== 'string' || vistos.has(f.slug)) continue
      vistos.add(f.slug)
      fields.push(f)
    }
    if (b.data && typeof b.data === 'object') {
      for (const [k, v] of Object.entries(b.data as Record<string, unknown>)) {
        if (!(k in valores) || vacio(valores[k])) valores[k] = v
      }
    }
  }
  return { fields, valores }
}

/** El texto del gate `solicitud_minimo` cuando frena el avance. */
export function mensajeMinimoIncompleto(barra: Barra, mensajeConfig?: string): string {
  if (mensajeConfig && mensajeConfig.trim() !== '') return mensajeConfig
  const preguntas = barra.faltan.map(f => f.pregunta).join(' · ')
  return `Falta el mínimo para cotizar (${barra.completos} de ${barra.total}): ${preguntas}`
}
