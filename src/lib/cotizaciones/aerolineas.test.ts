/**
 * El catálogo de aerolíneas (brief del 2026-10-08): una sigla, un color de marca, y ningún color
 * de tarifa. Lo que el PDF IMPRIME con él lo prueba `cotizacion-trappvel-render.test.ts`.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  AEROLINEAS,
  COLOR_SIN_IDENTIFICAR,
  aerolineaDeNombre,
  aerolineaDeSigla,
  colorDeAerolinea,
  siglaAerolinea,
} from './aerolineas'
import { TOKENS, colorDeTarifa } from '@/lib/pdf/cotizacion-trappvel-formato'
import PastillaAerolinea from '@/app/(app)/negocios/pastilla-aerolinea'

describe('el color de la aerolínea', () => {
  it('los códigos por país dan el color de su aerolínea: J6 = JA, 4C = LA', () => {
    expect(colorDeAerolinea('J6')).toEqual(colorDeAerolinea('JA'))
    expect(colorDeAerolinea('J6').fondo).toBe('#0A396D')
    expect(colorDeAerolinea('4C')).toEqual(colorDeAerolinea('LA'))
    expect(colorDeAerolinea('4C').fondo).toBe('#2A0088')
    expect(aerolineaDeSigla('H8')?.nombre).toBe('SKY Airline')
  })

  it('la sigla se muestra tal como viene: J6 se lee J6, no JA', () => {
    expect(siglaAerolinea('JetSMART', 'J6 1234')).toBe('J6')
    expect(siglaAerolinea('JetSMART', null)).toBe('JA')
  })

  it('texto blanco, salvo Spirit (negro sobre amarillo)', () => {
    expect(colorDeAerolinea('NK')).toEqual({ fondo: '#FFEC00', franja: '#000000', texto: '#000000' })
    expect(colorDeAerolinea('AV').texto).toBe('#FFFFFF')
    expect(AEROLINEAS.filter(x => x.texto !== '#FFFFFF').map(x => x.nombre)).toEqual(['Spirit'])
  })

  it('con secundario va franja; sin él, no', () => {
    expect(colorDeAerolinea('IB')).toEqual({ fondo: '#B11C25', franja: '#FACD08', texto: '#FFFFFF' })
    expect(colorDeAerolinea('AV').franja).toBeNull()
  })

  it('una sigla que el catálogo no conoce sale gris', () => {
    expect(colorDeAerolinea('XQ')).toEqual({ fondo: '#6B7280', franja: null, texto: '#FFFFFF' })
    expect(colorDeAerolinea('XQ')).toBe(COLOR_SIN_IDENTIFICAR)
  })

  it('la sigla del número manda aunque el nombre no coincida', () => {
    expect(siglaAerolinea('Aerolínea X', 'AV8520')).toBe('AV')
    expect(colorDeAerolinea(siglaAerolinea('Aerolínea X', 'AV8520')).fondo).toBe('#FF0000')
  })
})

describe('el catálogo', () => {
  it('ningún código IATA está en dos aerolíneas', () => {
    const vistos = new Map<string, string>()
    const repetidos: string[] = []
    for (const x of AEROLINEAS) {
      for (const c of x.iata) {
        if (vistos.has(c)) repetidos.push(`${c}: ${vistos.get(c)} y ${x.nombre}`)
        vistos.set(c, x.nombre)
      }
    }
    expect(repetidos).toEqual([])
  })

  it('todo código es de 2 caracteres en mayúscula y todo color es #RRGGBB', () => {
    for (const x of AEROLINEAS) {
      for (const c of x.iata) expect(c).toMatch(/^[A-Z0-9]{2}$/)
      for (const color of [x.fondo, x.franja, x.texto].filter((v): v is string => v !== null)) {
        expect(color).toMatch(/^#[0-9A-F]{6}$/)
      }
    }
  })

  it('ningún color de aerolínea es uno de tarifa: esos quedan solo para tarifas', () => {
    const deTarifa = new Set(
      ['Recomendada', 'Económica', 'Premium', 'Plan familiar'].map(colorDeTarifa).map(c => c.toUpperCase()),
    )
    expect(deTarifa).toEqual(new Set([TOKENS.magenta, TOKENS.verde, TOKENS.purpura, TOKENS.azul].map(c => c.toUpperCase())))
    const choques = AEROLINEAS.flatMap(x => [x.fondo, x.franja].filter((c): c is string => !!c).filter(c => deTarifa.has(c.toUpperCase())).map(c => `${x.nombre} ${c}`))
    expect(choques).toEqual([])
    expect(deTarifa.has(COLOR_SIN_IDENTIFICAR.fondo.toUpperCase())).toBe(false)
  })
})

describe('la aerolínea por su nombre', () => {
  it('la clave es palabra entera: «Tapachula» no es TAP', () => {
    expect(aerolineaDeNombre('Vuelos Tapachula')).toBeNull()
    expect(siglaAerolinea('Vuelos Tapachula', null)).toBeNull()
    expect(siglaAerolinea('TAP Air Portugal', null)).toBe('TP')
  })

  it('«Sky» suelto no es SKY Airline; «SKY Airline» sí', () => {
    expect(aerolineaDeNombre('Sky')).toBeNull()
    expect(siglaAerolinea('Sky', null)).toBeNull()
    expect(siglaAerolinea('Skyscanner', null)).toBeNull()
    expect(siglaAerolinea('SKY Airline', null)).toBe('H2')
  })

  it('sin tildes ni mayúsculas, y con los nombres viejos de marca', () => {
    expect(siglaAerolinea('SATENA', null)).toBe('9R')
    expect(siglaAerolinea('Aeroméxico', null)).toBe('AM')
    expect(siglaAerolinea('EasyFly', null)).toBe('VE')
    expect(siglaAerolinea('Aerolíneas Argentinas', null)).toBe('AR')
  })
})

describe('la pastilla en ONE', () => {
  const html = (aerolinea: string | null, numeroVuelo: string | null) =>
    renderToStaticMarkup(createElement(PastillaAerolinea, { aerolinea, numeroVuelo }))

  it('sin sigla no hay pastilla', () => {
    expect(html('Aerolínea desconocida', null)).toBe('')
    expect(html(null, null)).toBe('')
  })

  it('sigla desconocida: gris, con la sigla', () => {
    const h = html(null, 'XQ123')
    expect(h).toContain('data-pastilla-aerolinea="XQ"')
    expect(h).toContain('background:#6B7280')
  })

  it('J6 se lee J6 con el color de JetSMART y su franja', () => {
    const h = html('JetSMART', 'J6 1234')
    expect(h).toContain('>J6<')
    expect(h).toContain('background:#0A396D')
    expect(h).toContain('background:#9E202D')
  })

  it('Spirit: texto negro', () => {
    expect(html('Spirit', null)).toContain('color:#000000')
  })
})
