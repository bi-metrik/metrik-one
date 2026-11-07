import { describe, expect, it } from 'vitest'
import type { BorradorCotizacion, HotelBorrador } from '@/lib/cotizaciones/asistente/borrador'
import type { Requisitos, SalidaEntrega, SalidaRespuesta } from './esquema'
import { aniosDeLaTemporada, esNombreDelAsistente, preguntasQueBloquean, sinElAsistente, tarifaSabida, llavePregunta } from './preguntas'
import { lineaDeLoQueEntendi, mensajeDeConfirmacion } from './mensaje'
import { pasaACotizacion, procesarPedido, procesarRespuesta, responderTipo, totalesAlCliente } from './flujo'
import type { Llamador } from './llamada'
import { entregaNueva, puertoEnMemoria } from './puerto-memoria'

/**
 * Entrega única del bloqueo (brief del 2026-11-04). Datos inventados; el modelo es una salida a mano
 * (sin llamada real). Lo real (4 casos del QA con Haiku 5.5) lo corre `scripts/qa-entrega-unica.ts`.
 */

const hotel = (x: Partial<HotelBorrador>): HotelBorrador => ({
  pantallazo: 2, version: 'Recomendada', nombreEnPantallazo: 'HOTEL MAR', nombre: 'Hotel Mar', zonaEnPantallazo: null, zona: 'Rodadero',
  noches: 3, habitacion: 'Doble', regimenEnPantallazo: null, regimen: 'Desayuno', temporadaEnPantallazo: 'Alta | Promo', temporada: 'Alta',
  ninosGratis: null, codigoTarifa: null, compraAntesDe: null, tipoTarifa: 'publica',
  precios: [{ acomodacion: 'Doble', personasPorHabitacion: 2, precioPorPersona: 1_000_000 }], ninos: [],
  distribucion: [{ acomodacion: 'Doble', habitaciones: 1, personasPorHabitacion: 2 }], ninosAsignados: [],
  totalCalculadoPorElModelo: 2_000_000, incluyeIconos: [], incluye: 'Vuelo y hotel', cajaFoto: null, ...x,
})

const borrador = (hoteles: HotelBorrador[]): BorradorCotizacion => ({
  clienteParaDocumento: 'Laura Gómez', titular: 'Santa Marta', intro: 'Hola', destino: 'Santa Marta',
  vuelos: [
    { aerolinea: 'Avianca', numero: 'AV9764', origenIata: 'BOG', origenCiudad: 'Bogotá', destinoIata: 'SMR', destinoCiudad: 'Santa Marta', fecha: '2027-01-03', salida: '09:15', llegada: '10:45', escalas: 0 },
    { aerolinea: 'Avianca', numero: 'AV8507', origenIata: 'SMR', origenCiudad: 'Santa Marta', destinoIata: 'BOG', destinoCiudad: 'Bogotá', fecha: '2027-01-06', salida: '19:25', llegada: '21:00', escalas: 0 },
  ],
  hoteles, incluye: [], noIncluye: [], antesDeViajar: [], dudas: [],
})

const req = (x: Partial<Requisitos> = {}): Requisitos => ({
  tipoViaje: 'bloqueo', evidenciaTipo: 'lo dijo', cliente: 'Laura Gómez', viajeros: { adultos: 2, ninos: [] }, destino: 'Santa Marta',
  ciudadOrigen: 'Bogotá', fechaIda: '2027-01-03', fechaRegreso: '2027-01-06', noches: 3, operadorDeclarado: null, tarifaDicha: null, ...x,
})

const tres = () => borrador([
  hotel({ pantallazo: 2, version: 'Económica', nombre: 'Hotel Uno', precios: [{ acomodacion: 'Doble', personasPorHabitacion: 2, precioPorPersona: 900_000 }], totalCalculadoPorElModelo: 1_800_000 }),
  hotel({ pantallazo: 3, version: 'Recomendada', nombre: 'Hotel Dorado', temporadaEnPantallazo: '*A*ALTA 2026' }),
  hotel({ pantallazo: 4, version: 'Superior', nombre: 'Hotel Tres', precios: [{ acomodacion: 'Doble', personasPorHabitacion: 2, precioPorPersona: 1_200_000 }], totalCalculadoPorElModelo: 2_400_000 }),
])

describe('reglas fijas: qué pregunta bloquea', () => {
  it('lee los años de la temporada tal cual viene', () => {
    expect(aniosDeLaTemporada('*A*ALTA 2026')).toEqual([2026])
    expect(aniosDeLaTemporada('Zona Bocagrande 2026-2027')).toEqual([2026, 2027])
    expect(aniosDeLaTemporada('Alta | Promo')).toEqual([])
  })

  it('«ALTA 2026» en un viaje de enero de 2027 SIEMPRE pregunta (el modelo lo preguntó 1 de 4 veces)', () => {
    const q = preguntasQueBloquean({ requisitos: req({ operadorDeclarado: 'Aliados' }), borrador: tres(), redaccion: [], hoy: '2026-11-04' })
    expect(q.map(x => [x.clave, x.pantallazo])).toEqual([['temporada', 3]])
  })

  it('R-14: con Aliados la tarifa es pública y no se pregunta; sin operador ni tarifa dicha, sí', () => {
    expect(tarifaSabida({ tarifaDicha: null, operadorDeclarado: 'bloqueo de aliados' })).toBe('publica')
    expect(tarifaSabida({ tarifaDicha: 'neta', operadorDeclarado: 'Aliados' })).toBe('neta')
    const q = preguntasQueBloquean({ requisitos: req(), borrador: borrador([hotel({})]), redaccion: [], hoy: '2026-11-04' })
    expect(q.map(x => x.clave)).toEqual(['tarifa'])
  })

  it('sin viajeros pregunta los viajeros', () => {
    const q = preguntasQueBloquean({ requisitos: req({ viajeros: null, operadorDeclarado: 'Aliados' }), borrador: null, redaccion: [], hoy: '2026-11-04' })
    expect(q.map(x => x.clave)).toEqual(['viajeros'])
  })

  it('«Compra antes del» que vence antes del pago probable y niños gratis que le aplican a un niño', () => {
    const b = borrador([hotel({ compraAntesDe: '2026-11-05', ninosGratis: { texto: '1 niño gratis de 0 a 5 años', edadDesde: 0, edadHasta: 5 } })])
    const q = preguntasQueBloquean({ requisitos: req({ tarifaDicha: 'publica', viajeros: { adultos: 2, ninos: [{ edad: 4 }] } }), borrador: b, redaccion: [], hoy: '2026-11-04' })
    expect(q.map(x => x.clave)).toEqual(['compraAntesDe', 'ninosGratis'])
    const sinNino = preguntasQueBloquean({ requisitos: req({ tarifaDicha: 'publica', viajeros: { adultos: 2, ninos: [{ edad: 9 }] } }), borrador: b, redaccion: [], hoy: '2026-11-04' })
    expect(sinNino.map(x => x.clave)).toEqual(['compraAntesDe'])
  })

  it('el modelo redacta pero no decide: su texto se usa solo si la regla la eligió; lo resuelto no vuelve', () => {
    const redaccion = [
      { clave: 'temporada' as const, pantallazo: 3, pregunta: 'La tarifa del Hotel Dorado dice ALTA 2026, ¿aplica en enero 2027?' },
      { clave: 'temporada' as const, pantallazo: 2, pregunta: 'Esta no debe salir' },
      { clave: 'tarifa' as const, pantallazo: null, pregunta: 'Tampoco esta: Aliados es pública' },
    ]
    const q = preguntasQueBloquean({ requisitos: req({ operadorDeclarado: 'Aliados' }), borrador: tres(), redaccion, hoy: '2026-11-04' })
    expect(q).toHaveLength(1)
    expect(q[0].texto).toContain('ALTA 2026')
    const otra = preguntasQueBloquean({ requisitos: req({ operadorDeclarado: 'Aliados' }), borrador: tres(), redaccion, hoy: '2026-11-04', resueltas: new Set([llavePregunta('temporada', 3)]) })
    expect(otra).toHaveLength(0)
  })
})

describe('el mensaje a la asesora', () => {
  it('lo que entendí lo arma el código', () => {
    expect(lineaDeLoQueEntendi(req(), tres())).toBe('Laura Gómez · 2 adultos · Santa Marta, 3 al 6 de enero (3 noches) · 3 hoteles')
  })
  it('un solo mensaje con el código, las preguntas numeradas y la instrucción para contestar', () => {
    const preguntas = preguntasQueBloquean({ requisitos: req(), borrador: tres(), redaccion: [], hoy: '2026-11-04' })
    const m = mensajeDeConfirmacion({ codigo: 'COT-2026-0101', requisitos: req(), borrador: tres(), preguntas, faltaCelularCliente: false })
    expect(m.split('\n')[0]).toBe('COT-2026-0101 · *Laura Gómez · 2 adultos · Santa Marta, 3 al 6 de enero (3 noches) · 3 hoteles*')
    expect(m).toContain('1. ')
    expect(m).toContain('2. ')
    expect(m).toMatch(/citando este mensaje/)
  })
})

describe('reglas de plata y de etapa', () => {
  it('R-14: neta suma 15 % sobre la venta; pública no toca', () => {
    expect(totalesAlCliente({ Recomendada: 850_000 }, 'neta')).toEqual({ Recomendada: 1_000_000 })
    expect(totalesAlCliente({ Recomendada: 850_000 }, 'publica')).toEqual({ Recomendada: 850_000 })
  })
  it('pasa a cotización solo si quien entrega es quien cotiza', () => {
    expect(pasaACotizacion('s1', 's1')).toBe(true)
    expect(pasaACotizacion('s1', 's2')).toBe(false)
    expect(pasaACotizacion(null, null)).toBe(false)
  })
})

describe('el flujo punta a punta con la base en memoria', () => {
  const montar = (salida: SalidaEntrega, respuesta?: Partial<SalidaRespuesta>) => {
    const llamadas: string[] = []
    const modelo: Llamador = {
      async armar() { llamadas.push('armar'); return { salida: structuredClone(salida), uso: { promptTokens: 1, salidaTokens: 1, pensamientoTokens: 0, totalTokens: 2 }, ms: 1, modelo: 'guion' } },
      async aplicar() {
        llamadas.push('aplicar')
        return { salida: { respuestas: [], noEntendido: null, ...structuredClone(salida), ...respuesta } as SalidaRespuesta, uso: { promptTokens: 1, salidaTokens: 1, pensamientoTokens: 0, totalTokens: 2 }, ms: 1, modelo: 'guion' }
      },
    }
    const puerto = puertoEnMemoria({
      config: { manual: 'M', casa: {} as never },
      pantallazos: new Map([['p1', { nombre: 'p1.png', mime: 'image/png', base64: '' }]]),
      renderPdf: async e => ({ pdf: new Uint8Array([37, 80, 68, 70]), nombre: `Cotización ${e.codigo}.pdf` }),
    })
    const e = entregaNueva('ent-1', 'ws', 'staff-1', '573000000000', '2026-11-04T20:00:00Z')
    puerto.estado.entregas.set(e.id, e)
    puerto.estado.piezas.push(
      { id: 'pz1', entregaId: e.id, direccion: 'entrante', wamid: 'w1', contextoWamid: null, tipo: 'texto', texto: 'bloqueo para Laura Gomez, 2 adultos', mediaRef: null, mime: null, en: '2026-11-04T20:00:00Z' },
      { id: 'pz2', entregaId: e.id, direccion: 'entrante', wamid: 'w2', contextoWamid: null, tipo: 'imagen', texto: null, mediaRef: 'p1', mime: 'image/png', en: '2026-11-04T20:00:01Z' },
    )
    return { puerto, modelo, llamadas, e }
  }

  it('una llamada: abre el viaje como Bloqueo, guarda la cotización y pasa a Cotización con la hora de cada etapa', async () => {
    const { puerto, modelo, llamadas } = montar({ requisitos: req({ operadorDeclarado: 'Aliados' }), redaccion: [], borrador: tres() })
    const sal = await procesarPedido('ent-1', { puerto, modelo })
    expect(llamadas).toEqual(['armar'])
    expect(sal).toHaveLength(1)
    expect(puerto.estado.viajes[0]).toMatchObject({ modalidad: 'bloqueo', etapa: 'Cotización' })
    expect(puerto.estado.historialEtapas.map(h => h.a)).toEqual(['Solicitud', 'Cotización'])
    expect(puerto.estado.cotizaciones[0]).toMatchObject({ estado: 'borrador', conBorrador: true })
    const ent = puerto.estado.entregas.get('ent-1')!
    expect(ent.estado).toBe('por_confirmar')
    expect(ent.tiempos.etapaSolicitud && ent.tiempos.etapaCotizacion && ent.tiempos.confirmacionEnviada).toBeTruthy()
    expect(ent.preguntas.map(q => q.clave)).toEqual(['temporada'])
  })

  it('con la respuesta: aplica, vuelve a chequear con los viajeros confirmados y saca el PDF', async () => {
    const { puerto, modelo, llamadas } = montar(
      { requisitos: req({ operadorDeclarado: 'Aliados' }), redaccion: [], borrador: tres() },
      { respuestas: [{ numero: 1, clave: 'temporada', pantallazo: 3, resuelta: true, valor: 'sí aplica' }] },
    )
    await procesarPedido('ent-1', { puerto, modelo })
    const sal = await procesarRespuesta('ent-1', 'sí, 1 sí aplica', { puerto, modelo })
    expect(llamadas).toEqual(['armar', 'aplicar'])
    expect(sal[0]).toMatchObject({ tipo: 'documento' })
    expect(puerto.estado.entregas.get('ent-1')!.estado).toBe('listo')
    expect(puerto.estado.pdfs).toHaveLength(1)
    expect(puerto.estado.cotizaciones[0].totales).toEqual({ Económica: 1_800_000, Recomendada: 2_000_000, Superior: 2_400_000 })
  })

  it('el chequeo con los viajeros confirmados frena el PDF si no cuadran', async () => {
    const { puerto, modelo } = montar(
      { requisitos: req({ operadorDeclarado: 'Aliados' }), redaccion: [], borrador: tres() },
      { respuestas: [{ numero: 1, clave: 'temporada', pantallazo: 3, resuelta: true, valor: 'sí' }], requisitos: req({ operadorDeclarado: 'Aliados', viajeros: { adultos: 3, ninos: [] } }) },
    )
    await procesarPedido('ent-1', { puerto, modelo })
    const sal = await procesarRespuesta('ent-1', 'sí, pero son 3 adultos', { puerto, modelo })
    expect(sal[0].tipo).toBe('texto')
    expect(puerto.estado.entregas.get('ent-1')!.estado).toBe('frenado')
    expect(puerto.estado.pdfs).toHaveLength(0)
  })

  it('sin viajeros no arma la cotización y los pregunta', async () => {
    const { puerto, modelo } = montar({ requisitos: req({ viajeros: null, operadorDeclarado: 'Aliados' }), redaccion: [], borrador: tres() })
    await procesarPedido('ent-1', { puerto, modelo })
    const ent = puerto.estado.entregas.get('ent-1')!
    expect(ent.salida!.borrador).toBeNull()
    expect(ent.preguntas.map(q => q.clave)).toEqual(['viajeros'])
    expect(puerto.estado.cotizaciones[0].conBorrador).toBe(false)
  })

  it('si no está claro que sea bloqueo, pregunta y no guarda nada; con «Bloqueo» sigue', async () => {
    const { puerto, modelo } = montar({ requisitos: req({ tipoViaje: 'no_se_sabe', operadorDeclarado: 'Aliados' }), redaccion: [], borrador: tres() })
    const sal = await procesarPedido('ent-1', { puerto, modelo })
    expect(sal[0].tipo).toBe('botones')
    expect(puerto.estado.viajes).toHaveLength(0)
    await responderTipo('ent-1', 'bloqueo', { puerto, modelo })
    expect(puerto.estado.viajes).toHaveLength(1)
    expect(puerto.estado.entregas.get('ent-1')!.estado).toBe('por_confirmar')
  })

  it('dos webhooks a la vez no procesan dos veces', async () => {
    const { puerto, modelo, llamadas } = montar({ requisitos: req({ operadorDeclarado: 'Aliados' }), redaccion: [], borrador: tres() })
    await Promise.all([procesarPedido('ent-1', { puerto, modelo }), procesarPedido('ent-1', { puerto, modelo })])
    expect(llamadas).toEqual(['armar'])
  })
})

describe('«Trappi» no es un operador (prueba del 2026-11-07)', () => {
  it('reconoce el nombre y sus transcripciones parecidas', () => {
    for (const n of ['Trappi', 'trapi', 'Tratvi', 'Trapy', 'Trappy', 'TRAPPI.']) expect(esNombreDelAsistente(n), n).toBe(true)
    for (const n of ['Aliados', 'bloqueo de aliados', 'Travel', 'Trappvel', null, '']) expect(esNombreDelAsistente(n), String(n)).toBe(false)
  })
  it('lo saca del operador y de las preguntas que lo nombran; la tarifa vuelve a preguntarse con el texto del código', () => {
    const s = sinElAsistente({
      requisitos: req({ operadorDeclarado: 'Tratvi' }),
      redaccion: [{ clave: 'tarifa' as const, pantallazo: null, pregunta: '¿La tarifa de Tratvi es pública o neta?' }],
      borrador: tres(),
    })
    expect(s.requisitos.operadorDeclarado).toBeNull()
    expect(s.redaccion).toEqual([])
    const q = preguntasQueBloquean({ requisitos: s.requisitos, borrador: s.borrador, redaccion: s.redaccion, hoy: '2026-11-04' })
    expect(q.find(p => p.clave === 'tarifa')?.texto).toBe('¿La tarifa es pública o neta? Mientras tanto la dejé como pública.')
  })
  it('un operador de verdad no se toca', () => {
    const e = { requisitos: req({ operadorDeclarado: 'Aliados' }), redaccion: [], borrador: null }
    expect(sinElAsistente(e)).toBe(e)
  })
})
