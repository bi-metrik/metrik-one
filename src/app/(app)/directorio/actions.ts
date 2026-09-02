'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'
import { STATUS_CONTACTO } from '@/lib/catalogos/constants'
import { revalidatePath } from 'next/cache'
import { registrarActividad } from '@/lib/activity/registrar-actividad'
import { buscarContactoDuplicado, mensajeDuplicado } from '@/lib/contactos/dedup'
import { traerTodo } from '@/lib/supabase/paginar'
import { acumularCampana, ordenarCampanas } from '@/lib/contactos/campanas'

type SupabaseDeWorkspace = Awaited<ReturnType<typeof getWorkspace>>['supabase']

/**
 * Deja constancia de quien movio el segmento de un contacto y cuando.
 *
 * Vive aqui y no dentro de una sola action porque el segmento se escribe por DOS
 * caminos —el chip del listado (`updateContactoSegmento`) y el formulario del
 * Contacto 360 (`updateContacto`)—. Instrumentar uno solo daria un historial que
 * miente por omision: el mismo cambio aparece o no segun desde donde se hizo. Ese
 * doble camino ya mordio una vez, ver el comentario de `updateContactoSegmento`.
 *
 * Solo registra cuando el valor CAMBIA. El formulario del 360 reenvia todos los
 * campos en cada guardado, asi que sin esta comparacion dejaria una fila por
 * guardado aunque nadie hubiera tocado el segmento, y el historial se volveria
 * ruido en el que no se encuentra el cambio real.
 *
 * Nunca tumba la escritura: el segmento ya quedo guardado cuando esto corre, y
 * devolver error haria que la pantalla dijera que fallo algo que si ocurrio. Si el
 * registro falla se reporta por consola y el cambio queda sin rastro, que es
 * exactamente lo que pasaba antes de esto.
 */
async function registrarCambioSegmento(
  supabase: SupabaseDeWorkspace,
  workspaceId: string,
  staffId: string | null,
  contactoId: string,
  anterior: string | null,
  nuevo: string | null,
) {
  if ((anterior ?? null) === (nuevo ?? null)) return

  // Un cambio sin autor es medio registro: dice que paso pero no de quien fue, que
  // es lo unico que se pidio. Se escribe igual (perder el evento seria peor), pero
  // queda ruidoso en los logs para no descubrirlo despues mirando la pantalla.
  if (!staffId) {
    console.error('[registrarCambioSegmento] cambio de segmento SIN autor', { contactoId, workspaceId })
  }

  // `registrarActividad` lee el error y lo reporta con entidad, tipo y motivo — el
  // `if (error) console.error(...)` que vivia aqui era esa misma comprobacion escrita
  // a mano, y era la excepcion: los otros ~55 sitios no la tenian.
  await registrarActividad(supabase, {
    workspace_id: workspaceId,
    entidad_tipo: 'contacto',
    entidad_id: contactoId,
    tipo: 'cambio',
    // staff.id, NO profile.id: es la FK que declara `activity_log_autor_id_fkey`.
    autor_id: staffId,
    campo_modificado: 'segmento',
    valor_anterior: anterior,
    valor_nuevo: nuevo,
  }, 'registrarCambioSegmento')
}

// ── Contactos ─────────────────────────────────────────────

// Origen (primer toque) grabado en el contacto desde el webhook (custom_data.origen).
// Es first-touch inmutable: la campaña por la que el contacto llego la primera vez.
export interface OrigenContacto {
  fuente?: string | null
  campaign_id?: string | null
  campaign_name?: string | null
  adset_name?: string | null
  ad_name?: string | null
  platform?: string | null
  first_at?: string | null
}

// Contacto enriquecido para la vista general (calcado del patron de /negocios):
// marca Meta, ultima interaccion (cualquiera y solo Meta) y origen de campana.
export interface ContactoConMeta {
  id: string
  nombre: string
  telefono: string | null
  email: string | null
  fuente_adquisicion: string | null
  rol: string | null
  segmento: string | null
  comision_porcentaje: number | null
  created_at: string | null
  es_meta: boolean
  ultima_interaccion_at: string | null
  ultima_interaccion_meta_at: string | null
  origen: OrigenContacto | null
  responsable_id: string | null
  responsable_nombre: string | null
  /**
   * Cuantas interacciones de Meta tiene el contacto: un formulario de lead = una
   * interaccion. Medido en SOENA el 2026-09-02, de 651 contactos con Meta hay 605
   * con exactamente 1 — por eso la tarjeta solo pinta el numero cuando pasa de 1
   * (un "1" repetido 605 veces empuja hacia abajo lo que si se lee) y la vista de
   * lista si lo lleva como columna fija, donde una columna se escanea de un vistazo.
   */
  interacciones_meta: number
  /**
   * Campanas del contacto, de la mas vieja a la mas nueva y sin repetir.
   *
   * Sale de las MISMAS filas que `interacciones_meta` (las de `fuente = 'meta'`),
   * no de todas las interacciones: asi los dos numeros no se pueden contradecir.
   * Contar campanas sobre un conjunto mas amplio que el de formularios permitiria
   * pintar "1 formulario / 2 campanas", que se lee como un defecto.
   *
   * Se deduplica: dos formularios de la misma campana son DOS interacciones y UNA
   * campana. Son dos preguntas distintas y el equipo las confunde si el mismo
   * numero responde las dos.
   *
   * ⚠️ `campanas[0]` NO es la fuente del primer toque. `custom_data.origen` sigue
   * siendo el first-touch inmutable que graba el webhook, y manda cuando los dos
   * existen y no coinciden (misma regla que `ResumenCampanas` en el detalle).
   * Medido: 1 contacto de 988 discrepa hoy.
   */
  campanas: string[]
}

export async function getContactos(): Promise<ContactoConMeta[]> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  // ⚠️ Las dos consultas de aqui van paginadas: PostgREST corta en 1.000 filas
  // (`max_rows` medido en esta instancia el 2026-09-02) y NO avisa — devuelve 200
  // con la lista recortada. Traer todo "de una" ya no alcanza: SOENA tiene **988
  // contactos**, o sea doce de margen, y **703 interacciones** creciendo al ritmo
  // de la pauta (la campana de septiembre sumo 49 en seis dias). El dia que
  // cualquiera de las dos cruce el techo, unos contactos desaparecen del directorio
  // y otros pierden su marca de Meta y su conteo de formularios, sin error y sin
  // forma de distinguirlo de "no hay mas". `traerTodo` o devuelve el resultado
  // completo o lanza; una lista a medias con cara de entera es peor que un error.
  //
  // El orden es compuesto a proposito: `created_at` no es unico (los cargues
  // masivos comparten marca de tiempo al segundo) y sin desempate por `id` la
  // pagina 2 no continua donde termino la 1 — se repiten filas y se pierden otras.
  // responsable_id aun no esta en database.ts generado (migracion reciente) → cast.
  const contactos = await traerTodo<{
    id: string
    nombre: string
    telefono: string | null
    email: string | null
    fuente_adquisicion: string | null
    rol: string | null
    segmento: string | null
    comision_porcentaje: number | null
    created_at: string | null
    custom_data: { origen?: OrigenContacto } | null
    responsable_id: string | null
  }>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (d, h) => (supabase as any)
      .from('contactos')
      .select('id, nombre, telefono, email, fuente_adquisicion, rol, segmento, comision_porcentaje, created_at, custom_data, responsable_id')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .order('id')
      .range(d, h),
    { etiqueta: 'directorio/contactos' },
  )

  const rows = (contactos ?? []) as Array<{
    id: string
    nombre: string
    telefono: string | null
    email: string | null
    fuente_adquisicion: string | null
    rol: string | null
    segmento: string | null
    comision_porcentaje: number | null
    created_at: string | null
    custom_data: { origen?: OrigenContacto } | null
    responsable_id: string | null
  }>
  if (rows.length === 0) return []

  // Mapa de nombres de staff para resolver el responsable de cada contacto.
  const { data: staffRows } = await supabase
    .from('staff')
    .select('id, full_name')
    .eq('workspace_id', workspaceId)
  const staffMap = new Map<string, string>(
    ((staffRows ?? []) as Array<{ id: string; full_name: string }>).map((s) => [s.id, s.full_name]),
  )

  // Agregado de interacciones por contacto: un solo recorrido en memoria sobre el
  // fetch de arriba, sin columnas cacheadas ni triggers. `payload` entra al select
  // porque de ahi sale `campaign_name` (703 de 703 interacciones lo traen).
  const inters = await traerTodo<{
    contacto_id: string
    fuente: string
    payload: Record<string, unknown> | null
    ocurrida_at: string | null
    created_at: string | null
  }>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (d, h) => (supabase as any)
      .from('contacto_interacciones')
      .select('contacto_id, fuente, payload, ocurrida_at, created_at')
      .eq('workspace_id', workspaceId)
      .order('id')
      .range(d, h),
    { etiqueta: 'directorio/contacto_interacciones' },
  )

  const agg = new Map<string, {
    last: string | null
    lastMeta: string | null
    meta: boolean
    nMeta: number
    // campana → primera vez que se vio. La clave deduplica y el valor ordena.
    campanas: Map<string, string>
  }>()
  for (const it of inters) {
    const when = it.ocurrida_at ?? it.created_at
    const cur = agg.get(it.contacto_id) ?? { last: null, lastMeta: null, meta: false, nMeta: 0, campanas: new Map<string, string>() }
    if (when && (!cur.last || when > cur.last)) cur.last = when
    if (it.fuente === 'meta') {
      cur.meta = true
      cur.nMeta += 1
      // La dedup y el orden de las campanas viven en el modulo puro para poder
      // probarse contra las filas reales de produccion sin levantar Supabase.
      acumularCampana(cur.campanas, it.payload, when)
      if (when && (!cur.lastMeta || when > cur.lastMeta)) cur.lastMeta = when
    }
    agg.set(it.contacto_id, cur)
  }

  return rows.map((c) => {
    const a = agg.get(c.id)
    return {
      id: c.id,
      nombre: c.nombre,
      telefono: c.telefono,
      email: c.email,
      fuente_adquisicion: c.fuente_adquisicion,
      rol: c.rol,
      segmento: c.segmento,
      comision_porcentaje: c.comision_porcentaje,
      created_at: c.created_at,
      es_meta: a?.meta ?? false,
      ultima_interaccion_at: a?.last ?? null,
      ultima_interaccion_meta_at: a?.lastMeta ?? null,
      origen: c.custom_data?.origen ?? null,
      responsable_id: c.responsable_id,
      responsable_nombre: c.responsable_id ? (staffMap.get(c.responsable_id) ?? null) : null,
      interacciones_meta: a?.nMeta ?? 0,
      campanas: ordenarCampanas(a?.campanas),
    }
  })
}

// staff.id del usuario logueado (para pre-filtrar contactos "Mis contactos").
// null si el usuario no es staff del workspace.
export async function getMiStaffId(): Promise<string | null> {
  const { staffId, error } = await getWorkspace()
  if (error) return null
  return staffId ?? null
}

// staff.id + rol efectivo del usuario logueado. El rol decide el pre-filtro por
// defecto del directorio: quien coordina equipo entra viendo TODO, quien ejecuta
// entra viendo lo suyo. Ver `contactos-list.tsx`.
export async function getMiStaffContexto(): Promise<{ staffId: string | null; role: string | null }> {
  const { staffId, role, error } = await getWorkspace()
  if (error) return { staffId: null, role: null }
  return { staffId: staffId ?? null, role: role ?? null }
}

export async function getContacto(id: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return null

  const { data } = await supabase
    .from('contactos')
    .select('*')
    .eq('id', id)
    .single()

  return data
}

export async function createContacto(formData: FormData) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const nombre = formData.get('nombre') as string
  if (!nombre?.trim()) return { success: false, error: 'Nombre requerido' }

  const telefono = (formData.get('telefono') as string)?.trim() || null
  const email = (formData.get('email') as string)?.trim() || null

  // Una persona, un contacto: si el telefono o el correo ya son de alguien, esto
  // no se crea. Se devuelve QUIEN es y su id, porque un bloqueo sin salida hace
  // que el comercial invente un dato para poder seguir, y eso ensucia mas que el
  // duplicado que se queria evitar.
  const duplicado = await buscarContactoDuplicado(supabase, workspaceId, { telefono, email })
  if (duplicado) {
    return { success: false, error: mensajeDuplicado(duplicado), duplicado }
  }

  const { data, error: dbError } = await supabase
    .from('contactos')
    .insert({
      workspace_id: workspaceId,
      // Nombres de contacto en MAYUSCULAS (homogeneo con negocios).
      nombre: nombre.trim().toUpperCase(),
      telefono,
      email,
      // Casa propia del usuario de WhatsApp. Sin este campo, rechazar `@doritasrg`
      // en el teléfono no arregla nada: quien lo escribió ahí lo hizo porque no
      // tenía otro sitio, y lo volvería a hacer. Ver migración 20260902230000.
      usuario_whatsapp: (formData.get('usuario_whatsapp') as string)?.trim() || null,
      fuente_adquisicion: (formData.get('fuente_adquisicion') as string) || null,
      fuente_detalle: (formData.get('fuente_detalle') as string)?.trim() || null,
      rol: (formData.get('rol') as string) || null,
      segmento: (formData.get('segmento') as string) || 'sin_contactar',
      comision_porcentaje: formData.get('comision_porcentaje')
        ? parseFloat(formData.get('comision_porcentaje') as string)
        : null,
    })
    .select('id')
    .single()

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/directorio/contactos')
  return { success: true, id: data.id }
}

export async function updateContacto(id: string, formData: FormData) {
  const { supabase, workspaceId, role, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const updates: Record<string, unknown> = {}
  const fields = ['nombre', 'telefono', 'email', 'usuario_whatsapp', 'fuente_adquisicion', 'fuente_detalle', 'rol', 'segmento'] as const
  for (const f of fields) {
    const v = formData.get(f) as string | null
    if (v !== null) {
      const val = v.trim() || null
      // El nombre se guarda en MAYUSCULAS (homogeneo con negocios); email intacto.
      updates[f] = f === 'nombre' && val ? val.toUpperCase() : val
    }
  }
  // Editar tambien abre la puerta al duplicado: escribirle a un contacto el
  // telefono de otro deja dos filas con el mismo numero igual que crearlo de
  // cero. Se comprueba con el MISMO guardian, excluyendo el contacto que se
  // edita para que no choque consigo mismo.
  if (updates.telefono !== undefined || updates.email !== undefined) {
    const duplicado = await buscarContactoDuplicado(
      supabase,
      workspaceId,
      { telefono: updates.telefono as string | null, email: updates.email as string | null },
      id,
    )
    if (duplicado) return { success: false, error: mensajeDuplicado(duplicado), duplicado }
  }

  if (formData.get('comision_porcentaje') !== null) {
    const raw = formData.get('comision_porcentaje') as string
    updates.comision_porcentaje = raw ? parseFloat(raw) : null
  }
  // Responsable comercial del contacto (staff.id). Cadena vacía → sin responsable.
  // Asignar responsable es gerencial (ver `asignarResponsableContacto`), pero el
  // formulario del Contacto 360 reenvía TODOS los campos en cada guardado: se
  // compara contra el valor actual y solo se exige permiso si de verdad cambia.
  // Así un ejecutor sigue editando teléfono/email sin chocar con el guard.
  if (formData.get('responsable_id') !== null) {
    const raw = (formData.get('responsable_id') as string).trim()
    const nuevo = raw || null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: actual } = await (supabase as any)
      .from('contactos')
      .select('responsable_id')
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .single()
    const previo = (actual as { responsable_id: string | null } | null)?.responsable_id ?? null
    if (nuevo !== previo) {
      if (!getRolePermissions(role ?? 'read_only').canAssignResponsable) {
        return { success: false, error: 'Sin permisos para asignar responsable' }
      }
      if (nuevo) {
        const valido = await staffDelWorkspace(supabase, workspaceId, nuevo)
        if (!valido) return { success: false, error: 'Responsable no válido' }
      }
      updates.responsable_id = nuevo
    }
  }

  // Segmento anterior, solo si este guardado lo trae. El formulario reenvia todos
  // los campos siempre, asi que la comparacion la hace `registrarCambioSegmento`:
  // aqui solo se consigue el dato que esa comparacion necesita.
  let segmentoPrevio: string | null = null
  const tocaSegmento = updates.segmento !== undefined
  if (tocaSegmento) {
    const { data: previo } = await supabase
      .from('contactos')
      .select('segmento')
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    segmentoPrevio = (previo as { segmento: string | null } | null)?.segmento ?? null
  }

  const { error: dbError } = await supabase
    .from('contactos')
    .update(updates)
    .eq('id', id)

  if (dbError) return { success: false, error: dbError.message }

  if (tocaSegmento) {
    await registrarCambioSegmento(
      supabase,
      workspaceId,
      staffId ?? null,
      id,
      segmentoPrevio,
      (updates.segmento as string | null) ?? null,
    )
  }

  revalidatePath('/directorio/contactos')
  revalidatePath(`/directorio/contacto/${id}`)
  return { success: true }
}

export async function deleteContacto(id: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const { error: dbError } = await supabase
    .from('contactos')
    .delete()
    .eq('id', id)

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/directorio/contactos')
  return { success: true }
}

export async function updateContactoSegmento(id: string, segmento: string) {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  // La validación sale del catálogo, no de una lista escrita aquí: cuando el
  // juego de valores cambió (2026-07-31) esta copia se quedó con los cuatro
  // viejos y rechazó TODOS los status nuevos, así que el chip de la lista dejó
  // de funcionar en silencio (el detalle seguía guardando por otra vía).
  const valid = STATUS_CONTACTO.map(s => s.value) as readonly string[]
  if (!valid.includes(segmento)) return { success: false, error: 'Status invalido' }

  // El valor anterior se lee ANTES de escribir: es la mitad del registro que el
  // historial necesita ("de que a que"), y despues del update ya no existe.
  const { data: previo } = await supabase
    .from('contactos')
    .select('segmento')
    .eq('id', id)
    .maybeSingle()

  const { error: dbError } = await supabase
    .from('contactos')
    .update({ segmento })
    .eq('id', id)

  if (dbError) return { success: false, error: dbError.message }

  await registrarCambioSegmento(
    supabase,
    workspaceId,
    staffId ?? null,
    id,
    (previo as { segmento: string | null } | null)?.segmento ?? null,
    segmento,
  )

  revalidatePath('/directorio/contactos')
  revalidatePath(`/directorio/contacto/${id}`)
  return { success: true }
}

// ── Asignación de responsable de contacto ─────────────────
//
// Repartir contactos es trabajo gerencial (owner/admin/supervisor). El criterio
// se toma de `getRolePermissions(role).canAssignResponsable` —el mismo flag que
// gobierna la asignación de responsable de negocio— para que ambos módulos no se
// desincronicen. NO se define un literal local de roles aquí: `src/lib/roles.ts`
// ya es la fuente única.
//
// El guard va SIEMPRE server-side. Ocultar el control en la UI es solo UX.

/**
 * ¿El staff pertenece al workspace y está activo? Barrera de tenant: sin esto,
 * un `responsable_id` fabricado a mano asignaría un contacto a alguien de otro
 * workspace (la FK sola no valida el tenant).
 */
async function staffDelWorkspace(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  workspaceId: string,
  staffId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('staff')
    .select('id')
    .eq('id', staffId)
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .maybeSingle()
  return Boolean(data)
}

/**
 * Asigna (o quita, con `responsableId = null`) el responsable de UN contacto.
 *
 * Action dedicada en vez de reusar `actualizarContacto`: esa recibe FormData y
 * reescribe medio contacto; para un desplegable inline del listado se quiere una
 * firma directa (id + responsable) y un guard de rol acotado. Contactos es 1:1
 * (`contactos.responsable_id`), no N:M como negocios.
 */
export async function asignarResponsableContacto(
  contactoId: string,
  responsableId: string | null,
): Promise<{ success: boolean; error?: string }> {
  const { supabase, workspaceId, role, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  if (!getRolePermissions(role ?? 'read_only').canAssignResponsable) {
    return { success: false, error: 'Sin permisos para asignar responsable' }
  }

  if (responsableId) {
    const valido = await staffDelWorkspace(supabase, workspaceId, responsableId)
    if (!valido) return { success: false, error: 'Responsable no válido' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error: dbError } = await (supabase as any)
    .from('contactos')
    .update({ responsable_id: responsableId })
    .eq('id', contactoId)
    .eq('workspace_id', workspaceId)
    .select('id')

  if (dbError) return { success: false, error: (dbError as { message: string }).message }
  if (!data || data.length === 0) return { success: false, error: 'Contacto no encontrado' }

  // ENGANCHE DE NOTIFICACIÓN (no implementado a propósito, dueño único en otra
  // sesión): aquí es donde avisarle al responsable que le asignaron el contacto.
  // Insertar en `notificaciones` con destinatario = responsableId.

  revalidatePath('/directorio/contactos')
  revalidatePath(`/directorio/contacto/${contactoId}`)
  return { success: true }
}

// Tope de selección masiva. 172 contactos en el workspace más grande hoy; 200
// deja aire sin volver la operación un cargue masivo encubierto.
const MAX_ASIGNACION_MASIVA = 200
// Los ids viajan en el query string de PostgREST (`id=in.(...)`). Se reparte en
// lotes para no acercarse al límite de longitud de URL. Siguen siendo 1-2
// requests, no un bucle de N.
const LOTE_ASIGNACION_MASIVA = 100

/**
 * Asigna (o quita) el responsable de VARIOS contactos de una vez.
 *
 * Un solo UPDATE por lote (`.in('id', ids)`), no N llamadas. Los leads de Meta
 * nacen sin responsable y se acumulan: repartirlos uno por uno desde el detalle
 * no escala.
 */
export async function asignarResponsableContactosMasivo(
  contactoIds: string[],
  responsableId: string | null,
): Promise<{ success: boolean; error?: string; actualizados?: number }> {
  const { supabase, workspaceId, role, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  if (!getRolePermissions(role ?? 'read_only').canAssignResponsable) {
    return { success: false, error: 'Sin permisos para asignar responsable' }
  }

  const ids = Array.from(new Set((contactoIds ?? []).filter(Boolean)))
  if (ids.length === 0) return { success: false, error: 'No hay contactos seleccionados' }
  if (ids.length > MAX_ASIGNACION_MASIVA) {
    return { success: false, error: `Máximo ${MAX_ASIGNACION_MASIVA} contactos por asignación` }
  }

  if (responsableId) {
    const valido = await staffDelWorkspace(supabase, workspaceId, responsableId)
    if (!valido) return { success: false, error: 'Responsable no válido' }
  }

  let actualizados = 0
  for (let i = 0; i < ids.length; i += LOTE_ASIGNACION_MASIVA) {
    const lote = ids.slice(i, i + LOTE_ASIGNACION_MASIVA)
    // El filtro por workspace_id es la barrera de tenant: ids de otro workspace
    // simplemente no matchean (y no se cuentan como actualizados).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error: dbError } = await (supabase as any)
      .from('contactos')
      .update({ responsable_id: responsableId })
      .in('id', lote)
      .eq('workspace_id', workspaceId)
      .select('id')

    if (dbError) return { success: false, error: (dbError as { message: string }).message }
    actualizados += (data as { id: string }[] | null)?.length ?? 0
  }

  // ENGANCHE DE NOTIFICACIÓN (no implementado a propósito, dueño único en otra
  // sesión): aquí avisaría al responsable de la asignación. OJO: repartir 100
  // contactos de golpe dispararía 100 avisos — quien lo implemente debe AGRUPAR
  // (un aviso por lote: "te asignaron N contactos"), no uno por fila.

  revalidatePath('/directorio/contactos')
  return { success: true, actualizados }
}

export async function searchContactos(query: string) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  const { data } = await supabase
    .from('contactos')
    .select('id, nombre, telefono, email')
    .eq('workspace_id', workspaceId)
    .ilike('nombre', `%${query}%`)
    .limit(10)

  return data ?? []
}

// ── Staff para selector de responsable (contacto) ─────────
// Devuelve el staff activo del workspace para poblar el selector "Responsable"
// del Contacto 360. Prioriza el área comercial (staff_areas.area='comercial');
// si no hay ninguno con esa área, cae a todo el staff activo (evita un selector
// vacío en workspaces que no clasifican por área).

export interface StaffOption {
  id: string
  full_name: string
}

export async function getStaffParaResponsable(): Promise<StaffOption[]> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  const { data: activos } = await supabase
    .from('staff')
    .select('id, full_name')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .order('full_name')

  const staff = (activos ?? []) as StaffOption[]
  if (staff.length === 0) return []

  // Filtrar a comercial si hay quienes tengan esa área asignada.
  const { data: areas } = await supabase
    .from('staff_areas')
    .select('staff_id')
    .eq('area', 'comercial')
    .in('staff_id', staff.map((s) => s.id))

  const comercialIds = new Set(((areas ?? []) as { staff_id: string }[]).map((a) => a.staff_id))
  if (comercialIds.size > 0) {
    return staff.filter((s) => comercialIds.has(s.id))
  }
  return staff
}

// ── Empresas ──────────────────────────────────────────────

export async function getEmpresas() {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  const { data } = await supabase
    .from('empresas')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })

  return data ?? []
}

export async function getEmpresa(id: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return null

  const { data } = await supabase
    .from('empresas')
    .select('*')
    .eq('id', id)
    .single()

  return data
}

export async function createEmpresa(formData: FormData) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const nombre = formData.get('nombre') as string
  if (!nombre?.trim()) return { success: false, error: 'Nombre requerido' }

  const { data, error: dbError } = await supabase
    .from('empresas')
    .insert({
      workspace_id: workspaceId,
      nombre: nombre.trim(),
      codigo: '', // trigger auto-genera
      sector: (formData.get('sector') as string) || null,
      numero_documento: (formData.get('numero_documento') as string)?.trim() || null,
      tipo_documento: (formData.get('tipo_documento') as string) || null,
      tipo_persona: (formData.get('tipo_persona') as string) || null,
      regimen_tributario: (formData.get('regimen_tributario') as string) || null,
      gran_contribuyente: formData.get('gran_contribuyente') === 'true',
      agente_retenedor: formData.get('agente_retenedor') === 'true',
      contacto_id: (formData.get('contacto_id') as string) || null,
      contacto_nombre: (formData.get('contacto_nombre') as string)?.trim() || null,
      contacto_email: (formData.get('contacto_email') as string)?.trim() || null,
    })
    .select('id')
    .single()

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/directorio/empresas')
  return { success: true, id: data.id }
}

export async function updateEmpresa(id: string, formData: FormData) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const updates: Record<string, unknown> = {}
  const textFields = ['nombre', 'sector', 'numero_documento', 'tipo_documento', 'tipo_persona', 'regimen_tributario', 'contacto_id', 'contacto_nombre', 'contacto_email'] as const
  for (const f of textFields) {
    const v = formData.get(f) as string | null
    if (v !== null) updates[f] = v.trim() || null
  }
  const boolFields = ['gran_contribuyente', 'agente_retenedor'] as const
  for (const f of boolFields) {
    const v = formData.get(f) as string | null
    if (v !== null) updates[f] = v === 'true'
  }

  const { error: dbError } = await supabase
    .from('empresas')
    .update(updates)
    .eq('id', id)

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/directorio/empresas')
  revalidatePath(`/directorio/empresa/${id}`)
  return { success: true }
}

export async function deleteEmpresa(id: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  // Check for related negocios before deleting
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: negociosAsociados } = await (supabase as any)
    .from('negocios')
    .select('id')
    .eq('empresa_id', id)
    .limit(1)

  if (negociosAsociados && negociosAsociados.length > 0) {
    return {
      success: false,
      error: 'No se puede eliminar esta empresa porque tiene negocios asociados. Elimina primero los negocios.',
    }
  }

  const { error: dbError } = await supabase
    .from('empresas')
    .delete()
    .eq('id', id)

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/directorio/empresas')
  return { success: true }
}

export async function searchEmpresas(query: string) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  const { data } = await supabase
    .from('empresas')
    .select('id, nombre, sector, numero_documento, tipo_documento, contacto_id')
    .eq('workspace_id', workspaceId)
    .ilike('nombre', `%${query}%`)
    .limit(10)

  return data ?? []
}

export async function checkPerfilFiscal(empresaId: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return { complete: false, missing: ['Error de autenticacion'] }

  const { data } = await supabase
    .from('empresas')
    .select('numero_documento, tipo_documento, tipo_persona, regimen_tributario, gran_contribuyente, agente_retenedor')
    .eq('id', empresaId)
    .single()

  if (!data) return { complete: false, missing: ['Empresa no encontrada'] }

  const missing: string[] = []
  if (!data.numero_documento) missing.push('Documento')
  if (!data.tipo_documento) missing.push('Tipo de documento')
  if (!data.tipo_persona) missing.push('Tipo de persona')
  if (!data.regimen_tributario) missing.push('Regimen tributario')
  if (data.gran_contribuyente === null) missing.push('Gran contribuyente')
  if (data.agente_retenedor === null) missing.push('Agente retenedor')

  return { complete: missing.length === 0, missing }
}

// ── Negocios por empresa/contacto (para vistas 360) ────────

export async function getNegociosPorEmpresa(empresaId: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('negocios')
    .select('id, nombre, codigo, estado, stage_actual, precio_estimado, created_at, contactos(nombre)')
    .eq('empresa_id', empresaId)
    .order('created_at', { ascending: false })

  return data ?? []
}

export async function getNegociosPorContacto(contactoId: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('negocios')
    .select('id, nombre, codigo, estado, stage_actual, precio_estimado, created_at, empresas(nombre)')
    .eq('contacto_id', contactoId)
    .order('created_at', { ascending: false })

  return data ?? []
}

// ── Interacciones del contacto (bandeja de leads / timeline) ──────────
// Interacciones entrantes (Meta / WhatsApp / web / manual) del contacto, más
// recientes primero. Alimenta la línea de tiempo del Contacto 360 y sus acciones
// (crear negocio, marcar contactada, descartar).

export interface InteraccionContacto {
  id: string
  fuente: string
  fuente_ref: string | null
  estado: string
  negocio_id: string | null
  payload: Record<string, unknown> | null
  ocurrida_at: string | null
  created_at: string | null
}

export async function getInteraccionesPorContacto(contactoId: string): Promise<InteraccionContacto[]> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('contacto_interacciones')
    .select('id, fuente, fuente_ref, estado, negocio_id, payload, ocurrida_at, created_at')
    .eq('workspace_id', workspaceId)
    .eq('contacto_id', contactoId)
    .order('ocurrida_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  return (data ?? []) as InteraccionContacto[]
}

// ── Vinculo persona natural: empresa <-> contacto ─────────

export async function getEmpresaByContacto(contactoId: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return null

  const { data } = await supabase
    .from('empresas')
    .select('id, nombre')
    .eq('contacto_id', contactoId)
    .maybeSingle()

  return data
}

// ── RUT OCR Pipeline (D69-D77) ──────────────────────────────

import { parseRut } from '@/lib/rut/parse-rut'
import type { RutParseResult, RutEmpresaUpdate } from '@/lib/rut/types'
import { getServerKey } from '@/lib/server-keys'

const RUT_MAX_SIZE = 10 * 1024 * 1024 // 10MB
const RUT_ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']

/**
 * Step 1: Upload RUT document + OCR parse.
 * Returns parsed data for user confirmation (D76: no auto-save).
 */
export async function uploadAndParseRUT(
  empresaId: string,
  formData: FormData,
): Promise<{ success: boolean; data?: RutParseResult; rutUrl?: string; error?: string }> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  // Validate file
  const file = formData.get('rut') as File
  if (!file || file.size === 0) return { success: false, error: 'No se selecciono archivo' }
  if (file.size > RUT_MAX_SIZE) return { success: false, error: 'El archivo no puede superar 10MB' }
  if (!RUT_ALLOWED_TYPES.includes(file.type)) {
    return { success: false, error: 'Solo se permiten PDF, JPG, PNG o WebP' }
  }

  // Verify empresa belongs to workspace
  const { data: empresa } = await supabase
    .from('empresas')
    .select('id')
    .eq('id', empresaId)
    .eq('workspace_id', workspaceId)
    .single()

  if (!empresa) return { success: false, error: 'Empresa no encontrada' }

  // Upload to Storage
  const ext = file.name.split('.').pop() || 'pdf'
  const ts = Date.now()
  const filePath = `${workspaceId}/empresas/${empresaId}/rut_${ts}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('rut-documents')
    .upload(filePath, file, { upsert: true })

  if (uploadError) return { success: false, error: `Error subiendo archivo: ${uploadError.message}` }

  // Get signed URL (private bucket)
  const { data: signedUrl } = await supabase.storage
    .from('rut-documents')
    .createSignedUrl(filePath, 60 * 60 * 24 * 365) // 1 year

  const rutUrl = signedUrl?.signedUrl || filePath

  // Parse with Gemini OCR
  const geminiKey = getServerKey('gemini')
  if (!geminiKey) {
    return { success: false, error: 'GEMINI_API_KEY no configurada en el servidor' }
  }

  const buffer = await file.arrayBuffer()
  const { data: parsed, error: parseError } = await parseRut(buffer, file.type, geminiKey)

  if (parseError || !parsed) {
    return { success: false, error: parseError || 'Error procesando el RUT' }
  }

  return { success: true, data: parsed, rutUrl }
}

/**
 * Step 2: Confirm RUT data after user review (D76).
 * Saves all confirmed fields to empresas + recalculates estado_fiscal.
 */
export async function confirmRutData(
  empresaId: string,
  confirmedFields: RutEmpresaUpdate,
): Promise<{ success: boolean; error?: string }> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  // Build update object — only include non-undefined fields
  const updates: Record<string, unknown> = {}

  if (confirmedFields.numero_documento !== undefined) updates.numero_documento = confirmedFields.numero_documento
  if (confirmedFields.tipo_documento !== undefined) updates.tipo_documento = confirmedFields.tipo_documento
  if (confirmedFields.tipo_persona !== undefined) updates.tipo_persona = confirmedFields.tipo_persona
  if (confirmedFields.regimen_tributario !== undefined) updates.regimen_tributario = confirmedFields.regimen_tributario
  if (confirmedFields.gran_contribuyente !== undefined) updates.gran_contribuyente = confirmedFields.gran_contribuyente
  if (confirmedFields.agente_retenedor !== undefined) updates.agente_retenedor = confirmedFields.agente_retenedor
  if (confirmedFields.autorretenedor !== undefined) updates.autorretenedor = confirmedFields.autorretenedor
  if (confirmedFields.responsable_iva !== undefined) updates.responsable_iva = confirmedFields.responsable_iva
  if (confirmedFields.razon_social !== undefined) updates.razon_social = confirmedFields.razon_social
  if (confirmedFields.direccion_fiscal !== undefined) updates.direccion_fiscal = confirmedFields.direccion_fiscal
  if (confirmedFields.municipio !== undefined) updates.municipio = confirmedFields.municipio
  if (confirmedFields.departamento !== undefined) updates.departamento = confirmedFields.departamento
  if (confirmedFields.telefono !== undefined) updates.telefono = confirmedFields.telefono
  if (confirmedFields.email_fiscal !== undefined) updates.email_fiscal = confirmedFields.email_fiscal
  if (confirmedFields.actividad_ciiu !== undefined) updates.actividad_ciiu = confirmedFields.actividad_ciiu
  if (confirmedFields.actividad_secundaria !== undefined) updates.actividad_secundaria = confirmedFields.actividad_secundaria
  if (confirmedFields.fecha_inicio_actividades !== undefined) updates.fecha_inicio_actividades = confirmedFields.fecha_inicio_actividades

  // RUT metadata
  if (confirmedFields.rut_documento_url !== undefined) updates.rut_documento_url = confirmedFields.rut_documento_url
  updates.rut_fecha_carga = new Date().toISOString()
  if (confirmedFields.rut_confianza_ocr !== undefined) updates.rut_confianza_ocr = confirmedFields.rut_confianza_ocr
  updates.rut_verificado = true

  // Recalculate estado_fiscal (merge current + updates)
  const { data: currentEmpresa } = await supabase
    .from('empresas')
    .select('numero_documento, tipo_persona, regimen_tributario, gran_contribuyente, agente_retenedor, autorretenedor')
    .eq('id', empresaId)
    .eq('workspace_id', workspaceId)
    .single()

  if (!currentEmpresa) return { success: false, error: 'Empresa no encontrada' }

  const merged = { ...currentEmpresa, ...updates }
  const hardGateFields = ['numero_documento', 'tipo_persona', 'regimen_tributario', 'gran_contribuyente', 'agente_retenedor', 'autorretenedor'] as const
  const filled = hardGateFields.filter(f => merged[f] != null).length
  updates.estado_fiscal = filled === 0 ? 'pendiente' : filled === 6 ? 'verificado' : 'parcial'

  // Save
  const { error: dbError } = await supabase
    .from('empresas')
    .update(updates)
    .eq('id', empresaId)
    .eq('workspace_id', workspaceId)

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/directorio/empresas')
  revalidatePath(`/directorio/empresa/${empresaId}`)
  revalidatePath('/negocios')
  return { success: true }
}

// ── Modulos del directorio ────────────────────────────────

/**
 * ¿El workspace tiene el modulo de aliados activo? Lo usan las pages del
 * directorio para mostrar (o no) la pestana "Aliados".
 */
export async function tieneModuloAliados(): Promise<boolean> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return false

  const { data: ws } = await supabase
    .from('workspaces')
    .select('modules')
    .eq('id', workspaceId)
    .single()

  const modules = (ws as { modules: Record<string, boolean> | null } | null)?.modules
  return Boolean(modules?.aliados)
}
