/**
 * El nombre de quien oprimió el botón, para MOSTRARLO.
 *
 * ## Por qué existe
 *
 * Un `platform_admin` que trabaja dentro del workspace de un cliente opera con
 * `staffId: null`. No es un defecto de `getWorkspace`: `staff.id` es FK de
 * `activity_log` y de `negocio_responsables`, el UNIQUE de `staff.profile_id` es GLOBAL,
 * y prestar el id de un staff que vive en OTRO workspace sería autoría cross-tenant. El
 * null está bien.
 *
 * El hueco es lo que viene después: quien llama no tenía plan B y escribía `null`. En
 * SOENA quedaron **7 marcas de recibo de 18 sin autor** (medido el 2026-09-22), la
 * primera del 2026-09-03. El documento existe en Siigo y en la contabilidad del cliente,
 * y la marca no dice quién lo emitió.
 *
 * ## Qué es y qué NO es
 *
 * Esto resuelve el **nombre para mostrar**, que es texto. No resuelve el `staff_id`, que
 * es una llave foránea y sigue siendo null cuando no hay staff propio en el workspace.
 * Son dos preguntas distintas y aquí solo se responde la barata:
 *
 * - `por: "Mauricio Moreno"` dentro de un jsonb → texto, no arrastra nada de otro
 *   inquilino, solo dice quién oprimió el botón.
 * - `autor_id: <staff.id ajeno>` → eso sí sería autoría cross-tenant, y no se hace.
 *
 * Por eso el nombre del perfil se usa TAL CUAL, sin marcarlo como externo: el workspace
 * de origen del staff no es asunto de quien lee la marca de un recibo, y una etiqueta
 * («(MeTRIK)») afirmaría algo sobre la relación con el cliente que esta capa no sabe.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(cliente: unknown): any {
  return cliente
}

/**
 * Resuelve el nombre de quien actúa: primero su `staff` del workspace, y si no tiene,
 * el `profiles.full_name` del usuario autenticado.
 *
 * `null` solo cuando no hay ninguno de los dos (o los dos están sin nombre): eso sigue
 * significando «no se sabe quién», y es mejor que inventar una etiqueta.
 *
 * Pide un cliente con permiso para leer `staff` y `profiles` del usuario. Con el cliente
 * de sesión, el RLS de `staff` acota al workspace activo, que es justo el caso en que no
 * hay fila; el de servicio no tiene ese problema.
 */
export async function nombreDeQuienActua(
  cliente: unknown,
  quien: { staffId?: string | null; userId?: string | null },
): Promise<string | null> {
  if (quien.staffId) {
    const { data } = await db(cliente)
      .from('staff').select('full_name').eq('id', quien.staffId).maybeSingle()
    const nombre = (data?.full_name as string | null | undefined)?.trim()
    if (nombre) return nombre
  }

  if (quien.userId) {
    const { data } = await db(cliente)
      .from('profiles').select('full_name').eq('id', quien.userId).maybeSingle()
    const nombre = (data?.full_name as string | null | undefined)?.trim()
    if (nombre) return nombre
  }

  return null
}
