import type { CotizacionPDFProps, ViajePDF } from '@/lib/pdf/cotizacion-props'
import type { HotelPDF, VueloPDF } from '@/lib/cotizaciones/detalle-viaje'
import type { EntradaModeloPropuesta } from '@/lib/cotizaciones/propuesta/modelo-documento'
import { fotosDeCiudad } from '@/lib/pdf/fotos-ciudad'
import { firmaConLaAsesora, pieConLaAsesora } from '@/lib/cotizaciones/propuesta/asesora'
import { VERSIONES, type BorradorCotizacion, type Version } from './borrador'
import type { Validado, Viajeros } from './invariantes'

/**
 * Del borrador validado a la entrada de la plantilla real (`pdfDePropuestaHtml`). Lo que pone la casa
 * (asesora, pie, firma, términos, plan de pagos) llega en `casa`: en ONE vive en la configuración del
 * workspace, no lo decide el modelo.
 */

export interface Casa {
  marca: string
  vendedor: { nombre: string; razon_social: string; nit: string; color_primario: string }
  asesora: { nombre: string; cargo: string; celular: string; whatsapp: string }
  pie: string
  firma: { cargo: string; nombre: string; contacto: string }
  reglaPagos: { pct_minimo: number; dias_antes: number; anticipo_pct: number }
  terminos: string[]
}

export interface Solicitud {
  consecutivo: string
  cliente: string
  destino: string
  viajeros: Viajeros
  ciudadOrigen: string
  hoy: string
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
export function fechaCorta(iso: string): string {
  const [a, m, d] = iso.split('-').map(Number)
  return `${d} ${MESES[m - 1]} ${a}`
}

export function textoViajeros(v: Viajeros): string {
  const partes = [`${v.adultos} ${v.adultos === 1 ? 'adulto' : 'adultos'}`]
  if (v.ninos.length) partes.push(`${v.ninos.length} ${v.ninos.length === 1 ? 'niño' : 'niños'}`)
  return partes.join(' y ')
}

// Índice de la versión en `itinerarios` (la plantilla imprime «Premium» como «Superior»).
const NOMBRE_ITINERARIO: Record<Version, string> = { Económica: 'Económica', Recomendada: 'Recomendada', Superior: 'Premium' }

export function entradaDePropuesta(
  b: BorradorCotizacion,
  v: Validado,
  s: Solicitud,
  casa: Casa,
  fotos: Map<number, { url: string; proporcion: number }>,
): EntradaModeloPropuesta {
  const versiones = VERSIONES.filter(x => v.totales[x] !== undefined)
  const idx = (x: Version) => versiones.indexOf(x)
  const todas = versiones.map((_, i) => i)
  const ida = b.vuelos[0], regreso = b.vuelos[b.vuelos.length - 1]
  const noches = v.noches ?? 0

  const vuelos: VueloPDF[] = b.vuelos.map(t => ({
    linea: t === ida ? t.aerolinea.toUpperCase() : `${t.aerolinea.toUpperCase()} REGRESO`,
    aerolinea: t.aerolinea,
    origen: `${t.origenCiudad} ${t.origenIata}`,
    destino: `${t.destinoCiudad} ${t.destinoIata}`,
    fechaSalida: fechaCorta(t.fecha), fechaRegreso: null,
    horaSalida: t.salida, horaLlegada: t.llegada,
    horaSalidaRegreso: null, horaLlegadaRegreso: null, escalaIda: null, escalaRegreso: null,
    escalas: t.escalas, tarifa: null, equipaje: null, adicionales: [],
    numeroVuelo: t.numero, tarifas: todas,
  }) as VueloPDF)

  const hoteles: HotelPDF[] = versiones.map(x => {
    const h = b.hoteles.find(y => y.version === x)!
    return {
      linea: 'HOTEL', hotel: h.nombre, ciudad: b.destino, habitacion: h.habitacion, regimen: h.regimen,
      checkIn: fechaCorta(ida.fecha), checkOut: fechaCorta(regreso.fecha), noches: h.noches,
      ocupacion: textoViajeros(s.viajeros), cancelacion: null, estrellas: null, localizador: null, adicionales: [],
      zona: h.zona, incluye: h.incluye, foto: fotos.get(h.pantallazo) ?? null, tarifas: [idx(x)],
    } as HotelPDF
  })

  const linea = (nombre: string, precio: number) => ({ nombre, descripcion: null, precio_venta: precio, descuento_porcentaje: 0, cantidad: 1, unidad: null })
  const itinerarios = versiones.map(x => {
    const h = b.hoteles.find(y => y.version === x)!
    const total = v.totales[x] as number
    const items = [linea(`Paquete ${b.destino}: ${h.nombre}, ${h.noches} noches, ${h.regimen.toLowerCase()} + vuelo ${ida.aerolinea}, ${textoViajeros(s.viajeros)}`, total)]
    return { nombre: NOMBRE_ITINERARIO[x], esPrincipal: x === 'Recomendada', precio: total, items }
  })
  const principal = itinerarios.find(i => i.esPrincipal) ?? itinerarios[0]

  const asesora = { nombre: casa.asesora.nombre, cargo: casa.asesora.cargo, correo: null, celular: casa.asesora.celular }
  const ciudad = fotosDeCiudad(b.destino)
  const viaje: ViajePDF = {
    titular: b.titular, intro: b.intro, incluye: b.incluye, noIncluye: b.noIncluye, antesDeViajar: b.antesDeViajar,
    viajeros: textoViajeros(s.viajeros), destino: b.destino,
    fechas: `${fechaCorta(ida.fecha)} – ${fechaCorta(regreso.fecha)}`,
    duracion: `${noches + 1} días · ${noches} noches`,
    presentacion: null,
    foto: ciudad[0] ? { url: ciudad[0].ruta, rotulo: ciudad[0].rotulo, credito: ciudad[0].credito, foco: ciudad[0].foco, proporcion: ciudad[0].proporcion } as never : null,
    fotosCiudades: [], fechaInicio: ida.fecha, vuelos, hoteles, cargosEnDestino: [], nivelDetalle: 'normal',
    pie: pieConLaAsesora(casa.pie, asesora), firma: firmaConLaAsesora(casa.firma, asesora),
  } as ViajePDF

  const total = principal.precio
  const props = {
    cotizacion: {
      consecutivo: s.consecutivo, descripcion: b.titular, valor_total: total, modo: 'detallada',
      fecha_envio: null, fecha_validez: null, condiciones_pago: null, notas: null,
      descuento_porcentaje: 0, descuento_valor: 0, terminos_condiciones: casa.terminos.join('\n'),
    },
    empresa: { nombre: s.cliente, nit: null, contacto_nombre: s.cliente, contacto_email: null, telefono: null, direccion: null, ciudad: null },
    vendedor: { ...casa.vendedor, logo_url: null, telefono: null, email: null, direccion: null, ciudad: null },
    items: principal.items, itinerarios,
    dias: null, itemsSinDia: null, sugeridos: [], preciosPorPasajero: null,
    fiscal: { subtotal: total, iva: 0, reteFuente: 0, reteICA: 0, reteIVA: 0, totalBruto: total, totalRetenciones: 0, teQueda: total },
    negocio: { nombre: s.destino.toUpperCase() }, emisor: null, viaje,
    asiPuedesPagar: { fechaSalida: ida.fecha, hoy: s.hoy, regla: casa.reglaPagos },
  } as unknown as CotizacionPDFProps

  return {
    props, servicios: [], menoresAutorizados: false, anticipo: null,
    asesora: { nombre: casa.asesora.nombre, whatsapp: casa.asesora.whatsapp },
    cliente: { contacto: s.cliente, empresa: s.cliente, tipoPersona: 'natural' },
    numeroDeViajeros: s.viajeros.adultos + s.viajeros.ninos.length,
  }
}
