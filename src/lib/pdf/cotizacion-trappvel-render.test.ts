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
  numeroVuelo: '9459 4867 9842 9488',
  escalaIda: 'Bogota BOG',
  escalaRegreso: 'Bogota BOG',
  escalas: 1,
  tarifa: 'BASIC Standard economy',
  equipaje: 'articulo personal',
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
  preciosPorPasajero: { filas: [{ tipo: 'adulto', precioUnitario: 641_507 }], sinReparto: ['HOTEL CROWN PARADISE'] },
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

  it('imprime la tabla de vuelos con códigos IATA, número de vuelo y escala', async () => {
    const t = await texto(props())
    expect(t).toContain('Avianca')
    expect(t).toContain('CUC')
    expect(t).toContain('AXM')
    expect(t).toContain('9459')
    expect(t).toContain('Bogota BOG')
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
    expect(t).toContain('No incluye lo que se cobra por el grupo')
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
    expect(t).not.toContain('Cancelacion gratuita')
  })

  it('«general» recorta la descripción y el detalle de precios por línea', async () => {
    const t = await texto(props({ viaje: viaje({ nivelDetalle: 'general' }) }))
    expect(t).not.toContain('Standard Double')
    expect(t).not.toContain('BASIC Standard economy')
    expect(t).not.toContain('articulo personal')
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
