// Motor de generacion .docx — reemplaza placeholders {{VAR}} + logo {{EMPRESA_LOGO}}
// Corre en Node (server action / route handler), sin infra externa.

import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'
// @ts-expect-error — module has no types
import ImageModule from 'docxtemplater-image-module-free'
import type { TemplateContext } from './template-mapping'

export interface GenerateParams {
  templateBuffer: ArrayBuffer
  context: TemplateContext
  logoBuffer?: ArrayBuffer | null  // si null, el placeholder queda visible
}

export function generateDocx(params: GenerateParams): Buffer {
  const { templateBuffer, context, logoBuffer } = params
  const zip = new PizZip(Buffer.from(templateBuffer))

  const modules: unknown[] = []
  if (logoBuffer) {
    const imageModule = new ImageModule({
      centered: true,
      getImage: () => Buffer.from(logoBuffer),
      // Tamano estandar del logo en portada/header: 80mm x 30mm (convertido a EMU)
      // Calculamos tamano en pixels: 300 x 100 aproximado
      getSize: () => [300, 100],
    })
    modules.push(imageModule)
  }

  const doc = new Docxtemplater(zip, {
    delimiters: { start: '{{', end: '}}' },
    paragraphLoop: true,
    linebreaks: true,
    modules: modules as never[],
    nullGetter: () => '',  // si el placeholder no esta en context, queda vacio en vez de error
  })

  // Para docxtemplater, las imagenes se declaran igual que texto en el data.
  // El image module detecta que el placeholder es para imagen segun su nombre convencion.
  // Le pasamos el logo como un flag — el getImage del module devuelve los bytes.
  const data: Record<string, string | boolean> = { ...context }
  if (logoBuffer) {
    data.EMPRESA_LOGO = 'logo.png'  // el module ignora el valor, usa el callback
  }

  doc.render(data)
  return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' })
}
