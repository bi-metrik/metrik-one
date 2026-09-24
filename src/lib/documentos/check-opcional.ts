/**
 * ¿Un check del cruce de un documento se puede SALTAR cuando el documento no trae el dato?
 *
 * `optional: true` dice que sí: el 2º beneficiario del certificado UPME solo se compara si
 * el certificado lista a un segundo solicitante. Pero eso no puede valer siempre. En una
 * copropiedad el segundo solicitante es OBLIGATORIO, y con el check opcional un
 * certificado a nombre de una sola persona pasaba sin aviso: así salieron los seis
 * certificados que hubo que volver a pedir en SOENA (V0457 y los cinco de la auditoría
 * del 2026-09-24).
 *
 * `required_when` tiene la MISMA forma que el `condition` de un bloque y se resuelve con
 * el mismo criterio (`cumpleCondicion`). Si se cumple, el check deja de ser opcional y un
 * valor vacío se compara, o sea, falla. Sin `required_when`, nada cambia.
 */

import { cumpleCondicion, type CondicionBloque, type FuentesCondicion } from '@/lib/negocios/condicion-bloque'

export interface CheckConOpcionalidad {
  optional?: boolean
  required_when?: CondicionBloque | null
}

/** `true` si el check se da por bueno sin comparar porque el documento no trae el dato. */
export function checkSeSalta(
  check: CheckConOpcionalidad,
  valorExtraido: string,
  fuentes: FuentesCondicion,
): boolean {
  if (!check.optional || valorExtraido) return false
  if (check.required_when && cumpleCondicion(check.required_when, fuentes)) return false
  return true
}
