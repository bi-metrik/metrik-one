import 'server-only'

/**
 * Reversa de ruta — la parte que habla con la base.
 *
 * Las REGLAS viven en `src/lib/negocios/reversa-ruta.ts` (módulo puro, con pruebas): cómo
 * se recorre el routing, qué etapas quedaron omitidas y a cuál habría que devolver. Aquí
 * solo se resuelven contra un negocio concreto, se PROPONE, y —cuando una persona lo
 * decide— se ejecuta.
 *
 * ── Qué NO hace ───────────────────────────────────────────────────────────────────────
 * **No mueve nada por su cuenta, nunca.** Devolver un caso reabre gates de saldo y puede
 * dejar cobros y cuentas de cobro en desacuerdo con la etapa: es una decisión con
 * consecuencias de plata, así que la toma una persona. La detección deja una PROPUESTA
 * pendiente en el negocio; aplicarla es un acto aparte y explícito.
 *
 * ── Hermano de `retorno.ts`, no su reemplazo ──────────────────────────────────────────
 * `retorno.ts` (retorno al punto de decisión) devuelve el caso a la etapa donde el dato se
 * EVALÚA, y archiva lo que dependía de esa decisión. Sirve cuando la decisión se corrige
 * a tiempo y hay que volver a tomarla.
 *
 * Esto es lo contrario en dos cosas: el destino es la primera etapa OMITIDA (el tramo que
 * el caso se saltó, no el punto donde se equivocó), y **no se archiva ni se vacía nada**.
 * El trabajo que el caso hizo aguas abajo es válido: lo que falta es el tramo que nunca
 * recorrió. Destruirlo obligaría a rehacer un trabajo que nadie rechazó.
 *
 * Los dos conviven sin pisarse: si `retorno.ts` ya devolvió el caso al punto de decisión,
 * el caso queda EN esa etapa y `divergenciaDeRuta` no propone nada (el motor todavía no
 * decidió). Por eso la detección corre DESPUÉS del retorno, no antes.
 */

import {
  reversaActiva,
  divergenciaDeRuta,
  mensajePropuesta,
  type EtapaRuta,
  type ValoresPorOrden,
} from '@/lib/negocios/reversa-ruta'
import { camposDeDecision, type RoutingEtapa } from '@/lib/negocios/dato-de-decision'
import { aplicaSaltoPorSaldo } from '@/lib/negocios/salto-etapa'
import { LABEL_CAUSA, type CausaCorreccion } from './causas'
import { registrarActividad } from '@/lib/activity/registrar-actividad'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(supabase: unknown): any {
  return supabase
}

/** Una etapa, como la ve el equipo. `numero` es el visible; `orden` es interno. */
export type EtapaVista = { id: string; nombre: string; numero: number; orden: number }

export type PropuestaReversa = {
  /** Campos corregidos que gobiernan la bifurcación. Vacío en modo revalidación. */
  campos: string[]
  /** Etapa que evaluó el routing con el dato equivocado. */
  decision: EtapaVista
  /** Dónde está el caso ahora. */
  actual: { id: string; nombre: string }
  /** La primera etapa omitida: lo único que se propone mover. */
  destino: EtapaVista
  /** Todas las omitidas, en orden de camino. La primera es `destino`. */
  omitidas: EtapaVista[]
  /** Texto listo para la pantalla. */
  aviso: string
}

/** La propuesta tal como queda guardada en `negocios.metadata.reversa_ruta_pendiente`. */
export type PropuestaPendiente = PropuestaReversa & {
  detectado_at: string
  detectado_por: string | null
  detectado_por_nombre: string | null
  causa: CausaCorreccion | null
}

type ConfigLinea = { aviso?: string | null }

/**
 * ¿El recorrido de este caso se separó del que le corresponde con los datos de hoy?
 *
 * Dos modos, y la diferencia importa:
 *
 * - **Detección** (`slugsCambiados` con contenido): solo se revisan las bifurcaciones que
 *   la corrección tocó. Así la propuesta nace de un acto humano y no de un cambio de
 *   configuración: si alguien edita el routing de una línea, los casos viejos que ya lo
 *   recorrieron NO empiezan a pedir que los devuelvan.
 * - **Revalidación** (`slugsCambiados = null` + `soloDecisionEtapaId`): se recomprueba una
 *   propuesta guardada contra el estado de AHORA, justo antes de aplicarla. Entre que se
 *   detectó y que alguien la aprueba, el caso pudo moverse o alguien pudo corregir otra
 *   vez. La propuesta guardada sirve para avisar; **para mover manda esta recomprobación**.
 */
export async function detectarReversa(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  workspaceId: string,
  negocioId: string,
  slugsCambiados: string[] | null,
  soloDecisionEtapaId?: string,
): Promise<PropuestaReversa | null> {
  const { data: negRaw } = await db(supabase)
    .from('negocios')
    .select('id, linea_id, etapa_actual_id, estado')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  const neg = negRaw as {
    linea_id: string | null
    etapa_actual_id: string | null
    estado: string | null
  } | null
  if (!neg?.linea_id || !neg.etapa_actual_id) return null
  // Un negocio cerrado no se propone mover: reabrirlo es otro mecanismo, con sus propios
  // permisos y su propia traza. Proponer aquí sería ofrecer un atajo que los saltea.
  if (neg.estado !== 'abierto') return null

  // Opt-in por LÍNEA. Es el atajo que mantiene el costo en cero para quien no lo usa: sin
  // la declaración no se lee una sola tabla más.
  const { data: lineaRaw } = await db(supabase)
    .from('lineas_negocio')
    .select('config_extra')
    .eq('id', neg.linea_id)
    .maybeSingle()
  const configLinea = (lineaRaw as { config_extra?: Record<string, unknown> | null } | null)?.config_extra ?? null
  if (!reversaActiva(configLinea)) return null
  const cfgReversa = ((configLinea?.reversa_ruta ?? {}) as ConfigLinea)

  // ── Topología de la línea ───────────────────────────────────────────────
  const { data: etapasRaw } = await db(supabase)
    .from('etapas_negocio')
    .select('id, nombre, orden, numero, stage, config_extra')
    .eq('linea_id', neg.linea_id)
  const etapasBase = ((etapasRaw ?? []) as Array<Record<string, unknown>>).map(e => ({
    id: e.id as string,
    nombre: (e.nombre as string) ?? '',
    orden: e.orden as number,
    numero: (e.numero as number) ?? (e.orden as number),
    routing: (((e.config_extra as Record<string, unknown> | null)?.routing ?? null) as RoutingEtapa | null),
    // La MISMA función que decide el salto en el motor de avance. Si aquí se copiara el
    // criterio, la reversa llamaría "omitida" a una etapa que el motor salta a propósito.
    puedeSaltarsePorSaldo: aplicaSaltoPorSaldo({
      stage: (e.stage as string | null) ?? null,
      config_extra: (e.config_extra ?? null) as { saltar_si_saldo_cero?: unknown } | null,
    }),
  }))
  if (etapasBase.length === 0) return null

  const etapaActual = etapasBase.find(e => e.id === neg.etapa_actual_id)
  if (!etapaActual) return null

  // ── Qué etapas TIENEN casillas configuradas ─────────────────────────────
  // Sin esto, una etapa sin bloques nunca podría probar que fue recorrida y aparecería
  // como omitida para siempre (ver `EtapaRuta.tieneCasillas`).
  const { data: configsRaw } = await db(supabase)
    .from('bloque_configs')
    .select('id, etapa_id, config_extra, etapas_negocio!inner(linea_id)')
    .eq('etapas_negocio.linea_id', neg.linea_id)
  const conCasillas = new Set<string>()
  for (const c of ((configsRaw ?? []) as Array<{ etapa_id: string; config_extra: Record<string, unknown> | null }>)) {
    if (c.config_extra?.desactivado === true) continue
    conCasillas.add(c.etapa_id)
  }

  const etapas: EtapaRuta[] = etapasBase.map(e => ({ ...e, tieneCasillas: conCasillas.has(e.id) }))

  // ── Los hechos del caso: por dónde pasó y qué respondió ─────────────────
  //
  // La prueba de haber pasado por una etapa es tener instancias de sus casillas: solo
  // nacen al entrar. Es el mismo criterio que ya usa el retorno al punto de decisión, y
  // está verificado contra producción — NO se compara `orden`, que no ordena el recorrido.
  const { data: instRaw } = await db(supabase)
    .from('negocio_bloques')
    .select('data, bloque_configs!inner(bloque_definitions!inner(tipo), etapas_negocio!inner(orden))')
    .eq('negocio_id', negocioId)

  const recorridas = new Set<number>()
  const valores: ValoresPorOrden = {}
  for (const inst of ((instRaw ?? []) as Array<Record<string, unknown>>)) {
    const cfg = inst.bloque_configs as Record<string, unknown> | null
    const orden = (cfg?.etapas_negocio as { orden?: number } | null)?.orden
    if (typeof orden !== 'number') continue
    recorridas.add(orden)
    const tipo = (cfg?.bloque_definitions as { tipo?: string } | null)?.tipo
    // El motor arma su bolsillo SOLO con los bloques `datos` de la etapa fuente. Si aquí
    // se metiera otro tipo, la simulación decidiría distinto del motor.
    if (tipo !== 'datos') continue
    const data = inst.data as Record<string, unknown> | null
    if (!data || typeof data !== 'object') continue
    valores[orden] = { ...(valores[orden] ?? {}), ...data }
  }

  // ── Qué bifurcaciones hay que revisar ───────────────────────────────────
  const cambiados = slugsCambiados === null ? null : new Set(slugsCambiados)
  const candidatas = etapas
    .filter(e => {
      if (soloDecisionEtapaId && e.id !== soloDecisionEtapaId) return false
      // Sin condiciones no hay bifurcación: no decide nada que se pueda equivocar.
      const campos = camposDeDecision(e.routing)
      if (campos.length === 0) return false
      // El caso tiene que haber pasado por ahí Y haberse ido: si sigue en la etapa, el
      // motor todavía no decidió.
      if (e.id === etapaActual.id) return false
      if (!recorridas.has(e.orden)) return false
      if (cambiados === null) return true
      return campos.some(c => cambiados.has(c))
    })
    // Si la corrección tocara dos bifurcaciones, se propone la de MÁS ARRIBA: la de abajo
    // se volverá a evaluar de camino. Mismo criterio que `retornosPosibles`.
    .sort((a, b) => a.orden - b.orden)

  const porOrden = new Map(etapas.map(e => [e.orden, e]))
  const vista = (e: EtapaRuta): EtapaVista => ({ id: e.id, nombre: e.nombre, numero: e.numero, orden: e.orden })

  for (const decision of candidatas) {
    const { omitidas, destino } = divergenciaDeRuta({
      etapas,
      decisionOrden: decision.orden,
      valores,
      recorridas,
      etapaActualOrden: etapaActual.orden,
    })
    if (destino === null) continue

    const etapaDestino = porOrden.get(destino)
    if (!etapaDestino) continue
    const omitidasVista = omitidas.map(o => porOrden.get(o)).filter((e): e is EtapaRuta => !!e).map(vista)

    return {
      campos: cambiados ? camposDeDecision(decision.routing).filter(c => cambiados.has(c)) : [],
      decision: vista(decision),
      actual: { id: etapaActual.id, nombre: etapaActual.nombre },
      destino: vista(etapaDestino),
      omitidas: omitidasVista,
      aviso: mensajePropuesta(omitidasVista, etapaDestino, cfgReversa.aviso),
    }
  }

  return null
}

/**
 * Deja la propuesta pendiente en el negocio, para que la vea quien puede decidir.
 *
 * ⚠️ Se PERSISTE en vez de mostrarse y ya. Quien corrige el dato no siempre es quien puede
 * decidir mover el caso (ni está mirando la pantalla cuando se detecta), y un caso en la
 * vía equivocada no puede depender de que alguien alcance a leer un aviso que se va. Aquí
 * queda hasta que alguien la aplique o la descarte a propósito.
 *
 * No lanza: la corrección del dato ya está guardada y eso es lo que no se puede perder.
 */
export async function guardarPropuesta(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
  workspaceId: string
  negocioId: string
  propuesta: PropuestaReversa
  staffId?: string | null
  userId?: string
  causa: CausaCorreccion | null
}): Promise<void> {
  const { supabase, workspaceId, negocioId, propuesta, staffId, userId, causa } = params
  try {
    const { data: negRaw } = await db(supabase)
      .from('negocios')
      .select('metadata')
      .eq('id', negocioId)
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    if (!negRaw) return
    const metadata = ((negRaw as { metadata: Record<string, unknown> | null }).metadata ?? {})

    let nombre: string | null = null
    if (userId) {
      const { data: prof } = await db(supabase).from('profiles').select('full_name').eq('id', userId).maybeSingle()
      nombre = (prof as { full_name?: string } | null)?.full_name ?? null
    }

    const pendiente: PropuestaPendiente = {
      ...propuesta,
      detectado_at: new Date().toISOString(),
      detectado_por: staffId ?? null,
      detectado_por_nombre: nombre,
      causa,
    }

    const { error } = await db(supabase)
      .from('negocios')
      .update({ metadata: { ...metadata, reversa_ruta_pendiente: pendiente } })
      .eq('id', negocioId)
      .eq('workspace_id', workspaceId)
    if (error) console.error('[reversa] no se pudo guardar la propuesta:', error)
  } catch (err) {
    console.error('[reversa] no se pudo guardar la propuesta:', err)
  }
}

/** Quita la propuesta pendiente. Devuelve la que había, para poder dejarla en la traza. */
export async function limpiarPropuesta(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  workspaceId: string,
  negocioId: string,
): Promise<PropuestaPendiente | null> {
  const { data: negRaw } = await db(supabase)
    .from('negocios')
    .select('metadata')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (!negRaw) return null
  const metadata = ((negRaw as { metadata: Record<string, unknown> | null }).metadata ?? {})
  const previa = (metadata.reversa_ruta_pendiente ?? null) as PropuestaPendiente | null
  if (!previa) return null
  const { reversa_ruta_pendiente: _quitada, ...resto } = metadata
  await db(supabase)
    .from('negocios')
    .update({ metadata: resto })
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
  return previa
}

export type ResultadoReversa = {
  destinoNombre: string
  etapaAnterior: string | null
  omitidas: string[]
}

/**
 * Devuelve el caso a la primera etapa omitida. Lo llama una persona, nunca el sistema.
 *
 * Tres cosas que este mecanismo NO hace, cada una a propósito:
 *
 * 1. **No archiva ni vacía ningún bloque.** El trabajo hecho aguas abajo sigue siendo
 *    válido: lo que faltó es el tramo que el caso nunca recorrió. Al re-avanzar, el caso
 *    vuelve a pasar por esas etapas con su dato puesto y sus bloques intactos.
 * 2. **No inventa su propio movedor.** Usa el mismo `cambiarEtapaNegocio` que usa el
 *    avance normal, inyectado por quien llama (`moverEtapa`) para no cerrar un ciclo de
 *    imports contra las server actions. Ese movedor es el que crea las instancias de las
 *    casillas de la etapa destino heredando lo que corresponde, exactamente igual que la
 *    entrada normal a una etapa. Copiar esa lógica aquí sería una segunda entrada a etapa
 *    que se desincroniza en cuanto alguien toque una.
 * 3. **No manda el aviso a mano.** `avisar_al_entrar` lo dispara el trigger
 *    `trg_avisar_entrada_etapa`, que cuelga del UPDATE de `negocios.etapa_actual_id`. Como
 *    el movimiento pasa por ese UPDATE, el aviso sale solo. Es justo el paso que se pierde
 *    cuando un caso se mueve por fuera del producto, y por eso mover con un UPDATE que
 *    esquive el trigger (o con la replicación desactivada) rompería lo único que este
 *    mecanismo vino a garantizar.
 */
export async function ejecutarReversa(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
  workspaceId: string
  negocioId: string
  propuesta: PropuestaReversa
  userId?: string
  staffId?: string | null
  /** Por qué se devuelve, en palabras de quien decide. */
  motivo: string
  moverEtapa: (negocioId: string, etapaId: string) => Promise<{ error: string | null }>
}): Promise<{ resultado: ResultadoReversa | null; error: string | null }> {
  const { supabase, workspaceId, negocioId, propuesta, userId, staffId, motivo, moverEtapa } = params

  const { data: negRaw } = await db(supabase)
    .from('negocios')
    .select('metadata, codigo, nombre')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (!negRaw) return { resultado: null, error: 'Negocio no encontrado' }
  const neg = negRaw as { metadata: Record<string, unknown> | null; codigo: string | null; nombre: string | null }
  const metadata = neg.metadata ?? {}

  let nombreAutor: string | null = null
  if (userId) {
    const { data: prof } = await db(supabase).from('profiles').select('full_name').eq('id', userId).maybeSingle()
    nombreAutor = (prof as { full_name?: string } | null)?.full_name ?? null
  }

  // El movimiento va PRIMERO: si falla, no se escribe ninguna marca que afirme un retorno
  // que no ocurrió.
  const mov = await moverEtapa(negocioId, propuesta.destino.id)
  if (mov.error) return { resultado: null, error: mov.error }

  const ahora = new Date().toISOString()
  const historial = Array.isArray(metadata.reversa_ruta) ? (metadata.reversa_ruta as unknown[]) : []
  const marca = {
    ciclo: historial.length + 1,
    campos: propuesta.campos,
    desde_etapa: propuesta.actual.nombre,
    hacia_etapa: propuesta.destino.nombre,
    decision_etapa: propuesta.decision.nombre,
    omitidas: propuesta.omitidas.map(o => o.nombre),
    motivo,
    causa: (metadata.reversa_ruta_pendiente as PropuestaPendiente | null)?.causa ?? null,
    aplicado_at: ahora,
    aplicado_por: staffId ?? null,
    aplicado_por_nombre: nombreAutor,
  }

  // La propuesta pendiente se consume: ya se decidió sobre ella.
  const { reversa_ruta_pendiente: _consumida, ...restoMetadata } = metadata
  const { error: errMarca } = await db(supabase)
    .from('negocios')
    .update({ metadata: { ...restoMetadata, reversa_ruta: [...historial, marca] } })
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
  // El caso ya se movió: un fallo aquí no lo deshace, pero no puede quedar mudo.
  if (errMarca) console.error('[reversa] el caso se movió y la marca no se pudo escribir:', errMarca)

  // ── Traza ─────────────────────────────────────────────────────────────
  // `autor_id` es FK a **staff(id)**, NO a profiles: pasarle el profile.id viola la FK y
  // el evento se pierde sin ruido. Y el `tipo` tiene que existir en el CHECK de
  // `activity_log`; 'cambio_etapa' está.
  if (staffId) {
    const omitidas = propuesta.omitidas.map(o => o.nombre).join(', ')
    await registrarActividad(db(supabase), {
      workspace_id: workspaceId,
      entidad_tipo: 'negocio',
      entidad_id: negocioId,
      tipo: 'cambio_etapa',
      autor_id: staffId,
      campo_modificado: 'etapa',
      valor_anterior: propuesta.actual.nombre,
      valor_nuevo: propuesta.destino.nombre,
      contenido:
        `Vuelve a ${propuesta.destino.nombre}: al corregir el dato que decide la ruta en ` +
        `${propuesta.decision.nombre}, el caso quedó saltándose ${omitidas}. Motivo: ${motivo}.`
          .slice(0, 280),
    }, 'ejecutarReversa')
  }

  // ── Avisar a quien vigila el proceso ──────────────────────────────────
  // Tipo `reproceso`: es el único del CHECK de `notificaciones` que significa "este caso
  // volvió atrás". Un tipo fuera del CHECK hace fallar el insert EN SILENCIO, así que no
  // se inventa uno nuevo sin migración aplicada. (El aviso de ENTRADA a la etapa destino
  // es otro, y lo dispara el trigger: son dos hechos distintos.)
  const { data: destinatarios } = await db(supabase)
    .from('profiles')
    .select('id')
    .eq('workspace_id', workspaceId)
    .in('role', ['owner', 'admin', 'supervisor'])
  const etiqueta = neg.codigo ? `${neg.codigo} — ${neg.nombre ?? ''}`.trim() : (neg.nombre ?? 'Negocio')
  for (const d of ((destinatarios ?? []) as Array<{ id: string }>)) {
    if (userId && d.id === userId) continue
    await db(supabase).rpc('crear_notificacion', {
      p_workspace_id: workspaceId,
      p_destinatario_id: d.id,
      p_tipo: 'reproceso',
      p_contenido: `${etiqueta} vuelve a ${propuesta.destino.nombre}: se corrigió el dato que decide la ruta y el caso se había saltado etapas.`,
      p_entidad_tipo: 'negocio',
      p_entidad_id: negocioId,
      p_deep_link: `/negocios/${negocioId}`,
      p_metadata: { motivo: 'reversa_ruta', desde: propuesta.actual.nombre, hacia: propuesta.destino.nombre },
      p_permitir_repetidas: true,
    })
  }

  return {
    resultado: {
      destinoNombre: propuesta.destino.nombre,
      etapaAnterior: propuesta.actual.nombre,
      omitidas: propuesta.omitidas.map(o => o.nombre),
    },
    error: null,
  }
}

/**
 * Descarta la propuesta sin mover el caso, dejando dicho por qué.
 *
 * Hace falta tanto como aplicarla: una propuesta que solo se puede aceptar deja de ser una
 * propuesta. Y el descarte es información — si el equipo descarta siempre la misma, la
 * configuración de la línea es lo que está mal.
 */
export async function descartarPropuesta(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
  workspaceId: string
  negocioId: string
  motivo: string
  staffId?: string | null
}): Promise<{ error: string | null }> {
  const { supabase, workspaceId, negocioId, motivo, staffId } = params
  const previa = await limpiarPropuesta(supabase, workspaceId, negocioId)
  if (!previa) return { error: 'No hay una propuesta pendiente' }

  if (staffId) {
    await registrarActividad(db(supabase), {
      workspace_id: workspaceId,
      entidad_tipo: 'negocio',
      entidad_id: negocioId,
      tipo: 'cambio',
      autor_id: staffId,
      campo_modificado: 'reversa_ruta',
      valor_anterior: previa.destino.nombre,
      valor_nuevo: null,
      contenido:
        `Se descartó devolver el caso a ${previa.destino.nombre}. Motivo: ${motivo}.`.slice(0, 280),
    }, 'descartarPropuesta')
  }
  return { error: null }
}

/** Etiqueta legible de la causa con la que se corrigió, para la pantalla. */
export function etiquetaCausa(causa: CausaCorreccion | null | undefined): string | null {
  return causa ? LABEL_CAUSA[causa] ?? null : null
}
