/**
 * El bolsillo de datos con el que el motor decide, leído de la base para UN negocio.
 *
 * Arma el mapa de campos de una etapa fuente, DESCARTANDO los bloques que no le aplican
 * al caso (su `condition` no se cumple) y los `desactivado: true`. Lo usan TRES sitios
 * que tienen que ver exactamente el mismo mapa:
 *  - el avance de etapa (`cambiarEtapaNegocioConGate`),
 *  - el salto encadenado por saldo, que también resuelve routing,
 *  - el retorno de un reproceso (`reproceso-actions.ts`), que pregunta si el caso debía
 *    pasar por la etapa a la que vuelve.
 * Si uno leyera otro mapa, un reproceso podría devolver el caso a una rama que el propio
 * motor nunca le habría dado.
 *
 * Vivía dentro de `negocio-v2-actions.ts` (un archivo `'use server'`, donde exportarlo lo
 * volvería un endpoint alcanzable). Salió aquí para el tercer consumidor; el código no
 * cambió.
 *
 * La regla pura (qué se descarta, en qué orden, cómo se cachea) vive en
 * `campos-de-routing.ts` con sus pruebas. Aquí solo se leen los bloques y se conecta el
 * evaluador: `condicion_cumplida`, la MISMA función SQL que usan los gates y el render,
 * llamada con `p_etapa_actual_id = sourceEtapaId`.
 */

import { camposDeRouting, type BloqueParaRouting } from './campos-de-routing'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(client: unknown): any { return client }

export async function camposDeRoutingDelNegocio(
  supabase: unknown,
  negocioId: string,
  lineaId: string,
  sourceEtapaId: string,
): Promise<Record<string, unknown>> {
  const { data: bloquesDatos } = await db(supabase)
    .from('negocio_bloques')
    .select(`
      data,
      bloque_configs!inner(
        etapa_id,
        config_extra,
        bloque_definitions!inner(tipo)
      )
    `)
    .eq('negocio_id', negocioId)
    .eq('bloque_configs.etapa_id', sourceEtapaId)

  type FilaBloque = {
    data: unknown
    bloque_configs: {
      config_extra: Record<string, unknown> | null
      bloque_definitions: { tipo: string } | null
    } | null
  }

  const bloques: BloqueParaRouting[] = ((bloquesDatos ?? []) as FilaBloque[]).map(b => ({
    data: b.data,
    config_extra: b.bloque_configs?.config_extra ?? null,
    tipo: b.bloque_configs?.bloque_definitions?.tipo ?? null,
  }))

  return camposDeRouting(bloques, async condicion => {
    const { data: cumple } = await db(supabase).rpc('condicion_cumplida', {
      p_negocio_id: negocioId,
      p_linea_id: lineaId,
      p_etapa_actual_id: sourceEtapaId,
      p_cond: condicion,
    })
    return cumple === true
  })
}
