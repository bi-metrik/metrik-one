/**
 * La fila de una captura en la bandeja (bug #859, COT-2026-0011; H2/H3 del 2026-09-24).
 *
 * Lo que se fija:
 *  1. La ficha sale de lo que devolvió la lectura (`leida`, el borrador), y la fila dice a
 *     dónde va a ir antes de aceptar.
 *  2. «Aceptar» solo con una lectura firmada: nada sin leer llega a Componentes (H2).
 *  3. El título es el nombre real de la opción o de la ranura, no «Vuelo» a secas.
 *  4. Qué cuenta como trabajo en el aire: toda lectura sin aceptar (vive solo en la pestaña).
 *  5. «Reemplazar el precio» solo contra una opción que ya está en Componentes.
 *
 * Se queda en `.ts` por el `include` de vitest.
 */
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import fixture from '@/lib/cotizaciones/providencia-equipaje.fixture.json'
import { ranuraPorSlug } from '@/lib/cotizaciones/ranuras-pantallazo'
import type { OpcionLeida } from '@/lib/cotizaciones/bandeja-capturas'
import type { Borrador } from '@/lib/cotizaciones/proceso-captura'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {}, back: () => {} }) }))
vi.mock('sonner', () => ({ toast: { success: () => {}, error: () => {}, warning: () => {} } }))
vi.mock('@/app/(app)/negocios/tarifa-pax-actions', () => ({
  leerCapturaEnBorrador: async () => ({ ok: false, codigo: 'X', mensaje: '' }),
  aceptarCapturaDeBandeja: async () => ({ ok: false, codigo: 'X', mensaje: '' }),
}))
vi.mock('@/app/(app)/negocios/ranura-actions', () => ({
  detectarCaptura: async () => ({ ok: false, codigo: 'SIN_TIPO', mensaje: '' }),
}))

const { FilaCaptura, enElAireCaptura, opcionesParaComparar, desenlaceDeAceptacion } = await import('./bandeja-capturas')
type Captura = Parameters<typeof FilaCaptura>[0]['captura']

const VUELO = ranuraPorSlug('vuelo_detalle')!
const LECTURAS = fixture as unknown as Record<string, Record<string, string | null>>

const BORRADOR = { tipo: 'vuelo', lectura: {}, lecturaJson: '{}', firma: 'f', pistas: { lugar: null, origen: null, destino: null } } as unknown as Borrador

function opcion(id: string, extra: Partial<OpcionLeida> = {}): OpcionLeida {
  return { id, nombre: null, grupo: null, tarifa_pax: null, tramos: null, cargo_destino_valor: null, cargo_destino_moneda: null, ...extra }
}

/** La opción como la arma el borrador tras leer la captura de Avianca. */
function leidaAvianca(): OpcionLeida {
  const valores = LECTURAS['01-vuelo1-bog-adz-avianca.png']
  const campos = VUELO.campos
    .filter(c => valores[c.slug] !== null && valores[c.slug] !== undefined)
    .map(c => ({ label: c.label, valor: valores[c.slug] as string }))
  return opcion('borrador:cap-1', { grupo: 'vuelo', tarifa_pax: { casillas: { grupo_completo: { moneda: 'COP', total: 1, campos } } } })
}

function captura(extra: Partial<Captura> = {}): Captura {
  return {
    id: 'cap-1',
    preview: 'data:image/png;base64,AA==',
    dataUrl: 'data:image/png;base64,AA==',
    estado: { fase: 'lista', alertas: [] },
    tipo: 'vuelo',
    pistas: null,
    borrador: BORRADOR,
    itemId: null,
    donde: 'Vuelo a Providencia · nuevo',
    etiqueta: null,
    leida: null,
    abierta: true,
    error: null,
    ...extra,
  }
}

function pintar(c: Captura) {
  const nada = () => {}
  return renderToStaticMarkup(React.createElement(FilaCaptura, {
    captura: c,
    composicion: { adultos: 2, ninos: 0, infantes: 1 },
    onAlternar: nada,
    onAceptar: nada,
    onBorrar: nada,
    onDeshacer: nada,
    onElegirTipo: nada,
    onElegirOpcion: nada,
  }))
}

describe('la fila de una captura leída (borrador)', () => {
  it('pinta la ficha de la lectura, dice a dónde va y ofrece Aceptar', () => {
    const html = pintar(captura({ leida: leidaAvianca() }))
    expect(html).toContain('Avianca')
    expect(html).toContain('BOG 06:05')
    expect(html).toContain('Va a: Vuelo a Providencia · nuevo')
    expect(html).toMatch(/>\s*Aceptar\s*</)
  })

  it('sin lectura firmada no hay Aceptar: nada sin leer llega a Componentes (H2)', () => {
    const html = pintar(captura({ borrador: null, leida: leidaAvianca() }))
    expect(html).not.toMatch(/>\s*Aceptar\s*</)
  })

  it('con la ficha vacía se puede aceptar, y avisa que se revisa en su bloque', () => {
    const html = pintar(captura({ leida: opcion('borrador:cap-1', { grupo: 'vuelo' }) }))
    expect(html).toMatch(/>\s*Aceptar\s*</)
    expect(html).toContain('revísala en su bloque')
  })

  it('el título es el nombre real de la ranura cuando no hay nombre de opción', () => {
    const html = pintar(captura({ estado: { fase: 'leyendo' }, leida: null, etiqueta: 'Vuelo a Providencia' }))
    expect(html).toContain('Vuelo a Providencia')
  })
})

describe('trabajo en el aire (aviso al recargar)', () => {
  it('cuenta lo que se procesa, lo que espera elegir cuál leer y toda lectura sin aceptar', () => {
    expect(enElAireCaptura({ estado: { fase: 'leyendo' }, borrador: null })).toBe(true)
    expect(enElAireCaptura({ estado: { fase: 'mirando' }, borrador: null })).toBe(true)
    expect(enElAireCaptura({ estado: { fase: 'eligiendo_opcion', mensaje: '', opciones: [] }, borrador: null })).toBe(true)
    expect(enElAireCaptura({ estado: { fase: 'lista', alertas: [] }, borrador: BORRADOR })).toBe(true)
    expect(enElAireCaptura({ estado: { fase: 'parecida', conItemId: 'x', donde: '', alertas: [] }, borrador: BORRADOR })).toBe(true)
    expect(enElAireCaptura({ estado: { fase: 'aceptando' }, borrador: BORRADOR })).toBe(true)
  })

  it('no cuenta lo aceptado, lo rechazado ni lo que no dejó lectura', () => {
    expect(enElAireCaptura({ estado: { fase: 'aceptada' }, borrador: BORRADOR })).toBe(false)
    expect(enElAireCaptura({ estado: { fase: 'eligiendo_tipo', motivo: '' }, borrador: null })).toBe(false)
    expect(enElAireCaptura({ estado: { fase: 'rechazada', mensaje: '' }, borrador: null })).toBe(false)
    expect(enElAireCaptura({ estado: { fase: 'lista', alertas: [] }, borrador: null })).toBe(false)
  })
})

describe('el pantallazo repetido (P10)', () => {
  it('misma imagen: dice dónde está ya, que no se procesó, y ofrece Deshacer', () => {
    const html = pintar(captura({ estado: { fase: 'repetida', mensaje: 'Ya está como Opción 2 de Vuelo 1' } }))
    expect(html).toContain('Ya está como Opción 2 de Vuelo 1')
    expect(html).toContain('no se volvió a procesar')
    expect(html).toContain('Deshacer')
    expect(html).not.toMatch(/>\s*Aceptar\s*</)
  })

  it('parece igual: Descartar (por defecto) y Agregar igual, sin Aceptar', () => {
    const html = pintar(captura({
      estado: { fase: 'parecida', conItemId: 'item-0', donde: 'Opción 1 de Vuelo 1', alertas: [] },
      leida: leidaAvianca(),
    }))
    expect(html).toContain('Parece igual a Opción 1 de Vuelo 1')
    expect(html).toContain('Descartar')
    expect(html).toContain('Agregar igual')
    expect(html).not.toMatch(/>\s*Aceptar\s*</)
    expect(html.indexOf('Descartar')).toBeLessThan(html.indexOf('Agregar igual'))
  })

  it('grupo cubierto (R8): Agregar como habitación', () => {
    const html = pintar(captura({
      estado: { fase: 'parecida', conItemId: 'item-0', donde: 'Opción 1 de Hotel', alertas: [], habitacion: true },
    }))
    expect(html).toContain('El grupo ya está cubierto en Opción 1 de Hotel')
    expect(html).toContain('Agregar como habitación')
  })

  it('otro precio contra una opción de Componentes: Reemplazar o Agregar como otra opción', () => {
    const html = pintar(captura({
      estado: { fase: 'otro_precio', conItemId: 'item-0', donde: 'Opción 1 de Vuelo 1', corta: 'Opción 1', alertas: [] },
      leida: leidaAvianca(),
    }))
    expect(html).toContain('Reemplazar el precio de Opción 1')
    expect(html).toContain('Agregar como otra opción')
    expect(html).not.toMatch(/>\s*Aceptar\s*</)
  })

  it('otro precio contra otra captura aún sin aceptar: no ofrece reemplazar', () => {
    const html = pintar(captura({
      estado: { fase: 'otro_precio', conItemId: 'borrador:cap-9', donde: 'otra captura de esta bandeja', corta: 'esa opción', alertas: [] },
    }))
    expect(html).not.toContain('Reemplazar el precio')
    expect(html).toContain('Agregar como otra opción')
  })
})

describe('las opciones contra las que se compara (P10)', () => {
  it('suma las de la página y las de la bandeja, sin la propia, las quitadas ni los ajustes', () => {
    const items = [{ id: 'p1' }, { id: 'item-1', nombre: 'vieja' }, { id: 'aj', es_ajuste: true }]
    const cs = [
      captura({ id: 'c-propia', leida: opcion('borrador:c-propia') }),
      captura({ id: 'c-aceptada', estado: { fase: 'aceptada' }, itemId: 'item-1', leida: opcion('borrador:c-aceptada', { nombre: 'fresca' }) }),
      captura({ id: 'c-borrador', leida: opcion('borrador:c-borrador') }),
      captura({ id: 'c-quitada', leida: opcion('borrador:c-quitada'), estado: { fase: 'borrada', antes: { fase: 'lista', alertas: [] } } }),
    ]
    const r = opcionesParaComparar(items, cs, 'c-propia')
    expect(r.map(o => o.id).sort()).toEqual(['borrador:c-borrador', 'item-1', 'p1'])
    // La aceptada entra con su id real, para poder reemplazar su precio.
    expect(r.find(o => o.id === 'item-1')?.nombre).toBe('fresca')
  })
})

describe('la × mientras se analiza (P11)', () => {
  const boton = (html: string) => html.match(/<button[^>]*data-quitar-captura[^>]*>/)?.[0] ?? ''

  it('en «Analizando…» la × está habilitada y dice que deja de analizar', () => {
    for (const fase of ['mirando', 'leyendo'] as const) {
      const b = boton(pintar(captura({ estado: { fase }, leida: null, borrador: null })))
      expect(b).not.toBe('')
      expect(b).not.toContain('disabled')
      expect(b).toContain('se deja de analizar')
    }
  })

  it('quitada a mitad del análisis, la fila lo dice y ofrece Deshacer', () => {
    const html = pintar(captura({ estado: { fase: 'borrada', antes: { fase: 'mirando' }, reanudar: true } }))
    expect(html).toContain('se dejó de analizar')
    expect(html).toContain('Deshacer')
  })
})

describe('«Aceptar» (R1, H3)', () => {
  it('mientras acepta: dice a dónde, y no ofrece otro Aceptar ni la ×', () => {
    const html = pintar(captura({ estado: { fase: 'aceptando' }, donde: 'Otra opción de Hotel en Providencia' }))
    expect(html).toContain('Agregando · Otra opción de Hotel en Providencia…')
    expect(html).not.toMatch(/>\s*Aceptar\s*</)
    expect(html).not.toContain('data-quitar-captura')
  })

  it('traduce la respuesta del servidor', () => {
    expect(desenlaceDeAceptacion({ ok: true, itemId: 'i', donde: 'Hotel en Providencia · Opción 2', pendiente: null }))
      .toEqual({ tipo: 'aceptada', itemId: 'i', donde: 'Hotel en Providencia · Opción 2', pendiente: null })
    expect(desenlaceDeAceptacion({ ok: false, codigo: 'SOBRA', mensaje: 'cubierto', conItemId: 'h1' }))
      .toEqual({ tipo: 'sobra', conItemId: 'h1', mensaje: 'cubierto' })
    expect(desenlaceDeAceptacion({ ok: false, codigo: 'FIRMA', mensaje: 'venció' })).toEqual({ tipo: 'error', mensaje: 'venció' })
    expect(desenlaceDeAceptacion(null).tipo).toBe('error')
  })
})
