/**
 * QA Trappvel de punta a punta (2026-10-29), grupo G7: lo que recibe el cliente en la propuesta y en
 * el texto de «Redactar con ONE». Cada caso es un código de las bitácoras de
 * `proyectos/trappvel/clarity/qa/2026-10-29_punta-a-punta-10-viajes/`.
 */
import { describe, expect, it } from 'vitest'
import { ENTRADA_EUROPA } from '../../../../test/propuesta-europa'
import type { EntradaModeloPropuesta, ServicioDelDocumento } from './modelo-documento'
import {
  cargoParaElCliente,
  destinoUnico,
  enLaVozDelDocumento,
  introDeterminista,
  lugarDelHotel,
  modeloDePropuesta,
  nombrePropio,
  textoConLaVozDelDocumento,
  vozPorViajeros,
} from './modelo-documento'
import { trayectosDeTraslado } from './trayectos'
import { serviciosDelDocumento } from './servicios-del-documento'
import { htmlDePropuesta, TEXTOS_DE_VOZ } from '@/lib/pdf/html/trappvel/plantilla'
import { esAlquilerDeCarro, serviciosDeItems } from '@/lib/cotizaciones/detalle-viaje'
import { alcanceDelViaje, huellaDeViaje, promptDelRedactor, viajeParaRedactar } from '@/lib/cotizaciones/documento-cliente'

const recursos = { foto: () => null, fotoDeCiudad: () => null, logo: null, marca: 'Agencia de ejemplo' }

const traslado = (nombre: string, campos: { label: string; valor: string }[]) => ({
  nombre,
  grupo: 'traslado: Traslado',
  tarifa_pax: { composicion: { adultos: 2, ninos: 2, infantes: 0 }, casillas: { grupo_completo: { moneda: 'USD', total: 1, campos } } },
})

const CARRO = traslado('AEROPUERTO ORLANDO (MCO) - AEROPUERTO MIAMI (MIA)', [
  { label: 'Proveedor', valor: 'Alamo' },
  { label: 'Trayecto', valor: 'Aeropuerto Orlando (MCO) - Aeropuerto Miami (MIA)' },
  { label: 'Vehículo', valor: 'SUV Estándar' },
  { label: 'Fecha', valor: '2026-12-11' },
])

const TRASLADO_HATO = traslado('AEROPUERTO HATO \n HOTEL EN WILLEMSTAD Y REGRESO', [
  { label: 'Proveedor', valor: 'Curaçao Island Transfers' },
  { label: 'Trayecto', valor: 'aeropuerto Hato \n hotel en Willemstad y regreso' },
  { label: 'Vehículo', valor: 'Sedán privado' },
  { label: 'Fecha', valor: '2027-04-10' },
])

describe('S3 · la voz por la cantidad de viajeros', () => {
  it('uno: usted; varios o sin dato: ustedes; nunca tú', () => {
    expect(vozPorViajeros(1)).toBe('singular')
    expect(vozPorViajeros(2)).toBe('plural')
    expect(vozPorViajeros(null)).toBe('plural')
    for (const voz of Object.values(TEXTOS_DE_VOZ)) {
      const todo = JSON.stringify({ ...voz, apartarCon: voz.apartarCon('$ 1') })
      expect(todo).not.toMatch(/\b(puedes|contigo|tu viaje|llevas|aparta tu)\b/i)
      expect(todo).not.toContain('—')
    }
  })

  it('el documento de un viajero no le habla al grupo', () => {
    const m = modeloDePropuesta({ ...ENTRADA_EUROPA, numeroDeViajeros: 1 })
    expect(m.voz).toBe('singular')
    const html = htmlDePropuesta(m, recursos)
    for (const plural of ['para el grupo', 'Elijan', 'Día abierto para ustedes', 'Escojan', 'Puedes repartirlo', 'Aparta tu viaje', 'Cuánto pagan']) {
      expect(html).not.toContain(plural)
    }
    expect(html).toContain('Elija su versión')
    expect(html).toContain('Cuánto paga y cuándo')
    expect(html).toContain('Puede repartirlo en más cuotas: lo acordamos con usted.')
  })

  it('el de varios viajeros, en ustedes y sin tutear', () => {
    const html = htmlDePropuesta(modeloDePropuesta({ ...ENTRADA_EUROPA, numeroDeViajeros: 4 }), recursos)
    expect(html).toContain('Elijan su versión')
    expect(html).toContain('Pueden repartirlo en más cuotas: lo acordamos con ustedes.')
    expect(html).not.toContain('para el grupo')
    expect(html).not.toMatch(/Puedes|contigo|Aparta tu viaje|con esto llevas/)
  })

  it('«Antes de viajar» y la presentación siguen la voz', () => {
    expect(enLaVozDelDocumento('Recuerden llevar sus pasaportes; les sugerimos llegar temprano', 'singular')).toBe('Recuerde llevar sus pasaportes; le sugerimos llegar temprano')
    expect(enLaVozDelDocumento('Recuerde llevar su pasaporte', 'plural')).toBe('Recuerden llevar su pasaporte')
    expect(textoConLaVozDelDocumento('Cinco noches en Cartagena para usted.', 5, 'singular')).toBe(true)
    expect(textoConLaVozDelDocumento('Cinco noches en Cartagena para ustedes.', 5, 'singular')).toBe(false)
    const intro = introDeterminista({ paradas: [{ ciudad: 'Cartagena', noches: 4, desde: null, hasta: null, siguiente: null }], trenes: 0, hoteles: [], dias: [{ fecha: '2027-01-01', numero: 1, ciudad: null, eventos: [], libre: true, opcionales: [], titulo: null, sugerencia: null }], voz: 'singular' })
    expect(intro).toBe('4 noches en Cartagena. Los días libres quedan abiertos para que usted decida.')
  })
})

describe('V6 · V8-3 · V7-4 · la zona no es el destino', () => {
  it('«zona / ciudad» y «ciudad - zona»', () => {
    expect(lugarDelHotel('NoMad, Manhattan / Nueva York', 'NUEVA YORK')).toEqual({ ciudad: 'Nueva York', zona: 'NoMad, Manhattan' })
    expect(lugarDelHotel('Disney Springs / Orlando', 'ORLANDO Y MIAMI')).toEqual({ ciudad: 'Orlando', zona: 'Disney Springs' })
    expect(lugarDelHotel('Mid Beach / Miami Beach', 'ORLANDO Y MIAMI')).toEqual({ ciudad: 'Miami Beach', zona: 'Mid Beach' })
    expect(lugarDelHotel('Willemstad / Curazao', 'CURAZAO')).toEqual({ ciudad: 'Curazao', zona: 'Willemstad' })
    expect(lugarDelHotel('Orlando / Florida', 'Orlando')).toEqual({ ciudad: 'Orlando', zona: 'Florida' })
    expect(lugarDelHotel('Madrid - Sol')).toEqual({ ciudad: 'Madrid', zona: 'Sol' })
    expect(lugarDelHotel('Santa Marta · Bello Horizonte')).toEqual({ ciudad: 'Santa Marta', zona: 'Bello Horizonte' })
    expect(lugarDelHotel('Providencia, San Andrés y Providencia, Colombia')).toEqual({ ciudad: 'Providencia', zona: null })
    expect(lugarDelHotel('Nueva York')).toEqual({ ciudad: 'Nueva York', zona: null })
  })

  it('el destino de un solo lugar, con nombre propio', () => {
    expect(nombrePropio('SAN ANDRÉS')).toBe('San Andrés')
    expect(destinoUnico('SAN ANDRÉS')).toBe('San Andrés')
    expect(destinoUnico('ORLANDO Y MIAMI')).toBeNull()
    expect(destinoUnico('Madrid, París y Roma')).toBeNull()
  })

  it('la ciudad del capítulo es el destino; cada hotel lleva su zona en su tarjeta', () => {
    const v = ENTRADA_EUROPA.props.viaje!
    const hoteles = v.hoteles.map((h) =>
      h.ciudad === 'Madrid' ? { ...h, ciudad: h.hotel === 'Catalonia Puerta del Sol' ? 'Sol / Madrid' : h.hotel === 'Ibis Styles Madrid Prado' ? 'Madrid' : 'Gran Vía / Madrid' } : h,
    )
    const m = modeloDePropuesta({ ...ENTRADA_EUROPA, props: { ...ENTRADA_EUROPA.props, viaje: { ...v, hoteles } } })
    expect(m.ruta.paradas[0].ciudad).toBe('Madrid')
    const madrid = m.hoteles.find((c) => c.ciudad === 'Madrid')!
    expect(madrid.opciones.map((o) => o.zona ?? null)).toEqual(expect.arrayContaining(['Sol', 'Gran Vía', null]))
    const html = htmlDePropuesta(m, recursos)
    expect(html).toContain('<div class="caps zona">Sol</div>')
    expect(html).toContain('<div class="caps zona">Gran Vía</div>')
    expect(html).not.toContain('Llegada al hotel en Sol')
  })

  it('el paquete de bloqueo (solo zona) duerme en el destino del viaje', () => {
    const v = ENTRADA_EUROPA.props.viaje!
    const paquete = { ...v.hoteles[0], ciudad: null, zona: 'Centro', tarifas: undefined }
    const m = modeloDePropuesta({
      ...ENTRADA_EUROPA,
      props: { ...ENTRADA_EUROPA.props, itinerarios: [], viaje: { ...v, destino: 'SAN ANDRÉS', hoteles: [paquete] } },
    })
    expect(m.ruta.paradas.map((p) => p.ciudad)).toEqual(['San Andrés'])
    const html = htmlDePropuesta(m, recursos)
    expect(html).not.toContain('Centro (')
    expect(html).toContain('<div class="caps zona">Centro</div>')
  })
})

describe('V7-2 · el cargo en destino dice qué es y si es por noche', () => {
  const base = { ciudad: 'Orlando', hotel: 'Holiday Inn', concepto: 'Impuestos y tasas de hospedaje', monto: '35 USD', observacion: '' }
  it('lectura nueva: resort fee por noche con el total', () => {
    expect(cargoParaElCliente({ ...base, conceptoLeido: 'Resort fee', porNoche: true, valor: 35, moneda: 'USD', noches: 6 })).toEqual({
      concepto: 'Resort fee (cargo del hotel)',
      monto: '35 USD por noche (210 USD por 6 noches)',
    })
    expect(cargoParaElCliente({ ...base, conceptoLeido: 'City tax' }).concepto).toBe('Tasa turística')
  })
  it('lectura anterior: no afirma que sea un impuesto', () => {
    expect(cargoParaElCliente(base)).toEqual({ concepto: 'Impuestos o cargos del hotel', monto: '35 USD' })
  })
})

describe('V7 · S6-1 · el regreso del traslado', () => {
  it('«A \\n hotel y regreso» son dos trayectos; el de vuelta sin fecha propia', () => {
    const t = trayectosDeTraslado({ trayecto: 'aeropuerto Hato \n hotel en Willemstad y regreso', vehiculo: 'Sedán privado', fecha: '2027-04-10' })
    expect(t.map((x) => x.descripcion)).toEqual(['aeropuerto Hato - hotel · Sedán privado', 'hotel - aeropuerto Hato · Sedán privado'])
    expect(t[1]).toMatchObject({ fecha: null, fechaIda: '10 abr 2027' })
    expect(trayectosDeTraslado({ trayecto: 'Aeropuerto - hotel y regreso', vehiculo: null, fecha: null })).toHaveLength(2)
  })
  it('desde la línea leída', () => {
    expect(serviciosDelDocumento([TRASLADO_HATO], '2027-04-10')).toHaveLength(2)
  })
})

describe('N7-4 · V7-3 · el carro de alquiler no es un traslado', () => {
  it('se reconoce por la arrendadora o por las palabras; un traslado de verdad no', () => {
    expect(esAlquilerDeCarro(CARRO)).toBe(true)
    expect(esAlquilerDeCarro(TRASLADO_HATO)).toBe(false)
    expect(esAlquilerDeCarro(traslado('CARRO', [{ label: 'Trayecto', valor: 'Alquiler de carro en Cancún' }]))).toBe(true)
    expect(serviciosDeItems([CARRO])[0].esAlquiler).toBe(true)
  })

  it('en la propuesta: «Alquiler de carro» con recogida y devolución, y nunca «Traslado»', () => {
    const [s] = serviciosDelDocumento([CARRO], '2026-12-10')
    expect(s.alquiler).toEqual({ recogida: 'Aeropuerto Orlando (MCO)', devolucion: 'Aeropuerto Miami (MIA)', vehiculo: 'SUV Estándar' })
    const v = ENTRADA_EUROPA.props.viaje!
    // Un vuelo sale de MIA el 20 dic: ese día se devuelve el carro.
    const vuelos = [...v.vuelos, { ...v.vuelos[0], linea: 'AA MIA', origen: 'Miami MIA', destino: 'Bogotá BOG', fechaSalida: '20 dic 2026', fechaRegreso: null, tarifas: undefined }]
    const entrada: EntradaModeloPropuesta = { ...ENTRADA_EUROPA, props: { ...ENTRADA_EUROPA.props, viaje: { ...v, vuelos } }, servicios: [s] }
    const m = modeloDePropuesta(entrada)
    const fila = m.trayectos.filas.find((t) => t.tipo === 'alquiler')!
    expect(fila.alquiler?.fechaDevolucion).toBe('2026-12-20')
    const html = htmlDePropuesta(m, recursos)
    expect(html).toContain('Alquiler de carro')
    expect(html).toContain('Recogida en Aeropuerto Orlando (MCO) · devolución en Aeropuerto Miami (MIA), 20 dic · SUV Estándar')
    expect(html).toContain('Devolución del carro en Aeropuerto Miami (MIA)')
    expect(html).not.toContain('Traslado Aeropuerto Orlando')
  })
})

describe('V7-5 · una actividad de varios días no deja «Día libre» los días pagados', () => {
  it('Disney 4 días ocupa del día que empieza a los tres siguientes', () => {
    const disney: ServicioDelDocumento = { tipo: 'actividad', descripcion: 'Walt Disney World: entrada de 4 días · 4 días · Madrid', fecha: '12 dic 2026', hora: null }
    const m = modeloDePropuesta({ ...ENTRADA_EUROPA, servicios: [...(ENTRADA_EUROPA.servicios ?? []), disney] })
    const dias = m.dias.filter((d) => d.eventos.some((e) => e.texto.startsWith('Walt Disney World')))
    expect(dias.map((d) => d.fecha)).toEqual(['2026-12-12', '2026-12-13', '2026-12-14', '2026-12-15'])
    expect(dias.every((d) => !d.libre)).toBe(true)
    expect(dias[3].eventos.find((e) => e.texto.startsWith('Walt'))?.texto).toBe('Walt Disney World: entrada de 4 días (día 4 de 4)')
  })
})

describe('V3 · V5 · V8-2 · S5-1 · S9-1 · S7-4 · los consejos aplican a ESTE viaje', () => {
  const viaje = (over: Partial<Parameters<typeof viajeParaRedactar>[0]> = {}) =>
    viajeParaRedactar({ items: [], destino: 'Santa Marta', fechas: { inicio: '2027-01-10', fin: '2027-01-14' }, composicion: { adultos: 2, ninos: 0, infantes: 0 }, nombresDelCliente: [], ...over })

  it('nacional o internacional', () => {
    expect(alcanceDelViaje(['Bogotá BOG', 'Cartagena CTG'], 'CARTAGENA')).toBe('nacional')
    expect(alcanceDelViaje(['Bogotá BOG', 'Curazao CUR'], 'CURAZAO')).toBe('internacional')
    expect(alcanceDelViaje([], 'Nueva York')).toBe('internacional')
    expect(alcanceDelViaje([], 'Un lugar sin nombre')).toBeNull()
    expect(viaje().alcance).toBe('nacional')
  })

  it('la visa en trámite y el carro llegan al redactor; sin ellos la huella es la de siempre', () => {
    const sin = viaje()
    expect(sin).not.toHaveProperty('visaEnTramite')
    expect(sin).not.toHaveProperty('alquilerDeCarro')
    // `alcance` no mueve la huella de los textos ya guardados.
    const { alcance: _a, ...resto } = sin
    expect(huellaDeViaje(sin)).toBe(huellaDeViaje(resto as typeof sin))
    expect(viaje({ visaEnTramite: true }).visaEnTramite).toBe(true)
    const conCarro = viaje({ items: [{ ...CARRO, es_ajuste: false }] })
    expect(conCarro.alquilerDeCarro).toHaveLength(1)
    expect(conCarro.traslados).toEqual([])
  })

  it('el prompt pide pasaporte sin «si aplica», nada de adaptador en un viaje nacional, menores, visa y carro', () => {
    const p = promptDelRedactor()
    expect(p).toContain('dilo sin condicionales como "si aplica"')
    expect(p).toContain('no hables de pasaporte, visa, adaptadores de enchufe')
    expect(p).toContain('cada menor, también el bebé, necesita su propio pasaporte vigente')
    expect(p).toContain('permiso de salida del país')
    expect(p).toContain('Si "visaEnTramite" es true')
    expect(p).toContain('la licencia de conducción vigente')
    // Las reglas nuevas no traen guion largo (el «—» del prompt es la regla que lo prohíbe).
    expect(p.split('\n').filter((l) => /alcance|visaEnTramite|alquilerDeCarro|niños o infantes/.test(l)).join('\n')).not.toContain('—')
  })
})
