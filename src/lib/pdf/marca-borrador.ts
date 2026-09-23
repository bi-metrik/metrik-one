/**
 * La marca de agua de un PDF que NO puede salir al cliente.
 *
 * Una cotización que no puede salir (pantallazos de otros pasajeros, margen bajo el mínimo
 * sin la firma del dueño, IVA sin calcular, IVA incluido sin plantilla) se descarga igual
 * —Edgar y las operadoras necesitan ver los borradores— pero cada página lleva «BORRADOR» y
 * sus motivos REALES («IVA sin calcular · no enviar», etc., ver `motivos-borrador.ts`), en
 * diagonal de esquina a esquina, grande y semitransparente: imposible de pasar por alto,
 * sin tapar el documento y sin una franja que se pueda recortar.
 *
 * Se pone DESPUÉS de renderizar, sobre los bytes del PDF, y no dentro de la plantilla.
 * Así sirve para cualquier motor y cualquier plantilla (@react-pdf, WeasyPrint) sin que
 * cada una tenga que acordarse de pintarla: una plantilla nueva que la olvidara dejaría
 * salir un borrador limpio.
 */

import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont } from 'pdf-lib'

import { lineaDeMotivos, textoDeMarca, type MotivoDeBorrador } from '@/lib/cotizaciones/motivos-borrador'

const LINEA_GRANDE = 'BORRADOR'
const ROJO = rgb(0.75, 0.11, 0.11)

export const TEXTO_MARCA_BORRADOR = textoDeMarca(['margen'])
export const TEXTO_MARCA_PANTALLAZOS = textoDeMarca(['pantallazos'])

/**
 * Pone la marca en cada página. La segunda línea dice los motivos REALES
 * (`motivos-borrador.ts`): sin motivos no hay borrador, así que la lista es obligatoria —
 * un motivo por defecto es justo lo que hizo que el IVA saliera diciendo «margen».
 */
export async function ponerMarcaDeBorrador(
  pdf: Uint8Array | Buffer,
  motivos: readonly MotivoDeBorrador[],
): Promise<Buffer> {
  const lineaChica = lineaDeMotivos(motivos)
  // Un motivo ocupa el ~55 % de la diagonal, como siempre. Dos juntos son más largos: se
  // les da ~70 % para que la letra no se achique hasta no leerse (sigue dentro de la
  // página, también apaisada).
  const anchoChica = motivos.length > 1 ? 0.7 : 0.55
  const doc = await PDFDocument.load(pdf)
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold)

  for (const pagina of doc.getPages()) {
    const { width, height } = pagina.getSize()
    const diagonal = Math.hypot(width, height)
    const angulo = Math.atan2(height, width)
    const cx = width / 2
    const cy = height / 2

    // «BORRADOR» ocupa ~60 % de la diagonal; la segunda línea, `anchoChica`.
    const tGrande = tamanoParaAncho(negrita, LINEA_GRANDE, diagonal * 0.6)
    const tChica = tamanoParaAncho(negrita, lineaChica, diagonal * anchoChica)
    const separacion = tGrande * 0.18

    // Las dos líneas se centran sobre la diagonal, una encima y otra debajo del centro.
    dibujarCentrado(pagina, negrita, LINEA_GRANDE, tGrande, cx, cy, angulo, tChica * 0.5 + separacion, 0.2)
    dibujarCentrado(pagina, negrita, lineaChica, tChica, cx, cy, angulo, -(tGrande * 0.62 + separacion), 0.28)
  }

  doc.setTitle(textoDeMarca(motivos))
  return Buffer.from(await doc.save())
}

function tamanoParaAncho(fuente: PDFFont, texto: string, ancho: number): number {
  return ancho / fuente.widthOfTextAtSize(texto, 1)
}

/**
 * Dibuja `texto` rotado `angulo` con su centro en (cx, cy) desplazado `desplazamiento`
 * en la perpendicular a la diagonal. `drawText` rota alrededor del origen del texto
 * (abajo a la izquierda), así que el origen se calcula para que quede centrado.
 */
function dibujarCentrado(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pagina: any,
  fuente: PDFFont,
  texto: string,
  tamano: number,
  cx: number,
  cy: number,
  angulo: number,
  desplazamiento: number,
  opacidad: number,
): void {
  const ancho = fuente.widthOfTextAtSize(texto, tamano)
  const alto = fuente.heightAtSize(tamano, { descender: false })
  const cos = Math.cos(angulo)
  const sin = Math.sin(angulo)
  // Centro de esta línea: el de la página, corrido sobre la perpendicular (-sin, cos).
  const mx = cx - sin * desplazamiento
  const my = cy + cos * desplazamiento
  // Origen = centro − R(ángulo)·(ancho/2, alto/2).
  const x = mx - (cos * ancho) / 2 + (sin * alto) / 2
  const y = my - (sin * ancho) / 2 - (cos * alto) / 2
  pagina.drawText(texto, {
    x,
    y,
    size: tamano,
    font: fuente,
    color: ROJO,
    opacity: opacidad,
    rotate: degrees((angulo * 180) / Math.PI),
  })
}
