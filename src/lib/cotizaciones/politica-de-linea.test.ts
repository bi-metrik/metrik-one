import { describe, expect, it } from 'vitest'

import {
  bloqueProvisional,
  cambiosDeMargen,
  cambiosDeRecargo,
  lineaUsaPoliticaDePrecio,
  motivoUmbralesInvalidos,
} from './politica-de-linea'

/** La configuración de Trappvel tal como estaba el 2026-09-22, antes de que Edgar la revisara. */
const TRAPPVEL = {
  margen: {
    piso_pct: 5,
    aviso_pct: 10,
    convencion: 'sobre_venta',
    default_pct: 15,
    provisional: true,
    revisar_con: 'Edgar',
  },
  recargo: {
    valor: 100000,
    activo: true,
    aplica_a: ['vuelo_detalle'],
    etiqueta: 'Recargo de emision',
    provisional: true,
  },
}

describe('qué líneas ven la sección (R6)', () => {
  it('la línea que declara margen o recargo, sí', () => {
    expect(lineaUsaPoliticaDePrecio(TRAPPVEL)).toBe(true)
    expect(lineaUsaPoliticaDePrecio({ recargo: { activo: false } })).toBe(true)
  })

  it('una línea que no declara nada, no: corre con los valores de fábrica', () => {
    expect(lineaUsaPoliticaDePrecio({})).toBe(false)
    expect(lineaUsaPoliticaDePrecio(null)).toBe(false)
    expect(lineaUsaPoliticaDePrecio({ rutas: [], siigo: {} })).toBe(false)
  })
})

describe('provisional', () => {
  it('se lee por bloque', () => {
    expect(bloqueProvisional(TRAPPVEL, 'margen')).toBe(true)
    expect(bloqueProvisional({ margen: { provisional: false } }, 'margen')).toBe(false)
    expect(bloqueProvisional({ margen: {} }, 'margen')).toBe(false)
  })
})

describe('el aviso frente al mínimo', () => {
  it('aviso mayor que el mínimo: se guarda', () => {
    expect(motivoUmbralesInvalidos({ pisoPct: 5, avisoPct: 10 })).toBeNull()
  })

  it('iguales: se guarda (quiere decir «no aviso, freno»)', () => {
    expect(motivoUmbralesInvalidos({ pisoPct: 8, avisoPct: 8 })).toBeNull()
  })

  it('aviso MENOR que el mínimo: no se guarda, y se explica por qué', () => {
    const m = motivoUmbralesInvalidos({ pisoPct: 10, avisoPct: 5 })
    expect(m).not.toBeNull()
    expect(m).toContain('no puede ser menor que el mínimo')
    expect(m).toContain('nunca llegaría a verse')
    expect(m).not.toMatch(/\bpiso\b/)
  })

  it('fuera de rango: no se guarda', () => {
    expect(motivoUmbralesInvalidos({ pisoPct: -1, avisoPct: 10 })).not.toBeNull()
    expect(motivoUmbralesInvalidos({ pisoPct: 5, avisoPct: 100 })).not.toBeNull()
    expect(motivoUmbralesInvalidos({ pisoPct: Number.NaN, avisoPct: 10 })).not.toBeNull()
  })
})

describe('qué queda en el historial', () => {
  it('una línea por cada valor que cambió, con el anterior y el nuevo', () => {
    const c = cambiosDeMargen('Viaje a medida', { pisoPct: 5, avisoPct: 10, provisional: true }, { pisoPct: 7, avisoPct: 12 })
    expect(c).toEqual([
      expect.objectContaining({ campo: 'margen.piso_pct', anterior: '5', nuevo: '7' }),
      expect.objectContaining({ campo: 'margen.aviso_pct', anterior: '10', nuevo: '12' }),
    ])
    expect(c[0].contenido).toBe('Margen mínimo para aprobar una cotización (Viaje a medida): 5% → 7%')
  })

  it('sin cambios pero provisional: queda la confirmación, con autor y fecha como cualquier cambio', () => {
    const c = cambiosDeMargen('Viaje a medida', { pisoPct: 5, avisoPct: 10, provisional: true }, { pisoPct: 5, avisoPct: 10 })
    expect(c).toHaveLength(1)
    expect(c[0]).toMatchObject({ campo: 'margen.provisional', anterior: 'true', nuevo: 'false' })
    expect(c[0].contenido).toContain('sin cambiarlos')
  })

  it('sin cambios y ya revisado: nada que registrar', () => {
    expect(cambiosDeMargen('X', { pisoPct: 5, avisoPct: 10, provisional: false }, { pisoPct: 5, avisoPct: 10 })).toEqual([])
  })

  it('el recargo: valor y a qué vuelos, dichos en palabras', () => {
    const previo = { activo: true, etiqueta: 'Recargo de emision', valor: 100_000, vuelos: 'todos' as const, provisional: true }
    const c = cambiosDeRecargo('Viaje a medida', previo, { ...previo, valor: 120_000, vuelos: 'internacionales' })
    expect(c.map(x => x.campo)).toEqual(['recargo.valor', 'recargo.vuelos'])
    expect(c[0].contenido).toContain('$100.000 → $120.000')
    expect(c[1].contenido).toContain('todos los vuelos → solo vuelos internacionales')
  })

  it('ningún texto pasa de 280 caracteres (el CHECK de activity_log tumba el INSERT)', () => {
    const largo = 'x'.repeat(400)
    const c = cambiosDeRecargo('L', { activo: true, etiqueta: 'a', valor: 1, vuelos: 'todos', provisional: false }, {
      activo: true, etiqueta: largo, valor: 1, vuelos: 'todos',
    })
    expect(c[0].contenido.length).toBeLessThanOrEqual(280)
  })
})
