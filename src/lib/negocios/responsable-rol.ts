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

import { registrarActividad } from '@/lib/activity/registrar-actividad'
import {
  asignarResponsableCon,
  rolDesdeAreas,
  type AsignacionResponsable,
  type ParamsAsignacion,
  type RolResponsable,
} from '../../../supabase/functions/_shared/asignar-responsable.ts'

// La escritura vive en `supabase/functions/_shared/asignar-responsable.ts` desde el 2026-10-16:
// el bot de WhatsApp (Deno) asigna con la MISMA función, así que deja la misma fila, el
// mismo rol y la misma línea en el timeline. Aquí solo se le da el escritor del timeline
// de la app (`registrarActividad`, que nunca lanza y reporta su rechazo).
//
// Precedencia del rol (comercial → operaciones) y por qué la anotación vive en el helper:
// ver el encabezado de este archivo y el de `_shared/asignar-responsable.ts`.

export { rolDesdeAreas }
export type { AsignacionResponsable, RolResponsable }

/**
 * Asigna un staff como responsable de un negocio dejando el `rol` escrito.
 *
 * Un negocio admite UN comercial y UN operativo (índice único parcial
 * `negocio_responsables_un_rol_por_negocio`): asignar otro del mismo área REEMPLAZA al
 * anterior. Se devuelve a quién desplazó para que la pantalla pueda decirlo.
 *
 * Idempotente: reasignar a la misma persona no la desplaza a sí misma (ni borra su fila).
 *
 * El aviso a la persona asignada (campanita y correo) lo da el trigger
 * `trg_avisar_asignacion_responsable` sobre `negocio_responsables`, no esta función: así
 * llega desde cualquier camino, también los que no pasan por aquí.
 */
export async function asignarResponsable(
  supabase: unknown,
  params: ParamsAsignacion,
): Promise<AsignacionResponsable> {
  return asignarResponsableCon(supabase, params, async (fila) => {
    await registrarActividad(supabase, fila, 'asignarResponsable')
  })
}
