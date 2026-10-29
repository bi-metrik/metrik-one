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

/**
 * Liberation Sans 2.1 (SIL OFL 1.1), métrica de Helvetica/Arial: la de los documentos del
 * expediente (DJ, Relación de facturas) que antes imprimía @react-pdf con Helvetica. Con la
 * misma métrica el renglón corta casi en el mismo sitio y la hoja sale igual. Mismo
 * subconjunto latino, hecho con `pyftsubset` desde el paquete Debian `fonts-liberation`.
 */
const ARCHIVOS_FORMULARIOS: Array<Omit<FuenteEmbebida, 'datos'> & { archivo: string }> = [
  { familia: 'Liberation Sans', peso: 400, estilo: 'normal', archivo: 'liberation-sans-400.woff2' },
  { familia: 'Liberation Sans', peso: 700, estilo: 'normal', archivo: 'liberation-sans-700.woff2' },
]

let cacheFormularios: FuenteEmbebida[] | null = null

export function fuentesDeFormularios(): FuenteEmbebida[] {
  if (cacheFormularios) return cacheFormularios
  cacheFormularios = ARCHIVOS_FORMULARIOS.map(({ archivo, ...f }) => ({
    ...f,
    datos: readFileSync(path.join(DIR_FUENTES, archivo)),
  }))
  return cacheFormularios
}
