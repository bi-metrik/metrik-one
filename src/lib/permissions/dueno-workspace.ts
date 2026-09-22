/**
 * ¿Quien habla es EL DUEÑO del workspace? No un admin, no un supervisor: el dueño.
 *
 * Lo usa lo que solo el dueño puede hacer: autorizar una cotización bajo el margen
 * mínimo y saltarse con motivo el gate `margen_sobre_piso` (decisión del 2026-09-22 en
 * Trappvel: «la excepción solo la autoriza Edgar»). La regla es sobre el ROL, nunca
 * sobre el id de una persona: el día que el workspace cambie de dueño no hay que tocar
 * código.
 *
 * ## Por qué no basta `role === 'owner'`
 *
 *  · **Un platform admin de MeTRIK que entra al workspace conserva SU rol.** El cambio de
 *    workspace mueve `profiles.workspace_id` y deja `role` intacto, así que Mauricio
 *    dentro de Trappvel se ve como `owner`. No es el dueño de Trappvel.
 *  · **«Ver como» (impersonación) devuelve el rol de la persona suplantada.** Un soporte
 *    viendo como Edgar no es Edgar, y una autorización que queda con su nombre tiene que
 *    haberla dado él.
 *
 * Fuente única: la consumen el guard del servidor y la pantalla que decide si dibuja el
 * botón. Copiada en los dos lados, la pantalla ofrecería algo que el servidor rechaza.
 */

export interface ActorDueno {
  role: string | null | undefined
  /** `getWorkspace().impersonating`. */
  impersonating?: boolean | null
  /** `profiles.platform_admin` de quien tiene la sesión. */
  platformAdmin?: boolean | null
}

export function esDuenoDelWorkspace(actor: ActorDueno): boolean {
  if (actor.role !== 'owner') return false
  if (actor.impersonating === true) return false
  if (actor.platformAdmin === true) return false
  return true
}

/**
 * Lee `profiles.platform_admin` de quien tiene la sesión. Con el cliente de servicio:
 * es una lectura de la propia fila, acotada por el `userId` que resolvió la sesión.
 *
 * Si no se puede leer, **se asume platform admin**: el lado seguro de un permiso
 * exclusivo es negarlo, no concederlo por falta de información.
 */
export async function leerPlatformAdmin(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  servicio: any,
  userId: string | null | undefined,
): Promise<boolean> {
  if (!userId) return true
  const { data, error } = await servicio
    .from('profiles')
    .select('platform_admin')
    .eq('id', userId)
    .maybeSingle()
  if (error || !data) return true
  return (data as { platform_admin?: boolean | null }).platform_admin === true
}
