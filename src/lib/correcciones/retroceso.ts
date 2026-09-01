/**
 * Ejecución del retroceso financiero: persistir el aviso, proponer, mover.
 *
 * Las reglas viven en `src/lib/negocios/retroceso-financiero.ts` (puro, 15 pruebas).
 * Acá solo se resuelven contra la base.
 *
 * ── Por qué el aviso se PERSISTE ────────────────────────────────────────────
 *
 * Quien cambia la plata (el área financiera) casi nunca es quien decide mover el caso
 * (el comercial que lo lleva). Un aviso que se muestra y desaparece lo cierra quien
 * pasaba por ahí, y el caso sigue adelante con plata que ya no tiene — que es
 * exactamente el estado que esto viene a evitar. Vive en
 * `negocios.metadata.recaudo_cambiado_pendiente` y **reaparece cuando el comercial
 * intenta avanzar**, hasta que alguien lo resuelve.
 *
 * Mismo criterio que `reversa_ruta_pendiente`, y por la misma razón.
 */

import {
  proponerRetrocesoFinanciero,
  validarRetroceso,
  construirAviso,
  type CausaRetrocesoFinanciero,
  type EtapaCandidata,
  type AvisoRecaudoCambiado,
} from '@/lib/negocios/retroceso-financiero'
import { registrarActividad } from '@/lib/activity/registrar-actividad'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(client: unknown): any {
  return client
}

export const CLAVE_AVISO = 'recaudo_cambiado_pendiente'

/**
 * Las etapas por las que el caso REALMENTE pasó.
 *
 * La prueba de haber estado en una etapa es tener instancias de sus bloques: solo nacen
 * al entrar. El `orden` no sirve — con routing que bifurca, un caso puede saltarse cinco
 * etapas de forma legítima, y proponer una de esas lo manda a hacer trabajo que no le
 * toca (medido en V0107/V0114: cinco saltadas, dos de ellas por saldo cubierto).
 */
export async function etapasRecorridas(
  supabase: unknown,
  negocioId: string,
  lineaId: string,
): Promise<EtapaCandidata[]> {
  const { data: etapasRaw } = await db(supabase)
    .from('etapas_negocio')
    .select('id, nombre, orden, numero, stage, config_extra')
    .eq('linea_id', lineaId)
    .order('orden')

  const etapas = (etapasRaw ?? []) as Array<{
    id: string
    nombre: string
    orden: number
    numero: number
    stage: string
    config_extra: Record<string, unknown> | null
  }>

  // Un solo viaje: los bloques del negocio traen su etapa, y su presencia ES la prueba.
  const { data: instanciasRaw } = await db(supabase)
    .from('negocio_bloques')
    .select('bloque_configs!inner(etapa_id)')
    .eq('negocio_id', negocioId)

  const conPrueba = new Set(
    ((instanciasRaw ?? []) as Array<{ bloque_configs: { etapa_id: string } | null }>)
      .map(i => i.bloque_configs?.etapa_id)
      .filter(Boolean) as string[],
  )

  return etapas
    .filter(e => conPrueba.has(e.id))
    .map(e => ({
      id: e.id,
      nombre: e.nombre,
      orden: e.orden,
      numero: e.numero,
      stage: e.stage,
      // Marcas declaradas en la línea. Sin ellas el módulo NO adivina por nombre:
      // quemar "Precobro" acá lo rompería en el primer cliente con otra topología.
      esPrecobro: (e.config_extra as { es_precobro?: boolean } | null)?.es_precobro === true,
      esNegociacion: (e.config_extra as { es_negociacion?: boolean } | null)?.es_negociacion === true,
    }))
}

/** Deja el aviso pegado al negocio. Lo ven la financiera y el comercial. */
export async function guardarAviso(params: {
  supabase: unknown
  workspaceId: string
  negocioId: string
  referencia: string
  motivo: string
  etapaAlCambiar: string
  gatesReabiertos: number
  destinoSugerido: string | null
  ahora: string
  staffId: string | null
}): Promise<{ error: string | null }> {
  const { supabase, workspaceId, negocioId } = params

  const { data: negRaw } = await db(supabase)
    .from('negocios')
    .select('metadata')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .single()

  const metadata = (negRaw?.metadata ?? {}) as Record<string, unknown>
  const aviso = construirAviso(params)

  const { error } = await db(supabase)
    .from('negocios')
    .update({ metadata: { ...metadata, [CLAVE_AVISO]: aviso } })
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)

  return { error: error ? (error as { message: string }).message : null }
}

/** Lee el aviso vigente, si lo hay. */
export async function leerAviso(
  supabase: unknown,
  workspaceId: string,
  negocioId: string,
): Promise<AvisoRecaudoCambiado | null> {
  const { data } = await db(supabase)
    .from('negocios')
    .select('metadata')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .single()

  const metadata = (data?.metadata ?? {}) as Record<string, unknown>
  return (metadata[CLAVE_AVISO] ?? null) as AvisoRecaudoCambiado | null
}

/** Retira el aviso. Exige motivo: sin él, nadie sabe por qué se cerró. */
export async function resolverAviso(params: {
  supabase: unknown
  workspaceId: string
  negocioId: string
  motivo: string
  staffId: string | null
}): Promise<{ error: string | null }> {
  const { supabase, workspaceId, negocioId, motivo, staffId } = params
  if (motivo.trim().length < 10) {
    return { error: 'Escribe por qué se resuelve el aviso (mínimo 10 caracteres).' }
  }

  const { data } = await db(supabase)
    .from('negocios')
    .select('metadata')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .single()

  const metadata = (data?.metadata ?? {}) as Record<string, unknown>
  const previo = metadata[CLAVE_AVISO] as AvisoRecaudoCambiado | null
  if (!previo) return { error: null }

  const { [CLAVE_AVISO]: _resuelto, ...resto } = metadata

  const { error } = await db(supabase)
    .from('negocios')
    .update({ metadata: resto })
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)

  if (error) return { error: (error as { message: string }).message }

  if (staffId) {
    await registrarActividad(db(supabase), {
      workspace_id: workspaceId,
      entidad_tipo: 'negocio',
      entidad_id: negocioId,
      tipo: 'cambio_sistema',
      autor_id: staffId,
      contenido: `Aviso de recaudo cambiado (ref ${previo.referencia}) resuelto: ${motivo.trim()}`.slice(0, 280),
    }, 'resolverAviso')
  }

  return { error: null }
}

/**
 * Mueve el caso hacia atrás por decisión del área financiera.
 *
 * ⚠️ El evento se marca como **financiero**, no como reproceso de operaciones. Contarlo
 * en el indicador de calidad le imputa a quien hizo bien su trabajo un error que ocurrió
 * con la plata, y eso invierte el indicador — la misma lección que `reproceso_eventos`
 * dejó al atribuir el reproceso a quien lo reporta en vez de a quien hizo el trabajo.
 */
export async function ejecutarRetroceso(params: {
  supabase: unknown
  workspaceId: string
  negocioId: string
  causa: CausaRetrocesoFinanciero
  /** Elegido por la financiera; puede diferir del sugerido. null = no mover. */
  destinoEtapaId: string | null
  motivo: string
  staffId: string | null
  /** Inyectado para no cerrar un ciclo de imports contra las server actions. */
  moverEtapa: (negocioId: string, etapaId: string) => Promise<{ error: string | null }>
}): Promise<{ ok: boolean; error?: string; errores?: string[]; movido: boolean }> {
  const { supabase, workspaceId, negocioId, destinoEtapaId, motivo, staffId, moverEtapa } = params

  const { data: negRaw } = await db(supabase)
    .from('negocios')
    .select('linea_id, etapa_actual_id, etapas_negocio!negocios_etapa_actual_id_fkey(id, nombre, orden, numero, stage)')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .single()

  if (!negRaw?.linea_id) return { ok: false, error: 'Negocio no encontrado', movido: false }

  const actualRaw = negRaw.etapas_negocio as {
    id: string; nombre: string; orden: number; numero: number; stage: string
  } | null
  if (!actualRaw) return { ok: false, error: 'El negocio no tiene etapa actual', movido: false }

  const etapaActual: EtapaCandidata = { ...actualRaw }
  const recorridas = await etapasRecorridas(supabase, negocioId, negRaw.linea_id)

  const v = validarRetroceso({ destinoEtapaId, motivo, etapasRecorridas: recorridas, etapaActual })
  if (!v.ok) return { ok: false, error: v.errores[0], errores: v.errores, movido: false }

  if (destinoEtapaId) {
    const mov = await moverEtapa(negocioId, destinoEtapaId)
    if (mov.error) return { ok: false, error: mov.error, movido: false }
  }

  const destino = recorridas.find(e => e.id === destinoEtapaId)

  if (staffId) {
    await registrarActividad(db(supabase), {
      workspace_id: workspaceId,
      entidad_tipo: 'negocio',
      entidad_id: negocioId,
      tipo: destinoEtapaId ? 'cambio_etapa' : 'cambio_sistema',
      autor_id: staffId,
      contenido: destinoEtapaId
        ? `Retroceso financiero: ${etapaActual.nombre} → ${destino?.nombre ?? 'etapa anterior'}. Motivo: ${motivo.trim()}`.slice(0, 280)
        : `Retroceso financiero evaluado sin mover de etapa. Motivo: ${motivo.trim()}`.slice(0, 280),
    }, 'ejecutarRetroceso')
  }

  // La marca financiera va en el evento, para que el cómputo de calidad de operaciones
  // pueda excluirlo. NO se reusa `reproceso_eventos`: ahí adentro, este caso contaría.
  await registrarActividad(db(supabase), {
    workspace_id: workspaceId,
    entidad_tipo: 'negocio',
    entidad_id: negocioId,
    tipo: 'cambio_sistema',
    autor_id: staffId,
    contenido: `[retroceso_financiero] origen=financiera causa=${params.causa} destino=${destino?.nombre ?? 'sin movimiento'}`.slice(0, 280),
  }, 'ejecutarRetroceso')

  return { ok: true, movido: Boolean(destinoEtapaId) }
}

/** Reexporta la propuesta para que la server action no importe de dos módulos. */
export { proponerRetrocesoFinanciero }
