/**
 * Rubros de obra de un workspace (C3): los que el asistente ofrece en cada gasto y con los que el
 * cierre agrupa lo gastado. Cada uno va a una categoría fiscal de siempre (`gastos.categoria`).
 *
 * Un rubro con gastos no se borra: se desactiva, para que el cierre de las obras viejas no cambie
 * de forma. Un workspace sin rubros sigue con las categorías fijas.
 */

export const MAX_NOMBRE_RUBRO = 24

/** Las categorías fiscales que acepta `obra_rubros.categoria` (el mismo CHECK que `gastos.categoria`). */
export const CATEGORIAS_FISCALES_RUBRO = [
  { value: 'materiales', label: 'Materiales' },
  { value: 'transporte', label: 'Transporte' },
  { value: 'alimentacion', label: 'Alimentación' },
  { value: 'servicios_profesionales', label: 'Servicios profesionales' },
  { value: 'software', label: 'Software' },
  { value: 'arriendo', label: 'Arriendo' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'capacitacion', label: 'Capacitación' },
  { value: 'otros', label: 'Otros' },
  { value: 'comision', label: 'Comisión' },
  { value: 'impuestos_recuperables', label: 'Impuestos recuperables' },
] as const

const VALIDAS = new Set<string>([
  ...CATEGORIAS_FISCALES_RUBRO.map((c) => c.value),
  // También están en el CHECK, pero son de los viajes: no se ofrecen en el formulario.
  'proveedor_viaje',
  'cortesia_viaje',
])

export interface RubroObra {
  id: string
  nombre: string
  descripcion: string | null
  ejemplos: string | null
  categoria: string
  orden: number
  activo: boolean
}

export const COLUMNAS_RUBRO = 'id, nombre, descripcion, ejemplos, categoria, orden, activo'

export interface DatosRubro {
  nombre: string
  descripcion: string | null
  ejemplos: string | null
  categoria: string
  orden: number
  activo: boolean
}

type Resultado<T> = { ok: true; datos: T } | { ok: false; error: string }

const texto = (v: unknown, max: number) => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, max) : null
}

export function validarRubro(entrada: unknown): Resultado<DatosRubro> {
  const e = (entrada ?? {}) as Record<string, unknown>
  const nombre = typeof e.nombre === 'string' ? e.nombre.trim().replace(/\s+/g, ' ') : ''
  if (!nombre) return { ok: false, error: 'Escribe el nombre del rubro.' }
  if (nombre.length > MAX_NOMBRE_RUBRO) {
    return { ok: false, error: `El nombre del rubro tiene máximo ${MAX_NOMBRE_RUBRO} caracteres (va en un botón de WhatsApp).` }
  }
  const categoria = typeof e.categoria === 'string' ? e.categoria : 'otros'
  if (!VALIDAS.has(categoria)) return { ok: false, error: 'Elige una categoría fiscal de la lista.' }
  const orden = Number(e.orden ?? 0)
  if (!Number.isInteger(orden) || orden < 0 || orden > 999) return { ok: false, error: 'El orden es un número entre 0 y 999.' }
  return {
    ok: true,
    datos: {
      nombre,
      descripcion: texto(e.descripcion, 300),
      ejemplos: texto(e.ejemplos, 500),
      categoria,
      orden,
      activo: e.activo !== false,
    },
  }
}

/** ¿Este nombre ya lo usa otro rubro del workspace? Igual que el índice único: sin mayúsculas ni espacios de los lados. */
export function nombreRepetido(nombre: string, rubros: { id: string; nombre: string }[], propioId: string | null): boolean {
  const llave = nombre.trim().toLowerCase()
  return rubros.some((r) => r.id !== propioId && r.nombre.trim().toLowerCase() === llave)
}
