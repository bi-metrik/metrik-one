/**
 * Los textos legales del registro autogestionado de Valida (pantalla «Tu empresa»).
 *
 * ⚠️ NINGUNO ESTÁ ESCRITO. Son marcadores `[TEXTO EMILIO]` / `[TEXTO LUCÍA]` a propósito: el texto
 * legal no lo redacta ingeniería (`18-recorrido-baja-friccion.md` §3.3):
 *   - Condiciones de la prueba (Emilio): corta, sin precio, sin permanencia, sin valor probatorio del
 *     PDF de prueba, y con el ACUERDO DE ENCARGO del tratamiento de los datos que se consultan, que
 *     tiene que quedar aceptado ANTES de la primera consulta, también en la prueba.
 *   - Aviso de datos del formulario (Lucía): el correo de un CDA suele ser un Gmail con nombre de
 *     persona, así que es dato personal (SIC 23-571469).
 *
 * Mientras un marcador siga aquí, `textosListos()` es false y el registro NO abre en producción
 * (ver `registroAbierto` en `llave.ts`). En un preview sí, para poder probar el recorrido.
 *
 * Puro, sin `node:crypto`: lo importa la pantalla para mostrar el texto. La huella la calcula el
 * servidor sobre ESTE MISMO texto (`huella-servidor.ts`), así la constancia prueba lo que se leyó.
 * Cambiar una sola letra de las Condiciones exige subir `version`.
 */

export const MARCADOR_TEXTO_PENDIENTE = /\[TEXTO (EMILIO|LUCÍA|LUCIA)\b/

export const CONDICIONES_PRUEBA = {
  slug: 'condiciones-prueba-valida',
  version: 'borrador-0',
  titulo: 'Condiciones de la prueba gratis de Valida',
  texto: [
    '[TEXTO EMILIO: Condiciones de la prueba gratis de Valida. Alcance: 10 consultas en 7 días, sin costo y sin tarjeta; sin precio ni permanencia; el reporte PDF de la prueba lleva la marca PRUEBA, la razón social es declarada y no verificada, y no sirve como soporte ante la Supertransporte; la empresa sigue siendo el sujeto obligado responsable de su SARLAFT.]',
    '[TEXTO EMILIO + LUCÍA: Acuerdo de encargo del tratamiento de los datos personales de terceros que la empresa consulta en Valida (MeTRIK IA S.A.S. como Encargado), aceptado antes de la primera consulta.]',
    '[TEXTO EMILIO: qué pasa al terminar la prueba (no se cobra nada; para seguir se activa el plan y se aceptan los Términos del plan). Cuando exista el registro con método de pago (ePayco), la cláusula de cobro al terminar la prueba.]',
  ].join('\n\n'),
} as const

export const AVISO_DATOS_FORMULARIO =
  '[TEXTO LUCÍA: aviso corto de privacidad del formulario de registro: quién es el Responsable (METRIK IA S.A.S., NIT 902.079.601-9), para qué se usan el correo, la razón social y el NIT, y el enlace a la Política de Tratamiento de Datos.]'

/** true cuando ya no queda ningún marcador: es la condición para abrir el registro en producción. */
export function textosListos(
  textos: readonly string[] = [CONDICIONES_PRUEBA.texto, AVISO_DATOS_FORMULARIO],
): boolean {
  return textos.every((t) => !MARCADOR_TEXTO_PENDIENTE.test(t))
}
