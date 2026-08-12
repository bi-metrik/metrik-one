/**
 * Qué decirle a quien acaba de asignar un responsable.
 *
 * Dos cosas que el sistema hace y antes no se veían en pantalla:
 *
 *   1. **Reemplazo.** Un negocio admite un comercial y un operativo; asignar otro del
 *      mismo área desplaza al anterior. Callarlo deja a alguien fuera de su caso sin
 *      que nadie lo note.
 *   2. **Asignado sin rol.** Un staff que no es de comercial ni de operaciones conserva
 *      el acceso al negocio pero NO entra al routing de avisos de etapa (ver
 *      `responsable-rol.ts`). Sin este aviso, quien asigna cree que la persona quedó
 *      enterada del caso y no es así.
 *
 * Vive aparte de `responsable-rol.ts` a propósito: ese módulo lo importan server actions
 * y scripts, este lo importan componentes de cliente.
 */

export function detalleAsignacion(res: {
  rol?: 'comercial' | 'operaciones' | null
  desplazado?: string | null
}): string | undefined {
  if (res.desplazado) {
    return res.rol
      ? `Reemplaza a ${res.desplazado} como ${res.rol}.`
      : `Reemplaza a ${res.desplazado}.`
  }
  if (res.rol === null) {
    return 'Sin área comercial ni operaciones: no recibirá los avisos de etapa de este negocio.'
  }
  return undefined
}
