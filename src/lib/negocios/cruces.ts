/**
 * Cruces de la LÍNEA: dos datos del mismo negocio que tienen que decir lo mismo.
 *
 * ── Por qué existen ────────────────────────────────────────────────────────────────
 * En SOENA, seis casos llegaron a la DIAN con la factura a nombre de dos personas y el
 * certificado UPME a nombre de una (V0457 y los cinco de la auditoría del 2026-09-24).
 * Cada uno obliga a pedir otro certificado. Ningún control lo vio, por tres razones:
 * la factura no leía a los compradores, el segundo solicitante del certificado era
 * opcional, y los cruces que existían viven DENTRO de un documento y se calculan una
 * sola vez, al cargarlo. Si la titularidad se corrige después, nadie vuelve a mirar.
 *
 * Un cruce de línea es distinto: compara dos bloques cualesquiera y se evalúa CADA VEZ
 * que se lee el negocio (la tarjeta de datos clave) y cada vez que se intenta avanzar
 * (el gate). No se guarda: un veredicto congelado vuelve a quedar viejo en cuanto
 * alguien corrige cualquiera de los dos lados.
 *
 * ── Las reglas ─────────────────────────────────────────────────────────────────────
 * - Un lado que falta NO es una contradicción: un caso sin certificado todavía no
 *   contradice nada. El cruce calla hasta que los dos lados existen.
 * - Un lado cuyo bloque no le aplica al caso tampoco cuenta (el motor solo lee bloques
 *   que le aplican; un dato de una rama abandonada no decide nada).
 * - `bloquea_en_etapas` dice en qué etapas (por `orden`) el cruce FRENA el avance. En
 *   las demás solo avisa. Frenar siempre se puede omitir con el permiso de omitir gates
 *   y el motivo escrito: un control nuevo sin salida deja casos varados.
 *
 * Configuración: `lineas_negocio.config_extra.cruces` (lista). Sin la clave, nada cambia.
 */

import { esPersonaJuridica, parsearPersonas } from '@/lib/documentos/personas'
import {
  mismoDocumento,
  normalizarClave,
  valorDe,
  type ContextoFuentes,
} from './fuentes-negocio'

/** Un lado numérico: un campo con número, un valor traducido con `mapeo`, o un conteo. */
export interface LadoCantidad {
  source_bloque_slug: string
  /**
   * Otros bloques que traen los MISMOS campos, en orden de preferencia después del
   * principal (el certificado UPME vive en Certificación o en Anexos según la ruta).
   * Se usa el primero que le aplique al caso y tenga dato.
   */
  alternativas?: string[]
  field?: string
  /** Traduce el valor del campo a número: `{ "unico": 1, "copropiedad": 2 }`. */
  mapeo?: Record<string, number>
  /** Cuenta cuántos de estos campos traen valor. */
  contar_campos?: string[]
  /**
   * Cuenta PERSONAS por pares nombre/documento (las filas de beneficiarios de un
   * certificado). Una fila cuenta si trae nombre o documento.
   */
  contar_personas?: Array<{ nombre: string; documento?: string }>
  /**
   * Si esta condición se cumple (misma forma que `condition`), `contar_personas` cuenta
   * solo personas NATURALES: una razón social o un NIT de sociedad no es un titular.
   */
  solo_naturales_si?: Record<string, unknown>
  /** Unidad para el mensaje: `["comprador", "compradores"]` → «2 compradores». */
  unidad?: [string, string]
}

interface CruceBase {
  slug: string
  /**
   * Texto que ve el equipo. Marcadores: `{a}`, `{b}` (cantidad, con su unidad si la
   * declara), `{a_valor}`, `{b_valor}` (el valor crudo, con la etiqueta de su opción),
   * `{documento}`, `{lista}`.
   */
  mensaje: string
  /** El cruce solo se evalúa si esta condición se cumple (misma forma que `condition`). */
  condition?: Record<string, unknown>
  /** Etapas (por `orden`) en las que el cruce frena el avance. Vacío = solo avisa. */
  bloquea_en_etapas?: number[]
}

export interface CruceCantidad extends CruceBase {
  tipo: 'cantidad'
  a: LadoCantidad
  b: LadoCantidad
}

export interface CruceDocumentoEnLista extends CruceBase {
  tipo: 'documento_en_lista'
  /** El documento que tiene que aparecer (el del RUT). */
  documento: { source_bloque_slug: string; field: string }
  /** La lista de personas donde se busca (los compradores de la factura). */
  lista: { source_bloque_slug: string; field: string }
}

export type Cruce = CruceCantidad | CruceDocumentoEnLista

export interface Contradiccion {
  slug: string
  mensaje: string
  /** ¿Frena el avance en la etapa en la que está el negocio? */
  bloquea: boolean
}

function esLado(v: unknown): v is LadoCantidad {
  if (typeof v !== 'object' || v === null) return false
  const l = v as Record<string, unknown>
  if (typeof l.source_bloque_slug !== 'string' || !l.source_bloque_slug) return false
  return typeof l.field === 'string' || Array.isArray(l.contar_campos) || Array.isArray(l.contar_personas)
}

function esFuente(v: unknown): v is { source_bloque_slug: string; field: string } {
  if (typeof v !== 'object' || v === null) return false
  const f = v as Record<string, unknown>
  return typeof f.source_bloque_slug === 'string' && !!f.source_bloque_slug && typeof f.field === 'string' && !!f.field
}

function esCruce(v: unknown): v is Cruce {
  if (typeof v !== 'object' || v === null) return false
  const c = v as Record<string, unknown>
  if (typeof c.slug !== 'string' || !c.slug) return false
  if (typeof c.mensaje !== 'string' || !c.mensaje.trim()) return false
  if (c.tipo === 'cantidad') return esLado(c.a) && esLado(c.b)
  if (c.tipo === 'documento_en_lista') return esFuente(c.documento) && esFuente(c.lista)
  return false
}

/** Los cruces que declara la línea. Una entrada mal formada se ignora, no rompe la ficha. */
export function leerCruces(configExtraLinea: Record<string, unknown> | null | undefined): Cruce[] {
  const crudo = configExtraLinea?.cruces
  return Array.isArray(crudo) ? crudo.filter(esCruce) : []
}

/** Los slugs de bloque que hay que cargar para evaluar estos cruces. */
export function slugsDeCruces(cruces: Cruce[]): string[] {
  const s = new Set<string>()
  const cond = (c?: Record<string, unknown>) => {
    const slug = c?.source_bloque_slug
    if (typeof slug === 'string' && slug) s.add(slug)
  }
  for (const c of cruces) {
    cond(c.condition)
    if (c.tipo === 'cantidad') {
      for (const l of [c.a, c.b]) {
        s.add(l.source_bloque_slug)
        cond(l.solo_naturales_si)
        for (const alt of l.alternativas ?? []) s.add(alt)
      }
    } else {
      s.add(c.documento.source_bloque_slug)
      s.add(c.lista.source_bloque_slug)
    }
  }
  return [...s]
}

type LadoResuelto = { n: number; valor: string }

/** El número de un lado, o `null` si falta el dato o su bloque no le aplica al caso. */
async function resolverLado(lado: LadoCantidad, ctx: ContextoFuentes): Promise<LadoResuelto | null> {
  for (const slug of [lado.source_bloque_slug, ...(lado.alternativas ?? [])]) {
    if (!ctx.porSlug[slug]) continue
    if (!(await ctx.aplica(slug))) continue

    if (lado.contar_personas && lado.contar_personas.length > 0) {
      const filas = lado.contar_personas
        .map(f => ({
          nombre: valorDe(ctx, slug, f.nombre),
          documento: f.documento ? valorDe(ctx, slug, f.documento) : undefined,
        }))
        .filter(p => p.nombre !== undefined || p.documento !== undefined)
      // Un documento sin ninguna fila todavía no dice cuántas personas trae.
      if (filas.length === 0) continue
      const soloNaturales = lado.solo_naturales_si ? await ctx.evaluar(lado.solo_naturales_si) : false
      const n = soloNaturales ? filas.filter(p => !esPersonaJuridica(p)).length : filas.length
      return { n, valor: String(n) }
    }
    if (lado.contar_campos && lado.contar_campos.length > 0) {
      const n = lado.contar_campos.filter(f => valorDe(ctx, slug, f) !== undefined).length
      // Un documento sin ninguno de los campos todavía no dice cuántas personas trae.
      if (n === 0) continue
      return { n, valor: String(n) }
    }
    if (!lado.field) continue
    const crudo = valorDe(ctx, slug, lado.field)
    if (crudo === undefined) continue
    const valor = ctx.etiqueta(slug, lado.field, crudo) ?? String(crudo)
    if (lado.mapeo) {
      const clave = normalizarClave(crudo)
      const entrada = Object.entries(lado.mapeo).find(([k]) => normalizarClave(k) === clave)
      // Un valor sin traducción (p. ej. `leasing`) no se compara: no hay número que esperar.
      if (!entrada) return null
      return { n: entrada[1], valor }
    }
    const n = Number(String(crudo).replace(/[^\d.-]/g, ''))
    if (!Number.isFinite(n)) return null
    return { n, valor }
  }
  return null
}

function conUnidad(n: number, unidad?: [string, string]): string {
  if (!unidad) return String(n)
  return `${n} ${n === 1 ? unidad[0] : unidad[1]}`
}

function redactar(plantilla: string, valores: Record<string, string>): string {
  return plantilla.replace(/\{(\w+)\}/g, (m, k: string) => (k in valores ? valores[k] : m))
}

/**
 * Las contradicciones vigentes de un negocio. Una lista vacía no dice que todo esté
 * bien: dice que ningún par de datos presentes se contradice.
 */
export async function evaluarCruces(
  cruces: Cruce[],
  ctx: ContextoFuentes,
  etapaOrden: number | null,
): Promise<Contradiccion[]> {
  const out: Contradiccion[] = []
  for (const c of cruces) {
    if (c.condition && !(await ctx.evaluar(c.condition))) continue
    const bloquea = etapaOrden !== null && (c.bloquea_en_etapas ?? []).includes(etapaOrden)

    if (c.tipo === 'cantidad') {
      const [a, b] = await Promise.all([resolverLado(c.a, ctx), resolverLado(c.b, ctx)])
      if (!a || !b || a.n === b.n) continue
      out.push({
        slug: c.slug,
        bloquea,
        mensaje: redactar(c.mensaje, {
          a: conUnidad(a.n, c.a.unidad),
          b: conUnidad(b.n, c.b.unidad),
          a_valor: a.valor,
          b_valor: b.valor,
        }),
      })
      continue
    }

    const { documento, lista } = c
    if (!ctx.porSlug[documento.source_bloque_slug] || !ctx.porSlug[lista.source_bloque_slug]) continue
    if (!(await ctx.aplica(documento.source_bloque_slug)) || !(await ctx.aplica(lista.source_bloque_slug))) continue
    const doc = valorDe(ctx, documento.source_bloque_slug, documento.field)
    const personas = parsearPersonas(valorDe(ctx, lista.source_bloque_slug, lista.field))
    // Sin documento o sin lista no hay nada que comparar. Una lista donde ninguna
    // persona trae documento tampoco: no se puede afirmar que el RUT no esté.
    if (doc === undefined || personas.length === 0 || personas.every(p => !p.documento)) continue
    if (personas.some(p => mismoDocumento(p.documento, doc))) continue
    out.push({
      slug: c.slug,
      bloquea,
      mensaje: redactar(c.mensaje, {
        documento: String(doc).replace(/\D/g, ''),
        lista: personas.map(p => (p.documento ? `${p.nombre} (${p.documento})` : p.nombre)).join('; '),
      }),
    })
  }
  return out
}
