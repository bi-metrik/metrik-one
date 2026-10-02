/**
 * Valores SUGERIDOS en un bloque `datos`: los que escribió el paso de entendimiento (lo
 * reenviado al bot de WhatsApp o lo pegado en la caja de la solicitud, `fuente: 'web'`) y
 * todavía no confirmó una persona.
 *
 * La marca vive en `negocio_bloques.data._sugeridos[slug] = { fuente, entrega_id, frase, en }`.
 * Es espacio de nombres del servidor (empieza por `_`): el navegador no la escribe
 * (`data-escribible.ts` la conserva). Solo se quita de dos formas:
 *   · la persona CAMBIA el valor (lo reemplazó: ya no es sugerido, es suyo);
 *   · la persona lo CONFIRMA tal cual (`confirmarSugerido`).
 *
 * Lo escribe `supabase/functions/_shared/wa-entendimiento-reglas.ts` (`fusionarSugeridos`).
 */

export const CLAVE_SUGERIDOS = '_sugeridos'

/** Por dónde llegó lo entendido. Mismo vocabulario que `CanalEntrega` del motor (`_shared`). */
export type FuenteMarca = 'whatsapp' | 'web'

export interface MarcaSugerido {
  fuente: FuenteMarca
  entrega_id?: string
  /** Las palabras del mensaje que sostienen el valor. */
  frase?: string
  en?: string
  /** Sin frase: el valor salió de una deducción («Edades 9, 4: ninguno de los 2 niños es menor de 2 años»). */
  deduccion?: string
  /** Lo que había antes, si este sugerido reemplazó a otro que nadie confirmó. */
  anterior?: string | number | null
}

/** El texto que se ve al pasar el cursor sobre «Sugerido»: la frase o la deducción, y lo que había antes. */
export function textoSugerido(marca: MarcaSugerido | undefined): string {
  const partes = [marca?.fuente === 'web' ? 'Sugerido de lo que pegaste' : 'Sugerido desde WhatsApp']
  if (marca?.frase) partes[0] += `: «${marca.frase}»`
  else if (marca?.deduccion) partes[0] += ` (deducido): ${marca.deduccion}`
  if (marca?.anterior !== undefined && marca.anterior !== null && marca.anterior !== '') {
    partes.push(`Antes decía ${marca.anterior}; nadie lo había confirmado.`)
  }
  return partes.join('. ')
}

export function sugeridosDe(data: Record<string, unknown> | null | undefined): Record<string, MarcaSugerido> {
  const m = data?.[CLAVE_SUGERIDOS]
  return m && typeof m === 'object' && !Array.isArray(m) ? (m as Record<string, MarcaSugerido>) : {}
}

/** Mismo valor para efectos de la marca: sin espacios al borde ni diferencia de mayúsculas. */
function mismo(a: unknown, b: unknown): boolean {
  const n = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim().toLocaleUpperCase('es-CO'))
  return n(a) === n(b)
}

/**
 * Quita la marca de los campos que la persona cambió. Se aplica al guardar, sobre la data ya
 * saneada: `anterior` es lo guardado, `nueva` lo que se va a escribir.
 */
export function soltarSugeridosEditados(
  anterior: Record<string, unknown>,
  nueva: Record<string, unknown>,
): Record<string, unknown> {
  const marcas = sugeridosDe(nueva)
  const slugs = Object.keys(marcas)
  if (slugs.length === 0) return nueva
  const quedan: Record<string, MarcaSugerido> = {}
  for (const s of slugs) if (mismo(anterior[s], nueva[s])) quedan[s] = marcas[s]
  if (Object.keys(quedan).length === slugs.length) return nueva
  const out = { ...nueva }
  if (Object.keys(quedan).length === 0) delete out[CLAVE_SUGERIDOS]
  else out[CLAVE_SUGERIDOS] = quedan
  return out
}

// ── Conflictos: lo que el mensaje dijo distinto a lo que el negocio ya tenía ──────────────
//
// Cuando la bandeja carga en un negocio que YA existe, un campo con valor no se pisa. Si el
// mensaje dice otra cosa, el valor se queda y lo dicho va a
// `negocio_bloques.data._conflictos[slug] = { fuente, entrega_id, valor, frase, en, origen }`.
// Lo escribe `supabase/functions/_shared/wa-carga-reglas.ts` (`cargarEnExistente`); la prueba
// de paridad compara la clave. La persona decide en la pantalla:
//   · «Usar» escribe el valor del mensaje como cualquier edición → al guardar, la marca se va
//     (`soltarConflictosEditados`);
//   · «Dejar» conserva el valor actual y quita la marca (`descartarConflictoEnData`).

export const CLAVE_CONFLICTOS = '_conflictos'

export interface MarcaConflicto {
  fuente: FuenteMarca
  entrega_id?: string
  /** Lo que dijo el mensaje. */
  valor: string | number
  frase?: string
  en?: string
  origen?: 'audio' | 'mensaje'
}

export function conflictosDe(data: Record<string, unknown> | null | undefined): Record<string, MarcaConflicto> {
  const m = data?.[CLAVE_CONFLICTOS]
  return m && typeof m === 'object' && !Array.isArray(m) ? (m as Record<string, MarcaConflicto>) : {}
}

function conMarcas(data: Record<string, unknown>, clave: string, quedan: Record<string, unknown>): Record<string, unknown> {
  const out = { ...data }
  if (Object.keys(quedan).length === 0) delete out[clave]
  else out[clave] = quedan
  return out
}

/** Quita el conflicto de los campos cuyo valor cambió al guardar: la persona ya decidió. */
export function soltarConflictosEditados(
  anterior: Record<string, unknown>,
  nueva: Record<string, unknown>,
): Record<string, unknown> {
  const marcas = conflictosDe(nueva)
  const slugs = Object.keys(marcas)
  if (slugs.length === 0) return nueva
  const quedan: Record<string, MarcaConflicto> = {}
  for (const s of slugs) if (mismo(anterior[s], nueva[s])) quedan[s] = marcas[s]
  if (Object.keys(quedan).length === slugs.length) return nueva
  return conMarcas(nueva, CLAVE_CONFLICTOS, quedan)
}

/** La persona deja el valor actual: se quita el conflicto, el valor no se toca. */
export function descartarConflictoEnData(data: Record<string, unknown>, slug: string): Record<string, unknown> {
  const marcas = { ...conflictosDe(data) }
  if (!(slug in marcas)) return data
  delete marcas[slug]
  return conMarcas(data, CLAVE_CONFLICTOS, marcas)
}

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/**
 * «El cliente dijo 20 nov en el audio del 30-sep» (o «en el texto pegado del 2-oct», si llegó por
 * la caja de la solicitud). El día es el de Bogotá (UTC-5, sin horario de verano).
 */
export function textoConflicto(valorLegible: string, marca: MarcaConflicto): string {
  const dondeDijo = marca.fuente === 'web' ? 'en el texto pegado' : marca.origen === 'audio' ? 'en el audio' : 'en el mensaje'
  const t = marca.en ? Date.parse(marca.en) : NaN
  let dia = ''
  if (!Number.isNaN(t)) {
    const b = new Date(t - 5 * 3600_000)
    dia = ` del ${b.getUTCDate()}-${MESES_CORTOS[b.getUTCMonth()]}`
  }
  return `El cliente dijo ${valorLegible} ${dondeDijo}${dia}`
}

/** La persona confirma el valor sugerido tal cual: se quita la marca, el valor se queda. */
export function confirmarSugeridoEnData(data: Record<string, unknown>, slug: string): Record<string, unknown> {
  const marcas = { ...sugeridosDe(data) }
  if (!(slug in marcas)) return data
  delete marcas[slug]
  const out = { ...data }
  if (Object.keys(marcas).length === 0) delete out[CLAVE_SUGERIDOS]
  else out[CLAVE_SUGERIDOS] = marcas
  return out
}
