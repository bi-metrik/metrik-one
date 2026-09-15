import { describe, expect, it } from 'vitest'
import {
  BUCKET_ARCHIVOS,
  construirReferencia,
  esReferenciaExterna,
  esRutaDeNegocio,
  esRutaPendienteDe,
  hrefArchivo,
  negocioDeRuta,
  nombreArchivoSeguro,
  parsearReferencia,
  rutaArchivoNegocio,
  rutaPendiente,
} from './referencia'

const NEG = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const OTRO = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'
const BLOQUE = '11111111-2222-4333-8444-555555555555'

describe('referencias externas', () => {
  it('construye y parsea ida y vuelta', () => {
    const ref = construirReferencia(BUCKET_ARCHIVOS, `negocios/${NEG}/vouchers/hotel.pdf`)
    expect(ref).toBe(`sbext://one-documentos/negocios/${NEG}/vouchers/hotel.pdf`)
    expect(esReferenciaExterna(ref)).toBe(true)
    expect(parsearReferencia(ref)).toEqual({ bucket: 'one-documentos', path: `negocios/${NEG}/vouchers/hotel.pdf` })
  })

  it('una URL de Drive o de Storage no es referencia externa', () => {
    expect(esReferenciaExterna('https://drive.google.com/file/d/abc/view')).toBe(false)
    expect(esReferenciaExterna('https://x.supabase.co/storage/v1/object/public/ve-documentos/a.pdf')).toBe(false)
    expect(esReferenciaExterna(null)).toBe(false)
  })

  it('rechaza formas sospechosas en vez de corregirlas', () => {
    expect(parsearReferencia(`sbext://one-documentos/negocios/${NEG}/../${OTRO}/a.pdf`)).toBeNull()
    expect(parsearReferencia('sbext://one-documentos/')).toBeNull()
    expect(parsearReferencia('sbext:///negocios/a.pdf')).toBeNull()
    expect(parsearReferencia(`sbext://One Documentos/negocios/${NEG}/a.pdf`)).toBeNull()
    expect(parsearReferencia(`sbext://one-documentos/negocios/${NEG}//a.pdf`)).toBeNull()
    expect(parsearReferencia(`sbext://one-documentos/negocios/${NEG}/a.pdf?token=x`)).toBeNull()
  })

  it('el negocio sale del segundo segmento y solo si es un uuid con algo debajo', () => {
    expect(negocioDeRuta(`negocios/${NEG}/a.pdf`)).toBe(NEG)
    expect(negocioDeRuta(`negocios/${NEG.toUpperCase()}/a.pdf`)).toBe(NEG)
    expect(negocioDeRuta(`negocios/${NEG}`)).toBeNull()
    expect(negocioDeRuta('negocios/no-es-uuid/a.pdf')).toBeNull()
    expect(negocioDeRuta(`otra/${NEG}/a.pdf`)).toBeNull()
  })
})

describe('hrefArchivo', () => {
  it('una referencia externa pasa por el endpoint que firma', () => {
    const ref = `sbext://one-documentos/negocios/${NEG}/pasaporte-y-visado.pdf`
    expect(hrefArchivo(ref)).toBe(`/api/archivos/abrir?ref=${encodeURIComponent(ref)}`)
    expect(hrefArchivo(ref, { descargar: true })).toBe(`/api/archivos/abrir?ref=${encodeURIComponent(ref)}&descargar=1`)
  })

  it('cualquier otra URL queda idéntica: un workspace en Drive no cambia un enlace', () => {
    const drive = 'https://drive.google.com/file/d/abc/view?usp=drivesdk'
    expect(hrefArchivo(drive)).toBe(drive)
    expect(hrefArchivo(drive, { descargar: true })).toBe(drive)
    expect(hrefArchivo(null)).toBeNull()
    expect(hrefArchivo('')).toBeNull()
  })
})

describe('rutas de almacenamiento', () => {
  it('quita tildes y espacios: Storage rechaza claves con tilde (medido)', () => {
    expect(rutaArchivoNegocio(NEG, '5. Documentos del viajero', 'Asistencia médica.pdf'))
      .toBe(`negocios/${NEG}/5-documentos-del-viajero/asistencia-medica.pdf`)
  })

  it('subcarpeta de varios niveles, o ninguna', () => {
    expect(rutaArchivoNegocio(NEG, '1. Legal/Propuestas', 'Propuesta v2.PDF'))
      .toBe(`negocios/${NEG}/1-legal/propuestas/propuesta-v2.pdf`)
    expect(rutaArchivoNegocio(NEG, null, 'COT-2026-0012.pdf')).toBe(`negocios/${NEG}/cot-2026-0012.pdf`)
    expect(rutaArchivoNegocio(NEG, ' / ', 'a.pdf')).toBe(`negocios/${NEG}/a.pdf`)
  })

  it('nombres raros no rompen la clave', () => {
    expect(nombreArchivoSeguro('Señor Ñandú (copia).jpeg')).toBe('senor-nandu-copia.jpeg')
    expect(nombreArchivoSeguro('.pdf')).toBe('pdf')
    expect(nombreArchivoSeguro('sin extension')).toBe('sin-extension')
    expect(nombreArchivoSeguro('v1.2 final')).toBe('v1-2-final')
    expect(nombreArchivoSeguro('???.pdf')).toBe('archivo.pdf')
  })

  it('un negocioId que no es uuid no produce ruta', () => {
    expect(() => rutaArchivoNegocio('../otro', null, 'a.pdf')).toThrow()
  })

  it('la subida pendiente vive dentro del prefijo del negocio', () => {
    const p = rutaPendiente(NEG, BLOQUE, '.PDF', 1757880000000)
    expect(p).toBe(`negocios/${NEG}/_pendientes/${BLOQUE}-1757880000000.pdf`)
    expect(esRutaPendienteDe(p, NEG)).toBe(true)
    expect(esRutaPendienteDe(p, OTRO)).toBe(false)
    expect(esRutaDeNegocio(p, NEG)).toBe(true)
  })

  it('una ruta definitiva no pasa por pendiente, y una ajena no es del negocio', () => {
    const definitiva = rutaArchivoNegocio(NEG, 'vouchers', 'hotel.pdf')
    expect(esRutaPendienteDe(definitiva, NEG)).toBe(false)
    expect(esRutaDeNegocio(definitiva, OTRO)).toBe(false)
    expect(esRutaPendienteDe(`negocios/${OTRO}/_pendientes/x.pdf`, NEG)).toBe(false)
  })
})
