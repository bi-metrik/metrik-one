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

import { cumpleCondicion, resolverFuente, type CondicionBloque, type FuentesCondicion } from '@/lib/negocios/condicion-bloque'
import { esPersonaJuridica } from './personas'

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

/**
 * ¿Una SOCIEDAD en un lugar opcional del documento, sin nada contra qué compararla, en un
 * negocio que no exige ese lugar? Entonces el check se da por bueno.
 *
 * Caso que lo motivó (SOENA, medido el 2026-10-01): los certificados UPME de 2024 salían a
 * nombre de la persona Y de la sociedad del proyecto (V0321, V0323, V0537: la misma
 * sociedad en el lugar del 2º beneficiario). El negocio es de un solo titular, no hay RUT
 * del segundo ni certificado de existencia de un banco, y el check comparaba la sociedad
 * contra un vacío: «esperado: (vacío)» y falla, en cuatro filas por caso. El cruce de
 * personas de la línea ya descontaba a esa sociedad (`solo_naturales_si`); este es el
 * mismo criterio en la validación del bloque.
 *
 * Lo que NO salta:
 * - una PERSONA NATURAL en ese lugar sin RUT del segundo: es un segundo titular que el
 *   negocio no registró, y eso sí hay que verlo;
 * - una sociedad cuando HAY contra qué compararla (el certificado de existencia del banco
 *   en un leasing): se compara;
 * - una sociedad cuando el lugar es obligatorio (`required_when` se cumple), o cuando no se
 *   puede saber si lo es porque falta el dato de la condición.
 */
export function sociedadAcompananteSeSalta(
  check: CheckConOpcionalidad,
  valorExtraido: string,
  valorEsperado: string,
  fuentes: FuentesCondicion,
): boolean {
  if (!check.optional || !valorExtraido || valorEsperado) return false
  if (!esPersonaJuridica({ nombre: valorExtraido, documento: valorExtraido })) return false
  const cond = check.required_when
  if (!cond) return true
  if (resolverFuente(cond, fuentes)[cond.field] === undefined) return false
  return !cumpleCondicion(cond, fuentes)
}
