'use server'

/**
 * Devolver un bloque a su área de origen para que lo corrijan.
 *
 * Las reglas puras (motivos, marca, lectura) viven en `@/lib/negocios/devolucion`, que
 * explica por qué esto NO es un reproceso y por qué se devuelve el bloque y no la etapa.
 * Aquí queda solo lo que necesita base de datos: permisos, marca, hecho y aviso.
 *
 * ⚠️ El hecho se escribe con `service_role`. `devolucion_eventos` le revoca la escritura a
 * `authenticated` a propósito, para que quien devuelve mal no pueda borrar su propia
 * devolución y dejar el indicador contando de menos justo donde importa. Es la misma
 * decisión de `reproceso_eventos`.
 */

import { revalidatePath } from 'next/cache'
import { getWorkspace } from './get-workspace'
import { createServiceClient } from '@/lib/supabase/server'
import {
  debeMoverElCaso,
  devolucionHabilitada,
  esMotivoValido,
  leerDevolucion,
  origenDeCopiaHeredada,
  puedeDevolverBloque,
  LABEL_MOTIVO,
  type MarcaDevolucion,
  type MotivoDevolucion,
} from '@/lib/negocios/devolucion'

/**
 * Mismo escape de tipos que usa `reproceso-actions`: `negocio_bloques.data` y las tablas
 * nuevas existen en la base pero no en `database.ts`, y regenerar los tipos arrastra
 * alias a mano que no tocan a este frente.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(supabase: unknown): any {
  return supabase
}

/** Qué `negocio_responsables.rol` atiende cada stage. Null = no hay uno obvio. */
const ROL_POR_STAGE: Record<string, string | undefined> = {
  venta: 'comercial',
  ejecucion: 'operaciones',
}

type BloqueRow = {
  id: string
  negocio_id: string
  estado: string | null
  data: Record<string, unknown> | null
  bloque_configs: {
    slug: string | null
    nombre: string | null
    config_extra: Record<string, unknown> | null
    etapas_negocio: {
      id: string
      nombre: string | null
      stage: string | null
      numero: number | null
    } | null
  } | null
}

const SELECT_BLOQUE = `
  id, negocio_id, estado, data,
  bloque_configs!inner(slug, nombre, config_extra, etapas_negocio!inner(id, nombre, stage, numero))
`

/**
 * Marca el bloque como devuelto: lo reabre, devuelve el CASO a la etapa del bloque, deja
 * el motivo visible para quien corrige, asienta el hecho y avisa al área dueña.
 *
 * Recibe el id de la casilla que el usuario tenía en pantalla, que casi nunca es la que
 * hay que reabrir: operaciones mira la copia heredada en su propia etapa. Lo primero que
 * se hace es redirigir al ORIGEN. Ver `@/lib/negocios/devolucion` para el porqué de cada
 * decisión.
 */
export async function devolverBloque(
  negocioBloqueId: string,
  input: { motivo: MotivoDevolucion; nota?: string },
): Promise<{ ok: boolean; error?: string; bloqueNombre?: string; movidoA?: string | null }> {
  const { supabase, workspaceId, staffId, userId, role, error } = await getWorkspace()
  if (error || !workspaceId || !userId) return { ok: false, error: 'No autenticado' }

  if (!esMotivoValido(input.motivo)) {
    return { ok: false, error: 'Escoge por qué se devuelve el documento' }
  }
  const nota = (input.nota ?? '').trim() || null

  const { data: bloque } = await db(supabase)
    .from('negocio_bloques')
    .select(SELECT_BLOQUE)
    .eq('id', negocioBloqueId)
    .maybeSingle()

  let b = bloque as BloqueRow | null
  if (!b) return { ok: false, error: 'Bloque no encontrado' }

  // ── Redirigir a la casilla del ORIGEN ─────────────────────────────────
  // La copia heredada tiene fila propia, pero solo su `data` se intercambia por la del
  // origen al pintarla: reabrir la copia dejaría pendiente una casilla que nadie mira,
  // mientras el documento malo sigue marcado como bueno donde de verdad vive. Es el mismo
  // criterio de `casilla-compartida.resolverDestino`, aplicado a la herencia readonly.
  const slugOrigen = origenDeCopiaHeredada(b.bloque_configs?.config_extra)
  if (slugOrigen) {
    const { data: filas } = await db(supabase)
      .from('negocio_bloques')
      .select(SELECT_BLOQUE)
      .eq('negocio_id', b.negocio_id)
      .eq('bloque_configs.slug', slugOrigen)
      .limit(2)
    const candidatos = (filas ?? []) as BloqueRow[]
    // Ambiguo o inexistente: NO se elige por cuenta propia ni se cae a la copia local.
    // Devolver sobre la fila equivocada es peor que no devolver, porque el aviso sale
    // igual y el documento malo se queda donde está.
    if (candidatos.length !== 1) {
      console.error('[devolucion] origen no resoluble:', slugOrigen, negocioBloqueId, candidatos.length)
      return { ok: false, error: 'No se encontró la casilla original de este documento. Avisa a soporte.' }
    }
    b = candidatos[0]
  }

  const cfg = b.bloque_configs
  const bloqueNombre = cfg?.nombre ?? 'Documento'

  // La devolución la habilita la CONFIGURACIÓN del bloque, nunca el código. Sin esto el
  // botón aparecería en bloques que ninguna área de origen atiende, y una devolución que
  // nadie recibe es peor que no tenerla: el caso queda frenado sin dueño.
  if (!devolucionHabilitada(cfg?.config_extra)) {
    return { ok: false, error: 'Este bloque no admite devolución' }
  }

  // Devolver algo que nunca se diligenció no tiene sentido: ya está pendiente y quien lo
  // tiene que llenar ya lo ve como pendiente. Sin este corte, una devolución sobre una
  // casilla vacía generaría un evento y un aviso por un trabajo que nadie hizo todavía.
  if (b.estado !== 'completo') {
    return { ok: false, error: 'El bloque todavía no está diligenciado' }
  }

  const yaDevuelto = leerDevolucion(b.data)
  if (yaDevuelto) {
    return { ok: false, error: `Ya está devuelto: ${LABEL_MOTIVO[yaDevuelto.motivo]}` }
  }

  const { data: negocio } = await db(supabase)
    .from('negocios')
    .select('id, workspace_id, codigo, nombre, estado, stage_actual, etapa_actual_id')
    .eq('id', b.negocio_id)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  const n = negocio as {
    codigo: string | null
    nombre: string | null
    stage_actual: string | null
    etapa_actual_id: string | null
  } | null
  if (!n) return { ok: false, error: 'Negocio no encontrado' }
  if (n.stage_actual === 'cerrado') {
    return { ok: false, error: 'El negocio está cerrado. Reábrelo antes de devolver un documento.' }
  }

  // ── Permisos ──────────────────────────────────────────────────────────
  // Devolver NO es editar. `guardEditarBloque` resuelve el área por el stage del BLOQUE,
  // así que exigirlo dejaría por fuera justo a quien detecta el error: operaciones mirando
  // un documento que es de comercial. Aquí basta con estar en el caso, o supervisar.
  let esResponsable = false
  if (staffId) {
    const { data: resp } = await db(supabase)
      .from('negocio_responsables')
      .select('staff_id')
      .eq('negocio_id', b.negocio_id)
      .eq('staff_id', staffId)
      .maybeSingle()
    esResponsable = Boolean(resp)
  }
  if (!puedeDevolverBloque(role, esResponsable)) {
    return { ok: false, error: 'Solo quien trabaja el caso o un supervisor puede devolver un documento' }
  }

  // Nombre de quien devuelve, resuelto AHORA y guardado en la marca. Quien corrige tiene
  // que saber a quién preguntarle, y una marca que solo trae el id obliga a la pantalla a
  // resolver un nombre que puede no estar en el payload. Es el mismo defecto que quedó
  // abierto en la marca de "no aplica".
  let porNombre: string | null = null
  if (staffId) {
    const { data: st } = await db(supabase)
      .from('staff')
      .select('nombre')
      .eq('id', staffId)
      .maybeSingle()
    porNombre = (st as { nombre: string | null } | null)?.nombre ?? null
  }

  const etapaBloque = cfg?.etapas_negocio?.nombre ?? null
  const stageBloque = cfg?.etapas_negocio?.stage ?? null

  // Dónde estaba el CASO al devolver, que no es donde vive el documento. Responde "en qué
  // punto se detecta el error", que es la pregunta con la que se arregla el proceso.
  let etapaAlDevolver: string | null = null
  let numeroEtapaActual: number | null = null
  if (n.etapa_actual_id) {
    const { data: et } = await db(supabase)
      .from('etapas_negocio')
      .select('nombre, numero')
      .eq('id', n.etapa_actual_id)
      .maybeSingle()
    const e = et as { nombre: string | null; numero: number | null } | null
    etapaAlDevolver = e?.nombre ?? null
    numeroEtapaActual = e?.numero ?? null
  }

  // ── El hecho, antes que la marca ──────────────────────────────────────
  // Si el insert del evento falla, se aborta sin tocar el bloque. Al revés (marcar y luego
  // fallar) dejaría una casilla reabierta que el indicador nunca vería: exactamente el
  // agujero que este frente viene a cerrar.
  const admin = createServiceClient()
  const { data: evento, error: errEvento } = await db(admin)
    .from('devolucion_eventos')
    .insert({
      workspace_id: workspaceId,
      negocio_id: b.negocio_id,
      negocio_bloque_id: b.id,
      bloque_slug: cfg?.slug ?? null,
      bloque_nombre: bloqueNombre,
      motivo: input.motivo,
      nota,
      etapa_al_devolver: etapaAlDevolver,
      devuelto_por: staffId ?? null,
    })
    .select('id')
    .maybeSingle()

  if (errEvento || !evento) {
    console.error('[devolucion] no se pudo asentar el evento:', errEvento)
    return { ok: false, error: 'No se pudo registrar la devolución. Intenta de nuevo.' }
  }

  const marca: MarcaDevolucion = {
    motivo: input.motivo,
    nota,
    por: staffId ?? null,
    por_nombre: porNombre,
    etapa: etapaAlDevolver,
    en: new Date().toISOString(),
    evento_id: (evento as { id: string }).id,
  }

  // Reabrir la casilla es lo que hace que el gate vuelva a retener el caso y que la
  // pantalla del área de origen la muestre como trabajo pendiente. Sin esto la devolución
  // sería un comentario más: visible para quien lo lee, invisible para el flujo.
  const { error: errUpd } = await db(supabase)
    .from('negocio_bloques')
    .update({
      data: { ...(b.data ?? {}), _devolucion: marca },
      estado: 'pendiente',
      completado_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', b.id)

  if (errUpd) {
    console.error('[devolucion] no se pudo marcar el bloque:', errUpd)
    // El evento ya quedó asentado; borrarlo aquí requeriría la escritura que se le revocó
    // a `authenticated` justo para que nadie borre devoluciones. Se cierra como resuelto en
    // el mismo instante, que en el indicador se lee como una devolución sin efecto.
    await db(admin)
      .from('devolucion_eventos')
      .update({ resuelto_at: new Date().toISOString() })
      .eq('id', (evento as { id: string }).id)
    return { ok: false, error: 'No se pudo devolver el documento. Intenta de nuevo.' }
  }

  // ── Devolver el CASO a la etapa del bloque ────────────────────────────
  // Reabrir la casilla sola no resolvía el dolor: el caso seguía en la bandeja de
  // operaciones, así que perseguir al cliente seguía siendo trabajo de operaciones. El
  // destino NO se enumera en código — es la etapa donde vive el bloque que se devolvió,
  // que en los tres habilitados hoy es de venta y por eso el caso vuelve al comercial.
  //
  // ⚠️ Se compara por `numero`, nunca por `orden`: ver `debeMoverElCaso`.
  //
  // Va DESPUÉS de reabrir la casilla y no antes. Al revés, un fallo al marcar el bloque
  // dejaría el caso movido a una etapa cuyo gate ya está satisfecho: el comercial lo
  // recibe sin nada que corregir y lo empuja de vuelta.
  //
  // Si la etapa no se puede mover, la devolución NO se revierte. La casilla reabierta y
  // el aviso ya hacen el trabajo principal, y deshacerlas por esto dejaría al operador
  // sin ninguna de las dos. Se registra el fallo y se sigue.
  let movidoA: string | null = null
  const etapaOrigen = cfg?.etapas_negocio ?? null
  if (etapaOrigen && debeMoverElCaso(numeroEtapaActual, etapaOrigen.numero)) {
    const { error: errMover } = await db(supabase)
      .from('negocios')
      .update({
        etapa_actual_id: etapaOrigen.id,
        stage_actual: etapaOrigen.stage,
        updated_at: new Date().toISOString(),
      })
      .eq('id', b.negocio_id)
      .eq('workspace_id', workspaceId)

    if (errMover) {
      console.error('[devolucion] no se pudo mover el caso:', errMover)
    } else {
      movidoA = etapaOrigen.nombre
      if (staffId) {
        await db(supabase).from('activity_log').insert({
          workspace_id: workspaceId,
          entidad_tipo: 'negocio',
          entidad_id: b.negocio_id,
          tipo: 'cambio_etapa',
          autor_id: staffId,
          campo_modificado: 'etapa_actual_id',
          valor_anterior: etapaAlDevolver,
          valor_nuevo: etapaOrigen.nombre,
          contenido: `Volvió a ${etapaOrigen.nombre ?? 'la etapa de origen'} por devolución de "${bloqueNombre}".`.slice(0, 280),
        })
      }
    }
  }

  // ── Traza en el timeline del negocio ──────────────────────────────────
  // ⚠️ `tipo` DEBE existir en el CHECK de `activity_log` (comentario, cambio, sistema,
  // cambio_etapa, cambio_estado, solicitud_conciliacion, conciliacion_atendida). Un tipo
  // fuera de la lista falla EN SILENCIO y la traza no se escribe. Se usa `cambio`, que es
  // lo que ocurre, con `campo_modificado` estable para poder contarlo sin leer el texto.
  if (staffId) {
    const { error: errLog } = await db(supabase).from('activity_log').insert({
      workspace_id: workspaceId,
      entidad_tipo: 'negocio',
      entidad_id: b.negocio_id,
      tipo: 'cambio',
      autor_id: staffId,
      campo_modificado: 'devolucion_bloque',
      valor_anterior: bloqueNombre,
      valor_nuevo: input.motivo,
      contenido: `Devolvió "${bloqueNombre}": ${LABEL_MOTIVO[input.motivo]}.${movidoA ? ` El caso volvió a ${movidoA}.` : ''}${nota ? ` ${nota}` : ''}`.slice(0, 280),
    })
    if (errLog) console.error('[devolucion] no se pudo escribir la traza:', errLog)
  }

  // ── Aviso al área dueña del bloque ────────────────────────────────────
  // Se notifica a quien tiene que corregir, no a todo el mundo: una devolución es trabajo
  // concreto para una persona. Si el caso no tiene responsable de esa área, cae a
  // supervisión, que es quien puede asignarlo.
  const rolDestino = stageBloque ? ROL_POR_STAGE[stageBloque] : undefined
  const destinatarios = new Set<string>()

  if (rolDestino) {
    const { data: resps } = await db(supabase)
      .from('negocio_responsables')
      .select('staff:staff_id(profile_id)')
      .eq('negocio_id', b.negocio_id)
      .eq('rol', rolDestino)
    for (const r of ((resps ?? []) as Array<{ staff: { profile_id: string | null } | null }>)) {
      if (r.staff?.profile_id) destinatarios.add(r.staff.profile_id)
    }
  }

  if (destinatarios.size === 0) {
    const { data: sup } = await db(supabase)
      .from('profiles')
      .select('id')
      .eq('workspace_id', workspaceId)
      .in('role', ['owner', 'admin', 'supervisor'])
    for (const p of ((sup ?? []) as Array<{ id: string }>)) destinatarios.add(p.id)
  }

  const etiqueta = n.codigo ? `${n.codigo} — ${n.nombre ?? ''}`.trim() : (n.nombre ?? 'Negocio')
  for (const destinatarioId of destinatarios) {
    if (destinatarioId === userId) continue // quien devolvió ya lo sabe
    // `permitir_repetidas` porque cada devolución es un hecho distinto: el dedup por
    // defecto suprimiría el aviso de la segunda si la primera sigue pendiente, y eso es
    // justo cuando más hay que avisar.
    await db(supabase).rpc('crear_notificacion', {
      p_workspace_id: workspaceId,
      p_destinatario_id: destinatarioId,
      p_tipo: 'devolucion_bloque',
      p_contenido: `${etiqueta}: corregir "${bloqueNombre}". ${LABEL_MOTIVO[input.motivo]}.`,
      p_entidad_tipo: 'negocio',
      p_entidad_id: b.negocio_id,
      p_deep_link: `/negocios/${b.negocio_id}`,
      p_metadata: {
        motivo: input.motivo,
        bloque_slug: cfg?.slug ?? null,
        bloque_nombre: bloqueNombre,
        etapa_bloque: etapaBloque,
      },
      p_permitir_repetidas: true,
    })
  }

  revalidatePath(`/negocios/${b.negocio_id}`)
  revalidatePath('/negocios')
  return { ok: true, bloqueNombre, movidoA }
}
