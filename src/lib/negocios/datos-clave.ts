/**
 * Tarjeta «Datos clave» del negocio: los pocos datos que cambian el trámite, visibles en
 * TODAS las etapas, para todos los roles, en solo lectura.
 *
 * ── Por qué existe ─────────────────────────────────────────────────────────────────
 * En SOENA la titularidad y el servicio contratado se responden en Propuesta y no se
 * vuelven a ver. En Cargue, donde operaciones sube los solicitantes a la UPME, no
 * aparecen, y la única pista de una copropiedad era que el bloque del segundo RUT
 * estuviera o no. Así salieron certificados a nombre de una sola persona para vehículos
 * de dos. Un dato que decide el trámite tiene que estar a la vista donde se trabaja.
 *
 * ── Las reglas ─────────────────────────────────────────────────────────────────────
 * - Es genérica y la declara la LÍNEA (`config_extra.datos_clave`): una lista de campos,
 *   cada uno con `label`, `source_bloque_slug`, `field` y un formato opcional. Nada de un
 *   cliente escrito aquí.
 * - Un campo vacío NO se oculta: sale «Sin definir» en ámbar. Un dato que falta es justo
 *   lo que hay que ver. Solo cambia a «No aplica» cuando NINGUNA de sus fuentes le aplica
 *   al caso (su `condition` no se cumple), porque ahí no hay nada que conseguir.
 * - Cada fuente puede exigir una condición propia para contar (la tarifa confirmada solo
 *   vale con el visto bueno de «confirmo») y traer una nota que acompaña al valor cuando
 *   sale de ella («cotizada»).
 * - El valor se lee por el slug del bloque origen con el mismo resolvedor que `condition`
 *   y `cross_check`; ver `fuentes-negocio.ts`.
 */

import { formatCOP } from '@/lib/cobros/format'
import { formatBogotaFechaCortaAno, formatBogotaFechaHora } from '@/lib/dates/bogota'
import { parsearPersonas } from '@/lib/documentos/personas'
import { valorDe, type ContextoFuentes } from './fuentes-negocio'
import type { Contradiccion } from './cruces'

export type FormatoDatoClave = 'texto' | 'moneda' | 'fecha' | 'fecha_hora' | 'personas'

export interface FuenteDatoClave {
  source_bloque_slug: string
  field: string
  /** La fuente solo cuenta si esta condición se cumple (misma forma que `condition`). */
  condition?: Record<string, unknown>
  /** Nota que acompaña al valor cuando sale de esta fuente, p. ej. «cotizada». */
  nota?: string
  formato?: FormatoDatoClave
  /** Texto por valor crudo. Gana sobre las opciones que declara el campo en su bloque. */
  etiquetas?: Record<string, string>
  /**
   * Solo para `detalle`: pintar la línea aunque el bloque no le aplique al caso. Hace
   * falta cuando otro bloque escribe en este (`compartido_con_origen`): la fecha de la
   * cita la llena la vía que la asignó, que no siempre es la del bloque origen.
   */
  mostrar_aunque_no_aplique?: boolean
}

export interface CampoDatoClave extends FuenteDatoClave {
  label: string
  /** Fuentes a probar, en orden, si la principal no trae valor. */
  alternativas?: FuenteDatoClave[]
  /** Líneas debajo del valor (los nombres de los titulares, la fecha de la cita). */
  detalle?: FuenteDatoClave[]
}

export interface ConfigDatosClave {
  titulo?: string
  campos: CampoDatoClave[]
}

export type ValorDatoClave =
  | { estado: 'ok'; texto: string; nota: string | null }
  | { estado: 'sin_definir' }
  | { estado: 'no_aplica' }

export interface CampoDatoClaveVista {
  label: string
  valor: ValorDatoClave
  detalle: string[]
}

export interface VistaDatosClave {
  titulo: string
  campos: CampoDatoClaveVista[]
  /** Contradicciones vigentes entre datos del negocio (los cruces de la línea). */
  contradicciones: Contradiccion[]
}

function esFuente(v: unknown): v is FuenteDatoClave {
  if (typeof v !== 'object' || v === null) return false
  const f = v as Record<string, unknown>
  return typeof f.source_bloque_slug === 'string' && !!f.source_bloque_slug && typeof f.field === 'string' && !!f.field
}

function esCampo(v: unknown): v is CampoDatoClave {
  if (!esFuente(v)) return false
  const label = (v as unknown as { label?: unknown }).label
  return typeof label === 'string' && label.trim().length > 0
}

/** La configuración de la tarjeta, o `null` si la línea no la declara. */
export function leerConfigDatosClave(
  configExtraLinea: Record<string, unknown> | null | undefined,
): ConfigDatosClave | null {
  const crudo = configExtraLinea?.datos_clave as { titulo?: unknown; campos?: unknown } | undefined
  if (!crudo || !Array.isArray(crudo.campos)) return null
  const campos = crudo.campos.filter(esCampo).map(c => ({
    ...c,
    alternativas: (c.alternativas ?? []).filter(esFuente),
    detalle: (c.detalle ?? []).filter(esFuente),
  }))
  if (campos.length === 0) return null
  return { titulo: typeof crudo.titulo === 'string' && crudo.titulo.trim() ? crudo.titulo : undefined, campos }
}

/** Los slugs de bloque que hay que cargar para pintar la tarjeta. */
export function slugsDeDatosClave(config: ConfigDatosClave): string[] {
  const s = new Set<string>()
  const agregar = (f: FuenteDatoClave) => {
    s.add(f.source_bloque_slug)
    const cond = f.condition?.source_bloque_slug
    if (typeof cond === 'string' && cond) s.add(cond)
  }
  for (const c of config.campos) {
    agregar(c)
    for (const a of c.alternativas ?? []) agregar(a)
    for (const d of c.detalle ?? []) agregar(d)
  }
  return [...s]
}

/** El texto de un valor crudo según el formato y las etiquetas de su fuente. */
function formatearValor(
  crudo: unknown,
  fuente: FuenteDatoClave,
  ctx: Pick<ContextoFuentes, 'etiqueta'>,
): string {
  const clave = String(crudo)
  if (fuente.etiquetas && clave in fuente.etiquetas) return fuente.etiquetas[clave]
  switch (fuente.formato) {
    case 'moneda': {
      const n = Number(String(crudo).replace(/[^\d.-]/g, ''))
      return Number.isFinite(n) ? formatCOP(n) : clave
    }
    case 'fecha':
      return formatBogotaFechaCortaAno(clave) ?? clave
    case 'fecha_hora':
      return formatBogotaFechaHora(clave) ?? clave
    case 'personas': {
      const personas = parsearPersonas(crudo)
      return personas.length > 0 ? personas.map(p => p.nombre || p.documento).join(' y ') : clave
    }
  }
  const opcion = ctx.etiqueta(fuente.source_bloque_slug, fuente.field, crudo)
  if (opcion) return opcion
  if (crudo === true) return 'Sí'
  if (crudo === false) return 'No'
  return clave
}

type Lectura = { texto: string; nota: string | null } | { ausente: true; aplica: boolean }

async function leerFuente(f: FuenteDatoClave, ctx: ContextoFuentes): Promise<Lectura> {
  const aplica = await ctx.aplica(f.source_bloque_slug)
  const crudo = valorDe(ctx, f.source_bloque_slug, f.field)
  if (crudo === undefined) return { ausente: true, aplica }
  // Un dato GUARDADO se muestra aunque su bloque ya no aplique: la tarjeta no esconde lo
  // que existe. Lo que no aplica solo decide entre «Sin definir» y «No aplica» cuando no
  // hay nada que mostrar.
  if (f.condition && !(await ctx.evaluar(f.condition))) return { ausente: true, aplica }
  return { texto: formatearValor(crudo, f, ctx), nota: f.nota ?? null }
}

/** La tarjeta resuelta contra los datos de HOY del negocio. */
export async function resolverDatosClave(
  config: ConfigDatosClave,
  ctx: ContextoFuentes,
  contradicciones: Contradiccion[] = [],
): Promise<VistaDatosClave> {
  const campos: CampoDatoClaveVista[] = []
  for (const campo of config.campos) {
    let valor: ValorDatoClave | null = null
    let algunaAplica = false
    for (const fuente of [campo, ...(campo.alternativas ?? [])]) {
      const l = await leerFuente(fuente, ctx)
      if ('texto' in l) {
        valor = { estado: 'ok', texto: l.texto, nota: l.nota }
        break
      }
      if (l.aplica) algunaAplica = true
    }
    if (!valor) valor = algunaAplica ? { estado: 'sin_definir' } : { estado: 'no_aplica' }

    // El detalle acompaña a un valor; sobre «Sin definir» o «No aplica» sería ruido.
    // Y a diferencia del valor, una línea de detalle SÍ exige que su bloque aplique: el
    // RUT del segundo titular de una copropiedad que se corrigió a «único» no es un
    // titular, y ponerlo debajo contradiría el valor que acompaña.
    const detalle: string[] = []
    if (valor.estado === 'ok') {
      for (const d of campo.detalle ?? []) {
        const l = await leerFuente(d, ctx)
        if ('texto' in l && (d.mostrar_aunque_no_aplique || (await ctx.aplica(d.source_bloque_slug)))) {
          detalle.push(l.nota ? `${l.texto} · ${l.nota}` : l.texto)
        }
      }
    }
    campos.push({ label: campo.label, valor, detalle })
  }
  return { titulo: config.titulo ?? 'Datos clave', campos, contradicciones }
}
