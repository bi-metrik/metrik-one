// Indicativo telefónico (código de área nacional, esquema 60X vigente desde 2022)
// por departamento DANE. Para las líneas FIJAS de 7 dígitos, la DIAN espera el
// número con el indicativo de la ciudad delante (ej. Bogotá "601 6210800"). Los
// celulares (10 dígitos, inician en 3) y los fijos que ya traen el indicativo
// (10 dígitos) no se tocan.
//
// Fuente: plan de numeración fija de Colombia (CRC). Se mapea por CÓDIGO DANE de
// departamento (2 dígitos) por robustez frente a variaciones del nombre.

const INDICATIVO_POR_DEPTO: Record<string, string> = {
  // 601 — Bogotá y Cundinamarca
  '11': '601', '25': '601',
  // 602 — Valle, Cauca, Nariño
  '76': '602', '19': '602', '52': '602',
  // 604 — Antioquia, Córdoba, Chocó
  '05': '604', '23': '604', '27': '604',
  // 605 — Región Caribe
  '08': '605', '13': '605', '20': '605', '44': '605', '47': '605', '70': '605', '88': '605',
  // 606 — Eje cafetero
  '17': '606', '63': '606', '66': '606',
  // 607 — Santanderes, Boyacá, Arauca
  '15': '607', '54': '607', '68': '607', '81': '607',
  // 608 — Tolima, Huila, Meta, Llanos, Amazonía
  '41': '608', '73': '608', '50': '608', '18': '608', '86': '608',
  '85': '608', '91': '608', '94': '608', '95': '608', '97': '608', '99': '608',
}

export function indicativoPorDepartamento(codigoDepartamento: string | null | undefined): string | null {
  if (!codigoDepartamento) return null
  const cod = String(codigoDepartamento).trim().padStart(2, '0')
  return INDICATIVO_POR_DEPTO[cod] ?? null
}

// Casilla 25 (Teléfono): si es una línea FIJA de 7 dígitos, antepone el indicativo
// del departamento ("601 6210800"). Celulares (inician en 3) y números que ya
// traen indicativo (10 dígitos) se dejan tal cual. Si no hay indicativo conocido,
// devuelve el teléfono sin cambios (no adivina un prefijo incorrecto).
export function formatearTelefonoFijo(
  telefono: string | null | undefined,
  codigoDepartamento: string | null | undefined,
): string | null {
  if (!telefono) return telefono ?? null
  const digits = String(telefono).replace(/\D/g, '')
  if (digits.length === 7) {
    const ind = indicativoPorDepartamento(codigoDepartamento)
    if (ind) return `${ind} ${digits}`
  }
  return telefono
}
