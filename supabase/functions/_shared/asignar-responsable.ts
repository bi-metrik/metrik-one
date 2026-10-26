// ============================================================
// Asignar el responsable de un negocio — la ÚNICA escritura (app y bot)
// ------------------------------------------------------------
// Vive en `_shared/` porque la escriben dos runtimes: la app (Next, `src/lib/negocios/responsable-rol.ts`, que la
// envuelve con `registrarActividad`) y el bot de WhatsApp (Deno, `wa-entendimiento.ts › crearNegocio`). Hasta el
// 2026-10-16 el bot tenía su propia copia: escribía la fila con rol y el `responsable_id`, pero no la línea del
// timeline ni liberaba el puesto. Una copia por runtime es lo que dejó a cuatro de cinco caminos mudos (ver el
// encabezado de `responsable-rol.ts`).
//
// Qué hace, en orden: deriva el rol del área (`staff_areas`), libera el puesto si lo tenía OTRA persona (índice
// único `(negocio_id, rol)`), escribe la fila con `assigned_by`, y anota en el timeline quién entró, con qué rol y a
// quién reemplazó. El aviso a la persona asignada NO va aquí: lo da el trigger `trg_avisar_asignacion_responsable`
// sobre `negocio_responsables`, que ve TODOS los caminos (la pantalla, el bot, la automática por etapa, un script).
//
// Puro de dependencias: ni Next ni Deno. El cliente llega como `unknown` (el de sesión, el de servicio o un doble).
// ============================================================

export type RolResponsable = 'comercial' | 'operaciones';

/**
 * Deriva el rol desde las áreas declaradas del staff. Precedencia comercial → operaciones: quien lleva las dos responde
 * primero por la venta, que es donde nace el caso.
 */
export function rolDesdeAreas(areas: readonly string[]): RolResponsable | null {
  if (areas.includes('comercial')) return 'comercial';
  if (areas.includes('operaciones')) return 'operaciones';
  return null;
}

export type AsignacionResponsable = {
  rol: RolResponsable | null;
  /** staff.id del responsable que ocupaba ese puesto y quedó desplazado, si hubo. */
  desplazado: string | null;
  /** Nombre del desplazado, ya resuelto — para que la pantalla pueda decirlo sin releer. */
  desplazadoNombre: string | null;
  error: string | null;
};

export interface ParamsAsignacion {
  negocioId: string;
  staffId: string;
  /** `profiles.id` de quien asigna (FK de `assigned_by`), NO el staff.id. `null` = el sistema. */
  assignedBy: string | null;
  /** Puesto pedido explícitamente. Solo se respeta si el staff TIENE esa área; si no, manda la derivación. */
  rol?: RolResponsable;
  /** Se agrega al texto del timeline (p. ej. «automático al entrar a Cargue»). */
  nota?: string;
  /**
   * De dónde salió (`negocio_responsables.asignado_origen`, migración 20261026090000). Sin decirlo: `persona` si hay
   * `assignedBy`, y null si no (un camino sin persona que no declara su origen queda como las filas viejas).
   */
  origen?: OrigenAsignacion;
  /** Con origen `regla_etapa`: la etapa a la que entró el negocio (`asignado_etapa_id`). */
  etapaId?: string;
}

/** `negocio_responsables.asignado_origen`. El trigger del aviso y el correo arman el texto según esto. */
export type OrigenAsignacion = 'persona' | 'bot_whatsapp' | 'regla_etapa';

/** El origen que se escribe: el declarado o, sin declarar, `persona` si alguien asignó. Pura. */
export function origenDeAsignacion(p: Pick<ParamsAsignacion, 'assignedBy' | 'origen'>): OrigenAsignacion | null {
  return p.origen ?? (p.assignedBy ? 'persona' : null);
}

/** La fila del timeline que deja la asignación (`activity_log`). */
export interface FilaAsignacion {
  workspace_id: string;
  entidad_tipo: 'negocio';
  entidad_id: string;
  tipo: 'cambio_sistema';
  /** FK a `staff(id)`. */
  autor_id: string | null;
  contenido: string;
}

/** Quien escribe en el timeline: la app usa `registrarActividad`; el bot, un insert con su log. Nunca lanza. */
export type AnotarAsignacion = (fila: FilaAsignacion) => Promise<void>;

// deno-lint-ignore no-explicit-any
type Db = { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const db = (c: unknown) => c as Db;

/**
 * Asigna un staff como responsable de un negocio dejando el `rol` escrito y la línea en el timeline. Un negocio admite
 * UN comercial y UN operativo: asignar otro del mismo área REEMPLAZA al anterior y se devuelve a quién desplazó.
 *
 * Idempotente con la misma persona: si ya ocupaba el puesto, la fila se actualiza en su lugar (no se borra y se vuelve
 * a crear). Borrarla la haría «nueva» para el trigger del aviso, que le avisaría otra vez de un caso que ya llevaba.
 */
export async function asignarResponsableCon(supabase: unknown, params: ParamsAsignacion, anotar: AnotarAsignacion): Promise<AsignacionResponsable> {
  const { negocioId, staffId, assignedBy } = params;

  const { data: areasStaff } = await db(supabase).from('staff_areas').select('area').eq('staff_id', staffId);
  const areas = ((areasStaff ?? []) as Array<{ area: string }>).map((a) => a.area);
  const rol = params.rol && areas.includes(params.rol) ? params.rol : rolDesdeAreas(areas);

  let desplazado: string | null = null;
  if (rol) {
    // Quién ocupaba el puesto ANTES de liberarlo (después ya no se puede saber).
    const { data: previo } = await db(supabase).from('negocio_responsables').select('staff_id')
      .eq('negocio_id', negocioId).eq('rol', rol).maybeSingle();
    const previoStaffId = (previo as { staff_id: string } | null)?.staff_id ?? null;
    if (previoStaffId && previoStaffId !== staffId) {
      desplazado = previoStaffId;
      // Libera el puesto antes de ocuparlo: el índice único no deja dos del mismo rol.
      await db(supabase).from('negocio_responsables').delete().eq('negocio_id', negocioId).eq('rol', rol);
    }
  }

  // assigned_by es FK → profiles(id): debe ser el profile.id, NO el staff.id.
  const { error } = await db(supabase).from('negocio_responsables').upsert(
    {
      negocio_id: negocioId, staff_id: staffId, assigned_by: assignedBy, rol,
      asignado_origen: origenDeAsignacion(params),
      asignado_etapa_id: params.origen === 'regla_etapa' ? params.etapaId ?? null : null,
    },
    { onConflict: 'negocio_id,staff_id', ignoreDuplicates: false },
  );
  const motivo = (error as { message: string } | null)?.message ?? null;
  if (motivo) return { rol, desplazado, desplazadoNombre: null, error: motivo };

  const desplazadoNombre = await nombreDeStaff(supabase, desplazado);
  await anotarAsignacion(supabase, { negocioId, staffId, assignedBy, rol, desplazadoNombre, nota: params.nota ?? null }, anotar);
  return { rol, desplazado, desplazadoNombre, error: null };
}

async function nombreDeStaff(supabase: unknown, staffId: string | null): Promise<string | null> {
  if (!staffId) return null;
  const { data } = await db(supabase).from('staff').select('full_name').eq('id', staffId).maybeSingle();
  return (data as { full_name: string | null } | null)?.full_name ?? null;
}

/**
 * La línea del timeline. `activity_log.autor_id` es FK a `staff(id)` y `assigned_by` es un `profiles.id`: se traduce
 * ACOTADO al workspace del negocio (el UNIQUE de `staff.profile_id` es global: sin el filtro, un platform_admin quedaría
 * como autor con su staff ajeno). Si no resuelve, el autor va nulo.
 */
async function anotarAsignacion(
  supabase: unknown,
  p: { negocioId: string; staffId: string; assignedBy: string | null; rol: RolResponsable | null; desplazadoNombre: string | null; nota: string | null },
  anotar: AnotarAsignacion,
): Promise<void> {
  const { data: negocio } = await db(supabase).from('negocios').select('workspace_id').eq('id', p.negocioId).maybeSingle();
  const workspaceId = (negocio as { workspace_id: string } | null)?.workspace_id;
  if (!workspaceId) return;

  let autorId: string | null = null;
  if (p.assignedBy) {
    const { data: autor } = await db(supabase).from('staff').select('id')
      .eq('profile_id', p.assignedBy).eq('workspace_id', workspaceId).maybeSingle();
    autorId = (autor as { id: string } | null)?.id ?? null;
  }

  const nombre = (await nombreDeStaff(supabase, p.staffId)) ?? 'Sin nombre';
  const comoRol = p.rol ? ` como ${p.rol}` : ' (sin área: no recibe avisos de etapa)';
  const relevo = p.desplazadoNombre ? `, en reemplazo de ${p.desplazadoNombre}` : '';
  const nota = p.nota ? ` (${p.nota})` : '';
  await anotar({
    workspace_id: workspaceId, entidad_tipo: 'negocio', entidad_id: p.negocioId, tipo: 'cambio_sistema', autor_id: autorId,
    contenido: `Responsable agregado: ${nombre}${comoRol}${relevo}${nota}`,
  });
}

/**
 * Mantiene `negocios.responsable_id` (legacy/display) = el responsable más antiguo que queda, o null. La fuente de
 * verdad de permisos es `negocio_responsables`.
 */
export async function sincronizarResponsablePrincipal(supabase: unknown, negocioId: string, workspaceId: string): Promise<void> {
  const { data } = await db(supabase).from('negocio_responsables').select('staff_id')
    .eq('negocio_id', negocioId).order('assigned_at', { ascending: true }).limit(1);
  const principal = ((data ?? []) as { staff_id: string }[])[0]?.staff_id ?? null;
  await db(supabase).from('negocios').update({ responsable_id: principal }).eq('id', negocioId).eq('workspace_id', workspaceId);
}
