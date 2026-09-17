/**
 * Los textos del flujo de viaje se GUARDAN en mayúscula, no solo se ven así.
 *
 * ## Por qué guardar y no maquillar
 *
 * El nombre de una línea y su descripción viajan al PDF, a la tabla de combinaciones y a
 * los rubros. Si la mayúscula viviera en el CSS, cada superficie tendría que acordarse de
 * aplicarla: el día que una se olvide, la misma cotización se lee de dos formas. Se
 * escribe una sola vez, al guardar, y todo lo que lee después ya la trae.
 *
 * ## Qué NO se toca, y por qué
 *
 * - **Correos.** Un correo en mayúscula sigue siendo válido, pero deja de parecerse al que
 *   el cliente escribió y se copia peor. Se reconocen por la arroba, que es la única
 *   marca que no depende de cómo se llame el campo.
 * - **Números, fechas y selectores.** La mayúscula no los cambia; aplicarles la función
 *   igual solo agregaría una capa que después hay que explicar.
 * - **Términos y condiciones.** Es un párrafo largo y en mayúscula sostenida no se lee.
 *
 * ## Tildes y la Ñ
 *
 * `toLocaleUpperCase('es-CO')` conserva los dos: «canción» → «CANCIÓN», «niño» → «NIÑO».
 * No se normaliza ni se despoja nada — quitar la tilde al guardar sería perder el dato.
 */

import { bloqueDeclaraComposicionViaje } from '@/lib/cotizaciones/lineas-por-tipo'

/**
 * Un texto en MAYÚSCULA, conservando tildes y la Ñ.
 *
 * ⚠️ Un valor con arroba se devuelve **tal cual**: es un correo y no se toca. La guarda
 * vive aquí, en la primitiva, y no en cada llamador, para que la pantalla y el servidor
 * no puedan discrepar sobre qué se convierte.
 */
export function aMayusculas(texto: string | null | undefined): string {
  const valor = texto ?? ''
  if (valor.includes('@')) return valor
  return valor.toLocaleUpperCase('es-CO')
}

/** Lo mínimo que hace falta de un campo declarado para saber si lleva texto libre. */
interface CampoDeclarado {
  slug?: unknown
  tipo?: unknown
}

/**
 * Los campos de TEXTO de un bloque que captura el viaje, pasados a mayúscula.
 *
 * Si el bloque no declara la composición del viaje (adultos/niños/infantes) devuelve el
 * dato **sin tocar**: es el mismo criterio con el que la cotización decide si ofrece
 * líneas por tipo, así que ningún otro workspace cambia.
 *
 * Solo `tipo: 'texto'`. Los números, las fechas, los selectores y los interruptores se
 * quedan como están — y un campo de texto que traiga una arroba también (ver `aMayusculas`).
 */
export function mayusculasDeBloqueDeViaje(
  fields: unknown,
  data: Record<string, unknown>,
): Record<string, unknown> {
  if (!bloqueDeclaraComposicionViaje(fields)) return data

  const slugsDeTexto = (fields as CampoDeclarado[])
    .filter(f => f?.tipo === 'texto' && typeof f?.slug === 'string')
    .map(f => f.slug as string)
  if (slugsDeTexto.length === 0) return data

  const siguiente = { ...data }
  for (const slug of slugsDeTexto) {
    const valor = siguiente[slug]
    if (typeof valor !== 'string') continue
    siguiente[slug] = aMayusculas(valor)
  }
  return siguiente
}
