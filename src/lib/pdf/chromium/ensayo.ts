/**
 * Fixture del ensayo de Chromium (PR 0 de la propuesta de Trappvel, 2026-10-14).
 *
 * `ensayo/doc.html` es el prototipo aprobado (`proyectos/trappvel/clarity/qa/
 * 2026-10-13_prueba-europa/ideal/doc.html`, cliente ficticio, precios inventados) con la
 * maqueta intacta y los datos de la agencia cambiados por unos de ejemplo: razón social,
 * NIT, cuentas, teléfonos y firma son inventados, y el logo es un texto. Un fixture del
 * repo no lleva datos de un cliente. Las fotos (Wikimedia Commons, con su crédito en el
 * documento) van reducidas a 800 px y JPEG q62 (1,3 MB las 25, contra 8,1 MB del
 * original): el ensayo mide el motor, no las fotos.
 *
 * El HTML se completa aquí con lo que en el prototipo salía del disco de la torre: las
 * fotos (como data URL) y las fuentes (Inter y Montserrat embebidas).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fuentesDelDocumento } from './fuentes'
import { cssDeFuentes, incrustarFotos, inyectarEstilo, pieDePagina } from './recursos'

export const DIR_ENSAYO = path.join(process.cwd(), 'src/lib/pdf/chromium/ensayo')

export interface HtmlDelEnsayo {
  html: string
  pie: string
  fotosFaltantes: string[]
  fotosIncrustadas: number
}

export function htmlDelEnsayo(): HtmlDelEnsayo {
  const crudo = readFileSync(path.join(DIR_ENSAYO, 'doc.html'), 'utf8')
  const { html, faltantes, incrustadas } = incrustarFotos(crudo, (archivo) => {
    try {
      return readFileSync(path.join(DIR_ENSAYO, 'fotos', archivo))
    } catch {
      return null
    }
  })
  const fuentes = fuentesDelDocumento()
  const pie = pieDePagina({
    izquierda: 'Agencia de ejemplo · www.agencia.example · contacto@agencia.example',
    codigo: 'COT-2026-0026',
    colorLinea: '#e63380',
    fuente: fuentes.find((f) => f.familia === 'Inter' && f.peso === 400 && f.estilo === 'normal'),
  })
  return {
    html: inyectarEstilo(html, cssDeFuentes(fuentes)),
    pie,
    fotosFaltantes: faltantes,
    fotosIncrustadas: incrustadas,
  }
}
