import { describe, expect, it } from 'vitest'

import { hayTarifaPorPasajero, lineasDesactualizadas, motivoParaNoEnviar } from './captura-desactualizada'
import { precioPorPasajeroDeItem } from './precio-pasajero-pdf'

const lectura = (over: Record<string, unknown> = {}) => ({
  moneda: 'COP', total: 2000000, aPagarAgencia: null, porTipo: [],
  ocupacion: { adultos: 2, ninos: 0, infantes: 0, total: 2 }, ocupacionDelItem: false,
  identidad: {}, notasCliente: [], alertas: [], campos: [], nombre: 'Hotel', descripcion: '',
  leidaEn: '2026-09-22T12:00:00Z', paraComposicion: { adultos: 2, ninos: 0, infantes: 0 },
  ...over,
})
const confirmada = (moneda = 'COP') => ({
  composicion: { adultos: 2, ninos: 0, infantes: 0 },
  costos: [{ tipo: 'adulto', cantidad: 2, unitarioCOP: 1000000, totalCOP: 2000000 }],
  costoTotalCOP: 2000000, moneda, tasa: null, confirmadaEn: '2026-09-22T13:00:00Z',
})
const TRES = { adultos: 3, ninos: 0, infantes: 0 }
const DOS = { adultos: 2, ninos: 0, infantes: 0 }

describe('las líneas desactualizadas de una cotización', () => {
  it('nombra la línea cuya captura es de otros pasajeros, con el texto de la línea', () => {
    const r = lineasDesactualizadas(
      [{ id: 'h', nombre: 'HOTEL', grupo: 'hotel', tarifa_pax: { casillas: { grupo_completo: lectura() } } }],
      TRES,
    )
    expect(r).toEqual([{
      itemId: 'h',
      nombre: 'HOTEL',
      motivos: ['Este pantallazo es para 2 adultos y la línea ahora cubre 3 adultos: pega uno nuevo.'],
      arreglo: 'pantallazo',
    }])
  })

  it('captura y confirmación viejas por la misma causa se dicen UNA vez', () => {
    const r = lineasDesactualizadas(
      [{ id: 'h', nombre: 'HOTEL', grupo: 'hotel', tarifa_pax: { casillas: { grupo_completo: lectura() }, confirmada: confirmada() } }],
      TRES,
    )
    expect(r[0].motivos).toHaveLength(1)
  })

  it('captura nueva pero sin volver a confirmar: queda la confirmación', () => {
    const nueva = lectura({ ocupacion: { adultos: 3, ninos: 0, infantes: 0, total: 3 }, paraComposicion: TRES })
    const r = lineasDesactualizadas(
      [{ id: 'h', nombre: 'HOTEL', grupo: 'hotel', tarifa_pax: { casillas: { grupo_completo: nueva }, confirmada: confirmada() } }],
      TRES,
    )
    expect(r[0].motivos[0]).toContain('El costo cargado es para 2 adultos y la línea ahora cubre 3 adultos')
    expect(r[0].arreglo).toBe('confirmacion')
  })

  it('nada viejo, línea sin ranura, o cuadre: no aparecen (R6)', () => {
    expect(lineasDesactualizadas([
      { id: 'h', nombre: 'HOTEL', grupo: 'hotel', tarifa_pax: { casillas: { grupo_completo: lectura() } } },
      { id: 's', nombre: 'SEGURO', grupo: null, tarifa_pax: { casillas: { grupo_completo: lectura() } } },
      { id: 'a', nombre: 'AJUSTE', grupo: 'hotel', es_ajuste: true, tarifa_pax: { casillas: { grupo_completo: lectura() } } },
    ], DOS)).toEqual([])
    expect(lineasDesactualizadas([
      { id: 's', nombre: 'SEGURO', grupo: null, tarifa_pax: { casillas: { grupo_completo: lectura() } } },
      { id: 'a', nombre: 'AJUSTE', grupo: 'hotel', es_ajuste: true, tarifa_pax: { casillas: { grupo_completo: lectura() } } },
    ], TRES)).toEqual([])
  })
})

describe('el motivo para no dejar salir la cotización (decisión del 2026-09-22)', () => {
  const hotelViejo = { id: 'h', nombre: 'HOTEL', grupo: 'hotel', tarifa_pax: { casillas: { grupo_completo: lectura() } } }
  const nueva = lectura({ ocupacion: { adultos: 3, ninos: 0, infantes: 0, total: 3 }, paraComposicion: TRES })
  const vueloSinReconfirmar = {
    id: 'v', nombre: 'HOTEL 2', grupo: 'hotel',
    tarifa_pax: { casillas: { grupo_completo: nueva }, confirmada: confirmada() },
  }

  it('sin líneas viejas, puede salir', () => {
    expect(motivoParaNoEnviar([])).toBeNull()
    expect(motivoParaNoEnviar(lineasDesactualizadas([hotelViejo], DOS))).toBeNull()
  })

  it('nombra lo que hay que pegar y, aparte, lo que solo hay que reconfirmar', () => {
    const lineas = lineasDesactualizadas([hotelViejo, vueloSinReconfirmar], TRES)
    expect(motivoParaNoEnviar(lineas)).toBe(
      'Antes de enviar, pega el pantallazo nuevo en: «HOTEL». Y vuelve a confirmar el costo de: «HOTEL 2».',
    )
    expect(motivoParaNoEnviar(lineas, 'aprobar')).toMatch(/^Antes de aprobar, pega el pantallazo nuevo en: «HOTEL»\./)
  })

  it('varias líneas del mismo arreglo van en una sola lista', () => {
    const otro = { ...hotelViejo, id: 'h2', nombre: 'HOTEL SANTA MARTA' }
    expect(motivoParaNoEnviar(lineasDesactualizadas([hotelViejo, otro], TRES))).toBe(
      'Antes de enviar, pega el pantallazo nuevo en: «HOTEL», «HOTEL SANTA MARTA».',
    )
  })

  it('otra moneda que la confirmada también frena: solo hay que reconfirmar', () => {
    const enUSD = {
      id: 'u', nombre: 'HOTEL USD', grupo: 'hotel',
      tarifa_pax: { casillas: { grupo_completo: lectura({ moneda: 'USD' }) }, confirmada: confirmada('COP') },
    }
    expect(motivoParaNoEnviar(lineasDesactualizadas([enUSD], DOS))).toBe(
      'Antes de enviar, vuelve a confirmar el costo de: «HOTEL USD».',
    )
  })

  it('hayTarifaPorPasajero: casillas o costo confirmado; nada más cuenta (R6)', () => {
    expect(hayTarifaPorPasajero([hotelViejo])).toBe(true)
    expect(hayTarifaPorPasajero([{ tarifa_pax: { confirmada: confirmada() } }])).toBe(true)
    expect(hayTarifaPorPasajero([{ tarifa_pax: null }, { tarifa_pax: { casillas: {} } }, {}])).toBe(false)
    expect(hayTarifaPorPasajero([])).toBe(false)
  })
})

describe('el documento no imprime el reparto de una confirmación vieja', () => {
  const item = (tarifa_pax: unknown) => ({
    precio_venta: 2400000,
    tarifa_pax,
    rubros: [{ valor_total: 2000000, sugerido: false }],
  })

  it('vigente: reparte; otro grupo: no reparte', () => {
    const t = { casillas: { grupo_completo: lectura() }, confirmada: confirmada() }
    expect(precioPorPasajeroDeItem(item(t), DOS)).toEqual([{ tipo: 'adulto', cantidad: 2, precioUnitario: 1200000 }])
    expect(precioPorPasajeroDeItem(item(t), TRES)).toBeNull()
  })

  it('otra moneda después de confirmar: no reparte, aun sin saber los pasajeros del viaje', () => {
    const t = {
      casillas: { grupo_completo: lectura() },
      confirmada: confirmada('COP'),
      moneda: { valor: 'USD', por: null, porId: null, en: '2026-09-22T14:00:00Z' },
    }
    expect(precioPorPasajeroDeItem(item(t))).toBeNull()
  })
})
