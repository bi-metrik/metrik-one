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

// Bounding box del logo en el header (px @ 96dpi).
// La celda del header mide ~2268 twips = 4cm = ~151px.
// Dejamos margen para que el logo no toque el borde y mantenga aspecto.
const LOGO_MAX_WIDTH = 130
const LOGO_MAX_HEIGHT = 60

function getImageDimensions(buf: Buffer): { width: number; height: number } | null {
  // PNG: 8 bytes signature + IHDR chunk en bytes 16..24 (width: 16-19, height: 20-23 big-endian)
  if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  }
  // JPEG: SOI 0xFFD8, recorrer markers buscando SOF0..SOF3, SOF5..SOF7, SOF9..SOFB, SOFD..SOFF
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2
    while (offset < buf.length) {
      if (buf[offset] !== 0xff) return null
      const marker = buf[offset + 1]
      // SOF markers (excluding DHT 0xC4, JPG 0xC8, DAC 0xCC)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = buf.readUInt16BE(offset + 5)
        const width = buf.readUInt16BE(offset + 7)
        return { width, height }
      }
      const segLen = buf.readUInt16BE(offset + 2)
      offset += 2 + segLen
    }
  }
  return null
}

function computeLogoSize(logoBuffer: ArrayBuffer): [number, number] {
  const dims = getImageDimensions(Buffer.from(logoBuffer))
  if (!dims || dims.width === 0 || dims.height === 0) {
    // Fallback: forzar bbox completo (puede deformar)
    return [LOGO_MAX_WIDTH, LOGO_MAX_HEIGHT]
  }
  const ratio = Math.min(LOGO_MAX_WIDTH / dims.width, LOGO_MAX_HEIGHT / dims.height)
  return [Math.round(dims.width * ratio), Math.round(dims.height * ratio)]
}

export function generateDocx(params: GenerateParams): Buffer {
  const { templateBuffer, context, logoBuffer } = params
  const zip = new PizZip(Buffer.from(templateBuffer))

  const modules: unknown[] = []
  if (logoBuffer) {
    const size = computeLogoSize(logoBuffer)
    const imageModule = new ImageModule({
      centered: false,
      getImage: () => Buffer.from(logoBuffer),
      getSize: () => size,
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
