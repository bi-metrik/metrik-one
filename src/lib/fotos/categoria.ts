/**
 * Qué muestra una foto de HOTEL (Mauricio, 2026-10-16). La asesora lo dice, si quiere, al subirla o
 * pegarla; sirve para reconocerla en el perfil. NO decide qué sale: la propuesta lleva las tres
 * fotos del perfil, de cualquier categoría. Puro.
 *
 *   · `fachada`: el hotel por fuera (el edificio, la entrada).
 *   · `habitacion`: el cuarto, la cama, el baño de la habitación.
 *   · `zonas_comunes`: lobby, recepción, restaurante, bar, piscina, terraza, spa.
 *   · `otra`: cualquier otra cosa.
 *
 * La columna `fotos_catalogo.categoria` es nula en las filas sin categoría (las de antes, las de
 * tours y ciudades, y las que se subieron sin decirla).
 */
export type CategoriaFoto = 'fachada' | 'habitacion' | 'zonas_comunes' | 'otra'

export const CATEGORIAS: readonly CategoriaFoto[] = ['fachada', 'habitacion', 'zonas_comunes', 'otra']

/** En singular, como se ofrece al subir: «¿Qué muestra? Fachada · Habitación · …». */
export const NOMBRE_CATEGORIA: Record<CategoriaFoto, string> = {
  fachada: 'Fachada',
  habitacion: 'Habitación',
  zonas_comunes: 'Zonas comunes',
  otra: 'Otra',
}

export function esCategoria(x: unknown): x is CategoriaFoto {
  return typeof x === 'string' && (CATEGORIAS as readonly string[]).includes(x)
}
