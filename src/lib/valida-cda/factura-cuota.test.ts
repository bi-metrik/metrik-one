import { describe, expect, it } from 'vitest'
import {
  TAMANO_MAX_FACTURA,
  nombreDescargaFactura,
  numeroFacturaValido,
  problemaArchivoFactura,
  rutaFactura,
} from './factura-cuota'

const bytes = (texto: string, prefijo: number[] = []) => new Uint8Array([...prefijo, ...Buffer.from(texto, 'utf8')])
const pdf = { nombre: 'FE-1.pdf', tipo: 'application/pdf', tamano: 1200, cabecera: bytes('%PDF-1.7\n') }
const xml = { nombre: 'FE-1.xml', tipo: 'application/xml', tamano: 900, cabecera: bytes('<?xml version="1.0"?>') }

describe('validación de la factura de una cuota', () => {
  it('acepta un PDF y un XML de verdad', () => {
    expect(problemaArchivoFactura('pdf', pdf)).toBeNull()
    expect(problemaArchivoFactura('xml', xml)).toBeNull()
  })

  it('el XML admite BOM, espacios y el tipo vacío o text/xml que mandan algunos navegadores', () => {
    expect(problemaArchivoFactura('xml', { ...xml, tipo: '', cabecera: bytes('\n  <Invoice>', [0xef, 0xbb, 0xbf]) })).toBeNull()
    expect(problemaArchivoFactura('xml', { ...xml, tipo: 'text/xml' })).toBeNull()
  })

  it('un archivo renombrado no pasa: manda el contenido, no el nombre', () => {
    expect(problemaArchivoFactura('pdf', { ...pdf, cabecera: bytes('<html>') })).toBe('El PDF de la factura no es un PDF')
    expect(problemaArchivoFactura('xml', { ...xml, cabecera: bytes('%PDF-1.7') })).toBe('El XML de la factura no es un XML')
    expect(problemaArchivoFactura('xml', { ...xml, nombre: 'FE-1.txt' })).toBe('El XML de la factura no es un XML')
  })

  it('vacío o por encima del tope, no', () => {
    expect(problemaArchivoFactura('pdf', null)).toBe('El PDF de la factura está vacío')
    expect(problemaArchivoFactura('pdf', { ...pdf, tamano: 0 })).toBe('El PDF de la factura está vacío')
    expect(problemaArchivoFactura('xml', { ...xml, tamano: TAMANO_MAX_FACTURA + 1 })).toBe('El XML de la factura pesa más de 2 MB')
  })

  it('el número: letras, dígitos y guiones, hasta 40, en mayúsculas', () => {
    expect(numeroFacturaValido(' fe-123 ')).toBe('FE-123')
    expect(numeroFacturaValido('FE 123')).toBeNull()
    expect(numeroFacturaValido("FE-1'; drop")).toBeNull()
    expect(numeroFacturaValido('A'.repeat(41))).toBeNull()
    expect(numeroFacturaValido('')).toBeNull()
  })

  it('la ruta va por huella y el nombre de descarga por número', () => {
    expect(rutaFactura('ws', 'a'.repeat(64), 'xml')).toBe(`ws/facturas/${'a'.repeat(64)}.xml`)
    expect(nombreDescargaFactura('FE-123', 'pdf')).toBe('FE-123.pdf')
    expect(nombreDescargaFactura(null, 'xml')).toBe('factura.xml')
  })
})
