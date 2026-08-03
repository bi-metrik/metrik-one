import 'server-only'

/**
 * Retorno al punto de decisión — la parte que habla con la base.
 *
 * Las REGLAS viven en `src/lib/negocios/retorno-decision.ts` (módulo puro, con pruebas):
 * qué declara la etapa, qué está aguas abajo, qué se puede archivar y cuándo hay que
 * devolver. Aquí solo se resuelven contra el negocio concreto y se ejecuta.
 *
 * Reusa el mecanismo del reproceso (`reproceso-actions.ts`) en todo lo que ya funciona:
 * destino declarado por configuración, archivado dentro del propio bloque en `data._ciclos`,
 * marca visible en el negocio y notificación. La diferencia es el ALCANCE: el reproceso
 * vacía el tramo entero porque un tercero rechazó el trabajo; aquí no se rechazó nada, así
 * que se vacía solo lo que dependía de la decisión que se está volviendo a tomar.
 */

import { resolverDerivado, type LockWhen } from '@/lib/negocios/campo-derivado'
import { visiblePuedeNacerCompleto } from '@/lib/negocios/bloque-visible-completo'
import {
  leerDeclaraciones,
  etapasAguasAbajo,
  bloqueArchivable,
  debeRetornar,
  mensajeAviso,
  type DeclaracionRetorno,
  type EtapaRetorno,
} from '@/lib/negocios/retorno-decision'
import { LABEL_CAUSA, type CausaCorreccion } from './causas'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(supabase: unknown): any {
  return supabase
}

type CampoField = { slug?: string; label?: string; lock_when?: LockWhen }

export type RetornoResuelto = {
  /** El campo que el usuario toca EN ESTE bloque (la pregunta, no su consecuencia). */
  campoFuente: string
  /** El campo decisor declarado por la etapa. Puede ser derivado del anterior. */
  campoDecisor: string
  /** `true` cuando el decisor se deriva de `campoFuente` vía `lock_when.mapping`. */
  derivado: boolean
  lockWhen?: LockWhen
  decl: DeclaracionRetorno
  etapaId: string
  etapaNombre: string
  etapaOrden: number
  /** Texto listo para la pantalla. */
  aviso: string
}

/**
 * Qué decisiones de ruta toca este bloque, y para cuáles el caso ya pasó el punto de
 * evaluación (o sea: cuáles obligarían a devolverlo).
 *
 * No mira valores: responde "si tocas esto, el caso vuelve". Es lo que necesita el aviso
 * de la pantalla, que se muestra ANTES de que exista un valor nuevo.
 *
 * Devuelve `[]` cuando ninguna etapa de la línea declara `punto_de_decision`: sin la
 * declaración, ningún workspace cambia de comportamiento.
 */
export async function retornosPosibles(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  negocioBloqueId: string,
): Promise<RetornoResuelto[]> {
  const { data: nb } = await db(supabase)
    .from('negocio_bloques')
    .select('negocio_id, bloque_configs!inner(slug, config_extra, etapa_id)')
    .eq('id', negocioBloqueId)
    .maybeSingle()
  if (!nb) return []

  const cfgBloque = (nb as Record<string, unknown>).bloque_configs as {
    slug: string | null
    config_extra: Record<string, unknown> | null
    etapa_id: string
  } | null
  if (!cfgBloque) return []
  const negocioId = (nb as { negocio_id: string }).negocio_id

  const { data: etapaPropia } = await db(supabase)
    .from('etapas_negocio')
    .select('linea_id')
    .eq('id', cfgBloque.etapa_id)
    .maybeSingle()
  const lineaId = (etapaPropia as { linea_id?: string } | null)?.linea_id
  if (!lineaId) return []

  const { data: etapasRaw } = await db(supabase)
    .from('etapas_negocio')
    .select('id, nombre, orden, numero, config_extra')
    .eq('linea_id', lineaId)
  type EtapaRow = EtapaRetorno & { config_extra: Record<string, unknown> | null }
  const etapas = ((etapasRaw ?? []) as Array<Record<string, unknown>>).map(e => ({
    id: e.id as string,
    nombre: e.nombre as string,
    orden: e.orden as number,
    numero: e.numero as number,
    routing: ((e.config_extra as Record<string, unknown> | null)?.routing ?? null) as EtapaRetorno['routing'],
    config_extra: (e.config_extra ?? null) as Record<string, unknown> | null,
  })) as EtapaRow[]

  const declaradas = etapas.flatMap(e =>
    leerDeclaraciones(e.config_extra).map(decl => ({ decl, etapa: e })),
  )
  // Atajo deliberado: sin declaraciones no se lee nada más. Es lo que mantiene el costo
  // en cero para los workspaces que no usan esto.
  if (declaradas.length === 0) return []

  const camposPropios = ((cfgBloque.config_extra?.fields ?? []) as CampoField[])
  const slugBloque = cfgBloque.slug

  // Campos de TODA la línea, para encontrar el decisor derivado y su `lock_when`.
  const { data: configsRaw } = await db(supabase)
    .from('bloque_configs')
    .select('config_extra, etapas_negocio!inner(linea_id)')
    .eq('etapas_negocio.linea_id', lineaId)
  const camposLinea: CampoField[] = ((configsRaw ?? []) as Array<Record<string, unknown>>)
    .flatMap(c => (((c.config_extra as Record<string, unknown> | null)?.fields ?? []) as CampoField[]))

  const { data: negocio } = await db(supabase)
    .from('negocios')
    .select('etapa_actual_id')
    .eq('id', negocioId)
    .maybeSingle()
  const etapaActualId = (negocio as { etapa_actual_id?: string | null } | null)?.etapa_actual_id ?? null
  const etapaActual = etapas.find(e => e.id === etapaActualId)
  if (!etapaActual) return []

  const out: RetornoResuelto[] = []
  for (const { decl, etapa } of declaradas) {
    // ¿Este bloque responde el decisor, directo o como fuente de su derivación?
    let campoFuente: string | null = null
    let derivado = false
    let lockWhen: LockWhen | undefined

    const propio = camposPropios.find(f => f.slug === decl.campo)
    if (propio) {
      campoFuente = decl.campo
    } else if (slugBloque) {
      const enLinea = camposLinea.find(f => f.slug === decl.campo)
      const lw = enLinea?.lock_when
      if (lw?.mapping && lw.source_bloque_slug === slugBloque && typeof lw.field === 'string') {
        // El decisor se DERIVA de una pregunta de este bloque (el patrón de O3: una sola
        // pregunta, varios campos resueltos). Corregir la pregunta mueve el decisor, así
        // que el aviso tiene que salir aquí, donde está el control que la gente toca.
        if (camposPropios.some(f => f.slug === lw.field)) {
          campoFuente = lw.field
          derivado = true
          lockWhen = lw
        }
      }
    }
    if (!campoFuente) continue

    // ¿Pasó por la etapa? Se mide por hechos: tener casillas de esa etapa. Solo nacen al
    // entrar (`cambiarEtapaNegocio` / auto-init de la etapa ACTUAL), así que su existencia
    // es prueba de haber estado ahí. Verificado contra producción el 2026-08-03: coincide
    // exactamente con la bitácora de salidas donde la bitácora existe (8 de 8).
    const { data: rastro } = await db(supabase)
      .from('negocio_bloques')
      .select('id, bloque_configs!inner(etapa_id)')
      .eq('negocio_id', negocioId)
      .eq('bloque_configs.etapa_id', etapa.id)
      .limit(1)
    const paso = ((rastro ?? []) as unknown[]).length > 0

    const aguasAbajo = etapasAguasAbajo(etapas, etapa.orden)
    if (!debeRetornar({
      etapaActualId: etapaActual.id,
      etapaActualOrden: etapaActual.orden,
      decisionEtapaId: etapa.id,
      decisionEtapaOrden: etapa.orden,
      pasoPorLaEtapa: paso,
      aguasAbajo,
    })) continue

    const label = camposPropios.find(f => f.slug === campoFuente)?.label ?? null
    out.push({
      campoFuente,
      campoDecisor: decl.campo,
      derivado,
      lockWhen,
      decl,
      etapaId: etapa.id,
      etapaNombre: etapa.nombre,
      etapaOrden: etapa.orden,
      aviso: mensajeAviso(decl, etapa.nombre, label),
    })
  }

  // Si una corrección tocara dos decisiones a la vez, se devuelve a la MÁS ARRIBA: la de
  // más abajo se volverá a evaluar de camino. Ordenar por orden es suficiente aquí porque
  // se comparan dos puntos del mismo recorrido, no dos ramas distintas.
  return out.sort((a, b) => a.etapaOrden - b.etapaOrden)
}

/**
 * De los retornos posibles, los que la corrección REALMENTE dispara: el valor del campo
 * decisor tiene que cambiar.
 *
 * ⚠️ Un decisor derivado puede NO moverse aunque su pregunta sí. Es el caso del leasing:
 * `requiere_devolucion_iva` tiene una regla dura que lo fuerza en falso, y esa regla le
 * gana al mapeo (`campo-derivado.ts`). Cambiar el servicio contratado en un caso de leasing
 * no cambia el decisor, así que devolver el caso sería moverlo por nada.
 */
export async function retornosDisparados(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  negocioId: string,
  posibles: RetornoResuelto[],
  cambios: Array<{ slug: string; antes: unknown; despues: unknown }>,
): Promise<Array<RetornoResuelto & { antes: unknown; despues: unknown }>> {
  const porSlug = new Map(cambios.map(c => [c.slug, c]))
  const out: Array<RetornoResuelto & { antes: unknown; despues: unknown }> = []

  for (const p of posibles) {
    const cambio = porSlug.get(p.campoFuente)
    if (!cambio) continue

    if (!p.derivado || !p.lockWhen) {
      if (JSON.stringify(cambio.antes) === JSON.stringify(cambio.despues)) continue
      out.push({ ...p, antes: cambio.antes, despues: cambio.despues })
      continue
    }

    // Derivado: hay que resolverlo con la MISMA función que usan el render y el guardado,
    // incluida la fuente de la regla puntual, que vive en otro bloque.
    const regla = p.lockWhen.regla
    let valorRegla: unknown = undefined
    if (regla?.source_bloque_slug) {
      const { data: bloqueRegla } = await db(supabase)
        .from('negocio_bloques')
        .select('data, bloque_configs!inner(slug)')
        .eq('negocio_id', negocioId)
        .eq('bloque_configs.slug', regla.source_bloque_slug)
        .limit(1)
        .maybeSingle()
      valorRegla = ((bloqueRegla as { data?: Record<string, unknown> } | null)?.data ?? {})[regla.field]
    }

    const antes = resolverDerivado(p.lockWhen, cambio.antes, valorRegla).valor
    const despues = resolverDerivado(p.lockWhen, cambio.despues, valorRegla).valor
    if (JSON.stringify(antes) === JSON.stringify(despues)) continue
    out.push({ ...p, antes, despues })
  }

  return out
}

export type ResultadoRetorno = {
  etapaNombre: string
  etapaAnterior: string | null
  bloquesArchivados: number
}

/**
 * Devuelve el caso al punto de decisión: archiva y vacía SOLO lo declarado, mueve el
 * negocio, deja marca, traza y aviso.
 *
 * No lanza: si algo falla, el dato corregido ya está guardado y eso es lo importante. Lo
 * que no puede pasar es que falle en silencio, así que cada tropiezo queda en consola.
 */
export async function ejecutarRetorno(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
  workspaceId: string
  negocioId: string
  userId?: string
  staffId?: string | null
  retorno: RetornoResuelto & { antes: unknown; despues: unknown }
  causa: CausaCorreccion
}): Promise<ResultadoRetorno | null> {
  const { supabase, workspaceId, negocioId, userId, staffId, retorno, causa } = params

  try {
    const { data: negocio } = await db(supabase)
      .from('negocios')
      .select('id, metadata, codigo, nombre, linea_id, etapa_actual_id')
      .eq('id', negocioId)
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    if (!negocio) return null
    const n = negocio as {
      metadata: Record<string, unknown> | null
      codigo: string | null
      nombre: string | null
      linea_id: string | null
      etapa_actual_id: string | null
    }
    if (!n.linea_id) return null

    const { data: etapaPrevia } = await db(supabase)
      .from('etapas_negocio')
      .select('nombre')
      .eq('id', n.etapa_actual_id)
      .maybeSingle()
    const etapaAnterior = (etapaPrevia as { nombre?: string } | null)?.nombre ?? null

    // ── Qué se archiva ────────────────────────────────────────────────────
    const slugs = retorno.decl.depende?.bloques ?? []
    const numeros = retorno.decl.depende?.etapas ?? []

    const { data: configsRaw } = await db(supabase)
      .from('bloque_configs')
      .select('id, slug, estado, es_gate, config_extra, etapas_negocio!inner(linea_id, numero)')
      .eq('etapas_negocio.linea_id', n.linea_id)

    type ConfigRow = {
      id: string
      slug: string | null
      estado: string | null
      es_gate: boolean | null
      config_extra: Record<string, unknown> | null
      etapas_negocio: { numero: number } | null
    }
    const configs = (configsRaw ?? []) as ConfigRow[]
    const aArchivar = configs.filter(c => {
      const declarado =
        (c.slug !== null && slugs.includes(c.slug)) ||
        (c.etapas_negocio?.numero !== undefined && numeros.includes(c.etapas_negocio.numero))
      // El guard manda sobre la declaración: un bloque de dinero, un heredado o un
      // documento marcado para conservarse NO se vacía aunque alguien lo declare.
      return declarado && bloqueArchivable(c.config_extra)
    })

    const marcaPrevia = (n.metadata?.retorno_decision ?? null) as { ciclo?: number } | null
    const ciclo = (marcaPrevia?.ciclo ?? 0) + 1
    const ahora = new Date().toISOString()
    let archivados = 0

    if (aArchivar.length > 0) {
      const porConfig = new Map(aArchivar.map(c => [c.id, c]))
      const { data: instancias } = await db(supabase)
        .from('negocio_bloques')
        .select('id, data, bloque_config_id')
        .eq('negocio_id', negocioId)
        .in('bloque_config_id', [...porConfig.keys()])

      for (const inst of ((instancias ?? []) as Array<{ id: string; data: Record<string, unknown> | null; bloque_config_id: string }>)) {
        const cfg = porConfig.get(inst.bloque_config_id)
        if (!cfg) continue
        const dataActual = (inst.data ?? {}) as Record<string, unknown>
        const ciclosPrevios = (dataActual._ciclos ?? []) as unknown[]
        const { _ciclos: _omit, ...datosDelCiclo } = dataActual
        if (Object.keys(datosDelCiclo).length === 0 && ciclosPrevios.length === 0) continue

        // Limpiar no es borrar: el ciclo anterior queda consultable dentro del propio
        // bloque, igual que en el reproceso.
        const nace = cfg.estado === 'visible'
          && visiblePuedeNacerCompleto(cfg.config_extra, {}, cfg.es_gate === true)

        const { error: errUpd } = await db(supabase)
          .from('negocio_bloques')
          .update({
            data: {
              _ciclos: [
                ...ciclosPrevios,
                {
                  ciclo,
                  archivado_at: ahora,
                  tipo: 'retorno_decision',
                  campo: retorno.campoDecisor,
                  data: datosDelCiclo,
                },
              ],
            },
            estado: nace ? 'completo' : 'pendiente',
            completado_at: nace ? ahora : null,
            updated_at: ahora,
          })
          .eq('id', inst.id)
        if (errUpd) console.error('[retorno] no se pudo archivar el bloque', inst.id, errUpd)
        else archivados++
      }
    }

    // ── Sembrar las casillas que le falten a la etapa destino ─────────────
    //
    // ⚠️ Un retorno REABRE gates ya cerrados, y un gate sin casilla no retiene nada:
    // `gates_pendientes_etapa` hace JOIN contra `negocio_bloques`, así que un bloque gate
    // sin instancia es invisible para el motor. Medido el 2026-08-03 en SOENA: a los 163
    // casos que pasaron por Documentación les faltan **653** casillas de bloques gate,
    // entre ellas la del bloque que responde `requiere_cita_dian` en 36 casos. Devolver
    // sin sembrar dejaría al caso saliendo otra vez sin responder la pregunta — el mismo
    // falso verde que obligó al backfill de 297 el 2026-07-31.
    const { data: configsDestinoRaw } = await db(supabase)
      .from('bloque_configs')
      .select('id, estado, es_gate, config_extra')
      .eq('etapa_id', retorno.etapaId)
    const configsDestino = ((configsDestinoRaw ?? []) as Array<{
      id: string
      estado: string | null
      es_gate: boolean | null
      config_extra: Record<string, unknown> | null
    }>).filter(c => c.config_extra?.desactivado !== true)

    if (configsDestino.length > 0) {
      const { data: yaTiene } = await db(supabase)
        .from('negocio_bloques')
        .select('bloque_config_id')
        .eq('negocio_id', negocioId)
        .in('bloque_config_id', configsDestino.map(c => c.id))
      const existentes = new Set(
        ((yaTiene ?? []) as Array<{ bloque_config_id: string }>).map(r => r.bloque_config_id),
      )
      const faltantes = configsDestino.filter(c => !existentes.has(c.id))
      if (faltantes.length > 0) {
        // Misma regla que el auto-init de la etapa: un `visible` que es gate y tiene
        // campos obligatorios sin valor NO nace resuelto.
        const nuevas = faltantes.map(c => {
          const nace = c.estado === 'visible'
            && visiblePuedeNacerCompleto(c.config_extra, {}, c.es_gate === true)
          return {
            negocio_id: negocioId,
            bloque_config_id: c.id,
            estado: nace ? 'completo' : 'pendiente',
            data: {},
            ...(nace ? { completado_at: ahora } : {}),
          }
        })
        const { error: errSiembra } = await db(supabase).from('negocio_bloques').insert(nuevas)
        if (errSiembra) console.error('[retorno] no se pudieron sembrar casillas del destino', errSiembra)
      }
    }

    // ── Mover el negocio y dejar marca ────────────────────────────────────
    let nombreAutor: string | null = null
    if (userId) {
      const { data: prof } = await db(supabase).from('profiles').select('full_name').eq('id', userId).maybeSingle()
      nombreAutor = (prof as { full_name?: string } | null)?.full_name ?? null
    }

    const marca = {
      activo: true,
      ciclo,
      campo: retorno.campoDecisor,
      campo_respondido: retorno.campoFuente,
      valor_anterior: retorno.antes ?? null,
      valor_nuevo: retorno.despues ?? null,
      causa,
      etapa_retorno: retorno.etapaNombre,
      desde_etapa: etapaAnterior,
      bloques_archivados: archivados,
      abierto_at: ahora,
      abierto_por: staffId ?? null,
      abierto_por_nombre: nombreAutor,
    }

    // `stage_actual` lo sincroniza el trigger `sync_negocio_stage_from_etapa`: escribirlo
    // aquí sería una segunda fuente para el mismo dato.
    const { error: errMover } = await db(supabase)
      .from('negocios')
      .update({
        etapa_actual_id: retorno.etapaId,
        metadata: { ...(n.metadata ?? {}), retorno_decision: marca },
      })
      .eq('id', negocioId)
      .eq('workspace_id', workspaceId)
    if (errMover) {
      console.error('[retorno] no se pudo mover el negocio', errMover)
      return null
    }

    // ── Traza ─────────────────────────────────────────────────────────────
    // `autor_id` es FK a **staff(id)**, NO a profiles. Pasarle el profile.id viola la FK y
    // el evento se pierde sin ruido: ya pasó con la primera corrección real (V0254).
    // Y el `tipo` tiene que existir en el CHECK de `activity_log` — 'cambio_etapa' está;
    // 'reproceso' NO (por eso la traza del reproceso nunca llegó a escribirse).
    if (staffId) {
      const { error: errLog } = await db(supabase).from('activity_log').insert({
        workspace_id: workspaceId,
        entidad_tipo: 'negocio',
        entidad_id: negocioId,
        tipo: 'cambio_etapa',
        autor_id: staffId,
        campo_modificado: 'etapa',
        valor_anterior: etapaAnterior,
        valor_nuevo: retorno.etapaNombre,
        contenido:
          `Vuelve a ${retorno.etapaNombre} para volver a decidir: se corrigió «${retorno.campoDecisor}». ` +
          `Causa: ${LABEL_CAUSA[causa]}.`,
      })
      if (errLog) console.error('[retorno] no se pudo escribir el evento del timeline', errLog)
    }

    // ── Notificar, igual que el reproceso ─────────────────────────────────
    const { data: destinatarios } = await db(supabase)
      .from('profiles')
      .select('id, role')
      .eq('workspace_id', workspaceId)
      .in('role', ['owner', 'admin', 'supervisor'])

    const etiqueta = n.codigo ? `${n.codigo} — ${n.nombre ?? ''}`.trim() : (n.nombre ?? 'Negocio')
    for (const d of ((destinatarios ?? []) as Array<{ id: string }>)) {
      if (userId && d.id === userId) continue
      // Tipo `reproceso`: es el único del CHECK de `notificaciones` que corresponde a
      // "este caso volvió atrás". Un tipo fuera del CHECK hace fallar el insert EN
      // SILENCIO, así que no se inventa uno nuevo sin migración aplicada.
      await db(supabase).rpc('crear_notificacion', {
        p_workspace_id: workspaceId,
        p_destinatario_id: d.id,
        p_tipo: 'reproceso',
        p_contenido: `${etiqueta} vuelve a ${retorno.etapaNombre}: se corrigió el dato que decide la ruta.`,
        p_entidad_tipo: 'negocio',
        p_entidad_id: negocioId,
        p_deep_link: `/negocios/${negocioId}`,
        p_metadata: { motivo: 'retorno_decision', campo: retorno.campoDecisor, ciclo },
        p_permitir_repetidas: true,
      })
    }

    return { etapaNombre: retorno.etapaNombre, etapaAnterior, bloquesArchivados: archivados }
  } catch (err) {
    console.error('[retorno] no se pudo devolver el caso al punto de decisión:', err)
    return null
  }
}
