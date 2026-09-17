import 'server-only'

import { contextoCorreccion } from '@/lib/correcciones/registrar'
import { resolverDestino } from '@/lib/negocios/casilla-compartida'

/**
 * ¿Subir un archivo REEMPLAZA a uno ya guardado, en una etapa que el negocio ya superó?
 *
 * Es la diferencia entre cargar un documento y corregir el expediente. Tres situaciones,
 * y solo la tercera es una corrección:
 *
 *   1. El bloque es de la etapa que se está trabajando → trabajo normal de la etapa.
 *   2. El bloque está VACÍO aunque su etapa haya pasado → primera carga. Pasa con los
 *      bloques que se reactivan tarde (`bloque-reactivado.ts`) y con los que declaran
 *      `editable_siempre`: no hay nada que corregir, y exigir una causa ahí rompería
 *      justo el caso que esos mecanismos existen para resolver.
 *   3. El bloque ya TIENE archivo y su etapa quedó atrás → se está cambiando un
 *      documento que el expediente daba por bueno. Mismo trato que corregir un campo:
 *      opt-in del bloque (`corregir_campos_gerencial`), causa obligatoria y registro.
 *
 * ⚠️ `editable_siempre` queda fuera a propósito, incluso con archivo. Ese flag DECLARA
 * el bloque abierto siempre y desde todas partes — es el documento que aparece DESPUÉS
 * de que su etapa pasó, como la factura bajada de Siigo — así que volver a subirlo no es
 * corregir hacia atrás. Medido el 2026-09-17: 25 bloques lo declaran, todos en SOENA.
 *
 * `nombreAnterior` viaja para que la traza diga QUÉ archivo se sustituyó: «archivo:
 * factura-vieja.pdf → factura-correcta.pdf» se lee; «se reemplazó el archivo» no dice
 * nada seis meses después.
 *
 * El contexto se mide contra el bloque que el usuario tiene ABIERTO (la etapa donde él
 * está parado es la que decide si esto es corregir), pero el archivo se lee de la fila
 * CANÓNICA, que es donde vive cuando la casilla es compartida.
 */
export type ReemplazoHaciaAtras = {
  /** El archivo entrante sustituye a otro, en una etapa ya superada. */
  aplica: boolean
  /** El bloque declara `corregir_campos_gerencial`. Sin él no hay corrección posible. */
  permiteCorregir: boolean
  nombreAnterior: string | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(supabase: unknown): any {
  return supabase
}

const NO_APLICA: ReemplazoHaciaAtras = { aplica: false, permiteCorregir: false, nombreAnterior: null }

export async function esReemplazoHaciaAtras(
  supabase: unknown,
  negocioBloqueId: string,
): Promise<ReemplazoHaciaAtras> {
  const ctx = await contextoCorreccion(supabase, negocioBloqueId)
  if (!ctx?.esPostAvance) return NO_APLICA

  const { data: abierto } = await db(supabase)
    .from('negocio_bloques')
    .select('bloque_configs!inner(config_extra)')
    .eq('id', negocioBloqueId)
    .maybeSingle()
  const cfg = ((abierto?.bloque_configs as { config_extra?: Record<string, unknown> } | null)?.config_extra
    ?? {}) as { editable_siempre?: boolean }
  if (cfg.editable_siempre === true) return NO_APLICA

  const destino = await resolverDestino(supabase, negocioBloqueId)
  const { data: fila } = await db(supabase)
    .from('negocio_bloques')
    .select('data')
    .eq('id', destino.id)
    .maybeSingle()
  const data = ((fila?.data ?? {}) as Record<string, unknown>)
  if (!data.drive_url) return NO_APLICA

  return {
    aplica: true,
    permiteCorregir: ctx.permiteCorregir,
    nombreAnterior: typeof data.file_name === 'string' ? data.file_name : null,
  }
}
