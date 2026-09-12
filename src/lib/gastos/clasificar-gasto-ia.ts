import 'server-only'

import { getServerKey } from '@/lib/server-keys'
import { CATEGORIAS_GASTO } from '@/lib/catalogos/constants'
import {
  normalizarPropuestaIA,
  proponerPorPalabras,
  type PropuestaGasto,
} from './clasificar-gasto'

// Flash-lite: la tarea es rotular una frase corta contra un catálogo cerrado de nueve
// valores. No hay juicio semántico que justifique thinking, y esto corre en cada
// descripción que el operador termina de escribir.
const GEMINI_MODEL = 'gemini-2.5-flash-lite'

const CATALOGO = CATEGORIAS_GASTO.map(c => `${c.value} (${c.label})`).join(', ')

const PROMPT = `Clasificas gastos de una empresa colombiana pequeña a partir de una descripción corta.

Categoría: elige EXACTAMENTE uno de estos valores: ${CATALOGO}.
Si la descripción no alcanza para decidir, responde "otros".

Clasificación, responde uno de: variable, fijo, no_operativo.
- variable: cambia con las ventas o con la obra (materiales, fletes, comisiones, alimentación de cuadrilla).
- fijo: se paga igual haya o no ventas (arriendo, licencias, honorarios del contador).
- no_operativo: no es parte de operar (impuesto de renta, intereses, multas).

Responde solo el JSON.`

/**
 * Propone categoría y clasificación para una descripción de gasto.
 *
 * SIEMPRE devuelve algo utilizable o `null`, nunca lanza: esto corre mientras el
 * operador escribe, y un error de red no puede dejar el formulario sin poder guardar.
 * Sin clave, sin red o con una respuesta que no cuadra con el catálogo, cae al
 * respaldo por palabras — que es determinista y no cuesta una llamada.
 */
export async function clasificarGastoConIA(descripcion: string): Promise<PropuestaGasto | null> {
  const texto = descripcion.trim()
  if (texto.length < 3) return null
  const respaldo = proponerPorPalabras(texto)

  let apiKey: string
  try {
    apiKey = getServerKey('gemini')
  } catch {
    return respaldo
  }

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: PROMPT }] },
          contents: [{ parts: [{ text: texto }] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 256,
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                categoria: { type: 'STRING' },
                clasificacion: { type: 'STRING' },
              },
              required: ['categoria', 'clasificacion'],
            },
          },
        }),
      },
    )
    if (!res.ok) return respaldo

    const data = await res.json()
    const crudo = data?.candidates?.[0]?.content?.parts?.[0]?.text
    if (typeof crudo !== 'string') return respaldo
    // Una categoría fuera del catálogo se descarta ENTERA y manda el respaldo: media
    // propuesta inventada es peor que la propuesta determinista.
    return normalizarPropuestaIA(JSON.parse(crudo)) ?? respaldo
  } catch {
    return respaldo
  }
}
