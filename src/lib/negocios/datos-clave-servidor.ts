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

import { contextoFuentesDelNegocio } from './fuentes-negocio-servidor'
import { evaluarCruces, leerCruces, slugsDeCruces, type Contradiccion, type Cruce } from './cruces'
import {
  leerConfigDatosClave,
  resolverDatosClave,
  slugsDeDatosClave,
  type ConfigDatosClave,
  type VistaDatosClave,
} from './datos-clave'
import type { ContextoFuentes } from './fuentes-negocio'

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
async function precalentar(ctx: ContextoFuentes, config: ConfigDatosClave | null, cruces: Cruce[]) {
  const slugs = new Set<string>([...slugsDeCruces(cruces), ...(config ? slugsDeDatosClave(config) : [])])
  const condiciones: Record<string, unknown>[] = []
  for (const c of cruces) if (c.condition) condiciones.push(c.condition)
  for (const campo of config?.campos ?? []) {
    for (const f of [campo, ...(campo.alternativas ?? []), ...(campo.detalle ?? [])]) {
      if (f.condition) condiciones.push(f.condition)
    }
  }
  await Promise.all([...[...slugs].map(s => ctx.aplica(s)), ...condiciones.map(c => ctx.evaluar(c))])
}

async function contexto(supabase: unknown, args: Args, config: ConfigDatosClave | null, cruces: Cruce[]) {
  const slugs = [...new Set([...slugsDeCruces(cruces), ...(config ? slugsDeDatosClave(config) : [])])]
  const ctx = await contextoFuentesDelNegocio(supabase, {
    negocioId: args.negocioId,
    lineaId: args.lineaId,
    etapaActualId: args.etapaActualId,
    slugs,
  })
  await precalentar(ctx, config, cruces)
  return ctx
}

/** La tarjeta de la ficha, o `null` si la línea no declara tarjeta ni cruces. */
export async function datosClaveDelNegocio(supabase: unknown, args: Args): Promise<VistaDatosClave | null> {
  const config = leerConfigDatosClave(args.configLinea)
  const cruces = leerCruces(args.configLinea)
  if (!config && cruces.length === 0) return null
  const ctx = await contexto(supabase, args, config, cruces)
  const contradicciones = await evaluarCruces(cruces, ctx, args.etapaOrden)
  if (config) return resolverDatosClave(config, ctx, contradicciones)
  // Sin tarjeta declarada, las contradicciones igual se muestran: son lo importante.
  return contradicciones.length > 0 ? { titulo: 'Datos clave', campos: [], contradicciones } : null
}

/**
 * Las contradicciones que FRENAN el avance en la etapa actual. Vacío si ningún cruce
 * bloquea en esta etapa, sin tocar la base: la gran mayoría de los avances no paga
 * ninguna consulta por esto.
 */
export async function contradiccionesQueBloquean(supabase: unknown, args: Args): Promise<Contradiccion[]> {
  if (args.etapaOrden === null) return []
  const orden = args.etapaOrden
  const cruces = leerCruces(args.configLinea).filter(c => (c.bloquea_en_etapas ?? []).includes(orden))
  if (cruces.length === 0) return []
  const ctx = await contexto(supabase, args, null, cruces)
  return (await evaluarCruces(cruces, ctx, orden)).filter(c => c.bloquea)
}
