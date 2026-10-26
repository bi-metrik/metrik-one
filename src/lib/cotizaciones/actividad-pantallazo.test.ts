import { describe, expect, it } from 'vitest'

import {
  avisoFechaDeActividad,
  avisoTasaPendiente,
  ciudadDeActividad,
  fechaDeActividad,
  lugarDeBloqueNuevo,
} from './actividad-pantallazo'
import { avisoFechaActividadFueraDelViaje, esAvisoFechasFueraDelViaje } from './ingreso-manual'
import {
  archivoComoDataUrl,
  fueraDeVista,
  leerSinSilencio,
  MENSAJE_LECTURA_INTERRUMPIDA,
} from './lectura-sin-silencio'
import { sumarAlertas, type Composicion, type LecturaCasilla, type TarifaPax } from './tarifa-pasajero'

const GRUPO: Composicion = { adultos: 2, ninos: 0, infantes: 1 }
const VIAJE = { inicio: '2026-11-09', fin: '2026-11-13' }

function lectura(over: Partial<LecturaCasilla> = {}): LecturaCasilla {
  return {
    total: 233.37, moneda: 'EUR', aPagarAgencia: null, porTipo: [],
    ocupacion: { adultos: null, ninos: null, infantes: null, total: 3 }, ocupacionDelItem: false,
    identidad: { nombre: 'Excursión a Cayo Cangrejo', fecha: '2026-11-13' }, notasCliente: [], alertas: [],
    campos: [{ label: 'Actividad', valor: 'Excursión a Cayo Cangrejo' }, { label: 'Fecha', valor: '2026-11-13' }],
    nombre: 'Excursión a Cayo Cangrejo', descripcion: '', leidaEn: '2026-10-01T16:39:30.432Z',
    ...over,
  }
}

describe('el lugar del bloque de una actividad (punto 4)', () => {
  it('sin ciudad en la captura: ninguno (el servidor pone el destino), aunque el detector diga la excursión', () => {
    expect(lugarDeBloqueNuevo('actividad', lectura(), 'Cayo Cangrejo')).toBeNull()
  })
  it('con ciudad en la captura, esa; corregida en la fila, la corregida', () => {
    const conCiudad = lectura({ campos: [{ label: 'Ciudad', valor: 'Providencia' }] })
    expect(lugarDeBloqueNuevo('actividad', conCiudad, 'Cayo Cangrejo')).toBe('Providencia')
    expect(lugarDeBloqueNuevo('actividad', lectura(), null, [{ slug: 'ciudad', valor: 'San Andrés' }])).toBe('San Andrés')
    expect(ciudadDeActividad(lectura(), { ciudad: { valor: 'Bogotá', por: null, porId: null, en: 'x' } } as never)).toBe('Bogotá')
  })
  it('hotel, vuelo y traslado siguen con lo que dijo el detector', () => {
    expect(lugarDeBloqueNuevo('hotel', lectura(), 'Cartagena')).toBe('Cartagena')
    expect(lugarDeBloqueNuevo('traslado', lectura(), null)).toBeNull()
  })
})

describe('la fecha de la actividad fuera del viaje (punto 5)', () => {
  it('antes, después y dentro', () => {
    expect(avisoFechaActividadFueraDelViaje('2026-11-15', VIAJE)).toBe('La actividad es el 15 nov 2026 y el viaje es del 9 nov 2026 al 13 nov 2026. Revisa la fecha.')
    expect(avisoFechaActividadFueraDelViaje('2026-11-08', VIAJE)).toContain('8 nov 2026')
    expect(avisoFechaActividadFueraDelViaje('2026-11-13', VIAJE)).toBeNull()
    expect(avisoFechaActividadFueraDelViaje('2026-11-09', VIAJE)).toBeNull()
  })
  it('con el día de la semana pegado, sin fecha o sin viaje', () => {
    expect(avisoFechaActividadFueraDelViaje('2026-11-15/dom', VIAJE)).toContain('15 nov 2026')
    expect(avisoFechaActividadFueraDelViaje(null, VIAJE)).toBeNull()
    expect(avisoFechaActividadFueraDelViaje('2026-11-15', null)).toBeNull()
  })
  it('la bandeja lo reconoce como aviso de fechas (va en la fila, como el del hotel)', () => {
    expect(esAvisoFechasFueraDelViaje(avisoFechaActividadFueraDelViaje('2026-11-15', VIAJE)!)).toBe(true)
    expect(esAvisoFechasFueraDelViaje('El hotel va del 1 oct 2026 al 3 oct 2026 y el viaje es del 9 nov 2026 al 13 nov 2026. Revisa las fechas.')).toBe(true)
    expect(esAvisoFechasFueraDelViaje('El precio está en EUR.')).toBe(false)
  })
  it('la tarjeta usa la fecha corregida por encima de la leída, y solo en actividades', () => {
    const t: TarifaPax = { casillas: { grupo_completo: lectura({ identidad: { fecha: '2026-11-15' } }) } }
    expect(avisoFechaDeActividad('actividad_detalle', t, VIAJE)).toContain('15 nov')
    const corregida: TarifaPax = { ...t, correcciones: { fecha: { valor: '2026-11-12', por: null, porId: null, en: 'x' } } }
    expect(fechaDeActividad(corregida.casillas!.grupo_completo, corregida.correcciones)).toBe('2026-11-12')
    expect(avisoFechaDeActividad('actividad_detalle', corregida, VIAJE)).toBeNull()
    expect(avisoFechaDeActividad('traslado_detalle', t, VIAJE)).toBeNull()
  })
})

describe('la tasa de cambio que falta (punto 3)', () => {
  const eur: TarifaPax = { casillas: { grupo_completo: lectura() } }
  it('EUR leída, costo calculable y sin cargar: lo dice', () => {
    expect(avisoTasaPendiente(eur, GRUPO, 'actividad_detalle')).toBe('El precio está en EUR: escribe la tasa de cambio para cargar el costo.')
  })
  it('en COP, sin lectura, o con el costo ya cargado: nada', () => {
    expect(avisoTasaPendiente({ casillas: { grupo_completo: lectura({ moneda: 'COP' }) } }, GRUPO, 'actividad_detalle')).toBeNull()
    expect(avisoTasaPendiente({}, GRUPO, 'actividad_detalle')).toBeNull()
    const cargada: TarifaPax = {
      ...eur,
      confirmada: { composicion: GRUPO, costos: [], costoTotalCOP: 1, moneda: 'EUR', tasa: 4500, confirmadaEn: '2026-10-01T17:00:00Z' },
    }
    expect(avisoTasaPendiente(cargada, GRUPO, 'actividad_detalle')).toBeNull()
  })
  it('si lo que falta es otro pantallazo (hotel con infante), no se habla de la tasa: lo dice su bloque', () => {
    expect(avisoTasaPendiente(eur, GRUPO, 'hotel_detalle')).toBeNull()
  })
})

describe('un pantallazo nunca falla en silencio (punto 7)', () => {
  it('si la lectura lanza o no responde, sale un rechazo con su mensaje', async () => {
    expect(await leerSinSilencio(async () => { throw new Error('504') })).toEqual({ ok: false, codigo: 'INTERRUMPIDA', mensaje: MENSAJE_LECTURA_INTERRUMPIDA })
    expect(await leerSinSilencio(async () => undefined)).toEqual({ ok: false, codigo: 'INTERRUMPIDA', mensaje: MENSAJE_LECTURA_INTERRUMPIDA })
    expect(await leerSinSilencio(async () => ({ ok: true as const, n: 1 }))).toEqual({ ok: true, n: 1 })
  })
  it('un archivo que no se deja leer rechaza (no queda colgado)', async () => {
    class LectorQueFalla {
      onload: ((ev: unknown) => void) | null = null
      onerror: (() => void) | null = null
      readAsDataURL() { setTimeout(() => this.onerror?.(), 0) }
    }
    const original = globalThis.FileReader
    globalThis.FileReader = LectorQueFalla as never
    try {
      await expect(archivoComoDataUrl(new Blob(['x']))).rejects.toThrow('No se pudo abrir esa imagen')
    } finally {
      globalThis.FileReader = original
    }
  })
  it('la bandeja fuera de la pantalla se reconoce (arriba o abajo)', () => {
    expect(fueraDeVista({ top: -400, bottom: -10 }, 800)).toBe(true)
    expect(fueraDeVista({ top: 900, bottom: 1200 }, 800)).toBe(true)
    expect(fueraDeVista({ top: -100, bottom: 50 }, 800)).toBe(false)
  })
})

describe('avisos sin repetir (punto 6)', () => {
  it('suma listas conservando el orden y sin duplicados', () => {
    expect(sumarAlertas(['a', 'b'], ['b', 'c'], null, ['a'])).toEqual(['a', 'b', 'c'])
    expect(sumarAlertas(['a', 'a'])).toEqual(['a'])
  })
})
