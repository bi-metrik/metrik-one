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
import { vuelosDeItems } from '@/lib/cotizaciones/detalle-viaje'
import { precioPorPasajeroDeItem, preciosPorPasajeroDelViaje } from '@/lib/cotizaciones/precio-pasajero-pdf'
import { textoParaElViaje, type DocumentoCliente } from '@/lib/cotizaciones/documento-cliente'

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
    // El título sale como lo escribió quien cotiza (§4.2): ya no se pasa a mayúsculas.
    expect(t).toContain('PROPUESTA DE VIAJE')
    expect(t).toContain('familia Sanchez')
    expect(t).not.toContain('VIAJE A CANCUN')
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
    // §4.4: el código va entre paréntesis y la escala se nombra.
    expect(t).toContain('Escala en Bogota (BOG)')
    // La pastilla de la aerolínea lleva su sigla IATA.
    expect(t).toContain('AV Avianca')
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
    // Dos trayectos: cada fila dice su ruta, y el regreso va al revés.
    expect(t.split('Cucuta (CUC)').length - 1).toBe(2)
    expect(t.split('Armenia (AXM)').length - 1).toBe(2)
  })

  it('⚠️ sin número de vuelo no hay columna VUELO: una columna vacía no se imprime', async () => {
    // Se mira el ENCABEZADO y no la palabra suelta: «DURACIÓN» también es una de las
    // cuatro fichas de la portada, y ahí sí tiene dato.
    const t = await texto(props())
    expect(t).toContain('AEROLÍNEA RUTA FECHA SALIDA LLEGADA')
    expect(t).not.toContain('LLEGADA VUELO')
    expect(t).not.toContain('LLEGADA DURACIÓN')
  })

  it('con número de vuelo la columna VUELO vuelve, con el de la ida y el del regreso', async () => {
    // Decisión de Mauricio (2026-09-22): el número vuelve a la tabla, solo si hay dato.
    // Con dos números y regreso, el primero es de la ida y el segundo del regreso.
    const t = await texto(props({ viaje: viaje({ vuelos: [{ ...VUELO, numeroVuelo: 'AV9459 AV9460' }] }) }))
    expect(t).toContain('LLEGADA VUELO')
    expect(t).toContain('AV9459')
    expect(t).toContain('AV9460')
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

  it('lo de destino cae en «A tener en cuenta»', async () => {
    const t = await texto(props())
    expect(t).toContain('A tener en cuenta')
    // Sin «en destino» pegado: el renglón puede partirse justo ahí y el extractor mete un
    // espacio de más en el corte.
    expect(t).toContain('Impuestos y tasas de hospedaje (Cancun), que se pagan')
  })

  /**
   * ⚠️ Hasta el 2026-09-22 «Incluido en el plan» repetía, con un chulo delante, la misma
   * lista de «Inversión» (COT-2026-0006: «✓ AVIANCA BOG - ADZ ✓ SATENA ADZ - PROVIDENCIA»).
   * Lo que el cliente recibe no es el nombre de una línea.
   */
  it('⚠️ «Incluido en el plan» ya no repite los nombres de las líneas de «Inversión»', async () => {
    const t = await texto(props())
    expect(t).not.toContain('Incluido en el plan')
    // La línea sigue en «Inversión», una sola vez.
    expect(t.split('TIQUETES AEREOS').length - 1).toBe(1)
  })

  it('con inclusiones de verdad, «Incluido en el plan» vuelve con ellas', async () => {
    const t = await texto(props({ viaje: viaje({ incluye: ['Traslados aeropuerto - hotel - aeropuerto', 'Desayunos diarios'] }) }))
    expect(t).toContain('Incluido en el plan')
    expect(t).toContain('Desayunos diarios')
    expect(t.split('TIQUETES AEREOS').length - 1).toBe(1)
  })

  it('lista los opcionales diciendo que no están en el precio', async () => {
    const t = await texto(props())
    expect(t).toContain('Opcionales')
    expect(t).toContain('No están incluidas en el precio')
    expect(t).toContain('SNORKEL EN ISLA MUJERES')
  })

  it('imprime los cargos en destino en su moneda local', async () => {
    const t = await texto(props())
    expect(t).toContain('Cargos a pagar en destino')
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

  it('cada vuelo y cada hotel llevan el nombre de SU tarifa, con el mismo color que en «Inversión»', async () => {
    const t = await texto(props({
      itinerarios: ITIN,
      viaje: viaje({
        vuelos: [{ ...VUELO, tarifas: [0] }, { ...VUELO, aerolinea: 'LATAM', tarifas: [1] }],
        hoteles: [{ ...HOTEL, tarifas: [0] }, { ...HOTEL, hotel: 'Hotel Economico Cancun', tarifas: [1] }],
      }),
    }))
    // Cuatro apariciones de ECONÓMICA: la tarjeta de «Inversión», los DOS tramos de su
    // vuelo (ida y regreso llevan cada uno su marca) y su hotel.
    expect(t.split('ECONÓMICA').length - 1).toBe(4)
    expect(t).toContain('Hotel Economico Cancun')
    expect(t).toContain('La que recomendamos')
  })

  it('con UNA sola tarifa no aparece ningún nombre de tarifa en vuelos ni hoteles', async () => {
    const t = await texto(props({
      itinerarios: [ITIN![0]],
      viaje: viaje({ vuelos: [{ ...VUELO, tarifas: [0] }], hoteles: [{ ...HOTEL, tarifas: [0] }] }),
    }))
    expect(t).not.toContain('RECOMENDADA')
    expect(t).not.toContain('La que recomendamos')
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
    expect(t).toContain('familia Sanchez')
    expect(t).toContain('Crown Paradise')
  })

  it('con foto se imprime su rótulo en mayúscula sostenida', async () => {
    const t = await texto(props({
      viaje: viaje({
        // Un PNG de 1×1 en data URL: la prueba no depende de la red.
        foto: {
          url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
          rotulo: 'Cancun · zona hotelera',
          credito: 'Autora de prueba (Wikimedia Commons, CC BY-SA 4.0)',
        },
      }),
    }))
    expect(t).toContain('CANCUN')
    expect(t).toContain('ZONA HOTELERA')
    // La licencia obliga a nombrar al autor de lo que se imprime.
    expect(t).toContain('Fotografías: Autora de prueba (Wikimedia Commons, CC BY-SA 4.0)')
  })

  it('sin fotos no hay línea de créditos', async () => {
    const t = await texto(props({ viaje: viaje({ foto: null, fotosCiudades: [] }) }))
    expect(t).not.toContain('Fotografías')
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
      expect(t, nivel).toContain('Cargos a pagar en destino')
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


/**
 * ⚠️⚠️ COT-2026-0006 (San Andrés - Providencia, 6 adultos + 1 niño + 1 infante), renderizada
 * desde producción el 2026-09-22 después del #819. Cinco defectos en un documento de dos
 * páginas; el fixture reproduce su forma con la lectura TAL CUAL está en la base y pasa por
 * el mismo camino que la acción: `vuelosDeItems` → plantilla.
 */
describe('COT-2026-0006: San Andrés - Providencia', () => {
  const campos = (o: Record<string, string>) => Object.entries(o).map(([label, valor]) => ({ label, valor }))
  const conTarifa = (c: Record<string, string>, costos: [string, number, number][]) => {
    const total = costos.reduce((a, [, , t]) => a + t, 0)
    return {
      casillas: { grupo_completo: { total, moneda: 'COP', campos: campos(c) } },
      confirmada: {
        tasa: null,
        moneda: 'COP',
        composicion: { adultos: 6, ninos: 1, infantes: 1 },
        costos: costos.map(([tipo, cantidad, totalCOP]) => ({ tipo, cantidad, totalCOP, unitarioCOP: Math.round(totalCOP / cantidad) })),
        costoTotalCOP: total,
        confirmadaEn: '2026-09-17T16:53:02.530Z',
      },
    }
  }
  const LINEAS = [
    {
      nombre: 'AVIANCA BOG - ADZ',
      // ⚠️ El grupo real: un nombre libre, no una ranura.
      grupo: 'avianca bog - adz',
      precio_venta: 7_303_878,
      rubros: [{ valor_total: 6_208_296 }],
      tarifa_pax: conTarifa(
        { 'Aerolínea': 'Avianca', 'Origen': 'Bogotá', 'Destino': 'San Andrés Isla', 'Salida': '2026-11-23', 'Regreso': '2026-11-28', 'Nº de vuelo': '9782, 9779', 'Escalas': '0' },
        [['adulto', 6, 5_547_822], ['nino', 1, 649_137], ['infante', 1, 11_337]],
      ),
    },
    {
      nombre: 'SATENA ADZ - PROVIDENCIA',
      grupo: 'vuelo',
      precio_venta: 3_873_172,
      rubros: [{ valor_total: 3_292_196 }],
      tarifa_pax: conTarifa(
        { 'Aerolínea': 'SATENA', 'Origen': 'San Andrés Isla ADZ', 'Destino': 'Providencia PVA', 'Salida': '2026-11-23', 'Regreso': '2026-11-25', 'Nº de vuelo': '8832 · 8833', 'Escalas': '0' },
        [['adulto', 6, 2_877_222], ['nino', 1, 403_637], ['infante', 1, 11_337]],
      ),
    },
  ]

  const cot0006 = (over: Partial<ViajePDF> = {}): CotizacionPDFProps => {
    const items = LINEAS.map(l => ({
      nombre: l.nombre, descripcion: null, precio_venta: l.precio_venta, descuento_porcentaje: 0, cantidad: 1, unidad: null,
      precioPorPasajero: precioPorPasajeroDeItem(l),
    }))
    return props({
      cotizacion: { ...props().cotizacion, valor_total: 11_177_050 },
      items,
      dias: null,
      sugeridos: null,
      preciosPorPasajero: preciosPorPasajeroDelViaje(items),
      negocio: { nombre: 'San Andres - Providencia' },
      viaje: viaje({
        viajeros: '6 adultos, 1 nino y 1 infante',
        destino: 'San Andres - Providencia',
        fechas: '23 nov 2026 - 28 nov 2026',
        duracion: '6 dias / 5 noches',
        presentacion: null,
        fechaInicio: '2026-11-23',
        vuelos: vuelosDeItems(LINEAS.map(l => ({ nombre: l.nombre, grupo: l.grupo, tarifa_pax: l.tarifa_pax }))),
        hoteles: [],
        cargosEnDestino: [],
        ...over,
      }),
    })
  }

  it('1 · el vuelo de Avianca sale en la tabla de vuelos y en el día a día', async () => {
    const t = await texto(cot0006())
    // ⚠️ El renderizador parte la corrida después del dígito del día («28  nov»): se busca
    // con `\s+`. Día a día: el 23 abre con Avianca y el 28 es su regreso.
    expect(t).toMatch(/23 NOV Bogotá San Andrés Isla Avianca/)
    expect(t).toMatch(/28 NOV San Andrés Isla Bogotá Avianca/)
    // Tabla de vuelos: las dos filas de Avianca, cada una con su fecha y su número.
    expect(t).toMatch(/Avianca Bogotá San Andrés Isla Vuelo directo 23\s+nov 2026 9782/)
    expect(t).toMatch(/Avianca San Andrés Isla Bogotá Vuelo directo 28\s+nov 2026 9779/)
  })

  it('2 · cada número de vuelo va en SU fila: 8832 a la ida, 8833 al regreso', async () => {
    const t = await texto(cot0006())
    expect(t).not.toContain('8832 · 8833')
    expect(t).toMatch(/Providencia \(PVA\) Vuelo directo 23\s+nov 2026 8832/)
    expect(t).toMatch(/San Andrés Isla \(ADZ\) Vuelo directo 25\s+nov 2026 8833/)
  })

  it('2b · un solo número para ida y regreso no se pega a ninguna fila: va bajo el vuelo', async () => {
    const vuelos = cot0006().viaje!.vuelos.map(v => ({ ...v, numeroVuelo: v.aerolinea === 'SATENA' ? '8832' : null }))
    const t = await texto(cot0006({ vuelos }))
    expect(t).toContain('Vuelo 8832')
    // Sin número asignable a un tramo no hay columna VUELO.
    expect(t).not.toContain('FECHA VUELO')
  })

  it('3 · ⚠️⚠️ el redondeo no se cobra por el grupo, y la columna suma el TOTAL', async () => {
    const t = await texto(cot0006())
    expect(t).not.toContain('Se cobra por el grupo')
    expect(t).not.toContain('Ajuste por redondeo')
    expect(t).toContain('9.911.814')
    // Los 2 pesos del redondeo van al niño: 1.238.558 + 2.
    expect(t).toContain('1.238.560')
    expect(t).toContain('26.676')
    expect(t).toContain('11.177.050')
    expect(9_911_814 + 1_238_560 + 26_676).toBe(11_177_050)
  })

  it('3b · lo que de verdad se cobra por el grupo se sigue nombrando', async () => {
    const p = cot0006()
    const t = await texto({
      ...p,
      items: [...p.items, { nombre: 'SEGURO DE VIAJE', descripcion: null, precio_venta: 420_000, descuento_porcentaje: 0, cantidad: 1, unidad: null }],
      preciosPorPasajero: preciosPorPasajeroDelViaje([...p.items, { nombre: 'SEGURO DE VIAJE', precio_venta: 420_000, cantidad: 1 }]),
    })
    expect(t).toContain('Se cobra por el grupo: SEGURO DE VIAJE')
  })

  it('4 · «Incluido en el plan» no repite las dos líneas de «Inversión»', async () => {
    const t = await texto(cot0006())
    expect(t).not.toContain('Incluido en el plan')
    expect(t.split('SATENA ADZ - PROVIDENCIA').length - 1).toBe(1)
  })

  it('5 · con un solo destino igual al título, el capítulo no repite el título', async () => {
    // Sin vuelos ni fotos para contar limpio: el título (portada), la ficha DESTINO y,
    // antes del arreglo, el encabezado del capítulo.
    const solo = (nombre: string) => props({
      negocio: { nombre },
      sugeridos: null,
      viaje: viaje({ destino: 'Providencia', vuelos: [], hoteles: [], cargosEnDestino: [], presentacion: null, fechaInicio: '2026-11-23' }),
    })
    const t = await texto(solo('Providencia'))
    expect(t.split('Providencia').length - 1).toBe(2)
    // Si el título NO nombra el destino, el capítulo conserva su nombre.
    const u = await texto(solo('Luna de miel familia Porras'))
    expect(u.split('Providencia').length - 1).toBe(2)
  })

  it('5b · con varios destinos cada capítulo conserva su nombre y su «DESTINO N DE M»', async () => {
    const t = await texto(props({
      negocio: { nombre: 'Europa - Madrid y Roma' },
      viaje: viaje({
        destino: 'Madrid y Roma',
        vuelos: [],
        cargosEnDestino: [],
        hoteles: [
          { ...HOTEL, hotel: 'Hotel Metropolis', ciudad: 'Madrid', checkIn: '11 may 2027', checkOut: '14 may 2027' },
          { ...HOTEL, hotel: 'Hotel Navona', ciudad: 'Roma', checkIn: '14 may 2027', checkOut: '18 may 2027' },
        ],
      }),
    }))
    expect(t).toContain('DESTINO 1 DE 2 Madrid')
    expect(t).toContain('DESTINO 2 DE 2 Roma')
  })
})


/**
 * El texto para el cliente (2026-09-22): titular, presentación, «Incluido en el plan» y
 * «Antes de viajar», redactados por ONE y revisados por el equipo.
 *
 * Las props del viaje se arman con `textoParaElViaje`, la MISMA función que usa la acción
 * del PDF: así lo que se prueba es la regla completa («solo sale lo revisado»), no una
 * copia de ella.
 */
describe('el texto para el cliente', () => {
  const TEXTO = {
    titular: 'Cancun entre ruinas mayas y mar turquesa',
    intro: 'Cinco dias para descansar frente al Caribe y conocer Chichen Itza.',
    incluye: ['Tiquetes aereos con Avianca y articulo personal', 'Cuatro noches en el Crown Paradise con todo incluido'],
    antes_de_viajar: ['Lleve pasaporte vigente', 'Los impuestos del hotel se pagan alla'],
  }
  const doc = (revisado: boolean): DocumentoCliente => ({
    ...TEXTO,
    origen: 'ia',
    modelo: 'gemini-2.5-flash',
    redactado_en: '2026-09-22T20:00:00.000Z',
    fuente_hash: 'abc',
    revisado_por: revisado ? 'staff-1' : null,
    revisado_por_nombre: revisado ? 'Edgar' : null,
    revisado_en: revisado ? '2026-09-22T21:00:00.000Z' : null,
  })
  const conTexto = (d: DocumentoCliente | null) => props({ viaje: viaje(textoParaElViaje(d)) })

  it('revisado: el titular reemplaza al nombre del negocio en la portada', async () => {
    const t = await texto(conTexto(doc(true)))
    // El título es grande y parte renglón: el extractor deja un espacio doble en cada corte.
    expect(t).toMatch(/PROPUESTA DE VIAJE · COTIZACIÓN Cancun\s+entre ruinas mayas y\s+mar turquesa/)
    expect(t).not.toContain('familia Sanchez')
  })

  it('revisado: la presentación sale bajo el título', async () => {
    expect(await texto(conTexto(doc(true)))).toContain('descansar frente al Caribe y conocer Chichen Itza')
  })

  it('revisado: «Incluido en el plan» lista lo que el cliente recibe', async () => {
    const t = await texto(conTexto(doc(true)))
    expect(t).toContain('Incluido en el plan')
    expect(t).toContain('Tiquetes aereos con Avianca y articulo personal')
  })

  it('revisado: «Antes de viajar» sale en su recuadro', async () => {
    const t = await texto(conTexto(doc(true)))
    expect(t).toContain('Antes de viajar:')
    expect(t).toContain('Lleve pasaporte vigente')
  })

  it('⚠️⚠️ un borrador de ONE sin revisar no imprime NADA: el documento sale como sin texto', async () => {
    const borrador = await texto(conTexto(doc(false)))
    expect(borrador).not.toContain('ruinas mayas')
    expect(borrador).not.toContain('Lleve pasaporte vigente')
    expect(borrador).not.toContain('Incluido en el plan')
    expect(borrador).toBe(await texto(conTexto(null)))
  })

  it('persona natural: el cliente bajo el título sale una vez, no «Ligia Sanchez · Ligia Sanchez»', async () => {
    const t = await texto(props())
    expect(t).not.toContain('Ligia Sanchez · Ligia Sanchez')
    expect(t).toContain('Ligia Sanchez')
    const conEmpresa = await texto(props({ empresa: { ...props().empresa, nombre: 'Viajes Andinos SAS' } }))
    expect(conEmpresa).toContain('Ligia Sanchez · Viajes Andinos SAS')
  })

  it('R6 · las plantillas de los demás workspaces ignoran el texto: su salida no cambia un carácter', async () => {
    const base = props({ viaje: null })
    const conElTexto = props({ viaje: viaje(textoParaElViaje(doc(true))) })
    for (const plantilla of [CotizacionPDF, CotizacionTermotechPDF]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const render = async (p: CotizacionPDFProps) => textoDelPDF(Buffer.from(await renderToBuffer(createElement(plantilla, p) as any)))
      expect(await render(conElTexto)).toBe(await render(base))
    }
  }, 30_000)
})
