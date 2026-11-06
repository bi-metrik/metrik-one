/**
 * «¿Ese precio es de todos los pasajeros o de uno solo?» (Trappvel, 2026-11-06).
 *
 * Tatiana pegó un vuelo de la pantalla del GDS (BOG–CTG / CTG–BOG, «COP 4,666,438», sin número de
 * pasajeros) y salió RX2 pidiendo «una captura que lo incluya». Ninguna captura lo va a incluir: la
 * pantalla no lo dice. Decisión de Mauricio: que la persona elija; en vuelos NO se supone total
 * (cotizar a la mitad del costo). El hotel sigue con su regla (#1441: total con aviso).
 */
import { describe, expect, it } from 'vitest'

import {
  etiquetaDeBasePrecio,
  evaluarLectura,
  preguntaDeBasePrecio,
  type ContextoLectura,
  type LecturaCruda,
} from './lectura-pantallazo'
import { construirLecturaCasilla } from './lectura-casilla'
import {
  elegirBasePrecio,
  leerCaptura,
  type CambioDeCaptura,
  type DependenciasDeProceso,
  type LecturaDeBorrador,
  type OpcionDeBase,
} from './proceso-captura'
import { ranuraPorSlug } from './ranuras-pantallazo'
import type { LecturaCasilla } from './tarifa-pasajero'

const VUELO = ranuraPorSlug('vuelo_detalle')!
const HOTEL = ranuraPorSlug('hotel_detalle')!
const v = (valor: string | null, confianza = 0.95) => ({ value: valor, confidence: confianza })

/** La pantalla del GDS: ida y regreso, el total y nada que diga a cuántos. */
function vueloGds(over: Record<string, { value: string | null; confidence: number }> = {}): LecturaCruda {
  return {
    veredicto: 'detalle_unico',
    observacion: 'Itinerario BOG-CTG / CTG-BOG con su precio',
    campos: {
      aerolinea: v('AVIANCA'),
      origen: v('BOG'),
      destino: v('CTG'),
      fecha_salida: v('2026-12-12'),
      fecha_regreso: v('2026-12-18'),
      numero_vuelo: v('AV9590'),
      escalas: v('0'),
      pax: v(null, 0),
      moneda: v('COP'),
      precio_total: v('4666438'),
      base_precio: v(null, 0),
      ...over,
    },
    desglose: [],
  }
}

/** El contexto de la bandeja (`leer-imagen-captura.ts`). */
const BANDEJA: ContextoLectura = { soloMinimosDeCosto: true, monedaSiFalta: 'COP', pasajeros: 4 }

describe('vuelo sin base_precio: se pregunta, no se supone', () => {
  it('solo falta base_precio: RX2 con las opciones del enum de la ranura', () => {
    const r = evaluarLectura(VUELO, vueloGds(), BANDEJA)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.codigo).toBe('RX2')
    expect(r.basePorElegir).toEqual(['total', 'por_pax'])
    expect(r.basePorElegir).toEqual(VUELO.campos.find(c => c.slug === 'base_precio')!.opciones)
  })

  it('las palabras de la pregunta y de los botones', () => {
    expect(preguntaDeBasePrecio(VUELO)).toBe('¿Ese precio es de todos los pasajeros o de uno solo?')
    expect(preguntaDeBasePrecio(ranuraPorSlug('traslado_detalle')!)).toBe('¿Ese precio es de todas las personas o de una sola?')
    expect(etiquetaDeBasePrecio('total')).toBe('Es el total')
    expect(etiquetaDeBasePrecio('por_pax')).toBe('Es por persona')
  })

  for (const slug of ['traslado_detalle', 'actividad_detalle', 'tren_detalle', 'otro_detalle']) {
    it(`también en ${slug}: sus opciones, no las del vuelo`, () => {
      const ranura = ranuraPorSlug(slug)!
      const def = ranura.campos.find(c => c.slug === 'base_precio')!
      expect(def.min).toBe(true)
      const campos: LecturaCruda['campos'] = {}
      for (const c of ranura.campos) campos[c.slug] = v(c.tipo === 'fecha' ? '2026-12-12' : c.tipo === 'currency' || c.tipo === 'numero' ? '100' : 'algo')
      campos.moneda = v('COP')
      campos.precio_total = v('350000')
      campos.base_precio = v(null, 0)
      for (const s of ['pax', 'ocupacion', 'ocupacion_total', 'ocupacion_adultos', 'ocupacion_ninos', 'ocupacion_infantes']) if (campos[s]) campos[s] = v(null, 0)
      const r = evaluarLectura(ranura, { veredicto: 'detalle_unico', observacion: null, campos, desglose: [] }, BANDEJA)
      expect(r.ok, slug).toBe(false)
      if (!r.ok) expect(r.basePorElegir, r.motivo).toEqual(def.opciones)
    })
  }

  it('lo que eligió la persona entra como leído: sin alerta de revisión, con rastro', () => {
    const r = evaluarLectura(VUELO, vueloGds(), { ...BANDEJA, basePrecioElegido: 'por_pax' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.campos.find(c => c.slug === 'base_precio')).toMatchObject({ valor: 'por_pax', alertaRevision: false, elegido: true })
    expect(r.basePrecioOrigen).toBe('elegido')
    expect(r.avisos.join(' ')).not.toMatch(/total o por persona|por persona o de todas/)
  })

  it('un valor fuera del enum no cuenta como elección', () => {
    const r = evaluarLectura(VUELO, vueloGds(), { ...BANDEJA, basePrecioElegido: 'por_noche' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.basePorElegir).toEqual(['total', 'por_pax'])
  })

  it('lo que el lector sí leyó manda sobre la elección', () => {
    const r = evaluarLectura(VUELO, vueloGds({ base_precio: v('total') }), { ...BANDEJA, basePrecioElegido: 'por_pax' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.campos.find(c => c.slug === 'base_precio')?.valor).toBe('total')
    expect(r.basePrecioOrigen).toBeUndefined()
  })
})

describe('un solo pasajero: no se pregunta', () => {
  it('el viaje es de uno: total, sin aviso', () => {
    const r = evaluarLectura(VUELO, vueloGds(), { ...BANDEJA, pasajeros: 1 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.campos.find(c => c.slug === 'base_precio')?.valor).toBe('total')
    expect(r.basePrecioOrigen).toBe('un_pasajero')
    expect(r.avisos.join(' ')).not.toMatch(/total o por persona|por persona o de todas/)
  })

  it('la captura dice un pasajero aunque el viaje no se sepa: total', () => {
    const r = evaluarLectura(VUELO, vueloGds({ pax: v('1') }), { ...BANDEJA, pasajeros: null })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.campos.find(c => c.slug === 'base_precio')?.valor).toBe('total')
  })

  it('la captura dice dos aunque el viaje sea de uno: se pregunta', () => {
    const r = evaluarLectura(VUELO, vueloGds({ pax: v('2') }), { ...BANDEJA, pasajeros: 1 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.basePorElegir).toEqual(['total', 'por_pax'])
  })

  it('sin saber cuántos: se pregunta', () => {
    const r = evaluarLectura(VUELO, vueloGds(), { ...BANDEJA, pasajeros: null })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.basePorElegir).toBeDefined()
  })
})

describe('lo demás sigue igual', () => {
  it('falta el precio además de base_precio: RX2 de siempre, sin pregunta', () => {
    const r = evaluarLectura(VUELO, vueloGds({ precio_total: v(null, 0) }), BANDEJA)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.codigo).toBe('RX2')
    expect(r.motivo).toContain('precio_total')
    expect(r.basePorElegir).toBeUndefined()
  })

  it('cargue de siempre (todos los mínimos): con otros faltantes, RX2 sin pregunta', () => {
    const r = evaluarLectura(VUELO, vueloGds({ aerolinea: v(null, 0) }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.motivo).toContain('aerolinea')
    expect(r.basePorElegir).toBeUndefined()
  })

  it('a mano no se pregunta aquí: el formulario lo pide', () => {
    const r = evaluarLectura(VUELO, vueloGds(), { ...BANDEJA, manual: true, pasajeros: 1 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.basePorElegir).toBeUndefined()
  })

  it('el hotel sigue con la regla de #1441: total con alerta y aviso, sin pregunta', () => {
    const r = evaluarLectura(HOTEL, {
      veredicto: 'detalle_unico',
      observacion: null,
      campos: {
        hotel: v('Decameron Cartagena'), ciudad: v('Cartagena'), tipo_habitacion: v('Estándar'), regimen: v('Todo incluido'),
        check_in: v('2026-12-12'), check_out: v('2026-12-15'), ocupacion: v('2 Huéspedes'),
        moneda: v('COP'), precio_total: v('2905882'), base_precio: v(null, 0),
      },
      desglose: [],
    }, BANDEJA)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.campos.find(c => c.slug === 'base_precio')).toMatchObject({ valor: 'total', alertaRevision: true, confidence: 0 })
    expect(r.basePrecioOrigen).toBeUndefined()
  })
})

describe('el costo de cada respuesta', () => {
  const COMPOSICION = { adultos: 3, ninos: 1, infantes: 0 }
  const casilla = (elegido: string) => {
    const r = evaluarLectura(VUELO, vueloGds(), { ...BANDEJA, basePrecioElegido: elegido })
    if (!r.ok) throw new Error(r.motivo)
    return construirLecturaCasilla(VUELO, r, '2026-11-06T12:00:00Z', COMPOSICION)
  }

  it('«Es el total»: el precio tal cual', () => {
    const l = casilla('total')
    expect(l.total).toBe(4666438)
    expect(l.basePrecioOrigen).toBe('elegido')
  })

  it('«Es por persona» sin pasajeros en la captura: por los pasajeros del viaje, nunca por 1', () => {
    const l = casilla('por_pax')
    expect(l.total).toBe(4666438 * 4)
    expect(l.alertas.join(' ')).toContain('4 personas × ese precio')
    expect(l.basePrecioOrigen).toBe('elegido')
  })

  it('«Es por persona» con pasajeros en la captura: por los de la captura', () => {
    const r = evaluarLectura(VUELO, vueloGds({ pax: v('2'), base_precio: v('por_pax') }), BANDEJA)
    if (!r.ok) throw new Error(r.motivo)
    expect(construirLecturaCasilla(VUELO, r, '2026-11-06T12:00:00Z', COMPOSICION).total).toBe(4666438 * 2)
  })
})

describe('la bandeja: elegir no vuelve a leer', () => {
  const opcion = (valor: string): OpcionDeBase => ({
    valor,
    etiqueta: etiquetaDeBasePrecio(valor),
    lectura: { nombre: `Vuelo ${valor}`, campos: [], alertas: [] } as unknown as LecturaCasilla,
    lecturaJson: `{"base":"${valor}"}`,
    firma: `firma-${valor}`,
    alertas: valor === 'por_pax' ? ['4 personas × ese precio'] : [],
  })
  const ELECCION = { pregunta: preguntaDeBasePrecio(VUELO), opciones: [opcion('total'), opcion('por_pax')] }

  function montar(lectura: LecturaDeBorrador) {
    const cambios: CambioDeCaptura[] = []
    let leidas = 0
    const deps: DependenciasDeProceso = {
      detectar: async () => { throw new Error('no debe mirar') },
      leer: async () => { leidas += 1; return lectura },
      revisar: b => ({ leida: { id: 'borrador:x', nombre: b.lectura.nombre } as never, donde: 'Vuelo Bogotá → Cartagena · nuevo' }),
      vigente: () => true,
      informar: c => cambios.push(c),
    }
    return { deps, cambios, leidas: () => leidas }
  }

  it('la lectura con la pregunta deja la fila preguntando, sin borrador', async () => {
    const m = montar({ ok: false, codigo: 'RX2', mensaje: 'No se ve…', eleccionBase: ELECCION })
    await leerCaptura(m.deps, 'vuelo', { lugar: null, origen: 'BOG', destino: 'CTG' }, null)
    const fin = m.cambios[m.cambios.length - 1]
    expect(fin.estado).toEqual({ fase: 'eligiendo_base', pregunta: ELECCION.pregunta, opciones: ELECCION.opciones })
    expect(fin.borrador).toBeNull()
    expect(fin.abierta).toBe(true)
  })

  it('al elegir, la lectura FIRMADA de esa respuesta queda lista, sin otra llamada', async () => {
    const m = montar({ ok: false, codigo: 'RX2', mensaje: 'No se ve…', eleccionBase: ELECCION })
    const pistas = { lugar: null, origen: 'BOG', destino: 'CTG' }
    await leerCaptura(m.deps, 'vuelo', pistas, null)
    expect(m.leidas()).toBe(1)
    elegirBasePrecio(m.deps, 'vuelo', pistas, ELECCION.opciones[1])
    expect(m.leidas()).toBe(1)
    const fin = m.cambios[m.cambios.length - 1]
    expect(fin.estado).toEqual({ fase: 'lista', alertas: ['4 personas × ese precio'] })
    expect(fin.borrador).toMatchObject({ tipo: 'vuelo', lecturaJson: '{"base":"por_pax"}', firma: 'firma-por_pax', pistas })
    expect(fin.donde).toBe('Vuelo Bogotá → Cartagena · nuevo')
  })

  it('un RX2 sin pregunta sigue rechazado', async () => {
    const m = montar({ ok: false, codigo: 'RX2', mensaje: 'No se ven estos datos: el precio…' })
    await leerCaptura(m.deps, 'vuelo', { lugar: null, origen: null, destino: null }, null)
    expect(m.cambios[m.cambios.length - 1].estado).toMatchObject({ fase: 'rechazada' })
  })
})
