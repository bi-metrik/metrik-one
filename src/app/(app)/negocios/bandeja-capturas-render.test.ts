/**
 * La fila de un pantallazo en la bandeja (bug #859; H2 a H5 del 2026-09-24; forma y textos del
 * prototipo de la tarjeta aprobado ese día).
 *
 * Lo que se fija:
 *  1. La fila leída se revisa en la fila: título de la lectura, campos y «Aceptar» (H4).
 *  2. «Aceptar» solo con una lectura firmada: nada sin leer llega a Componentes (H2).
 *  3. Lo aceptado se queda a la vista y dice dónde quedó, con «Ver» (H3).
 *  4. La habitación que sobra se pregunta con el texto del prototipo.
 *  5. Las alertas son solo el ícono ⚠ (H5).
 *  6. Qué cuenta como trabajo en el aire: toda lectura sin aceptar (vive solo en la pestaña).
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
import type { LecturaCasilla } from '@/lib/cotizaciones/tarifa-pasajero'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {}, back: () => {} }) }))
vi.mock('sonner', () => ({ toast: { success: () => {}, error: () => {}, warning: () => {} } }))
vi.mock('@/app/(app)/negocios/tarifa-pax-actions', () => ({
  leerCapturaEnBorrador: async () => ({ ok: false, codigo: 'X', mensaje: '' }),
  aceptarCapturaDeBandeja: async () => ({ ok: false, codigo: 'X', mensaje: '' }),
  quitarHabitacion: async () => ({ success: true }),
}))
vi.mock('@/app/(app)/negocios/ranura-actions', () => ({
  detectarCaptura: async () => ({ ok: false, codigo: 'SIN_TIPO', mensaje: '' }),
}))

const { FilaCaptura, enElAireCaptura, opcionesParaComparar, desenlaceDeAceptacion, textoDeAceptada, textoDelPie, pendientesPorOpcion } = await import('./bandeja-capturas')
type Captura = Parameters<typeof FilaCaptura>[0]['captura']

const LECTURAS = fixture as unknown as Record<string, Record<string, string | null>>

function lectura(slugRanura: string, valores: Record<string, string | null>): LecturaCasilla {
  const ranura = ranuraPorSlug(slugRanura)!
  const campos = ranura.campos
    .filter(c => valores[c.slug] !== null && valores[c.slug] !== undefined)
    .map(c => ({ label: c.label, valor: valores[c.slug] as string }))
  return {
    moneda: 'COP', total: Number(valores.precio_total ?? 0), aPagarAgencia: null, porTipo: [],
    ocupacion: {
      adultos: valores.ocupacion_adultos ? Number(valores.ocupacion_adultos) : null,
      ninos: null, infantes: valores.ocupacion_infantes ? Number(valores.ocupacion_infantes) : null, total: null,
    },
    ocupacionDelItem: false, identidad: {}, notasCliente: [], alertas: [], campos,
    nombre: '', descripcion: '', leidaEn: '2026-09-24T00:00:00Z',
  } as LecturaCasilla
}

const AVIANCA = LECTURAS['01-vuelo1-bog-adz-avianca.png']
const borrador = (tipo: 'vuelo' | 'hotel', l: LecturaCasilla) =>
  ({ tipo, lectura: l, lecturaJson: '{}', firma: 'f', pistas: { lugar: null, origen: null, destino: null } }) as unknown as Borrador

const BORRADOR_VUELO = borrador('vuelo', lectura('vuelo_detalle', AVIANCA))
const ENILDA = lectura('hotel_detalle', {
  hotel: 'Posada Enilda', tipo_habitacion: 'Habitación 2 Camas', ocupacion_adultos: '2', moneda: 'COP', precio_total: '401200',
})

function opcion(id: string, extra: Partial<OpcionLeida> = {}): OpcionLeida {
  return { id, nombre: null, grupo: null, tarifa_pax: null, tramos: null, cargo_destino_valor: null, cargo_destino_moneda: null, ...extra }
}

function captura(extra: Partial<Captura> = {}): Captura {
  return {
    id: 'cap-1',
    preview: 'data:image/png;base64,AA==',
    dataUrl: 'data:image/png;base64,AA==',
    estado: { fase: 'lista', alertas: [] },
    tipo: 'vuelo',
    pistas: null,
    borrador: BORRADOR_VUELO,
    itemId: null,
    donde: 'Vuelo a Providencia · nuevo',
    etiqueta: null,
    leida: null,
    error: null,
    ...extra,
  }
}

const pintar = (c: Captura, ubicaciones = {}) =>
  renderToStaticMarkup(React.createElement(FilaCaptura, { captura: c, ubicaciones, onVer: () => {} }))

describe('la fila de un pantallazo leído: se revisa antes de aceptar (H4)', () => {
  it('título de la lectura, los campos del prototipo y «Aceptar» / «Descartar»', () => {
    const html = pintar(captura())
    expect(html).toContain('Avianca · Bogotá → San Andrés')
    for (const r of ['Aerolínea', 'Vuelo', 'Fecha', 'Sale de BOG', 'Llega a ADZ', 'Costo']) expect(html).toContain(`<span>${r}</span>`)
    expect(html).toContain('value="9 nov 2026"')
    expect(html).toMatch(/>Aceptar</)
    expect(html).toMatch(/>Descartar</)
    expect(html).not.toContain('Aceptar con cambios')
    // El costo se ve, pero no se escribe en la bandeja.
    expect(html).toMatch(/<input[^>]*readonly=""[^>]*data-campo-revision="costo"/i)
  })

  it('sin hora de llegada: la frase del prototipo y el campo en ámbar con «Escríbela»', () => {
    const html = pintar(captura({ borrador: borrador('vuelo', lectura('vuelo_detalle', { ...AVIANCA, hora_llegada: null })) }))
    expect(html).toContain('El pantallazo corta la hora de llegada. Escríbela y acepta; lo demás ONE ya lo leyó.')
    expect(html).toMatch(/placeholder="Escríbela"[^>]*data-campo-revision="hora_llegada"/)
  })

  it('una habitación que se suma a su opción no se revisa campo por campo', () => {
    const html = pintar(captura({ tipo: 'hotel', borrador: borrador('hotel', ENILDA), como: 'habitacion' }))
    expect(html).not.toContain('data-campo-revision')
    expect(html).toMatch(/>Aceptar</)
  })

  it('sin lectura firmada no hay Aceptar: nada sin leer llega a Componentes (H2)', () => {
    const html = pintar(captura({ borrador: null }))
    expect(html).not.toMatch(/>Aceptar</)
    expect(html).toContain('data-quitar-captura')
  })

  it('una lectura sin datos se puede aceptar, y avisa que se revisa en su bloque', () => {
    const html = pintar(captura({ borrador: borrador('vuelo', lectura('vuelo_detalle', {})) }))
    expect(html).toMatch(/>Aceptar</)
    expect(html).toContain('revísala en su bloque')
  })

  it('las alertas de la lectura son solo el ícono ⚠, con su texto al pasar el mouse (H5)', () => {
    const html = pintar(captura({ estado: { fase: 'lista', alertas: ['Revisa la moneda: la captura no la muestra.'] } }))
    expect(html).toContain('aria-label="Necesita tu decisión"')
    expect(html).toContain('role="tooltip"')
    expect(html).toContain('Revisa la moneda: la captura no la muestra.')
  })
})

describe('mientras se lee', () => {
  it('«Pantallazo pegado», «Leyendo…» y la × habilitada', () => {
    for (const fase of ['mirando', 'leyendo'] as const) {
      const html = pintar(captura({ estado: { fase }, borrador: null }))
      expect(html).toContain('Pantallazo pegado')
      expect(html).toContain('Leyendo…')
      const x = html.match(/<button[^>]*data-quitar-captura[^>]*>/)?.[0] ?? ''
      expect(x).toContain('aria-label="Quitar este pantallazo"')
      expect(x).not.toContain('disabled')
    }
  })

  it('el nombre de la ranura, si se sabe, antes que «Pantallazo pegado»', () => {
    const html = pintar(captura({ estado: { fase: 'leyendo' }, borrador: null, etiqueta: 'Vuelo a Providencia' }))
    expect(html).toContain('Vuelo a Providencia')
  })
})

describe('quitada y descartada', () => {
  it('×: «Quitaste este pantallazo…», con Deshacer', () => {
    const html = pintar(captura({ estado: { fase: 'borrada', antes: { fase: 'mirando' }, reanudar: true } }))
    expect(html).toContain('Quitaste este pantallazo. No entró a la cotización.')
    expect(html).toContain('Deshacer')
  })

  it('«Descartar» en una pregunta: «Descartada…», con Deshacer', () => {
    const html = pintar(captura({ estado: { fase: 'borrada', antes: { fase: 'lista', alertas: [] }, motivo: 'descartada' } }))
    expect(html).toContain('Descartada. No entró a la cotización.')
    expect(html).toContain('Deshacer')
  })
})

describe('la habitación que sobra (R8, regla 6)', () => {
  it('pregunta con el hotel y el precio, «Descartar» primero y «Es una habitación más»', () => {
    const html = pintar(captura({
      tipo: 'hotel',
      borrador: borrador('hotel', ENILDA),
      estado: { fase: 'parecida', conItemId: 'item-0', donde: 'Opción 2 de Hotel en Providencia', alertas: [], habitacion: true },
    }))
    expect(html).toContain('Posada Enilda · Habitación 2 Camas · 2 adultos · $401.200')
    expect(html).toContain('Esta habitación sobra: el grupo ya está cubierto en Posada Enilda. ¿La descarto?')
    expect(html.indexOf('>Descartar<')).toBeLessThan(html.indexOf('Es una habitación más'))
    expect(html).not.toMatch(/>Aceptar</)
  })
})

describe('el pantallazo repetido (P10)', () => {
  it('misma imagen: dice dónde está ya, que no se procesó, y ofrece Deshacer', () => {
    const html = pintar(captura({ estado: { fase: 'repetida', mensaje: 'Ya está como Opción 2 de Vuelo 1' } }))
    expect(html).toContain('Ya está como Opción 2 de Vuelo 1 · no se volvió a procesar')
    expect(html).toContain('Deshacer')
    expect(html).not.toMatch(/>Aceptar</)
  })

  it('parece igual: Descartar (por defecto) y Agregar igual, sin Aceptar', () => {
    const html = pintar(captura({ estado: { fase: 'parecida', conItemId: 'item-0', donde: 'Opción 1 de Vuelo 1', alertas: [] } }))
    expect(html).toContain('Mismo servicio, mismas fechas y mismo precio que Opción 1 de Vuelo 1.')
    expect(html).not.toMatch(/>Aceptar</)
    expect(html.indexOf('>Descartar<')).toBeLessThan(html.indexOf('Agregar igual'))
  })

  it('otro precio contra una opción de Componentes: Reemplazar o Agregar como otra opción', () => {
    const html = pintar(captura({ estado: { fase: 'otro_precio', conItemId: 'item-0', donde: 'Opción 1 de Vuelo 1', corta: 'Opción 1', alertas: [] } }))
    expect(html).toContain('Reemplazar el precio de Opción 1')
    expect(html).toContain('Agregar como otra opción')
  })

  it('otro precio contra otra captura aún sin aceptar: no ofrece reemplazar', () => {
    const html = pintar(captura({ estado: { fase: 'otro_precio', conItemId: 'borrador:cap-9', donde: 'otra captura de esta bandeja', corta: 'esa opción', alertas: [] } }))
    expect(html).not.toContain('Reemplazar el precio')
    expect(html).toContain('Agregar como otra opción')
  })
})

describe('lo aceptado se queda a la vista (H3)', () => {
  const aceptada = (como: 'hermana' | 'nueva' | 'habitacion', extra: Partial<Captura> = {}) => captura({
    estado: { fase: 'aceptada' },
    itemId: 'item-7',
    aceptada: { como, bloque: 'Hotel en Providencia', opcion: 2, habitacionId: como === 'habitacion' ? 'h7' : null, habitacionNumero: como === 'habitacion' ? 4 : null, antes: { fase: 'lista', alertas: [] } },
    ...extra,
  })

  it('dice dónde quedó con el nombre de la página, y ofrece Ver', () => {
    const html = pintar(aceptada('hermana'), { 'item-7': { bloque: 'Hotel en Providencia', opcion: 1 } })
    expect(html).toContain('Agregada a Hotel en Providencia · Opción 1')
    expect(html).toMatch(/>Ver</)
    expect(html).not.toContain('Deshacer')
  })

  it('en un bloque nuevo lo dice así', () => {
    const u = { 'item-7': { bloque: 'Vuelo 2 · San Andrés → Providencia', opcion: 1 } }
    expect(textoDeAceptada(aceptada('nueva'), u)).toBe('Agregada a un bloque nuevo: Vuelo 2 · San Andrés → Providencia')
  })

  it('como habitación: su número, y Deshacer', () => {
    const html = pintar(aceptada('habitacion'), { 'item-7': { bloque: 'Hotel en Providencia', opcion: 2 } })
    expect(html).toContain('Agregada a Hotel en Providencia · Opción 2 como habitación 4')
    expect(html).toContain('Deshacer')
  })

  it('si la página todavía no trae la opción, usa lo que dijo el servidor', () => {
    expect(textoDeAceptada(aceptada('hermana'), {})).toBe('Agregada a Hotel en Providencia · Opción 2')
  })

  it('mientras acepta: dice a dónde, y no ofrece otro Aceptar ni la ×', () => {
    const html = pintar(captura({ estado: { fase: 'aceptando' }, donde: 'Otra opción de Hotel en Providencia' }))
    expect(html).toContain('Agregando · Otra opción de Hotel en Providencia…')
    expect(html).not.toMatch(/>Aceptar</)
    expect(html).not.toContain('data-quitar-captura')
  })

  it('traduce la respuesta del servidor', () => {
    expect(desenlaceDeAceptacion({ ok: true, itemId: 'i', donde: 'Hotel en Providencia · Opción 2', pendiente: null, como: 'hermana', bloque: 'Hotel en Providencia', opcion: 2 }))
      .toMatchObject({ tipo: 'aceptada', itemId: 'i', como: 'hermana', bloque: 'Hotel en Providencia', opcion: 2, correccionesFallidas: [] })
    expect(desenlaceDeAceptacion({ ok: false, codigo: 'SOBRA', mensaje: 'cubierto', conItemId: 'h1' }))
      .toEqual({ tipo: 'sobra', conItemId: 'h1', mensaje: 'cubierto' })
    expect(desenlaceDeAceptacion({ ok: false, codigo: 'FIRMA', mensaje: 'venció' })).toEqual({ tipo: 'error', mensaje: 'venció' })
    expect(desenlaceDeAceptacion(null).tipo).toBe('error')
  })
})

describe('el pie de la bandeja', () => {
  it('cuenta los otros pantallazos que ya están en la cotización', () => {
    expect(textoDelPie(5)).toBe('Otros 5 pantallazos ya están en la cotización.')
    expect(textoDelPie(0)).toBeNull()
  })
})

describe('trabajo en el aire (aviso al recargar)', () => {
  it('cuenta lo que se procesa, lo que espera elegir cuál leer y toda lectura sin aceptar', () => {
    expect(enElAireCaptura({ estado: { fase: 'leyendo' }, borrador: null })).toBe(true)
    expect(enElAireCaptura({ estado: { fase: 'mirando' }, borrador: null })).toBe(true)
    expect(enElAireCaptura({ estado: { fase: 'eligiendo_opcion', mensaje: '', opciones: [] }, borrador: null })).toBe(true)
    expect(enElAireCaptura({ estado: { fase: 'lista', alertas: [] }, borrador: BORRADOR_VUELO })).toBe(true)
    expect(enElAireCaptura({ estado: { fase: 'parecida', conItemId: 'x', donde: '', alertas: [] }, borrador: BORRADOR_VUELO })).toBe(true)
    expect(enElAireCaptura({ estado: { fase: 'aceptando' }, borrador: BORRADOR_VUELO })).toBe(true)
  })

  it('no cuenta lo aceptado, lo rechazado ni lo que no dejó lectura', () => {
    expect(enElAireCaptura({ estado: { fase: 'aceptada' }, borrador: BORRADOR_VUELO })).toBe(false)
    expect(enElAireCaptura({ estado: { fase: 'eligiendo_tipo', motivo: '' }, borrador: null })).toBe(false)
    expect(enElAireCaptura({ estado: { fase: 'rechazada', mensaje: '' }, borrador: null })).toBe(false)
    expect(enElAireCaptura({ estado: { fase: 'lista', alertas: [] }, borrador: null })).toBe(false)
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
    expect(r.find(o => o.id === 'item-1')?.nombre).toBe('fresca')
  })
})

describe('el ⚠ de la tarjeta: qué opción tiene un pantallazo esperando (R8, regla 6)', () => {
  const sobra = (id: string, conItemId: string, habitacion = true) =>
    ({ id, estado: { fase: 'parecida' as const, conItemId, donde: 'Opción 2', alertas: [], habitacion } })

  it('la habitación que sobra señala su opción; la primera captura gana', () => {
    expect(pendientesPorOpcion([sobra('c1', 'o2'), sobra('c2', 'o2'), sobra('c3', 'o1')])).toEqual({ o2: 'c1', o1: 'c3' })
  })

  it('una parecida que no es habitación, o contra un borrador, no es de ninguna tarjeta', () => {
    expect(pendientesPorOpcion([sobra('c1', 'o2', false)])).toEqual({})
    expect(pendientesPorOpcion([sobra('c1', 'borrador:cap-9')])).toEqual({})
    expect(pendientesPorOpcion([{ id: 'c1', estado: { fase: 'lista' as const, alertas: [] } }])).toEqual({})
  })
})
