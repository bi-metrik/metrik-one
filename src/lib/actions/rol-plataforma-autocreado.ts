/**
 * Que `staff.rol_plataforma` lleva el registro que `getWorkspace` crea solo cuando el
 * usuario autenticado no tiene staff.
 *
 * Dos restricciones mandan, y las dos viven en la base:
 *
 * 1. `staff_rol_plataforma_check` solo acepta
 *    'dueno','administrador','supervisor','ejecutor','contador','campo'. El mapa viejo
 *    mandaba 'operativo' para operator/read_only/contador: el upsert fallaba con 23514,
 *    `staffId` quedaba null y la accion del usuario quedaba sin autor (528 errores
 *    "[getWorkspace] no se pudo crear ni encontrar el staff" desde el 2026-10-01 11:06
 *    en alma-afi, tres operadores sin fila en staff).
 *
 * 2. `trg_sync_staff_role` (AFTER INSERT OR UPDATE OF rol_plataforma) ESPEJA el valor
 *    sobre `profiles.role` con un CASE: dueno→owner, administrador→admin,
 *    supervisor→supervisor, ejecutor→operator, campo→read_only. Cada valor de aqui
 *    tiene que volver por ese CASE al MISMO `profiles.role` del que salio; si no, crear
 *    el staff le cambia el rol a la persona. Por eso:
 *    - `read_only` va a 'campo', no a 'ejecutor': 'campo' es el unico valor valido
 *      cuyo espejo es `read_only`. Con 'ejecutor' el trigger subiria a la persona a
 *      `operator` (de solo lectura a operar).
 *    - `contador` NO tiene valor seguro hoy: el CASE del trigger no trae
 *      `WHEN 'contador'`, asi que insertar 'contador' dejaria `profiles.role` en NULL
 *      (la persona pierde su rol). Se devuelve `null` = no autocrear; `staffId` queda
 *      null, que es lo que ya pasaba, ahora sin el 23514 repetido. Arreglarlo pide una
 *      migracion que agregue `WHEN 'contador' THEN 'contador'` al trigger.
 */
const ROL_PLATAFORMA_POR_ROL: Record<string, string> = {
  owner: 'dueno',
  admin: 'administrador',
  supervisor: 'supervisor',
  operator: 'ejecutor',
  read_only: 'campo',
}

/**
 * `null` = no se autocrea el staff (rol sin espejo seguro, o desconocido). Un rol
 * desconocido ya no cae en 'dueno': el trigger lo convertiria en `owner`.
 * `profiles.role` null conserva el comportamiento de siempre (perfil fundador → dueno).
 */
export function rolPlataformaParaAutocrear(role: string | null | undefined): string | null {
  return ROL_PLATAFORMA_POR_ROL[role ?? 'owner'] ?? null
}
