/**
 * Lo que la plantilla de Trappvel IMPRIME de verdad, leído del binario del PDF.
 *
 * Una plantilla puede recibir el dato correcto y no pintarlo: el JSX decide. Por eso todo
 * lo que este archivo afirma sale de `textoDelPDF`, no de las props.
 *
 * Los datos del vuelo y del hotel son los mismos del banco real de capturas que usa
 * `detalle-viaje.test.ts`.
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToBuffer } from '@react-pdf/renderer'

import CotizacionPDF from './cotizacion-pdf'
import CotizacionTermotechPDF from './cotizacion-termotech-pdf'
import CotizacionTrappvelPDF from './cotizacion-trappvel-pdf'
import { plantillaCotizacionPropia } from './plantillas-cotizacion'
import { textoDelPDF } from './texto-del-pdf'
import type { CotizacionPDFProps, ViajePDF } from './cotizacion-props'

const VUELO = {
  linea: 'AVIANCA CUCUTA-ARMENIA',
  aerolinea: 'Avianca',
  origen: 'Cucuta CUC',
  destino: 'Armenia AXM',
  fechaSalida: '23 oct',
  fechaRegreso: '25 oct',
  // Las horas del banco real (`3.57.39_PM-3`): la ida sale 05:50 y llega 10:15 tras la
  // escala de Bogota.
  horaSalida: '05:50',
  horaLlegada: '10:15',
  horaSalidaRegreso: '18:45',
  horaLlegadaRegreso: '22:10',
  escalaIda: 'Bogota BOG',
  escalaRegreso: 'Bogota BOG',
  escalas: 1,
  tarifa: 'BASIC Standard economy',
  equipaje: 'articulo personal',
  adicionales: [],
}

const HOTEL = {
  linea: 'CROWN PARADISE',
  hotel: 'Crown Paradise Club Cancun',
  ciudad: 'Cancun',
  habitacion: 'Standard Double',
  regimen: 'Todo incluido',
  checkIn: '19 dic 2026',
  checkOut: '23 dic 2026',
  noches: 4,
  ocupacion: '2 Adultos - 1 Nino',
  cancelacion: 'Cancelacion gratuita hasta 30/11/2026',
  estrellas: null,
  localizador: null,
  adicionales: [],
}

const CARGO = {
  ciudad: 'Cancun',
  concepto: 'Impuestos y tasas de hospedaje',
  monto: '329,44 MXN',
  observacion: 'Se paga en el hotel. No esta incluido en el precio.',
}

const viaje = (over: Partial<ViajePDF> = {}): ViajePDF => ({
  viajeros: '2 adultos y 1 nino',
  destino: 'Cancun',
  fechas: '19 dic 2026 - 23 dic 2026',
  duracion: '5 dias / 4 noches',
  presentacion: 'Cancun combina playa turquesa con la zona arqueologica maya.',
  foto: null,
  vuelos: [VUELO],
  hoteles: [HOTEL],
  cargosEnDestino: [CARGO],
  nivelDetalle: 'normal',
  pie: 'www.trappvel.com - contacto@trappvel.com - Bogota',
  firma: { nombre: 'Edgar Javier Alarcon S.', cargo: 'Director Comercial', contacto: 'contacto@trappvel.com' },
  ...over,
})

const props = (over: Partial<CotizacionPDFProps> = {}): CotizacionPDFProps => ({
  cotizacion: {
    consecutivo: 'COT-2026-0006',
    descripcion: null,
    valor_total: 7_303_878,
    modo: 'detallada',
    fecha_envio: null,
    fecha_validez: null,
    condiciones_pago: null,
    notas: null,
    descuento_porcentaje: 0,
    descuento_valor: 0,
  },
  empresa: {
    nombre: 'Ligia Sanchez',
    nit: null,
    contacto_nombre: 'Ligia Sanchez',
    contacto_email: null,
    telefono: null,
    direccion: null,
    ciudad: null,
  },
  vendedor: {
    nombre: 'Trappvel',
    razon_social: null,
    nit: null,
    logo_url: null,
    color_primario: '#e63380',
    telefono: null,
    email: null,
    direccion: null,
    ciudad: null,
  },
  items: [
    { nombre: 'TIQUETES AEREOS', descripcion: null, precio_venta: 1_294_351, descuento_porcentaje: 0, cantidad: 1, unidad: null, precioPorPasajero: [{ tipo: 'adulto', cantidad: 2, precioUnitario: 641_507 }] },
    { nombre: 'HOTEL CROWN PARADISE', descripcion: null, precio_venta: 3_780_884, descuento_porcentaje: 0, cantidad: 1, unidad: null },
  ],
  dias: [
    { dia: 1, items: [{ nombre: 'TRASLADO AEROPUERTO - HOTEL', descripcion: 'Privado, con guia en espanol', precio_venta: 180_000, descuento_porcentaje: 0, cantidad: 1, unidad: null }] },
    { dia: 3, items: [{ nombre: 'TOUR CHICHEN ITZA', descripcion: 'Dia completo con almuerzo', precio_venta: 420_000, descuento_porcentaje: 0, cantidad: 1, unidad: null }] },
  ],
  itemsSinDia: null,
  sugeridos: [
    { nombre: 'SNORKEL EN ISLA MUJERES', descripcion: 'Medio dia', precio_venta: 260_000, cantidad: 1, unidad: 'pax' },
  ],
  preciosPorPasajero: {
    filas: [{ tipo: 'adulto', cantidad: 2, precioUnitario: 641_507 }],
    cubierto: 1_283_014,
    sinReparto: ['HOTEL CROWN PARADISE'],
  },
  fiscal: null,
  negocio: { nombre: 'Viaje a Cancun - familia Sanchez' },
  emisor: null,
  viaje: viaje(),
  ...over,
})

async function texto(p: CotizacionPDFProps): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return textoDelPDF(Buffer.from(await renderToBuffer(createElement(CotizacionTrappvelPDF, p) as any)))
}

describe('la plantilla trappvel está registrada', () => {
  it('el slug «trappvel» resuelve a esta plantilla, y los demás no cambian', () => {
    expect(plantillaCotizacionPropia('trappvel')).toBe(CotizacionTrappvelPDF)
    expect(plantillaCotizacionPropia('metrik')).toBeNull()
    expect(plantillaCotizacionPropia('wmc')).toBeNull()
  })
})

describe('el documento del cliente', () => {
  it('pone en la portada el título y las cuatro fichas', async () => {
    const t = await texto(props())
    expect(t).toContain('VIAJE A CANCUN')
    expect(t).toContain('VIAJEROS')
    expect(t).toContain('DESTINO')
    expect(t).toContain('FECHA')
    // Sin el número de adelante: el renderizador parte la corrida de texto después del
    // dígito y entre los dos trozos queda un espacio de más. Ver `textoDelPDF`.
    expect(t).toContain('adultos y 1 nino')
    expect(t).toContain('dias / 4 noches')
  })

  it('imprime el párrafo del destino tal como lo escribió quien cotiza', async () => {
    expect(await texto(props())).toContain('zona arqueologica maya')
  })

  it('imprime la tabla de vuelos con aerolínea, códigos IATA y escala', async () => {
    const t = await texto(props())
    expect(t).toContain('Avianca')
    expect(t).toContain('CUC')
    expect(t).toContain('AXM')
    expect(t).toContain('Bogota BOG')
  })

  /**
   * §2.3 de la referencia: la tabla de vuelos lleva SALIDA, LLEGADA y DURACIÓN.
   *
   * Hasta el 2026-09-22 esas tres columnas no se podían llenar porque el dato no existía en
   * ninguna ranura. Las horas se miden contra las tres capturas reales del banco
   * (`qa/2026-09-22_horas-de-vuelo`): 15 de 15 corridas correctas.
   */
  it('imprime la hora de salida y de llegada de la ida y del regreso', async () => {
    const t = await texto(props())
    expect(t).toContain('SALIDA')
    expect(t).toContain('LLEGADA')
    expect(t).toContain('05:50')
    expect(t).toContain('10:15')
    expect(t).toContain('18:45')
    expect(t).toContain('22:10')
    // Dos trayectos: la fila se distingue por su sentido, y el regreso va al revés.
    expect(t).toContain('Ida')
    expect(t).toContain('Regreso')
  })

  it('⚠️ la tabla NO trae DURACIÓN ni número de vuelo: no están en la referencia', async () => {
    // El itinerario que Trappvel manda hoy tiene cinco columnas (AERO, RUTA, FECHA,
    // SALIDA, LLEGADA). Se mira el ENCABEZADO y no la palabra suelta: «DURACIÓN» también
    // es una de las cuatro fichas de la portada, y ahí sí tiene dato.
    const t = await texto(props())
    expect(t).toContain('SALIDA LLEGADA ESCALA')
    expect(t).not.toContain('LLEGADA DURACIÓN')
    // El número de vuelo se sigue viendo en la plataforma; en el documento, no.
    expect(t).not.toContain('9459')
  })

  it('un viaje de solo ida no imprime una fila de regreso vacía', async () => {
    const t = await texto(props({
      viaje: viaje({
        vuelos: [{ ...VUELO, fechaRegreso: null, horaSalidaRegreso: null, horaLlegadaRegreso: null, escalaRegreso: null }],
      }),
    }))
    expect(t).toContain('05:50')
    expect(t).not.toContain('22:10')
    // Con una sola fila la columna del sentido sobra: no hay nada que distinguir.
    expect(t).not.toContain('Regreso')
  })

  it('imprime la ficha de hotel con noches, habitación y plan', async () => {
    const t = await texto(props())
    expect(t).toContain('Crown Paradise')
    expect(t).toContain('4 noches')
    expect(t).toContain('Standard Double')
    expect(t).toContain('Todo incluido')
  })

  it('numera el día a día con los días que existen, sin rellenar el que falta', async () => {
    const t = await texto(props())
    expect(t).toContain('DÍA 1')
    expect(t).toContain('DÍA 3')
    expect(t).not.toContain('DÍA 2')
    expect(t).toContain('TOUR CHICHEN ITZA')
  })

  it('separa incluye de no incluye, y lo de destino cae en «no incluye»', async () => {
    const t = await texto(props())
    expect(t).toContain('INCLUYE / NO INCLUYE')
    expect(t).toContain('TIQUETES AEREOS')
    expect(t).toContain('se pagan en destino')
  })

  it('lista los opcionales diciendo que no están en el precio', async () => {
    const t = await texto(props())
    expect(t).toContain('OPCIONALES')
    expect(t).toContain('SNORKEL EN ISLA MUJERES')
  })

  it('imprime los cargos en destino en su moneda local', async () => {
    const t = await texto(props())
    expect(t).toContain('CARGOS A PAGAR EN DESTINO')
    // ⚠️ El monto y la moneda pueden viajar en dos corridas de texto distintas dentro del
    // PDF, así que se buscan por separado: afirmar la cadena entera mediría el salto de
    // línea del renderizador, no que el dato esté impreso.
    expect(t).toContain('329,44')
    expect(t).toContain('MXN')
  })

  it('imprime el precio por tipo de pasajero y lo que se cobra por el grupo', async () => {
    const t = await texto(props())
    expect(t).toContain('PRECIO POR PASAJERO')
    expect(t).toContain('Adulto')
    expect(t).toContain('Se cobra por el grupo: HOTEL CROWN PARADISE')
  })

  /**
   * ⚠️⚠️ La tabla por pasajero y el TOTAL son dinero del MISMO viaje, y hasta hoy se
   * imprimían como dos hechos sueltos que nadie reconciliaba: en la prueba real de
   * Providencia la suma por pasajero quedaba 360.000 por debajo del total y el documento
   * no lo decía. Aquí se mide que la columna CIERRA.
   */
  it('⚠️⚠️ la columna por pasajero + lo del grupo da exactamente el TOTAL', async () => {
    const t = await texto(props())
    // ⚠️ Sin el «$»: `Intl` lo separa con un espacio duro y `toContain` no lo encuentra.
    // 2 adultos x 641.507 = 1.283.014 (`cubierto`), y el resto hasta 5.075.235.
    expect(t).toContain('1.283.014')
    expect(t).toContain('3.792.221')
    expect(t).toContain('5.075.235')
    expect(1_283_014 + 3_792_221).toBe(5_075_235)
  })

  it('sin poder reconciliar, el documento lo DICE en vez de sugerir que la columna suma', async () => {
    const t = await texto(props({
      preciosPorPasajero: {
        filas: [{ tipo: 'adulto', cantidad: null, precioUnitario: 641_507 }],
        cubierto: null,
        sinReparto: ['HOTEL CROWN PARADISE'],
      },
    }))
    expect(t).toContain('No incluye lo que se cobra por el grupo')
    expect(t).not.toContain('Se cobra por el grupo:')
  })

  it('el pie de marca y la firma salen de la configuración del workspace', async () => {
    const t = await texto(props())
    expect(t).toContain('www.trappvel.com')
    expect(t).toContain('Edgar Javier Alarcon S.')
    expect(t).toContain('Director Comercial')
  })

  it('sin firma configurada firma quien generó el documento', async () => {
    const t = await texto(props({
      viaje: viaje({ firma: null }),
      emisor: { nombre: 'Alejandra Gomez', cargo: 'Asesora de viajes' },
    }))
    expect(t).toContain('Alejandra Gomez')
    expect(t).toContain('Asesora de viajes')
  })

  it('sin pie configurado se arma con los datos del vendedor', async () => {
    const t = await texto(props({
      viaje: viaje({ pie: null }),
      vendedor: { ...props().vendedor, email: 'hola@trappvel.com' },
    }))
    expect(t).toContain('hola@trappvel.com')
  })
})

/**
 * R7 · las TRES tarifas que van en la propuesta.
 *
 * ⚠️⚠️ Esta plantilla recibia `itinerarios` desde que existe y NO lo consumia: la palabra
 * aparecia dos veces en el archivo y las dos eran comentarios. Encenderla para Trappvel
 * fue lo que perdio las tres opciones — antes una cotizacion salia con la generica, que si
 * las imprime. O sea que el documento se le pasaban tres tarifas armadas y mostraba UNA.
 */
describe('las tres tarifas (Economica / Recomendada / Premium)', () => {
  const ITIN: CotizacionPDFProps['itinerarios'] = [
    {
      nombre: 'Recomendada', esPrincipal: true, precio: 5_075_235,
      items: [{ nombre: 'TIQUETES AEREOS', descripcion: null, precio_venta: 1_294_351, descuento_porcentaje: 0, cantidad: 1, unidad: null }],
    },
    {
      nombre: 'Económica', esPrincipal: false, precio: 3_900_000,
      items: [{ nombre: 'TIQUETES LOW COST', descripcion: null, precio_venta: 900_000, descuento_porcentaje: 0, cantidad: 1, unidad: null }],
    },
    {
      nombre: 'Premium', esPrincipal: false, precio: 8_400_000,
      items: [{ nombre: 'TIQUETES FLEX', descripcion: null, precio_venta: 2_100_000, descuento_porcentaje: 0, cantidad: 1, unidad: null }],
    },
  ]

  /**
   * Un documento CORTO, de una sola pagina.
   *
   * ⚠️ `textoDelPDF` concatena los `stream` en el orden del BINARIO, que no es el de las
   * paginas: en un PDF de dos hojas el texto de la segunda puede salir primero. Comparar
   * posiciones solo significa algo dentro de una misma pagina.
   */
  const corto = (over: Partial<CotizacionPDFProps> = {}) =>
    props({ viaje: viaje({ vuelos: [], hoteles: [], cargosEnDestino: [] }), dias: null, sugeridos: null, ...over })

  it('imprime las TRES con su nombre y su precio, la recomendada primero', async () => {
    const t = await texto(corto({ itinerarios: ITIN }))
    expect(t).toContain('RECOMENDADA')
    expect(t).toContain('ECONÓMICA')
    expect(t).toContain('PREMIUM')
    expect(t).toContain('3.900.000')
    expect(t).toContain('8.400.000')
    // El orden lo fija `bloquesParaPDF` (principal primero) y el documento lo respeta:
    // la Recomendada va primera por ser la principal, no por precio.
    expect(t.indexOf('RECOMENDADA')).toBeLessThan(t.indexOf('ECONÓMICA'))
    expect(t.indexOf('ECONÓMICA')).toBeLessThan(t.indexOf('PREMIUM'))
  })

  it('cada bloque imprime SU combinacion, no el abanico completo', async () => {
    const t = await texto(props({ itinerarios: ITIN }))
    expect(t).toContain('TIQUETES LOW COST')
    expect(t).toContain('TIQUETES FLEX')
  })

  it('⚠️ dice cual total manda: sin eso el cliente ve tres precios y no sabe que acepta', async () => {
    const t = await texto(props({ itinerarios: ITIN }))
    expect(t).toContain('El total de abajo corresponde a la opción recomendada')
    // El TOTAL sigue siendo el del principal (R5), no la suma de los tres.
    expect(t).toContain('5.075.235')
  })

  it('1b · con UNA sola tarifa el documento sale como hoy: sin encabezados ni aclaracion', async () => {
    const t = await texto(props({ itinerarios: [ITIN![0]] }))
    expect(t).not.toContain('RECOMENDADA')
    expect(t).not.toContain('El total de abajo corresponde')
    expect(t).toContain('TIQUETES AEREOS')
  })

  it('R6 · sin itinerarios el documento no cambia un caracter', async () => {
    const sin = await texto(props())
    const conNull = await texto(props({ itinerarios: null }))
    expect(conNull).toBe(sin)
  })

  it('⚠️ el nombre y el precio de cada opcion salen tambien en el nivel «general»', async () => {
    // El nivel recorta descripcion, nunca lo que el cliente tiene que decidir: sin los
    // encabezados, las tres tarifas serian invisibles justo en el formato mas corto.
    const t = await texto(props({ itinerarios: ITIN, viaje: viaje({ nivelDetalle: 'general' }) }))
    expect(t).toContain('ECONÓMICA')
    expect(t).toContain('3.900.000')
    // Lo que SI se recorta es el desglose linea por linea.
    expect(t).not.toContain('TIQUETES LOW COST')
  })
})

describe('el hueco de la foto', () => {
  it('sin foto el documento sale completo: no hay imagen rota ni sección vacía', async () => {
    const t = await texto(props({ viaje: viaje({ foto: null }) }))
    expect(t).toContain('VIAJE A CANCUN')
    expect(t).toContain('Crown Paradise')
  })

  it('con foto se imprime su rótulo en mayúscula sostenida', async () => {
    const t = await texto(props({
      viaje: viaje({
        // Un PNG de 1×1 en data URL: la prueba no depende de la red.
        foto: {
          url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
          rotulo: 'Cancun · zona hotelera',
        },
      }),
    }))
    expect(t).toContain('CANCUN')
    expect(t).toContain('ZONA HOTELERA')
  })
})

describe('los tres niveles de detalle', () => {
  it('«muy detallada» agrega la descripción del día y el precio por pasajero de cada línea', async () => {
    const t = await texto(props({ viaje: viaje({ nivelDetalle: 'muy_detallada' }) }))
    expect(t).toContain('guia en espanol')
    expect(t).toContain('Cancelacion gratuita')
  })

  it('«normal» describe el viaje sin la letra chica', async () => {
    const t = await texto(props({ viaje: viaje({ nivelDetalle: 'normal' }) }))
    expect(t).toContain('Standard Double')
    expect(t).not.toContain('guia en espanol')
    // ⚠️ La política de cancelación SÍ sale en «normal» desde el 2026-09-22. Estaba
    // condicionada a «muy detallada», y ese nivel es inerte (su bloque sigue oculto), así
    // que no se imprimía NUNCA — y §2.4 de la referencia la lista en la ficha del hotel.
    // Una tarifa no reembolsable es una condición, no letra chica.
    expect(t).toContain('Cancelacion gratuita')
  })

  it('«general» recorta la descripción y el detalle de precios por línea', async () => {
    const t = await texto(props({ viaje: viaje({ nivelDetalle: 'general' }) }))
    expect(t).not.toContain('Standard Double')
    expect(t).not.toContain('BASIC Standard economy')
    expect(t).not.toContain('articulo personal')
    expect(t).not.toContain('Cancelacion gratuita')
    // Las horas NO se recortan en ningún nivel: son el itinerario, no la letra chica.
    expect(t).toContain('05:50')
  })

  it('⚠️ lo que el cliente TIENE que pagar no se recorta en ningún nivel', async () => {
    for (const nivel of ['muy_detallada', 'normal', 'general'] as const) {
      const t = await texto(props({ viaje: viaje({ nivelDetalle: nivel }) }))
      expect(t, nivel).toContain('329,44')
      expect(t, nivel).toContain('CARGOS A PAGAR EN DESTINO')
      expect(t, nivel).toContain('TOTAL')
      expect(t, nivel).toContain('PRECIO POR PASAJERO')
    }
  })
})

describe('compatibilidad', () => {
  it('las plantillas de los demás workspaces ignoran `viaje`: su salida no cambia un carácter', async () => {
    const base = props({ viaje: null })
    const conViaje = props({ viaje: viaje() })
    for (const plantilla of [CotizacionPDF, CotizacionTermotechPDF]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const render = async (p: CotizacionPDFProps) => textoDelPDF(Buffer.from(await renderToBuffer(createElement(plantilla, p) as any)))
      expect(await render(conViaje)).toBe(await render(base))
    }
  }, 30_000)

  it('sin viaje la plantilla de Trappvel imprime igual el precio, sin romperse', async () => {
    const t = await texto(props({ viaje: null }))
    expect(t).toContain('TIQUETES AEREOS')
    expect(t).toContain('TOTAL')
  })
})


/**
 * El adicional DENTRO del vuelo, y su plata dentro del total de la linea (S1.2).
 *
 * > *«Un equipaje adicional de bodega no lo pondria como otro item, sino que lo agregaria
 * > dentro del vuelo como adicional para que el sistema me lo muestre todo junto.»*
 *
 * Todo lo que se afirma aqui sale del BINARIO del PDF, no de las props: la plantilla
 * puede recibir el dato correcto y no pintarlo, que es lo que el JSX decide.
 */
describe('adicionales dentro de la variante', () => {
  const conMaleta = () =>
    props({
      viaje: viaje({ vuelos: [{ ...VUELO, adicionales: ['Equipaje de bodega adicional x2'] }] }),
      items: [
        {
          nombre: 'TIQUETES AEREOS',
          descripcion: null,
          precio_venta: 1_294_351,
          descuento_porcentaje: 0,
          cantidad: 1,
          unidad: null,
          adicionales: ['Equipaje de bodega adicional x2'],
          valorAdicionales: 240_000,
        },
        { nombre: 'HOTEL CROWN PARADISE', descripcion: null, precio_venta: 3_780_884, descuento_porcentaje: 0, cantidad: 1, unidad: null },
      ],
    })

  it('se imprime dentro de la ficha del vuelo', async () => {
    const t = await texto(conMaleta())
    expect(t).toContain('Adicionales')
    expect(t).toContain('Equipaje de bodega adicional x2')
  })

  it('su plata entra en el total de SU linea: la columna sigue cuadrando', async () => {
    const t = await texto(conMaleta())
    // 1.294.351 + 240.000 = 1.534.351. Sin el sumando saldria 1.294.351 y la columna
    // quedaria por debajo del TOTAL, que si los incluye.
    expect(t).toContain('1.534.351')
    expect(t).not.toContain('1.294.351')
  })

  it('sale en los TRES niveles de detalle: es plata que el cliente paga', async () => {
    for (const nivel of ['muy_detallada', 'normal', 'general'] as const) {
      const p = conMaleta()
      const t = await texto({ ...p, viaje: { ...p.viaje!, nivelDetalle: nivel } })
      expect(t, nivel).toContain('Equipaje de bodega adicional x2')
    }
  }, 30_000)

  it('R6 . sin adicionales el documento no cambia un caracter', async () => {
    const sinCampo = props()
    const conCampoVacio = props({
      items: props().items.map(i => ({ ...i, adicionales: [], valorAdicionales: 0 })),
    })
    expect(await texto(conCampoVacio)).toBe(await texto(sinCampo))
  }, 30_000)
})
