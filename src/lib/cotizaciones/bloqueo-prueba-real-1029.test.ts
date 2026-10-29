import { describe, expect, it } from 'vitest'

import aliadosHotel from './__fixtures__/bloqueo/aliados-hotel.json'
import { PROMPT_HOTEL_BLOQUEO, ESQUEMA_HOTEL_BLOQUEO, hotelDesdeLectura, incluyeDesdeLectura } from './bloqueo-extraccion'
import { edadesIniciales, edadesNinosDeLaSolicitud, paqueteVacio, type PaqueteBloqueo } from './bloqueo-paquete'
import { paquetesIncompletos } from './bloqueo-incompleto'
import { frenosDePaqueteYPasajero } from './frenos-de-paquete-y-pasajero'
import { listaUnica, type EntradaDeLista } from './lista-unica'
import { estadoDeLosPasos, sigue, type EntradaDePasos } from './por-pasos-vista'
import { motivosDeBorrador, textoDeMarca } from './motivos-borrador'
import { edadesMenoresDesdeFilas } from './viaje-negocio'

/**
 * Los cuatro defectos de la prueba real del bloqueo de Trappvel en producción (2026-10-29, tras el
 * #1324). El modelo es la respuesta ya devuelta (doble): ni llaves ni red. Datos ficticios.
 */

const GRUPO = 'paquete de bloqueo: Paquete de bloqueo en San Andrés'

function completo(): PaqueteBloqueo {
  const h = hotelDesdeLectura(aliadosHotel)
  if (!h.ok) throw new Error('fixture ilegible')
  const p: PaqueteBloqueo = { ...paqueteVacio('Aliados Travel'), hotel: h.hotel, incluye: h.incluye }
  p.hotel.precios = p.hotel.precios.filter(x => x.acomodacion === 'doble')
  p.hotel.nino = { precio: 900_000, edadMin: 2, edadMax: 11 }
  p.distribucion = { habitaciones: { doble: 2 }, ninos: 1, infantes: 0, edadesNinos: [7] }
  return p
}
const linea = (id: string, p: PaqueteBloqueo | null) => ({ id, nombre: 'OPCIÓN 1', grupo: GRUPO, es_ajuste: false, tarifa_pax: p ? { bloqueo: p } : null })
const VIAJE = { adultos: 4, ninos: 1, infantes: 0 }

describe('1 · el lector del hotel lee el INF y no confunde el seguro hotelero', () => {
  it('el prompt y el esquema piden el infante con su precio', () => {
    expect(PROMPT_HOTEL_BLOQUEO).toMatch(/INF 180\.000/)
    expect(ESQUEMA_HOTEL_BLOQUEO.properties).toHaveProperty('infante')
  })
  it('«INF 180.000» llena el precio por infante; «no paga» es 0; sin INF queda vacío', () => {
    const con = hotelDesdeLectura({ ...aliadosHotel, infante: { precio: 180000 } })
    expect(con.ok && con.hotel.infante).toEqual({ precio: 180000 })
    const gratis = hotelDesdeLectura({ ...aliadosHotel, infante: { precio: 0 } })
    expect(gratis.ok && gratis.hotel.infante).toEqual({ precio: 0 })
    const sin = hotelDesdeLectura({ ...aliadosHotel, infante: null })
    expect(sin.ok && sin.hotel.infante).toBeNull()
    const nulo = hotelDesdeLectura({ ...aliadosHotel, infante: { precio: null } })
    expect(nulo.ok && nulo.hotel.infante).toBeNull()
  })
  it('el prompt dice que el seguro hotelero NO es seguro médico', () => {
    expect(PROMPT_HOTEL_BLOQUEO).toMatch(/seguro hotelero/)
    expect(PROMPT_HOTEL_BLOQUEO).toMatch(/NO es seguro médico/)
  })
  it('el texto que solo dice «seguro hotelero» no marca seguro médico, aunque el modelo lo diga', () => {
    const r = incluyeDesdeLectura({ iconos: [], incluye_por_texto: ['seguro_medico', 'traslados'], texto_incluye: 'Incluye traslados in y out y seguro hotelero' })
    expect(r.casillas.seguro_medico).toBeNull()
    expect(r.casillas.traslados).toBe(true)
  })
  it('el texto con asistencia médica sí lo marca, aunque también nombre el seguro hotelero', () => {
    const r = incluyeDesdeLectura({ iconos: [], incluye_por_texto: ['seguro_medico'], texto_incluye: 'Seguro hotelero y asistencia médica' })
    expect(r.casillas.seguro_medico).toBe(true)
  })
  it('un ícono descrito como seguro hotelero no marca seguro médico', () => {
    const r = incluyeDesdeLectura({ iconos: [{ descripcion: 'escudo de seguro hotelero', categoria: 'seguro_medico', seguro: true }], incluye_por_texto: [] })
    expect(r.casillas.seguro_medico).toBe(false)
  })
})

describe('2 · la barra de pasos usa la misma revisión que la lista', () => {
  const baseLista: EntradaDeLista = {
    sinPrecio: [], capturas: null, tarifas: [], salida: null,
    pantallazosPorAceptar: 0, texto: 'ok', noVan: [], faltaDia: null, margenBajoAviso: null, recargo: null, viaje: null, ivaSinCalcular: null,
  }
  const entradaPasos = (rojos: number, primerImpide: string | null): EntradaDePasos & { pasoActual: 1 | 2 | 3 } => ({
    servicios: 1, conOpciones: 0, pantallazosPorAceptar: 0, leyendo: 0, sinCosto: [], bajoMinimo: [], tarifasVistas: true,
    vanAlCliente: ['Recomendada'], rojos, ambar: 0, texto: 'ok', enviada: false, primerImpide, pasoActual: 1,
  })

  // Un paquete por cada motivo de `faltasDelPaquete`.
  const casos: Array<[string, () => { p: PaqueteBloqueo | null; viaje: typeof VIAJE }]> = [
    ['falta_costo', () => ({ p: null, viaje: VIAJE })],
    ['infantes', () => ({ p: completo(), viaje: { ...VIAJE, infantes: 1 } })],
    ['nino_sin_edad', () => { const p = completo(); p.distribucion.edadesNinos = []; return { p, viaje: VIAJE } }],
    ['nino_fuera_de_rango', () => { const p = completo(); p.distribucion.edadesNinos = [13]; return { p, viaje: VIAJE } }],
    ['acomodacion_sin_precio', () => { const p = completo(); p.hotel.precios.push({ acomodacion: 'triple', precioPorPersona: null }); return { p, viaje: VIAJE } }],
  ]
  for (const [clave, armar] of casos) {
    it(`${clave}: la lista frena, «Sigue:» dice lo mismo y nunca «Todo listo»; el envío frena igual`, () => {
      const { p, viaje } = armar()
      const items = [linea('pq-1', p)]
      const paquetes = paquetesIncompletos(items, null, viaje)
      expect(paquetes[0].faltas[0].clave).toBe(clave)
      const lista = listaUnica({ ...baseLista, paquetes })
      expect(lista.impide[0].clave).toBe('paquete-incompleto')
      const e = entradaPasos(lista.impide.length, lista.impide[0].texto)
      const s = sigue(e)
      expect(s.texto).not.toMatch(/Todo listo/)
      expect(s.texto).toBe(lista.impide[0].texto)
      expect(estadoDeLosPasos(e)[3].tono).toBe('error')
      // `enviarPorPasos` y el PDF frenan con el mismo texto.
      const frenos = frenosDePaqueteYPasajero({ items, tarifas: [], composicion: viaje, conPrecioPorPasajero: true })
      expect(frenos.paquete).toBe(lista.impide[0].texto)
    })
  }
  it('el caso real: un niño sin edad ya no deja la barra en «Todo listo»', () => {
    const p = completo()
    p.distribucion.edadesNinos = []
    const lista = listaUnica({ ...baseLista, paquetes: paquetesIncompletos([linea('pq-1', p)], null, VIAJE) })
    const s = sigue(entradaPasos(lista.impide.length, lista.impide[0].texto))
    expect(s.texto).toBe('Paquete «Hotel Cartagena Dubai» incompleto: Falta la edad de un niño.')
  })
  it('cualquier otro rojo de la lista (la autorización de datos) también frena la barra', () => {
    const lista = listaUnica({ ...baseLista, autorizacionDatos: 'Falta la autorización de datos del cliente.' })
    expect(sigue(entradaPasos(lista.impide.length, lista.impide[0].texto)).texto).toBe('Falta la autorización de datos del cliente.')
  })
  it('sin rojos, «Todo listo» como siempre', () => {
    expect(sigue(entradaPasos(0, null)).texto).toMatch(/^Todo listo/)
  })
})

describe('3 · la edad del niño viene de la Solicitud', () => {
  it('«8 años» con un niño → [8]', () => {
    expect(edadesNinosDeLaSolicitud('8 años', { ninos: 1, infantes: 0 })).toEqual([8])
  })
  it('«9, 4» y números sueltos', () => {
    expect(edadesNinosDeLaSolicitud('9, 4', { ninos: 2, infantes: 0 })).toEqual([9, 4])
    expect(edadesNinosDeLaSolicitud(8, { ninos: 1, infantes: 0 })).toEqual([8])
  })
  it('con un infante en el viaje, la edad bajo 2 años es la suya, no la del niño', () => {
    expect(edadesNinosDeLaSolicitud('7, 1.5', { ninos: 1, infantes: 1 })).toEqual([7])
  })
  it('a lo sumo tantas edades como niños; nada legible → []', () => {
    expect(edadesNinosDeLaSolicitud('5, 8, 10', { ninos: 2, infantes: 0 })).toEqual([5, 8])
    expect(edadesNinosDeLaSolicitud(null, { ninos: 1, infantes: 0 })).toEqual([])
    expect(edadesNinosDeLaSolicitud('sin dato', { ninos: 1, infantes: 0 })).toEqual([])
  })
  it('de las filas de `negocio_bloques`: la primera con valor', () => {
    expect(edadesMenoresDesdeFilas([{ edades_menores: null }, { edades_menores: '8 años' }])).toBe('8 años')
    expect(edadesMenoresDesdeFilas([{ edades_menores: 8 }])).toBe('8')
    expect(edadesMenoresDesdeFilas([{ edades_menores: '  ' }, {}])).toBeNull()
  })
  it('las guardadas en el paquete mandan; sin ellas, las de la Solicitud', () => {
    expect(edadesIniciales([5], [8])).toEqual([5])
    expect(edadesIniciales([], [8])).toEqual([8])
    expect(edadesIniciales(undefined, null)).toEqual([])
  })
})

describe('4 · si «Enviar» frena, el PDF lleva la marca', () => {
  it('los tres frenos nuevos tienen su motivo, en el orden del envío', () => {
    const m = motivosDeBorrador({ autorizacionDatos: true, precioPorPasajero: true, paqueteIncompleto: true, pantallazos: false, sinRecomendada: false, margen: false, ivaSinCalcular: false, ivaIncluidoSinPlantilla: false })
    expect(m).toEqual(['autorizacion_datos', 'precio_por_pasajero', 'paquete_incompleto'])
    expect(textoDeMarca(['autorizacion_datos'])).toBe('BORRADOR · falta la autorización de datos · no enviar')
    expect(textoDeMarca(['paquete_incompleto'])).toBe('BORRADOR · paquete incompleto · no enviar')
  })
  it('sin las condiciones nuevas, los motivos de siempre no cambian', () => {
    expect(motivosDeBorrador({ pantallazos: false, sinRecomendada: false, margen: true, ivaSinCalcular: false, ivaIncluidoSinPlantilla: false })).toEqual(['margen'])
  })
  it('P12 solo cuenta si quien llama dice que es por pasos (el PDF no mira el interruptor)', () => {
    const f = frenosDePaqueteYPasajero({ items: [linea('pq-1', completo())], tarifas: [], composicion: VIAJE, conPrecioPorPasajero: false })
    expect(f).toEqual({ precioPorPasajero: null, paquete: null })
  })
})
