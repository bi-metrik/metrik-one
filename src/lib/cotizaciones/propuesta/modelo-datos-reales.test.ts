/**
 * El modelo con los datos COMO LLEGAN de la captura, no como los escribió el fixture. Cada caso es
 * un hallazgo de la COT-2026-0026 real (prueba Europa, descargada de producción el 2026-10-14),
 * reproducido sobre la muestra (`test/propuesta-europa.ts`): ningún dato del cliente.
 */
import { describe, expect, it } from 'vitest'
import { ENTRADA_EUROPA, HOTELES_EUROPA, R } from '../../../../test/propuesta-europa'
import type { EntradaModeloPropuesta, ServicioDelDocumento } from './modelo-documento'
import {
  descripcionDeOpcional,
  enLaVozDelDocumento,
  incluyeDeTodas,
  modeloDePropuesta,
  textoConLaVozDelDocumento,
} from './modelo-documento'
import { htmlDePropuesta } from '@/lib/pdf/html/trappvel/plantilla'
import { ciudadDeCapitulo, claveDeCiudad } from '@/lib/pdf/cotizacion-trappvel-formato'
import { claveDeFoto } from '@/lib/fotos/clave'

const t = (descripcion: string, fecha: string | null, extra: Partial<ServicioDelDocumento> = {}): ServicioDelDocumento => ({ tipo: 'traslado', descripcion, fecha, hora: null, ...extra })

/** La muestra con lo que trajo la captura real: zonas en la ciudad, bloques fuera de orden, fichas crudas y el texto viejo de Gemini. */
function comoLaCaptura(): EntradaModeloPropuesta {
  const v = ENTRADA_EUROPA.props.viaje!
  const conZona = HOTELES_EUROPA.map((h) =>
    h.hotel === 'Catalonia Puerta del Sol' ? { ...h, ciudad: 'Madrid - Sol' } : h.hotel === 'Waldorf Astoria Amsterdam' ? { ...h, ciudad: 'Ámsterdam · Herengracht' } : h,
  )
  // Ámsterdam se cargó segundo: Madrid, Ámsterdam, Barcelona, París.
  const enDesorden = [...conZona.slice(0, 3), ...conZona.slice(9, 12), ...conZona.slice(3, 9)]
  const sugeridos = ENTRADA_EUROPA.props.sugeridos!.map((s) =>
    s.nombre === 'Disneyland Paris'
      ? { ...s, nombre: 'Disneyland Paris: entrada de 1 día a los 2 parques', descripcion: 'Ciudad: París · Fecha: 2026-12-19 · Duración: 1 día · Idioma: Francés / Inglés · Proveedor: Operador de Ejemplo' }
      : s,
  )
  return {
    ...ENTRADA_EUROPA,
    props: {
      ...ENTRADA_EUROPA.props,
      sugeridos,
      viaje: {
        ...v,
        hoteles: enDesorden,
        duracion: '14 días / 13 noches',
        intro: '¡Prepárese para un viaje por Europa! Hemos diseñado esta propuesta de 13 noches en cuatro ciudades.',
        incluye: [
          'Tiquetes aéreos Bogotá – Madrid con Air France, vía París',
          '3 noches en el Hotel Catalonia Puerta del Sol en Madrid, con desayuno',
          '4 noches en el Pullman Paris Tour Eiffel en París, con desayuno',
          'Tren AVE de Madrid a Barcelona',
        ],
        antesDeViajar: ['Recuerde llevar sus pasaportes vigentes', 'Tenga en cuenta que hace frío: le sugerimos ropa abrigada!'],
        cargosEnDestino: [{ ciudad: 'Barcelona - Eixample', hotel: null, concepto: 'Tasa turística', monto: '41,28 EUR', observacion: 'Se paga en el hotel.' }],
      },
    },
    servicios: [
      ...(ENTRADA_EUROPA.servicios ?? []).filter((s) => !/Schiphol/.test(s.descripcion)),
      // La vuelta de un traslado con una sola fecha en la captura (la de la ida).
      t('hotel - aeropuerto Schiphol · Privado', null, { fechaIda: '21 dic 2026' }),
    ],
  }
}

const recursos = { foto: () => null, fotoDeCiudad: () => null, logo: null, marca: 'Agencia de ejemplo' }

describe('la ciudad sin la zona del hotel', () => {
  it('«Madrid - Sol» es Madrid y «Ámsterdam · Herengracht» es Ámsterdam; «Madrid-Barajas» no se parte', () => {
    expect(ciudadDeCapitulo('Madrid - Sol')).toBe('Madrid')
    expect(ciudadDeCapitulo('Ámsterdam · Herengracht')).toBe('Ámsterdam')
    expect(ciudadDeCapitulo('Providencia, San Andrés y Providencia, Colombia')).toBe('Providencia')
    expect(ciudadDeCapitulo('Saint-Tropez')).toBe('Saint-Tropez')
    expect(claveDeCiudad('Madrid - Sol')).toBe(claveDeCiudad('Madrid'))
    // El catálogo de fotos busca la ciudad, no el barrio.
    expect(claveDeFoto('ciudad', 'Madrid - Sol')).toBe('madrid')
  })

  it('en el modelo y en todo el documento', () => {
    const m = modeloDePropuesta(comoLaCaptura())
    expect(m.hoteles.map((h) => h.ciudad)).toEqual(['Madrid', 'Barcelona', 'París', 'Ámsterdam'])
    expect(m.dias.map((d) => d.ciudad).filter(Boolean)).not.toContain('Madrid - Sol')
    const html = htmlDePropuesta(m, recursos)
    expect(html).not.toContain('Madrid - Sol')
    expect(html).not.toContain('Herengracht')
    expect(m.precio.noIncluye[0]).toBe('Tasa turística (Barcelona), que se pagan en destino')
  })
})

describe('el orden del viaje, no el de las líneas', () => {
  it('destinos, ruta, «Dónde duermen» y los hoteles de cada versión por fecha de entrada', () => {
    const m = modeloDePropuesta(comoLaCaptura())
    expect(m.ruta.paradas.map((p) => p.ciudad)).toEqual(['Madrid', 'Barcelona', 'París', 'Ámsterdam'])
    expect(m.tarifas.find((x) => x.indice === R)!.hoteles.map((h) => h.ciudad)).toEqual(['Madrid', 'Barcelona', 'París', 'Ámsterdam'])
    const html = htmlDePropuesta(m, recursos)
    expect(html).toContain('Madrid (3N) · Barcelona (3N) · París (4N) · Ámsterdam (2N)')
    // La ruta lleva el tren de cada salida, con su nombre corto.
    expect(m.ruta.paradas.map((p) => p.siguiente)).toEqual([
      'Madrid Atocha - Barcelona Sants · AVE 03071 Renfe, Estándar',
      'Barcelona Sants - Paris Gare de Lyon · TGV INOUI 9714, segunda clase',
      'Paris Nord - Amsterdam Centraal · Eurostar 9325, Standard',
      null,
    ])
    const ruta = html.slice(html.indexOf('class="route"'), html.indexOf('Lo que van a vivir'))
    for (const tren of ['AVE 03071 Renfe', 'TGV INOUI 9714', 'Eurostar 9325']) expect(ruta).toContain(tren)
  })
})

describe('las noches son las de hotel', () => {
  it('«14 días / 13 noches» (el vuelo nocturno contado) sale «14 días · 12 noches», igual que «Incluye»', () => {
    const m = modeloDePropuesta(comoLaCaptura())
    expect(m.portada.duracion).toBe('14 días · 12 noches')
    const html = htmlDePropuesta(m, recursos)
    expect(html).not.toContain('13 noches')
    expect(html).toContain('12 noches')
  })

  it('sin noches de hotel, la duración guardada tal cual', () => {
    const e = comoLaCaptura()
    const m = modeloDePropuesta({ ...e, props: { ...e.props, viaje: { ...e.props.viaje!, hoteles: [] } } })
    expect(m.portada.duracion).toBe('14 días / 13 noches')
  })
})

describe('el plan opcional, sin la ficha cruda ni el proveedor', () => {
  it('queda la duración y el idioma; la ciudad y el día van sobre la foto', () => {
    expect(descripcionDeOpcional('Ciudad: París · Fecha: 2026-12-19 · Duración: 1 día · Idioma: Francés / Inglés · Proveedor: Operador de Ejemplo')).toBe('1 día · en francés o inglés')
    expect(descripcionDeOpcional('CIUDAD: ÁMSTERDAM · DURACIÓN: 1 H 15 MIN · IDIOMA: AUDIOGUÍA EN ESPAÑOL · PROVEEDOR: X')).toBe('1 h 15 min · audioguía en español')
    expect(descripcionDeOpcional('Un día completo en los dos parques.')).toBe('Un día completo en los dos parques.')
    expect(descripcionDeOpcional('Salida el 2026-12-19 desde el hotel')).toBe('Salida el 19 dic desde el hotel')
    expect(descripcionDeOpcional('Proveedor: Operador de Ejemplo')).toBeNull()
    // También escrito sin «Campo:».
    expect(descripcionDeOpcional('Con guía en español · proveedor Ejemplo SAS')).toBe('Con guía en español')
  })

  it('el documento no dice el proveedor en ninguna parte', () => {
    const m = modeloDePropuesta(comoLaCaptura())
    const disney = m.opcionales.find((o) => o.nombre.startsWith('Disneyland'))!
    expect(disney.descripcion).toBe('1 día · en francés o inglés')
    const html = htmlDePropuesta(m, recursos)
    expect(html).not.toMatch(/proveedor/i)
    expect(html).not.toContain('Operador de Ejemplo')
    expect(html).not.toMatch(/\b2026-12-19\b/)
  })
})

describe('el texto guardado en la voz del documento', () => {
  it('un intro con exclamación, de usted o con otras noches no se imprime: sale el determinista', () => {
    expect(textoConLaVozDelDocumento('¡Prepárese para un viaje por Europa!', 12)).toBe(false)
    expect(textoConLaVozDelDocumento('Usted va a recorrer Europa.', 12)).toBe(false)
    expect(textoConLaVozDelDocumento('Qué viaje les espera!', 12)).toBe(false)
    expect(textoConLaVozDelDocumento('Son 13 noches en cuatro ciudades.', 12)).toBe(false)
    expect(textoConLaVozDelDocumento('Entre ciudades van en tren y los días libres son de ustedes.', 12)).toBe(true)
    const m = modeloDePropuesta(comoLaCaptura())
    expect(m.portada.intro).toBe(
      '12 noches en Madrid, Barcelona, París y Ámsterdam, y entre ciudades van en tren, de centro a centro. Todos los hoteles incluyen el desayuno. Los días libres quedan abiertos para que ustedes decidan.',
    )
  })

  it('el intro revisado que sí habla como el documento se respeta', () => {
    const m = modeloDePropuesta(ENTRADA_EUROPA)
    expect(m.portada.intro).toBe(ENTRADA_EUROPA.props.viaje!.intro)
  })

  it('«Antes de viajar» pasa de usted a ustedes y sin exclamaciones', () => {
    expect(enLaVozDelDocumento('Recuerde llevar sus pasaportes vigentes')).toBe('Recuerden llevar sus pasaportes vigentes')
    expect(enLaVozDelDocumento('Tenga en cuenta que hace frío: le sugerimos ropa abrigada!')).toBe('Tengan en cuenta que hace frío: les sugerimos ropa abrigada.')
    expect(enLaVozDelDocumento('Lleguen tres horas antes.')).toBe('Lleguen tres horas antes.')
    const m = modeloDePropuesta(comoLaCaptura())
    expect(m.formal.antesDeViajar.join(' ')).not.toMatch(/[¡!]|\bRecuerde\b|\ble sugerimos\b/)
  })
})

describe('«Incluido en todas» de verdad en todas', () => {
  it('la línea que nombra el hotel o la aerolínea de una versión sale; va una que lo dice', () => {
    const m = modeloDePropuesta(comoLaCaptura())
    expect(m.precio.incluye).toEqual([
      'Tiquetes aéreos de ida y regreso; la aerolínea cambia según la versión',
      '12 noches de hotel con desayuno; el hotel cambia según la versión',
      'Tren AVE de Madrid a Barcelona',
    ])
  })

  it('sin tarifas (una sola versión), el texto revisado tal cual', () => {
    const lineas = ['3 noches en el Hotel Catalonia Puerta del Sol']
    expect(incluyeDeTodas(lineas, { hoteles: [{ ciudad: 'Madrid', desde: null, hasta: null, noches: 3, opciones: [{ tarifas: [], hotel: 'Catalonia Puerta del Sol', estrellas: 4, habitacion: null, regimen: null, cancelacion: null, cargoEnDestino: null, foto: null }] }], vuelos: [], tarifas: 1, noches: 3 })).toEqual(lineas)
  })
})

describe('los traslados del día, en el orden en que pasan', () => {
  it('la vuelta sin fecha propia sale el día que termina la estadía donde cae la ida', () => {
    const m = modeloDePropuesta(comoLaCaptura())
    const vuelta = m.trayectos.filas.find((f) => /Schiphol/.test(f.descripcion))!
    expect(vuelta.fecha).toBe('2026-12-23')
    expect(m.trayectos.filas.filter((f) => f.tipo === 'traslado')).toHaveLength(8)
  })

  it('del hotel a la estación antes del tren; de la estación al hotel después', () => {
    // Como en la real: el traslado de llegada se cargó antes que el tren.
    const e = comoLaCaptura()
    const llegada = e.servicios!.find((x) => x.descripcion.startsWith('Barcelona Sants - hotel'))!
    const m = modeloDePropuesta({ ...e, servicios: [llegada, ...e.servicios!.filter((x) => x !== llegada)] })
    const dia14 = m.dias.find((d) => d.fecha === '2026-12-14')!
    expect(dia14.eventos.map((e) => e.tipo)).toEqual(['traslado', 'tren', 'traslado', 'hotel'])
    expect(dia14.eventos[0].texto).toMatch(/^Hotel - estación/)
    expect(dia14.eventos[2].texto).toMatch(/^Barcelona Sants - hotel/)
  })
})
