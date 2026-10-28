/**
 * Inter, Montserrat y Poppins para el motor Chromium, leídas del disco de la función.
 *
 * Son subconjuntos woff2 (latín + «★ → · « » € –») hechos con `pyftsubset` desde los
 * paquetes Debian `fonts-inter` y `fonts-montserrat`; las dos familias van con licencia
 * SIL Open Font License 1.1, que permite embeberlas. ~130 KB las siete.
 *
 * Viajan a la función por `outputFileTracingIncludes` de `next.config.ts`, solo en las
 * rutas que imprimen con Chromium.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { FuenteEmbebida } from './recursos'

export const DIR_FUENTES = path.join(process.cwd(), 'src/lib/pdf/chromium/fuentes')

const ARCHIVOS: Array<Omit<FuenteEmbebida, 'datos'> & { archivo: string }> = [
  { familia: 'Inter', peso: 400, estilo: 'normal', archivo: 'inter-400.woff2' },
  { familia: 'Inter', peso: 400, estilo: 'italic', archivo: 'inter-400-italic.woff2' },
  { familia: 'Inter', peso: 600, estilo: 'normal', archivo: 'inter-600.woff2' },
  { familia: 'Inter', peso: 700, estilo: 'normal', archivo: 'inter-700.woff2' },
  { familia: 'Montserrat', peso: 600, estilo: 'normal', archivo: 'montserrat-600.woff2' },
  { familia: 'Montserrat', peso: 700, estilo: 'normal', archivo: 'montserrat-700.woff2' },
  { familia: 'Montserrat', peso: 800, estilo: 'normal', archivo: 'montserrat-800.woff2' },
  // Poppins (títulos de la propuesta de Trappvel, como el formato de Edgar del 2026-10-14). Mismo
  // subconjunto, desde google/fonts (ofl/poppins, SIL OFL 1.1).
  { familia: 'Poppins', peso: 600, estilo: 'normal', archivo: 'poppins-600.woff2' },
  { familia: 'Poppins', peso: 700, estilo: 'normal', archivo: 'poppins-700.woff2' },
]

let cache: FuenteEmbebida[] | null = null

export function fuentesDelDocumento(): FuenteEmbebida[] {
  if (cache) return cache
  cache = ARCHIVOS.map(({ archivo, ...f }) => ({
    ...f,
    datos: readFileSync(path.join(DIR_FUENTES, archivo)),
  }))
  return cache
}
