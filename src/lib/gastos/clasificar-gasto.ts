// ============================================================
// De una descripción en español a la categoría del gasto y a si es fijo o variable.
//
// Por qué existe: el formulario le pedía al operador elegir la categoría y responder
// "¿este gasto desaparece si no hay ventas?" ANTES de poder anotar la plata. Son dos
// preguntas de contabilidad puestas en el peor momento, el de la captura, y el costo
// de equivocarse lo paga después el reporte. La descripción ya trae la respuesta:
// "arriendo bodega septiembre" es arriendo y es fijo, y nadie necesita que se lo
// pregunten.
//
// La clasificación NO es autoridad: es una propuesta que se ve y se cambia en un clic.
// Por eso viaja siempre con el origen de la propuesta.
// ============================================================

import { CATEGORIAS_GASTO } from '@/lib/catalogos/constants'

export type ClasificacionGasto = 'variable' | 'fijo' | 'no_operativo'

export const CATEGORIAS_VALIDAS: string[] = CATEGORIAS_GASTO.map(c => c.value)

/**
 * Categoría → fijo o variable por defecto. Mismo seed que la migración
 * 20260427100001: cambiarlo aquí descuadra los reportes ya emitidos.
 */
export const CATEGORIA_A_CLASIFICACION: Record<string, ClasificacionGasto> = {
  comision: 'variable',
  materiales: 'variable',
  transporte: 'variable',
  viaticos: 'variable',
  mano_de_obra: 'variable',
  alimentacion: 'variable',
  servicios_profesionales: 'fijo',
  software: 'fijo',
  impuestos_seguros: 'fijo',
  arriendo: 'fijo',
  marketing: 'fijo',
  capacitacion: 'fijo',
  otros: 'variable',
}

export interface PropuestaGasto {
  categoria: string
  clasificacion: ClasificacionGasto
  /** De dónde salió: 'palabras' es el respaldo determinista, 'ia' el modelo. */
  origen: 'palabras' | 'ia'
}

/**
 * Palabras que amarran una descripción a una categoría. Es el respaldo cuando el
 * modelo no está disponible o devuelve algo que no existe, y es lo que hace que esto
 * se pueda probar sin red.
 *
 * El orden importa: la primera categoría que engancha gana, así que las señales más
 * específicas van antes. "Curso de soldadura" es capacitación, no materiales, aunque
 * la soldadura suene a material.
 */
const SENALES: Array<{ categoria: string; palabras: string[] }> = [
  { categoria: 'arriendo', palabras: ['arriendo', 'arrendamiento', 'alquiler', 'canon', 'bodega'] },
  { categoria: 'capacitacion', palabras: ['curso', 'capacitacion', 'entrenamiento', 'certificacion', 'diplomado'] },
  { categoria: 'software', palabras: ['software', 'licencia', 'suscripcion', 'hosting', 'dominio', 'saas'] },
  { categoria: 'marketing', palabras: ['publicidad', 'pauta', 'marketing', 'anuncio', 'volantes', 'brochure'] },
  { categoria: 'servicios_profesionales', palabras: ['honorarios', 'asesoria', 'contador', 'abogado', 'consultoria', 'ingeniero'] },
  { categoria: 'alimentacion', palabras: ['almuerzo', 'comida', 'restaurante', 'alimentacion', 'refrigerio', 'desayuno', 'cena'] },
  { categoria: 'transporte', palabras: ['transporte', 'flete', 'gasolina', 'combustible', 'acpm', 'peaje', 'taxi', 'uber', 'pasaje', 'envio', 'domicilio'] },
  { categoria: 'materiales', palabras: ['material', 'insumo', 'tuberia', 'lamina', 'tornillo', 'pintura', 'cemento', 'ferreteria', 'repuesto', 'herramienta', 'soldadura', 'cable'] },
]

/** Normaliza para comparar: sin tildes, en minúscula. */
function plano(texto: string): string {
  return texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/**
 * ¿La descripción contiene esta señal como PALABRA?
 *
 * Se compara por palabras y no por subcadena: "uber" vive dentro de "tubería", y con
 * `includes` un gasto de tubería se clasificaba como transporte. El error es del tipo
 * que nadie reporta, porque la propuesta sale plausible.
 */
function contienePalabra(texto: string, palabra: string): boolean {
  return texto.split(/[^a-z0-9]+/).includes(plano(palabra))
}

/**
 * Categoría por palabras de la descripción. `null` cuando ninguna señal engancha:
 * devolver 'otros' aquí haría indistinguible "no sé" de "es otros", y el formulario
 * necesita la diferencia para decidir si propone o se queda callado.
 */
export function categoriaPorPalabras(descripcion: string): string | null {
  const texto = plano(descripcion)
  if (!texto.trim()) return null
  for (const senal of SENALES) {
    if (senal.palabras.some(p => contienePalabra(texto, p))) return senal.categoria
  }
  return null
}

/**
 * Valida lo que devolvió el modelo contra el catálogo. Una categoría inventada se
 * descarta entera: dejarla pasar mete en `gastos.categoria` un valor que ningún
 * reporte sabe agrupar, y el síntoma aparece meses después como plata sin clasificar.
 */
export function normalizarPropuestaIA(
  raw: { categoria?: unknown; clasificacion?: unknown } | null | undefined,
): PropuestaGasto | null {
  const categoria = typeof raw?.categoria === 'string' ? raw.categoria.trim() : ''
  if (!CATEGORIAS_VALIDAS.includes(categoria)) return null
  const cruda = typeof raw?.clasificacion === 'string' ? raw.clasificacion.trim() : ''
  const clasificacion: ClasificacionGasto =
    cruda === 'variable' || cruda === 'fijo' || cruda === 'no_operativo'
      ? cruda
      : CATEGORIA_A_CLASIFICACION[categoria] ?? 'variable'
  return { categoria, clasificacion, origen: 'ia' }
}

/** La propuesta determinista, para cuando no hay modelo. `null` si no hay señal. */
export function proponerPorPalabras(descripcion: string): PropuestaGasto | null {
  const categoria = categoriaPorPalabras(descripcion)
  if (!categoria) return null
  return { categoria, clasificacion: CATEGORIA_A_CLASIFICACION[categoria] ?? 'variable', origen: 'palabras' }
}
