/**
 * Qué se toma del portapapeles al pegar un comprobante.
 *
 * EL CASO QUE IMPORTA: un `paste` no trae UNA cosa, trae varias. Copiar un pantallazo
 * desde una web o desde WhatsApp deja en el portapapeles el `text/html`, el
 * `text/plain` y la imagen, en ese orden. Tomar el primer item devuelve el texto y el
 * usuario ve "el comprobante debe ser una imagen" con el pantallazo copiado.
 *
 * MUTACIONES MEDIDAS el 2026-09-12 (10 verdes en la línea base):
 *   · quedarse con el primer item de tipo imagen sin pedirle el archivo → 1 roja
 *   · preferir el PDF sobre la imagen                                   → 1 roja
 *   · devolver `file.name` siempre en `nombreDeComprobantePegado`       → 2 rojas
 */
import { describe, it, expect } from 'vitest'
import {
  comprobanteDelPortapapeles,
  motivoRechazoComprobante,
  nombreDeComprobantePegado,
  MAX_COMPROBANTE_BYTES,
  type ItemPegado,
} from './comprobante-pegado'

function archivo(nombre: string, tipo: string, bytes = 10): File {
  return { name: nombre, type: tipo, size: bytes } as File
}

function item(kind: string, type: string, file: File | null = null): ItemPegado {
  // `kind` se conserva en la firma porque así vienen los items reales del navegador,
  // aunque lo que decide sea si entregan archivo.
  void kind
  return { type, getAsFile: () => file }
}

describe('lo que se rescata del portapapeles', () => {
  it('el pantallazo pegado junto a su texto sigue siendo el pantallazo', () => {
    const png = archivo('image.png', 'image/png')
    const pegado = [
      item('string', 'text/html'),
      item('string', 'text/plain'),
      item('file', 'image/png', png),
    ]
    expect(comprobanteDelPortapapeles(pegado)).toBe(png)
  })

  it('un PDF copiado también sirve', () => {
    const pdf = archivo('soporte.pdf', 'application/pdf')
    expect(comprobanteDelPortapapeles([item('file', 'application/pdf', pdf)])).toBe(pdf)
  })

  it('con imagen y PDF a la vez gana la imagen: es lo que la persona acaba de recortar', () => {
    const png = archivo('image.png', 'image/png')
    const pdf = archivo('otro.pdf', 'application/pdf')
    const elegido = comprobanteDelPortapapeles([
      item('file', 'application/pdf', pdf),
      item('file', 'image/png', png),
    ])
    expect(elegido).toBe(png)
  })

  it('un item que dice ser imagen pero no entrega archivo no tapa al que sí', () => {
    const png = archivo('image.png', 'image/png')
    const elegido = comprobanteDelPortapapeles([
      item('string', 'image/png', null),
      item('file', 'image/png', png),
    ])
    expect(elegido).toBe(png)
  })

  it('pegar texto suelto no adjunta nada', () => {
    expect(comprobanteDelPortapapeles([item('string', 'text/plain')])).toBeNull()
  })

  it('un portapapeles vacío no revienta', () => {
    expect(comprobanteDelPortapapeles(null)).toBeNull()
    expect(comprobanteDelPortapapeles([])).toBeNull()
  })
})

describe('lo que se rechaza, y por qué', () => {
  it('un formato que no es comprobante dice que es el formato', () => {
    expect(motivoRechazoComprobante(archivo('hoja.xlsx', 'application/vnd.ms-excel')))
      .toContain('imagen')
  })

  it('una imagen enorme dice que es el tamaño, no el formato', () => {
    const motivo = motivoRechazoComprobante(archivo('foto.png', 'image/png', MAX_COMPROBANTE_BYTES + 1))
    expect(motivo).toContain('10 MB')
  })

  it('CONTROL — un pantallazo normal pasa', () => {
    expect(motivoRechazoComprobante(archivo('foto.png', 'image/png'))).toBeNull()
  })
})

describe('el nombre de lo pegado', () => {
  const momento = new Date('2026-09-12T15:04:05Z')

  it('"image.png" se reemplaza: veinte comprobantes con ese nombre son indistinguibles', () => {
    const nombre = nombreDeComprobantePegado(archivo('image.png', 'image/png'), momento)
    expect(nombre).toBe('comprobante-20260912-150405.png')
  })

  it('un jpeg pegado no queda con extensión "jpeg"', () => {
    expect(nombreDeComprobantePegado(archivo('image.jpeg', 'image/jpeg'), momento)).toMatch(/\.jpg$/)
  })

  it('CONTROL — un archivo con nombre propio lo conserva', () => {
    expect(nombreDeComprobantePegado(archivo('transferencia-bancolombia.png', 'image/png'), momento))
      .toBe('transferencia-bancolombia.png')
  })
})
