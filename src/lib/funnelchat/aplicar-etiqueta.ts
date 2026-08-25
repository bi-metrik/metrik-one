// Aplica en ONE la etiqueta que alguien puso en FunnelChat.
//
// Vive separado del endpoint a proposito: el endpoint es el receptor (lee el
// cuerpo, resuelve el token, deja constancia) y esto es la decision. Mezclarlos
// haria que la bitacora dependiera de que la escritura salga bien, y la bitacora
// tiene que quedar SIEMPRE, incluso —sobre todo— cuando esto falla.

import { resolverSegmento, telefonoMovilCo } from './etiqueta-a-segmento'

/** Los eventos que mueven status. FunnelChat manda otros (`mensaje_recibido`) por
 *  el mismo endpoint; esos se registran y no hacen nada. */
const EVENTOS_DE_ETIQUETA = new Set(['tag_agregado', 'etiqueta_asignada'])

export type ResultadoAplicacion =
  | { accion: 'aplicado'; contacto_id: string; etiqueta: string; de: string | null; a: string }
  | { accion: 'sin_cambio'; contacto_id: string; etiqueta: string; segmento: string }
  | { accion: 'ignorado'; motivo: string; detalle?: string }

/* eslint-disable @typescript-eslint/no-explicit-any */
type Supabase = any

/**
 * Devuelve SIEMPRE un resultado, nunca lanza: lo que sale de aqui se guarda en
 * `funnelchat_eventos.resultado`, y una excepcion dejaria la fila diciendo que el
 * evento llego sin decir que se hizo con el. Eso es justo el fallo mudo que este
 * frente viene cerrando.
 */
export async function aplicarEtiqueta(
  supabase: Supabase,
  workspaceId: string,
  payload: Record<string, unknown>,
): Promise<ResultadoAplicacion> {
  try {
    const evento = String(payload.evento ?? '').trim()
    if (!EVENTOS_DE_ETIQUETA.has(evento)) {
      return { accion: 'ignorado', motivo: 'evento_no_es_de_etiqueta', detalle: evento || '(vacio)' }
    }

    const etiqueta = String(payload.etiqueta ?? '').trim()
    if (!etiqueta) return { accion: 'ignorado', motivo: 'sin_etiqueta' }

    // El mapa se lee en cada evento y no se cachea: es configuracion que se ajusta
    // a mano cuando renombran una etiqueta, y un cache haria que el ajuste tardara
    // en verse sin que nadie entienda por que.
    const { data: ws } = await supabase
      .from('workspaces')
      .select('config_extra')
      .eq('id', workspaceId)
      .maybeSingle()

    const mapa = (ws?.config_extra as any)?.funnelchat?.mapa_segmentos as
      | Record<string, unknown>
      | undefined

    const destino = resolverSegmento(etiqueta, mapa)
    if (!destino.ok) return { accion: 'ignorado', motivo: destino.motivo, detalle: destino.detalle }

    const nacional = telefonoMovilCo(String(payload.telefono ?? ''))
    if (!nacional) {
      return {
        accion: 'ignorado',
        motivo: 'telefono_no_es_movil_co',
        detalle: String(payload.telefono ?? '(vacio)'),
      }
    }

    const { data: candidatos, error: errBusqueda } = await supabase.rpc(
      'funnelchat_contactos_por_telefono',
      { p_workspace_id: workspaceId, p_nacional: nacional },
    )
    if (errBusqueda) {
      return { accion: 'ignorado', motivo: 'error_buscando_contacto', detalle: errBusqueda.message }
    }

    const filas = (candidatos ?? []) as { id: string; segmento: string | null }[]
    if (filas.length === 0) {
      return { accion: 'ignorado', motivo: 'contacto_no_encontrado', detalle: nacional }
    }
    // Dos contactos con el mismo telefono no se resuelven adivinando. Queda escrito
    // cuantos eran para que el duplicado se pueda arreglar en el directorio.
    if (filas.length > 1) {
      return { accion: 'ignorado', motivo: 'telefono_ambiguo', detalle: `${nacional}: ${filas.length} contactos` }
    }

    const contacto = filas[0]
    if ((contacto.segmento ?? null) === destino.segmento) {
      return {
        accion: 'sin_cambio',
        contacto_id: contacto.id,
        etiqueta,
        segmento: destino.segmento,
      }
    }

    const { error: errUpdate } = await supabase
      .from('contactos')
      .update({ segmento: destino.segmento })
      .eq('id', contacto.id)
      .eq('workspace_id', workspaceId)

    if (errUpdate) {
      return { accion: 'ignorado', motivo: 'error_escribiendo', detalle: errUpdate.message }
    }

    // Mismo rastro que deja un cambio hecho a mano en ONE (`registrarCambioSegmento`
    // en directorio/actions). Sin esto el status del contacto cambiaria solo, sin
    // autor ni fecha, y el historial del Contacto 360 mentiria por omision.
    //
    // `autor_id` va nulo porque no lo movio nadie de ONE. Que fue FunnelChat y con
    // que etiqueta queda en `contenido`, que es la unica columna de texto libre que
    // tiene la tabla: sin eso la fila diria "cambio de status, autor desconocido",
    // que en un historial es peor que no tenerla. Nunca tumba la escritura: el
    // status ya quedo guardado.
    const { error: errLog } = await supabase.from('activity_log').insert({
      workspace_id: workspaceId,
      entidad_tipo: 'contacto',
      entidad_id: contacto.id,
      tipo: 'cambio',
      autor_id: null,
      campo_modificado: 'segmento',
      valor_anterior: contacto.segmento,
      valor_nuevo: destino.segmento,
      contenido: `FunnelChat: etiqueta "${etiqueta}"`,
    })
    if (errLog) console.error('[funnelchat] status guardado, historial no:', errLog.message)

    return {
      accion: 'aplicado',
      contacto_id: contacto.id,
      etiqueta,
      de: contacto.segmento ?? null,
      a: destino.segmento,
    }
  } catch (e) {
    return {
      accion: 'ignorado',
      motivo: 'excepcion',
      detalle: e instanceof Error ? e.message : String(e),
    }
  }
}
