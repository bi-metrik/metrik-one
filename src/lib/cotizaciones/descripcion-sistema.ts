/**
 * Quién escribió la descripción de una línea de viaje: el sistema o una persona.
 *
 * Vive aparte (y sin dependencias) porque la leen dos capas que no pueden importarse entre
 * sí: la ficha de la línea (`ficha-linea.ts`, que reescribe la descripción) y el documento
 * del cliente (`detalle-viaje.ts`, que imprime la nota de la persona).
 */

/**
 * ¿La descripción que tiene hoy la línea la puede reescribir el sistema?
 *
 * Mismo criterio que el nombre (`nombre-linea.ts`) y que el margen: lo que escribió una
 * persona no se toca, ni al volver a confirmar ni al corregir un campo de la ficha (regla 4
 * del brief). Se decide comparando el VALOR con el que el sistema escribió la última vez
 * (`TarifaPax.descripcionDelSistema`):
 *
 *  · vacía → sí, no hay nada que proteger;
 *  · con marca → solo si sigue siendo la que escribió el sistema;
 *  · sin marca y con una tarifa ya confirmada → sí: es una línea confirmada antes de que
 *    existiera la marca, y así se comportaba; sin la marca no hay forma de saber si alguien
 *    la editó, y cambiarle la conducta sería peor que conservarla;
 *  · sin marca y sin confirmar nunca → no: lo que haya lo escribió una persona.
 */
export function descripcionReescribible(
  actual: string | null | undefined,
  delSistema: string | null | undefined,
  hayConfirmada: boolean,
): boolean {
  const a = (actual ?? '').trim()
  if (a === '') return true
  if (delSistema === undefined) return hayConfirmada
  return delSistema !== null && a === delSistema.trim()
}
