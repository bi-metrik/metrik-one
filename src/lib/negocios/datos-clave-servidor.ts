/**
 * Conecta la tarjeta de datos clave y los cruces de la línea con la base.
 *
 * Dos consumidores, un solo camino de lectura (`contextoFuentesDelNegocio`):
 *  - la ficha del negocio pinta la tarjeta con las contradicciones en rojo;
 *  - el avance de etapa frena si alguna contradicción bloquea en la etapa actual.
 * Si leyeran por caminos distintos, la tarjeta podría mostrar en rojo algo que el gate
 * deja pasar, o frenar por algo que la tarjeta no muestra.
 *
 * No es un archivo `'use server'`: exportar esto desde uno lo volvería un endpoint.
 */

import { createHash } from 'node:crypto'
import { contextoFuentesDelNegocio } from './fuentes-negocio-servidor'
import { aplicarAvances, type AvanceCruce } from './cruces-avance'
import { evaluarCruces, leerCruces, slugsDeCruces, type Contradiccion, type Cruce } from './cruces'
import {
  leerConfigDatosClave,
  resolverDatosClave,
  resumirReprocesos,
  slugsDeDatosClave,
  type ConfigDatosClave,
  type ReprocesoResumen,
  type VistaDatosClave,
} from './datos-clave'
import type { ContextoFuentes } from './fuentes-negocio'
import { evaluarVotos, leerVotos, slugsDeVotos, votoEnDisputa, type ResultadoVoto, type Voto } from './votos'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(client: unknown): any { return client }

type Args = {
  negocioId: string
  lineaId: string
  etapaActualId: string | null
  /** `orden` de la etapa actual: decide qué cruces frenan aquí. */
  etapaOrden: number | null
  configLinea: Record<string, unknown> | null
}

/**
 * Resuelve de una vez, en paralelo, todo lo que la evaluación va a preguntar: si cada
 * bloque aplica y cada condición declarada. Sin esto, cada `await` de la evaluación sería
 * una ida y vuelta a la base en fila (~60-150 ms cada una en producción).
 */
async function precalentar(ctx: ContextoFuentes, config: ConfigDatosClave | null, cruces: Cruce[], votos: Voto[]) {
  const slugs = new Set<string>([...slugsDeCruces(cruces), ...slugsDeVotos(votos), ...(config ? slugsDeDatosClave(config) : [])])
  const condiciones: Record<string, unknown>[] = []
  for (const c of cruces) if (c.condition) condiciones.push(c.condition)
  for (const v of votos) if (v.condition) condiciones.push(v.condition)
  for (const campo of config?.campos ?? []) {
    for (const f of [campo, ...(campo.alternativas ?? []), ...(campo.detalle ?? [])]) {
      if (f.condition) condiciones.push(f.condition)
    }
  }
  await Promise.all([...[...slugs].map(s => ctx.aplica(s)), ...condiciones.map(c => ctx.evaluar(c))])
}

async function contexto(supabase: unknown, args: Args, config: ConfigDatosClave | null, cruces: Cruce[], votos: Voto[] = []) {
  const slugs = [...new Set([...slugsDeCruces(cruces), ...slugsDeVotos(votos), ...(config ? slugsDeDatosClave(config) : [])])]
  const ctx = await contextoFuentesDelNegocio(supabase, {
    negocioId: args.negocioId,
    lineaId: args.lineaId,
    etapaActualId: args.etapaActualId,
    slugs,
  })
  await precalentar(ctx, config, cruces, votos)
  return ctx
}

/** Los reprocesos del caso, cerrados incluidos. Un fallo de lectura no tumba la ficha. */
async function reprocesosDelNegocio(supabase: unknown, negocioId: string): Promise<ReprocesoResumen[]> {
  const { data, error } = await db(supabase)
    .from('reproceso_eventos')
    .select('ciclo, tipo, abierto_at, cerrado_at')
    .eq('negocio_id', negocioId)
  if (error) {
    console.error('[datos-clave] reproceso_eventos:', error)
    return []
  }
  return resumirReprocesos((data ?? []) as Array<{ ciclo: number; tipo: string; abierto_at: string; cerrado_at: string | null }>)
}

/**
 * La huella de una contradicción trae los datos del caso en claro (nombres, documentos).
 * Sale del evaluador convertida en hash: así viaja a la pantalla y así se guarda la
 * excepción, sin copiar datos del cliente a otra tabla.
 */
export function hashHuella(huella: string): string {
  return createHash('sha256').update(huella).digest('hex').slice(0, 32)
}

function conHuellaHash(cs: Contradiccion[]): Contradiccion[] {
  return cs.map(c => (c.huella ? { ...c, huella: hashHuella(c.huella) } : c))
}

/**
 * Las excepciones de cruces del negocio (`negocio_cruces_avanzados`). Un fallo de lectura
 * devuelve vacío: sin excepciones el cruce vuelve a frenar, que es el lado seguro.
 */
export async function avancesDelNegocio(supabase: unknown, negocioId: string): Promise<AvanceCruce[]> {
  const { data, error } = await db(supabase)
    .from('negocio_cruces_avanzados')
    .select('cruce_slug, huella, motivo, created_at, autor:staff!negocio_cruces_avanzados_autor_id_fkey(full_name)')
    .eq('negocio_id', negocioId)
  if (error) {
    console.error('[datos-clave] negocio_cruces_avanzados:', error)
    return []
  }
  return ((data ?? []) as Array<{
    cruce_slug: string; huella: string; motivo: string; created_at: string; autor: { full_name: string | null } | null
  }>).map(r => ({
    cruce_slug: r.cruce_slug,
    huella: r.huella,
    motivo: r.motivo,
    created_at: r.created_at,
    autor: r.autor?.full_name ?? null,
  }))
}

/** Un voto en disputa también es una contradicción: la que el gate frena y la tarjeta pinta. */
function contradiccionesDeVotos(votos: ResultadoVoto[]): Contradiccion[] {
  return votos
    .filter(v => votoEnDisputa(v) && v.mensaje)
    .map(v => ({ slug: `voto:${v.slug}`, mensaje: v.mensaje as string, bloquea: v.bloquea }))
}

/**
 * La tarjeta de la ficha, o `null` si no hay nada que mostrar. Los reprocesos del caso
 * entran en TODA línea, declare o no tarjeta: un reproceso cerrado no puede desaparecer
 * de la ficha solo porque la línea no configuró datos clave.
 */
export async function datosClaveDelNegocio(supabase: unknown, args: Args): Promise<VistaDatosClave | null> {
  const config = leerConfigDatosClave(args.configLinea)
  const cruces = leerCruces(args.configLinea)
  const votos = leerVotos(args.configLinea)
  const reprocesosP = reprocesosDelNegocio(supabase, args.negocioId)
  const avancesP = cruces.length > 0 ? avancesDelNegocio(supabase, args.negocioId) : Promise.resolve([])
  let contradicciones: Contradiccion[] = []
  let lecturas: ResultadoVoto[] = []
  let vista: VistaDatosClave | null = null
  if (config || cruces.length > 0 || votos.length > 0) {
    const ctx = await contexto(supabase, args, config, cruces, votos)
    const [deCruces, deVotos] = await Promise.all([
      evaluarCruces(cruces, ctx, args.etapaOrden),
      evaluarVotos(votos, ctx, args.etapaOrden),
    ])
    // Un cruce avanzado con motivo sigue a la vista, marcado: la diferencia no se corrigió.
    contradicciones = aplicarAvances(conHuellaHash(deCruces), await avancesP)
    lecturas = deVotos
    if (config) vista = await resolverDatosClave(config, ctx, contradicciones)
  }
  const reprocesos = await reprocesosP
  if (!vista) {
    // Sin tarjeta declarada, lo que haya que ver igual se muestra.
    const hayAlgo =
      contradicciones.length > 0 ||
      lecturas.some(l => votoEnDisputa(l) || (l.avisos ?? []).length > 0) ||
      reprocesos.length > 0
    if (!hayAlgo) return null
    vista = { titulo: 'Datos clave', campos: [], contradicciones }
  }
  return { ...vista, lecturas, reprocesos }
}

/**
 * Los votos en disputa que impiden generar formularios (declaración, relación de
 * facturas, 010, 1668, carta). Vacío si la línea no declara votos con `niega_generacion`,
 * sin tocar la base más que para leer la línea.
 */
export async function lecturasQueNieganGeneracion(supabase: unknown, args: Args): Promise<ResultadoVoto[]> {
  const votos = leerVotos(args.configLinea).filter(v => v.niega_generacion === true)
  if (votos.length === 0) return []
  const ctx = await contexto(supabase, args, null, [], votos)
  return (await evaluarVotos(votos, ctx, args.etapaOrden)).filter(v => v.niega_generacion)
}

/** Un voto concreto contra los datos de HOY (para corregir una lectura dudosa). */
export async function votoDelNegocio(supabase: unknown, args: Args, votoSlug: string): Promise<ResultadoVoto | null> {
  const voto = leerVotos(args.configLinea).find(v => v.slug === votoSlug)
  if (!voto) return null
  const ctx = await contexto(supabase, args, null, [], [voto])
  const [r] = await evaluarVotos([voto], ctx, args.etapaOrden)
  return r ?? null
}

/**
 * Las contradicciones que FRENAN el avance en la etapa actual. Vacío si ningún cruce
 * bloquea en esta etapa, sin tocar la base: la gran mayoría de los avances no paga
 * ninguna consulta por esto.
 *
 * Un cruce con una excepción vigente (mismo cruce, mismos datos: `cruces-avance.ts`) ya
 * no frena. Los cruces de línea vuelven con la huella en hash: es la llave con la que
 * `avanzarCrucesConMotivo` guarda la excepción.
 */
export async function contradiccionesQueBloquean(supabase: unknown, args: Args): Promise<Contradiccion[]> {
  if (args.etapaOrden === null) return []
  const orden = args.etapaOrden
  const cruces = leerCruces(args.configLinea).filter(c => (c.bloquea_en_etapas ?? []).includes(orden))
  const votos = leerVotos(args.configLinea).filter(v => (v.bloquea_en_etapas ?? []).includes(orden))
  if (cruces.length === 0 && votos.length === 0) return []
  const ctx = await contexto(supabase, args, null, cruces, votos)
  const [deCruces, deVotos, avances] = await Promise.all([
    evaluarCruces(cruces, ctx, orden),
    evaluarVotos(votos, ctx, orden),
    cruces.length > 0 ? avancesDelNegocio(supabase, args.negocioId) : Promise.resolve([] as AvanceCruce[]),
  ])
  const crucesQueFrenan = aplicarAvances(conHuellaHash(deCruces.filter(c => c.bloquea)), avances)
    .filter(c => !c.avanzado)
  return [...crucesQueFrenan, ...contradiccionesDeVotos(deVotos).filter(c => c.bloquea)]
}
