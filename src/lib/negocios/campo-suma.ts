/**
 * Campo que es la SUMA de otros campos del mismo bloque (`suma_de`, opt-in por config).
 *
 * Nació con la tarifa por pasajero: en «Condiciones del viaje» se preguntan adultos, niños
 * e infantes, y `numero_pasajeros` deja de digitarse para ser la suma. Dos números que
 * dicen lo mismo y se escriben por separado terminan diciendo cosas distintas.
 *
 * Vive aparte porque la regla la aplican DOS lados que tienen que coincidir: el render
 * (`BloqueDatos`) y el guardado (`actualizarBloqueData` / `marcarBloqueCompleto`). El
 * servidor la vuelve a aplicar: lo que manda el navegador es UX.
 *
 * ⚠️ Si NINGUNA de las fuentes tiene número, el campo NO se toca. Un bloque viejo con el
 * total escrito a mano y sin el desglose conservaría su total en vez de quedar vacío: vaciar
 * un dato que alguien escribió porque ahora se pregunta de otra forma es perderlo.
 */

import { parsearNumeroColombiano } from './numero-colombiano'

export interface CampoConSuma {
  slug: string
  suma_de?: string[]
}

export function aplicarSumas(
  fields: CampoConSuma[] | null | undefined,
  valores: Record<string, unknown>,
): Record<string, unknown> {
  let resultado = valores
  for (const f of fields ?? []) {
    if (!Array.isArray(f.suma_de) || f.suma_de.length === 0) continue
    const numeros = f.suma_de.map(slug => parsearNumeroColombiano(valores[slug]))
    if (numeros.every(n => n === null)) continue
    const suma = numeros.reduce<number>((a, n) => a + (n ?? 0), 0)
    if (resultado[f.slug] !== suma) {
      resultado = { ...resultado, [f.slug]: suma }
    }
  }
  return resultado
}
