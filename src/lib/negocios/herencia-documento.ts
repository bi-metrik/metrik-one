/**
 * ¿De qué casilla hereda su archivo una casilla de documento que acaba de nacer?
 *
 * Los bloques de tipo `documento` COMPARTEN un único `bloque_definition_id`: en SOENA, 46
 * bloques para 14 documentos distintos. Ese id no identifica la casilla, solo dice «esto es
 * un documento». Heredar por él devuelve **cualquier** documento ya cargado del negocio, el
 * último que se completó.
 *
 * Medido en producción el 2026-09-08: **206 archivos de Drive reclamados por dos casillas a
 * la vez** y **508 casillas mostrando el documento de otra** — la factura apareciendo también
 * como `007_RUT` y como `007A_RUT_2`, la certificación bancaria como `009_CARTA_AUTORIZACION`.
 * Lo destapó el renombrado del paquete DIAN, que tuvo que saltarse esos archivos porque no se
 * sabía qué nombre les correspondía.
 *
 * Acotado antes de tocar nada: en los 206 casos la casilla canónica (la `editable` con slug,
 * donde el operador carga) tenía el archivo correcto, y ninguna casilla contaminada es gate.
 * No se perdió ningún documento ni avanzó ningún negocio de más. El daño es que la pantalla
 * afirma tener un documento que nunca llegó.
 *
 * Es el mismo defecto que se corrigió en julio para los bloques `datos` (ver el comentario
 * largo en `negocio-v2-actions.ts`): se arreglaron esos y se quedaron los de documento.
 *
 * La identidad real de un documento es su **`label`**: de ahí sale el nombre del archivo en
 * Drive (`${label}.pdf`), así que dos casillas con el mismo label son el mismo documento y
 * dos con label distinto no lo son nunca.
 *
 * @param nombre Respaldo, y **solo para las copias de solo lectura**. Hay documentos que no
 *   declaran `label` («Factura emitida», «Propuesta económica firmada»): sin este respaldo sus
 *   copias no encontrarían pareja y nacerían vacías, cuando su único trabajo es mostrar lo que
 *   ya tiene el original. En una casilla `editable` no se usa: ahí carga una persona, y
 *   preferimos que nazca vacía a que aparezca llena con algo que nadie subió ahí.
 * @returns Las llaves a probar, en orden. Vacío significa «no se hereda»: nace vacía, que es
 *   la verdad. No se adivina.
 */
export function llavesDeHerenciaDocumento(
  definitionId: string,
  label: string | null | undefined,
  nombre?: string | null,
): string[] {
  const llaves: string[] = []
  if (label) llaves.push(`${definitionId}:${label}`)
  if (nombre && nombre !== label) llaves.push(`${definitionId}:${nombre}`)
  return llaves
}
