/**
 * Las casillas (`negocio_bloques`) de una etapa a la que el negocio acaba de entrar, con la
 * herencia de lo que ya se llenó en etapas anteriores.
 *
 * Extraída TAL CUAL de `cambiarEtapaNegocio` (post-cotización F6, diseño técnico §6): el cron que
 * mueve un viaje a «En viaje» el día de salida no tiene sesión, y tiene que instanciar las mismas
 * casillas que el avance a mano. Una sola implementación para los dos; el cliente de base lo pone
 * quien llama (la sesión, o `service_role` en el cron, siempre filtrando por workspace).
 *
 * Idempotente: no vuelve a crear una casilla que el negocio ya tiene para esa etapa.
 */

import { computeFieldDefaults } from '@/lib/negocios/crear-negocio'
import { visiblePuedeNacerCompleto } from '@/lib/negocios/bloque-visible-completo'
import {
  fuenteDeHerencia,
  indicesDeHerencia,
  origenesPorSlugDe,
  type FilaDelNegocio,
  type FuenteHerencia,
} from '@/lib/negocios/herencia-casilla'

// El esquema de bloques no está entero en los tipos generados.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(supabase: unknown): any {
  return supabase
}

export async function instanciarBloquesDeEtapa(
  supabase: unknown,
  { negocioId, etapaId, workspaceId }: { negocioId: string; etapaId: string; workspaceId: string },
): Promise<void> {
  // Crear negocio_bloques para la nueva etapa si no existen
  // Solo heredar estado/data para bloques VISIBLE (editable siempre empieza pendiente)
  const { data: bloqueConfigs } = await db(supabase)
    .from('bloque_configs')
    .select('id, bloque_definition_id, estado, es_gate, nombre, config_extra, bloque_definitions(tipo)')
    .eq('etapa_id', etapaId)
    .eq('workspace_id', workspaceId)

  if (bloqueConfigs && (bloqueConfigs as Record<string, unknown>[]).length > 0) {
    const typedConfigs = bloqueConfigs as Array<{
      id: string
      bloque_definition_id: string
      estado: string
      es_gate: boolean | null
      nombre: string | null
      config_extra: Record<string, unknown> | null
      bloque_definitions: { tipo: string } | null
    }>
    const configIds = typedConfigs.map(b => b.id)

    const instanciasExistentes = await db(supabase)
      .from('negocio_bloques')
      .select('bloque_config_id')
      .eq('negocio_id', negocioId)
      .in('bloque_config_id', configIds)

    const existingIds = new Set(
      ((instanciasExistentes.data ?? []) as Record<string, unknown>[]).map(
        i => i.bloque_config_id as string
      )
    )

    // Filas completas del negocio (de cualquier etapa) con la config que las gobierna.
    // Solo las de ORIGEN alimentan la herencia: ver `herencia-casilla.ts`.
    const { data: completadosRaw } = await db(supabase)
      .from('negocio_bloques')
      .select('id, estado, data, completado_at, bloque_configs(bloque_definition_id, nombre, estado, slug, config_extra, bloque_definitions(tipo))')
      .eq('negocio_id', negocioId)
      .eq('estado', 'completo')

    const aFila = (c: Record<string, unknown>): FilaDelNegocio => {
      const cfg = (c.bloque_configs ?? {}) as Record<string, unknown>
      return {
        id: c.id as string,
        estado: c.estado as string,
        data: (c.data ?? null) as Record<string, unknown> | null,
        completado_at: (c.completado_at ?? null) as string | null,
        config: {
          bloque_definition_id: (cfg.bloque_definition_id ?? null) as string | null,
          nombre: (cfg.nombre ?? null) as string | null,
          estado: (cfg.estado ?? null) as string | null,
          slug: (cfg.slug ?? null) as string | null,
          config_extra: (cfg.config_extra ?? null) as Record<string, unknown> | null,
          tipo: ((cfg.bloque_definitions as Record<string, unknown> | null)?.tipo ?? null) as string | null,
        },
      }
    }
    const indices = indicesDeHerencia(((completadosRaw ?? []) as Record<string, unknown>[]).map(aFila))

    // Una copia de documento hereda el archivo de SU origen, que se busca por slug y en
    // cualquier estado (la factura que archiva Siigo queda `pendiente` con archivo).
    const slugsOrigenDocumento = [...new Set(
      typedConfigs
        .filter(bc => !existingIds.has(bc.id) && bc.estado === 'visible' && bc.bloque_definitions?.tipo === 'documento')
        .map(bc => (bc.config_extra as { source_bloque_slug?: unknown } | null)?.source_bloque_slug)
        .filter((x): x is string => typeof x === 'string' && x !== ''),
    )]
    let origenesPorSlug = new Map<string, FilaDelNegocio>()
    if (slugsOrigenDocumento.length > 0) {
      const { data: origenesRaw } = await db(supabase)
        .from('negocio_bloques')
        .select('id, estado, data, completado_at, bloque_configs!inner(bloque_definition_id, nombre, estado, slug, config_extra, bloque_definitions(tipo))')
        .eq('negocio_id', negocioId)
        .in('bloque_configs.slug', slugsOrigenDocumento)
      origenesPorSlug = origenesPorSlugDe(((origenesRaw ?? []) as Record<string, unknown>[]).map(aFila))
    }

    // De qué fila heredó cada casilla nueva. Los `bloque_items` se copian de esa misma
    // fila, nunca de otra con el mismo `definition_id`.
    const fuentePorConfig = new Map<string, FuenteHerencia>()

    const nuevas = typedConfigs
      .filter(bc => !existingIds.has(bc.id))
      .map(bc => {
        const isVisible = bc.estado === 'visible'
        const isDatos = bc.bloque_definitions?.tipo === 'datos'

        // Los bloques `datos` y `documento` COMPARTEN `bloque_definition_id`: su identidad
        // es el nombre (datos) o el label (documento). Heredar por definition_id copiaba
        // respuestas y archivos ajenos (321 instancias de datos en julio, 508 casillas de
        // documento en septiembre). Y una COPIA no puede ser fuente: una copia sucia se
        // perpetuaba en cada avance de etapa. Toda la regla vive en `fuenteDeHerencia`.
        const prevCompleto = fuenteDeHerencia(
          {
            bloque_definition_id: bc.bloque_definition_id,
            estado: bc.estado,
            nombre: bc.nombre,
            config_extra: bc.config_extra,
            tipo: bc.bloque_definitions?.tipo,
          },
          indices,
          origenesPorSlug,
        )
        if (prevCompleto) fuentePorConfig.set(bc.id, prevCompleto)

        // If no inherited data, initialize with field defaults from config
        const data = prevCompleto?.data
          ?? (isDatos ? computeFieldDefaults(bc.config_extra as Record<string, unknown> | null) : {})

        // Heredar el estado `completo` exige además que los campos `required` del bloque
        // DESTINO tengan valor: el origen puede declarar otros campos, y un gate no debe
        // darse por cumplido con una respuesta que su propia casilla no tiene.
        const heredaCompleto = !!prevCompleto
          && (!isVisible || visiblePuedeNacerCompleto(
                bc.config_extra as Record<string, unknown> | null,
                data,
                bc.es_gate === true,
              ))

        return {
          negocio_id: negocioId,
          bloque_config_id: bc.id,
          estado: heredaCompleto ? 'completo' : 'pendiente',
          data,
          completado_at: heredaCompleto ? (prevCompleto?.completado_at ?? new Date().toISOString()) : null,
        }
      })

    if (nuevas.length > 0) {
      const { data: insertadas } = await db(supabase)
        .from('negocio_bloques')
        .insert(nuevas)
        .select('id, bloque_config_id')

      // Copiar bloque_items para bloques visibles que heredaron de un bloque previo
      if (insertadas) {
        for (const inst of (insertadas as Array<{ id: string; bloque_config_id: string }>)) {
          const bc = typedConfigs.find(c => c.id === inst.bloque_config_id)
          if (!bc || bc.estado !== 'visible') continue
          const prev = fuentePorConfig.get(bc.id)
          if (!prev) continue

          // Copiar items del bloque fuente al nuevo bloque visible
          const { data: sourceItems } = await db(supabase)
            .from('bloque_items')
            .select('orden, label, tipo, contenido, completado, completado_por, completado_at, link_url, imagen_data')
            .eq('negocio_bloque_id', prev.id)

          if (sourceItems && (sourceItems as unknown[]).length > 0) {
            const copiedItems = (sourceItems as Record<string, unknown>[]).map(item => ({
              ...item,
              negocio_bloque_id: inst.id,
            }))
            await db(supabase).from('bloque_items').insert(copiedItems)
          }
        }
      }
    }
  }
}
