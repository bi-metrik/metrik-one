import { describe, expect, it } from 'vitest'

import { contentDispositionPdf, destinoPrincipal, nombrePdfCotizacion, tituloPdfCotizacion } from './nombre-pdf-cotizacion'

// El caso de referencia: negocio «SAN ANDRÉS» de Trappvel, COT-2026-0011 (cliente ficticio).
const SAN_ANDRES = { codigo: 'COT-2026-0011', cliente: 'MARÍA PÉREZ MUÑOZ', destino: 'SAN ANDRÉS' }

describe('nombrePdfCotizacion', () => {
  it('cotización, código, cliente y destino', () => {
    expect(nombrePdfCotizacion(SAN_ANDRES)).toBe('Cotización COT-2026-0011 - MARÍA PÉREZ MUÑOZ - SAN ANDRÉS.pdf')
  })

  it('el borrador lleva el sufijo al final', () => {
    expect(nombrePdfCotizacion({ ...SAN_ANDRES, borrador: true })).toBe('Cotización COT-2026-0011 - MARÍA PÉREZ MUÑOZ - SAN ANDRÉS - BORRADOR.pdf')
  })

  it('sin destino (una cotización que no es de viaje) o sin cliente, la parte no va', () => {
    expect(nombrePdfCotizacion({ codigo: 'COT-2026-0008', cliente: 'Conjunto El Roble' })).toBe('Cotización COT-2026-0008 - Conjunto El Roble.pdf')
    expect(nombrePdfCotizacion({ codigo: 'COT-2026-0008', destino: 'Cartagena' })).toBe('Cotización COT-2026-0008 - Cartagena.pdf')
    expect(nombrePdfCotizacion({ codigo: 'COT-2026-0008', cliente: '   ', destino: null })).toBe('Cotización COT-2026-0008.pdf')
    expect(nombrePdfCotizacion({ codigo: null })).toBe('Cotización.pdf')
  })

  it('sanea lo que un sistema de archivos no acepta', () => {
    const n = nombrePdfCotizacion({ codigo: 'COT-1', cliente: 'AC/DC: "Rock" <S.A.S>?', destino: 'Bogotá|Medellín*' })
    expect(n).toBe('Cotización COT-1 - AC-DC- -Rock- -S.A.S - Bogotá-Medellín.pdf')
    expect(n.slice(0, -4)).not.toMatch(/[\\/:*?"<>|]/)
    expect(nombrePdfCotizacion({ codigo: 'COT-1', cliente: 'Ana\nRuiz\t' })).toBe('Cotización COT-1 - Ana Ruiz.pdf')
  })

  it('un nombre larguísimo se corta por parte', () => {
    const n = nombrePdfCotizacion({ codigo: 'COT-1', cliente: 'X'.repeat(300), destino: 'Lima' })
    expect(n).toBe(`Cotización COT-1 - ${'X'.repeat(60)} - Lima.pdf`)
  })

  it('destino igual al cliente no se repite', () => {
    expect(nombrePdfCotizacion({ codigo: 'COT-1', cliente: 'San Andrés', destino: 'SAN ANDRÉS' })).toBe('Cotización COT-1 - San Andrés.pdf')
  })
})

describe('destinoPrincipal', () => {
  it('con varias paradas, la primera', () => {
    expect(destinoPrincipal('Madrid · París · Roma')).toBe('Madrid')
    expect(destinoPrincipal('Punta Cana, República Dominicana')).toBe('Punta Cana')
    expect(destinoPrincipal('  ')).toBeNull()
    expect(destinoPrincipal(null)).toBeNull()
  })
})

describe('tituloPdfCotizacion', () => {
  it('es el nombre del archivo sin la extensión', () => {
    expect(tituloPdfCotizacion(SAN_ANDRES)).toBe('Cotización COT-2026-0011 - MARÍA PÉREZ MUÑOZ - SAN ANDRÉS')
    expect(`${tituloPdfCotizacion(SAN_ANDRES)}.pdf`).toBe(nombrePdfCotizacion(SAN_ANDRES))
  })
})

describe('contentDispositionPdf', () => {
  it('ASCII en filename y el nombre real en filename*', () => {
    const c = contentDispositionPdf(nombrePdfCotizacion(SAN_ANDRES))
    expect(c).toBe(
      'inline; filename="Cotizacion COT-2026-0011 - MARIA PEREZ MUNOZ - SAN ANDRES.pdf"; ' +
        "filename*=UTF-8''Cotizaci%C3%B3n%20COT-2026-0011%20-%20MAR%C3%8DA%20P%C3%89REZ%20MU%C3%91OZ%20-%20SAN%20ANDR%C3%89S.pdf",
    )
    expect(decodeURIComponent(c.split("UTF-8''")[1])).toBe(nombrePdfCotizacion(SAN_ANDRES))
  })
})
