'use server'

/**
 * Reprocesos — devolver un negocio a una etapa anterior para rehacer un tramo del
 * flujo cuando un tercero rechaza el trabajo.
 *
 * A diferencia de `reabrirNegocio` (que resucita un negocio CERRADO), un reproceso
 * ocurre con el negocio vivo: la UPME emite un certificado malo, o la DIAN devuelve
 * la solicitud de devolución. El caso vuelve atrás y recorre los mismos pasos.
 *
 * Tres decisiones de diseño:
 *
 * 1. **La etapa destino no está en el código.** Cada etapa declara de qué reproceso
 *    es punto de retorno vía `config_extra.reproceso_de`. Así el flujo se puede
 *    reordenar sin tocar este archivo, y otras líneas de negocio pueden usarlo.
 *
 * 2. **Limpiar no es borrar.** El dato del ciclo anterior se archiva dentro del
 *    propio bloque, en `data._ciclos`, antes de vaciar los campos. El operario
 *    vuelve a llenar en limpio, pero nada se pierde: el ciclo 1 sigue consultable
 *    cuando va por el ciclo 3.
 *
 * 3. **Un reproceso no es un detalle interno.** Queda marcado en el negocio, se ve
 *    en el listado y notifica a supervisores y owner. Juan David lo pidió así:
 *    sin esto "queda como en un limbo porque no hay forma de rastrearlo" y
 *    reaparece semanas después.
 */

import { revalidatePath } from 'next/cache'
import { getWorkspace } from './get-workspace'
import { createServiceClient } from '@/lib/supabase/server'
import { getAreasEfectivas, type Area } from '@/lib/permissions/can-edit'
import {
  resolverAtribucionReproceso,
  type CausaReproceso,
  type TipoReproceso,
} from '@/lib/negocios/atribucion-reproceso'
import { registrarActividad } from '@/lib/activity/registrar-actividad'

/**
 * Los tipos generados de Supabase van por detrás del esquema real: `negocios.metadata`
 * y el `data` jsonb de los bloques existen en la base pero no en `database.ts`. Mismo
 * escape que usa `negocio-v2-actions`, para no bloquear esto en una regeneración de
 * tipos que arrastra 26 alias a mano.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(supabase: unknown): any {
  return supabase
}

// Los tipos viven en `@/lib/negocios/atribucion-reproceso`. NO re-exportarlos desde
// aqui: en un archivo 'use server' el build de produccion convierte cada export en
// referencia de runtime, y un `export type { X }` de un simbolo importado queda
// apuntando a una variable que no existe (ReferenceError al evaluar el modulo).
// Los tipos declarados en este archivo (como ReprocesoMarca) si se erasan bien.

export type ReprocesoMarca = {
  activo: boolean
  tipo: TipoReproceso
  ciclo: number
  causa: CausaReproceso
  detalle: string
  abierto_at: string
  abierto_por: string | null
  abierto_por_nombre: string | null
  etapa_retorno: string | null
}

const LABEL_TIPO: Record<TipoReproceso, string> = {
  certificacion_upme: 'Certificación UPME',
  devolucion_dian: 'Devolución DIAN',
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getStaffAreas(supabase: any, staffId: string): Promise<Area[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('staff_areas')
    .select('area')
    .eq('staff_id', staffId)
  const VALID_AREAS: readonly string[] = ['comercial', 'operaciones', 'financiera', 'direccion']
  return ((data ?? []) as Array<{ area: string }>)
    .map((r) => r.area)
    .filter((a): a is Area => VALID_AREAS.includes(a))
}

/**
 * A quien se le carga el reproceso: quien completo el bloque del tramo que hay
 * que rehacer. Devuelve un `staff.id`, o NULL si el trabajo no tiene autor
 * (cargue masivo por SQL) o si quien lo hizo no esta en `staff`.
 *
 * ⚠️ `negocio_bloques.completado_por` apunta a `profiles.id`, mientras que el
 * indicador se agrupa por `staff.id`. El puente es `staff.profile_id`. Usar uno
 * por el otro da cero silencioso: `negocios.responsable_id` SI es `staff.id`, y
 * confundirlos es facil.
 */
/**
 * Devuelve el negocio a la etapa que corresponda al tipo de reproceso, archivando
 * el ciclo anterior y dejando marca visible.
 */
export async function reprocesarNegocio(
  negocioId: string,
  input: { tipo: TipoReproceso; causa: CausaReproceso; detalle: string },
): Promise<{ ok: boolean; error?: string; etapaNombre?: string; ciclo?: number }> {
  const { supabase, workspaceId, staffId, userId, role, error } = await getWorkspace()
  if (error || !workspaceId || !userId) return { ok: false, error: 'No autenticado' }

  const detalle = (input.detalle ?? '').trim()
  if (!detalle) return { ok: false, error: 'Describe por qué se reprocesa el caso' }

  const { data: negocio } = await db(supabase)
    .from('negocios')
    .select('id, workspace_id, estado, stage_actual, etapa_actual_id, linea_id, metadata, codigo, nombre')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (!negocio) return { ok: false, error: 'Negocio no encontrado' }
  const n = negocio as {
    stage_actual: string | null
    etapa_actual_id: string | null
    linea_id: string | null
    metadata: Record<string, unknown> | null
    codigo: string | null
    nombre: string | null
  }

  if (n.stage_actual === 'cerrado') {
    return { ok: false, error: 'El negocio está cerrado. Reábrelo antes de reprocesarlo.' }
  }
  if (!n.linea_id || !n.etapa_actual_id) {
    return { ok: false, error: 'El negocio no tiene etapa activa' }
  }

  // ── Permisos ──────────────────────────────────────────────────────────
  // Un reproceso rehace trabajo ya hecho y penaliza indicadores de calidad, así
  // que no lo dispara cualquiera: dirección, o un supervisor de operaciones.
  if (role !== 'owner' && role !== 'admin') {
    if (role !== 'supervisor') {
      return { ok: false, error: 'Solo supervisores de operaciones, admin u owner pueden reprocesar' }
    }
    if (!staffId) return { ok: false, error: 'Sin staff vinculado' }
    const areas = await getStaffAreas(supabase, staffId)
    const areasEf = getAreasEfectivas({ id: staffId, role: 'supervisor', areas })
    if (!areasEf.has('operaciones')) {
      return { ok: false, error: 'Necesitas área de operaciones para reprocesar' }
    }
  }

  // ── Etapa destino, declarada por la propia etapa ──────────────────────
  const { data: etapas } = await supabase
    .from('etapas_negocio')
    .select('id, nombre, orden, config_extra')
    .eq('linea_id', n.linea_id)
    .order('orden', { ascending: true })

  type EtapaRow = { id: string; nombre: string; orden: number; config_extra: Record<string, unknown> | null }
  const todas = (etapas ?? []) as EtapaRow[]

  const destino = todas.find((e) => {
    const decl = (e.config_extra?.reproceso_de ?? null) as string[] | string | null
    if (!decl) return false
    return Array.isArray(decl) ? decl.includes(input.tipo) : decl === input.tipo
  })
  if (!destino) {
    return {
      ok: false,
      error: `Ninguna etapa está declarada como punto de retorno para "${LABEL_TIPO[input.tipo]}"`,
    }
  }

  const etapaActual = todas.find((e) => e.id === n.etapa_actual_id)
  if (!etapaActual) return { ok: false, error: 'Etapa actual no encontrada en la línea' }
  if (etapaActual.orden < destino.orden) {
    return {
      ok: false,
      error: `El negocio está en ${etapaActual.nombre}, antes de ${destino.nombre}. No hay nada que reprocesar.`,
    }
  }

  // ── Archivar el ciclo y limpiar los bloques del tramo ─────────────────
  // Solo el tramo que se va a rehacer: desde la etapa de retorno hasta la actual.
  // Lo anterior no se toca, porque no se vuelve a recorrer.
  const idsTramo = todas.filter((e) => e.orden >= destino.orden && e.orden <= etapaActual.orden).map((e) => e.id)

  const marcaPrevia = (n.metadata?.reproceso ?? null) as ReprocesoMarca | null
  const ciclo = (marcaPrevia?.ciclo ?? 0) + 1
  const archivadoAt = new Date().toISOString()

  const { data: bloquesTramo } = await db(supabase)
    .from('negocio_bloques')
    .select('id, data, estado, bloque_configs!inner(etapa_id, config_extra)')
    .eq('negocio_id', negocioId)
    .in('bloque_configs.etapa_id', idsTramo)

  type BloqueRow = {
    id: string
    data: Record<string, unknown> | null
    estado: string | null
    bloque_configs: { etapa_id: string; config_extra: Record<string, unknown> | null } | null
  }

  for (const b of ((bloquesTramo ?? []) as BloqueRow[])) {
    // Los heredados readonly apuntan al mismo dato que su bloque origen; limpiarlos
    // borraría información de una etapa que no se está reprocesando.
    if (b.bloque_configs?.config_extra?.source_etapa_orden !== undefined) continue

    // `conservar_en_reproceso`: documentos que siguen sirviendo en el ciclo nuevo y
    // no hay por qué volver a pedirle al cliente. El caso es el certificado
    // bancario: dura 30 días, así que si el reproceso consigue una cita pronto el
    // mismo documento vale. Se conserva y es su cross-check de vigencia el que
    // avisa, ya contra la fecha de la cita NUEVA, si esta vez sí venció.
    //
    // Limpiarlo sin más haría que cada reproceso pidiera certificado nuevo, aunque
    // el que está sirva.
    if (b.bloque_configs?.config_extra?.conservar_en_reproceso === true) continue

    const dataActual = (b.data ?? {}) as Record<string, unknown>
    const ciclosPrevios = (dataActual._ciclos ?? []) as unknown[]
    const { _ciclos: _omit, ...datosDelCiclo } = dataActual
    // Sin nada que archivar y ya vacío: no se toca.
    if (Object.keys(datosDelCiclo).length === 0 && ciclosPrevios.length === 0) continue

    await db(supabase)
      .from('negocio_bloques')
      .update({
        data: {
          _ciclos: [...ciclosPrevios, { ciclo, archivado_at: archivadoAt, tipo: input.tipo, data: datosDelCiclo }],
        },
        estado: 'pendiente',
      })
      .eq('id', b.id)
  }

  // ── Mover el negocio y dejar la marca ─────────────────────────────────
  let nombreAutor: string | null = null
  if (staffId) {
    const { data: st } = await supabase.from('staff').select('full_name').eq('id', staffId).maybeSingle()
    nombreAutor = (st as { full_name?: string } | null)?.full_name ?? null
  }

  const marca: ReprocesoMarca = {
    activo: true,
    tipo: input.tipo,
    ciclo,
    causa: input.causa,
    detalle,
    abierto_at: archivadoAt,
    abierto_por: staffId ?? null,
    abierto_por_nombre: nombreAutor,
    etapa_retorno: destino.nombre,
  }

  const { error: updErr } = await db(supabase)
    .from('negocios')
    .update({
      etapa_actual_id: destino.id,
      metadata: { ...(n.metadata ?? {}), reproceso: marca },
    })
    .eq('id', negocioId)

  if (updErr) return { ok: false, error: (updErr as { message: string }).message }

  // ── Historial del reproceso: el insumo REAL del indicador de calidad ──
  //
  // La marca de arriba vive en `negocios.metadata.reproceso` y solo conserva el
  // ciclo VIGENTE: al abrir el ciclo 2 se pisa el 1. Sirve para pintar el estado
  // del caso, no para contar "cuantos certificados malos hubo en julio", que es
  // lo que pesa el 40% del bono. Por eso cada ciclo se asienta como un hecho
  // propio en `reproceso_eventos`.
  //
  // `atribuido_a` es quien HIZO el trabajo que hay que rehacer, no quien reporta
  // el reproceso (eso siempre es la supervisora, y cargarselo a ella invertiria
  // el indicador). Se resuelve contra el `completado_por` del bloque del tramo.
  // Si no se puede resolver —trabajo que entro por cargue masivo, sin autor— se
  // deja en NULL y el tablero lo cuenta como "sin atribuir" en vez de colgarselo
  // a alguien por descarte.
  //
  // ⚠️ El hecho se escribe con `service_role`, no con el cliente de la sesion.
  // `reproceso_eventos` le revoca la escritura a `authenticated` A PROPOSITO —
  // de este insumo cuelga el 40% del bono, asi que quien reprocesa no puede
  // insertar ni borrar eventos por su cuenta desde PostgREST, donde el guard de
  // este server action no lo protege. `devolucion_eventos` tomo la misma
  // decision y su escritor si usa `service_role`.
  //
  // Esta linea usaba el cliente de la sesion, o sea que el insert devolvia
  // **42501 `permission denied for table reproceso_eventos`** en cada reproceso
  // y el `console.error` de abajo se lo tragaba. Medido el 2026-08-31: la tabla
  // tenia **0 filas** con **7 reprocesos reales** ya abiertos por la supervisora
  // entre el 13 y el 27 de agosto. La politica estaba bien; el que se quedo
  // atras fue el escritor.
  const admin = createServiceClient()
  const atribuidoA = await resolverAtribucionReproceso(supabase, negocioId, input.tipo)
  const { error: errEvento } = await db(admin).from('reproceso_eventos').insert({
    workspace_id: workspaceId,
    negocio_id: negocioId,
    ciclo,
    tipo: input.tipo,
    causa: input.causa,
    detalle,
    atribuido_a: atribuidoA,
    abierto_por: staffId ?? null,
    abierto_at: archivadoAt,
  })
  // Si el hecho no se asienta, el reproceso NO se deshace: el caso ya volvio a su
  // etapa y eso es lo que el equipo necesita. Pero el fallo deja de ser mudo — la
  // primera vez costo 7 eventos de calidad. El aviso va al timeline del negocio,
  // que es donde alguien lo puede ver; un `console.error` no lo mira nadie.
  if (errEvento) {
    console.error('[reproceso] no se pudo asentar el evento de calidad:', errEvento)
    await registrarActividad(db(admin), {
      workspace_id: workspaceId,
      entidad_tipo: 'negocio',
      entidad_id: negocioId,
      tipo: 'sistema',
      autor_id: staffId ?? null,
      contenido:
        `⚠️ El reproceso ${ciclo} se aplico, pero NO quedo registrado en el indicador ` +
        `de calidad. Avisale a MeTRIK para que lo reponga.`,
    }, 'reprocesarNegocio')
  }

  // ── Traza: es el insumo del indicador de calidad ──────────────────────
  //
  // ⚠️ `tipo` tiene que existir en el CHECK de `activity_log`, y **`reproceso` NO está
  // ahí** (la lista es: comentario, cambio, sistema, cambio_etapa, cambio_estado,
  // solicitud_conciliacion, conciliacion_atendida). Esta línea decía `'reproceso'`, así
  // que el insert fallaba y la traza del reproceso nunca se escribía. No se había notado
  // porque no se había corrido ningún reproceso todavía (0 en producción al 2026-08-03) y
  // porque el error del insert no se miraba. ⚠️ Ese "todavía" caducó: al 2026-08-31 hay
  // **7 reprocesos reales**, y el evento de calidad de arriba se estaba perdiendo en cada
  // uno por el mismo descuido. Un tipo fuera del CHECK falla EN SILENCIO:
  // es la cuarta vez que muerde. Se usa `cambio_etapa`, que es lo que de verdad ocurre.
  if (staffId) {
    await registrarActividad(supabase, {
      workspace_id: workspaceId,
      entidad_tipo: 'negocio',
      entidad_id: negocioId,
      tipo: 'cambio_etapa',
      autor_id: staffId,
      campo_modificado: 'etapa',
      contenido:
        `Reproceso ${ciclo} — ${LABEL_TIPO[input.tipo]}. ` +
        `Causa: ${input.causa === 'error_propio' ? 'error propio' : 'criterio del tercero'}. ` +
        `Vuelve a ${destino.nombre}. ${detalle}`,
      valor_anterior: etapaActual.nombre,
      valor_nuevo: destino.nombre,
    }, 'reprocesarNegocio')
  }

  // ── Notificar a supervisores y owner, sin excepción ───────────────────
  // Un reproceso es prioridad máxima: hay un cliente esperando algo que ya creía
  // resuelto. Se notifica aunque nadie esté mirando el tablero.
  const { data: destinatarios } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('workspace_id', workspaceId)
    .in('role', ['owner', 'admin', 'supervisor'])

  const etiqueta = n.codigo ? `${n.codigo} — ${n.nombre ?? ''}`.trim() : (n.nombre ?? 'Negocio')
  for (const d of ((destinatarios ?? []) as Array<{ id: string }>)) {
    if (d.id === userId) continue // quien lo abrió ya lo sabe
    // Vía canónica `crear_notificacion` en vez de insert directo, para heredar lo
    // que se le agregue (correos, etc.). `permitir_repetidas` porque cada ciclo es
    // un hecho distinto: el dedup por defecto suprimiría el aviso del ciclo 2 si el
    // del ciclo 1 sigue pendiente, que es justo cuando más hay que avisar.
    await db(supabase).rpc('crear_notificacion', {
      p_workspace_id: workspaceId,
      p_destinatario_id: d.id,
      p_tipo: 'reproceso',
      p_contenido: `Reproceso ${ciclo} en ${etiqueta}: ${LABEL_TIPO[input.tipo]}. Vuelve a ${destino.nombre}.`,
      p_entidad_tipo: 'negocio',
      p_entidad_id: negocioId,
      p_deep_link: `/negocios/${negocioId}`,
      p_metadata: { tipo_reproceso: input.tipo, causa: input.causa, ciclo },
      p_permitir_repetidas: true,
    })
  }

  revalidatePath(`/negocios/${negocioId}`)
  revalidatePath('/negocios')
  return { ok: true, etapaNombre: destino.nombre, ciclo }
}

/**
 * Cierra la marca de reproceso: el tramo se rehizo y el caso vuelve a la normalidad.
 * El historial de ciclos y la traza en activity_log se conservan; lo único que
 * cambia es que el negocio deja de estar señalado como urgente.
 */
export async function cerrarReproceso(
  negocioId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { supabase, workspaceId, staffId, role, error } = await getWorkspace()
  if (error || !workspaceId) return { ok: false, error: 'No autenticado' }
  if (role !== 'owner' && role !== 'admin' && role !== 'supervisor') {
    return { ok: false, error: 'Solo supervisores, admin u owner pueden cerrar un reproceso' }
  }

  const { data: negocio } = await db(supabase)
    .from('negocios')
    .select('id, metadata')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (!negocio) return { ok: false, error: 'Negocio no encontrado' }

  const metadata = ((negocio as { metadata: Record<string, unknown> | null }).metadata ?? {}) as Record<string, unknown>
  const marca = (metadata.reproceso ?? null) as ReprocesoMarca | null
  if (!marca?.activo) return { ok: false, error: 'Este negocio no tiene un reproceso abierto' }

  const cerradoAt = new Date().toISOString()

  await db(supabase)
    .from('negocios')
    .update({ metadata: { ...metadata, reproceso: { ...marca, activo: false, cerrado_at: cerradoAt } } })
    .eq('id', negocioId)

  // El hecho ya quedo asentado al abrirlo; aqui solo se le pone fecha de cierre.
  // El indicador de calidad cuenta por `abierto_at`, asi que cerrar un reproceso
  // NO lo borra del mes en que ocurrio: el certificado malo ya paso.
  //
  // Con `service_role` por la misma razon que el insert de `reprocesarNegocio`:
  // `authenticated` solo tiene SELECT sobre esta tabla, asi que este UPDATE
  // tambien venia fallando con 42501 — y sin `await` sobre el error, ni siquiera
  // dejaba rastro en la consola.
  await db(createServiceClient())
    .from('reproceso_eventos')
    .update({ cerrado_at: cerradoAt })
    .eq('negocio_id', negocioId)
    .eq('ciclo', marca.ciclo)
    .is('cerrado_at', null)

  if (staffId) {
    // `sistema`: cerrar el reproceso no mueve la etapa. Ver la nota del CHECK arriba.
    await registrarActividad(supabase, {
      workspace_id: workspaceId,
      entidad_tipo: 'negocio',
      entidad_id: negocioId,
      tipo: 'sistema',
      autor_id: staffId,
      contenido: `Reproceso ${marca.ciclo} cerrado — ${LABEL_TIPO[marca.tipo]}.`,
    }, 'cerrarReproceso')
  }

  revalidatePath(`/negocios/${negocioId}`)
  revalidatePath('/negocios')
  return { ok: true }
}
