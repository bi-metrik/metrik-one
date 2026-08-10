/**
 * Rol del responsable de un negocio — la señal que decide a quién se le avisa.
 *
 * Regla del modelo (2026-07-27): un negocio tiene DOS espacios de responsabilidad,
 * `comercial` y `operaciones`. `destinatarios_negocio` (SQL) resuelve el destinatario
 * de cada aviso buscando la fila con el `rol` que corresponde al stage de la etapa:
 * venta → comercial, ejecucion → operaciones, cobro → ambos. Si no encuentra fila con
 * ese rol, escala al supervisor del área.
 *
 * ── Por qué existe este módulo ───────────────────────────────────────────────
 *
 * Esa escalada está pensada para "nadie asignado", pero se disparaba con el
 * responsable puesto: la columna `rol` se llenaba en UN solo camino de escritura
 * (`agregarResponsable`) y quedaba NULL en los otros tres — la auto-asignación al
 * crear, la conversión de una interacción, y los scripts de cargue masivo. Una fila
 * sin rol es invisible para el routing, así que el aviso se iba al supervisor
 * mientras el responsable real no se enteraba de su propio caso.
 *
 * Medido en SOENA el 2026-08-10, antes de escribir esto: **50 avisos al supervisor
 * comercial, y en 48 de esos 50 el negocio SÍ tenía responsable** (fila con `rol`
 * NULL); ninguno estaba sin responsable. Sobre los negocios abiertos, 87 de 130 en
 * venta seguían escalando, y en 86 el responsable asignado era del área comercial.
 *
 * Por eso el helper NO expone solo la derivación: expone la ASIGNACIÓN completa
 * (derivar + liberar el puesto + escribir). Compartir solo la derivación dejaría a
 * cada camino la responsabilidad de acordarse de liberar el puesto antes de ocuparlo,
 * y el que se olvide choca contra el índice único `(negocio_id, rol)`.
 *
 * ── Límite deliberado ────────────────────────────────────────────────────────
 *
 * Solo existen dos espacios. Un staff de área `financiera` (o sin áreas declaradas)
 * se asigna igual —conserva su acceso al negocio— pero queda con `rol` NULL y NO
 * recibe avisos de etapa: los recibe cuando lo nombran en un comentario. Decisión de
 * Mauricio (2026-08-10). Por eso `asignarResponsable` devuelve `rol: null` en ese
 * caso en vez de fallar: quien llame decide si lo advierte en pantalla.
 */

export type RolResponsable = 'comercial' | 'operaciones'

/**
 * Deriva el rol desde las áreas declaradas del staff (`staff_areas`).
 *
 * Precedencia comercial → operaciones: quien lleva las dos áreas responde primero por
 * la venta, que es donde nace el caso. Es la precedencia que ya aplicaba
 * `agregarResponsable`; se conserva para no cambiar en silencio a quién le llega el
 * aviso en los workspaces que ya operan así.
 */
export function rolDesdeAreas(areas: readonly string[]): RolResponsable | null {
  if (areas.includes('comercial')) return 'comercial'
  if (areas.includes('operaciones')) return 'operaciones'
  return null
}

type Db = {
  from: (t: string) => any // eslint-disable-line @typescript-eslint/no-explicit-any
}

function db(client: unknown): Db {
  return client as Db
}

export type AsignacionResponsable = {
  rol: RolResponsable | null
  /** staff.id del responsable que ocupaba ese puesto y quedó desplazado, si hubo. */
  desplazado: string | null
  error: string | null
}

/**
 * Asigna un staff como responsable de un negocio dejando el `rol` escrito.
 *
 * Un negocio admite UN comercial y UN operativo (índice único parcial
 * `negocio_responsables_un_rol_por_negocio`): asignar otro del mismo área REEMPLAZA al
 * anterior. Se devuelve a quién desplazó para que la pantalla pueda decirlo — un
 * reemplazo silencioso deja a alguien fuera de su caso sin que nadie lo note.
 *
 * Idempotente: reasignar a la misma persona no la desplaza a sí misma.
 */
export async function asignarResponsable(
  supabase: unknown,
  params: { negocioId: string; staffId: string; assignedBy: string | null },
): Promise<AsignacionResponsable> {
  const { negocioId, staffId, assignedBy } = params

  const { data: areasStaff } = await db(supabase)
    .from('staff_areas')
    .select('area')
    .eq('staff_id', staffId)

  const areas = ((areasStaff ?? []) as Array<{ area: string }>).map((a) => a.area)
  const rol = rolDesdeAreas(areas)

  let desplazado: string | null = null

  if (rol) {
    // Quién ocupaba el puesto ANTES de liberarlo (después ya no se puede saber).
    const { data: previo } = await db(supabase)
      .from('negocio_responsables')
      .select('staff_id')
      .eq('negocio_id', negocioId)
      .eq('rol', rol)
      .maybeSingle()

    const previoStaffId = (previo as { staff_id: string } | null)?.staff_id ?? null
    if (previoStaffId && previoStaffId !== staffId) desplazado = previoStaffId

    // Libera el puesto antes de ocuparlo: el índice único no deja dos del mismo rol.
    await db(supabase)
      .from('negocio_responsables')
      .delete()
      .eq('negocio_id', negocioId)
      .eq('rol', rol)
  }

  // assigned_by es FK → profiles(id): debe ser el profile.id, NO el staff.id.
  const { error } = await db(supabase)
    .from('negocio_responsables')
    .upsert(
      { negocio_id: negocioId, staff_id: staffId, assigned_by: assignedBy, rol },
      { onConflict: 'negocio_id,staff_id', ignoreDuplicates: false },
    )

  return { rol, desplazado, error: (error as { message: string } | null)?.message ?? null }
}
