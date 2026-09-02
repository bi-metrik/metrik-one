/**
 * ¿La "empresa" de este negocio es la persona natural espejo de su contacto?
 *
 * Regla de PRESENTACIÓN, no de datos: la fila de `empresas` sigue existiendo
 * igual, con su RUT y su pipeline. Lo único que cambia es que la interfaz deja
 * de pintarla como una entidad aparte y muestra sus datos con dato (documento,
 * municipio) dentro del bloque del contacto, porque para quien mira son datos
 * de la persona.
 *
 * Medido en producción (workspace SOENA, 2026-09-02): de 190 negocios con
 * empresa, **184 cumplen este criterio** y los 6 restantes son `juridica`.
 * De las 184 empresas del workspace, 178 son `natural` y las 178 tienen
 * `contacto_id`.
 *
 * ⚠️ **No se usa la coincidencia de nombres**, aunque hoy acertaría en 182 de
 * 190: dos personas se pueden llamar igual y el nombre es editable. El
 * `contacto_id` es el vínculo declarado por el motor de identidad.
 *
 * ⚠️ Hacen falta **las dos** condiciones. Una empresa `natural` sin
 * `contacto_id`, o cuyo `contacto_id` apunte a otra persona, cae al bloque de
 * empresa normal: que se vea duplicado es mejor que esconder una empresa que sí
 * era otra cosa. Uno de los 6 casos `juridica` de SOENA (V0276) tiene
 * `contacto_id` igual al del negocio y aun así se pinta como empresa, que es lo
 * correcto.
 */
export type EmpresaEspejoInput = {
  tipo_persona: string | null
  contacto_id: string | null
}

export function esEmpresaEspejo(
  empresa: EmpresaEspejoInput | null | undefined,
  contactoIdDelNegocio: string | null | undefined,
): boolean {
  if (!empresa || !contactoIdDelNegocio) return false
  if (empresa.tipo_persona !== 'natural') return false
  return empresa.contacto_id === contactoIdDelNegocio
}

/**
 * ¿Esta empresa existe solo como espejo fiscal de un contacto?
 *
 * **Son dos predicados y no uno a propósito.** `esEmpresaEspejo` vive DENTRO de
 * un negocio, donde hay un contacto concreto contra el cual comparar: pregunta
 * "¿la empresa de ESTE negocio es su propio contacto?". El directorio de
 * empresas no tiene ese contexto —es una lista suelta, sin negocio— así que la
 * pregunta que puede hacer es otra: "¿esta empresa tiene dueño humano
 * declarado?". Unificarlos obligaría a que el directorio inventara un contacto
 * de referencia, y la fila de `empresas` puede tener negocios de varias
 * personas o ninguno.
 *
 * Mismas DOS condiciones, por la misma razón documentada arriba: en SOENA hay
 * una `juridica` con `contacto_id` (empresa C9, negocio V0276) que **sí** es una
 * empresa y no se puede esconder.
 *
 * Medido en producción (workspace SOENA, 2026-09-02): de 180 empresas, **174
 * cumplen** este criterio, 0 son `natural` sin `contacto_id` y las 6 restantes
 * son `juridica` (una de ellas, la del caso V0276, con `contacto_id`).
 *
 * Regla de PRESENTACIÓN otra vez: las 174 filas se siguen creando igual y
 * siguen alimentando contrato, cotización en PDF y cuentas de cobro. Lo único
 * que cambia es que el directorio no las lista por defecto.
 */
export function esEspejoDeContacto(empresa: EmpresaEspejoInput): boolean {
  return empresa.tipo_persona === 'natural' && empresa.contacto_id !== null
}
