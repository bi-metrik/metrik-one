import 'server-only'

/**
 * ¿El contacto es de este workspace y quien pregunta es su responsable? Lo usan las secciones de la
 * ficha del contacto que escriben sin un viaje de por medio (autorización de datos #1138, perfil):
 * sin bloque ni etapa, el permiso lo da el rol, y el `operator` solo escribe si es responsable del
 * contacto o de uno de sus viajes (como en `canViewNegocio`).
 *
 * El contacto se lee con el cliente del USUARIO y el filtro de workspace: un id de otro inquilino
 * devuelve `existe: false` antes de tocar nada con `service_role`.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any

export async function contactoYResponsable(p: {
  supabase: Cliente
  workspaceId: string
  role: string | null
  staffId: string | null
  contactoId: string
}): Promise<{ existe: boolean; esResponsable: boolean }> {
  const { data: c } = await p.supabase
    .from('contactos')
    .select('id, responsable_id')
    .eq('id', p.contactoId)
    .eq('workspace_id', p.workspaceId)
    .maybeSingle()
  const contacto = c as { id: string; responsable_id: string | null } | null
  if (!contacto) return { existe: false, esResponsable: false }

  let esResponsable = !!p.staffId && contacto.responsable_id === p.staffId
  if (!esResponsable && p.staffId && p.role === 'operator') {
    const { data: filas } = await p.supabase
      .from('negocio_responsables')
      .select('negocio_id, negocios!inner(contacto_id, workspace_id)')
      .eq('staff_id', p.staffId)
      .eq('negocios.contacto_id', p.contactoId)
      .eq('negocios.workspace_id', p.workspaceId)
      .limit(1)
    esResponsable = ((filas ?? []) as unknown[]).length > 0
  }
  return { existe: true, esResponsable }
}
