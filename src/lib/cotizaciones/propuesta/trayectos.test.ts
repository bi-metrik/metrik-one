/**
 * Los traslados como los escribe la captura (formas vistas en la COT-2026-0026 real del
 * 2026-10-14), partidos en los trayectos que ve el cliente. Textos de muestra.
 */
import { describe, expect, it } from 'vitest'
import { trayectosDeTraslado, vehiculoLegible } from './trayectos'
import { serviciosDelDocumento } from './servicios-del-documento'

const leer = (trayecto: string, vehiculo: string | null, fecha: string | null) => trayectosDeTraslado({ trayecto, vehiculo, fecha })

describe('trayectosDeTraslado', () => {
  it('«A -> hotel y hotel -> B» con dos fechas: dos trayectos, cada uno con su día', () => {
    expect(
      leer('Aeropuerto Madrid-Barajas (MAD) T4 -> Hotel en el centro de Madrid y Hotel en el centro de Madrid -> Estación Madrid Puerta de Atocha', 'Van privada', '2026-12-11 y 2026-12-14'),
    ).toEqual([
      { descripcion: 'Aeropuerto Madrid-Barajas (MAD) T4 - hotel · Van privada', fecha: '11 dic 2026', hora: null },
      { descripcion: 'hotel - Estación Madrid Puerta de Atocha · Van privada', fecha: '14 dic 2026', hora: null },
    ])
  })

  it('el renglón del medio («hotel y hotel») es el final de uno y el comienzo del otro', () => {
    expect(leer('Gare de Lyon \n hotel y hotel \n Gare du Nord', 'Van privada', '2026-12-17 y 2026-12-21').map((t) => [t.descripcion, t.fecha])).toEqual([
      ['Gare de Lyon - hotel · Van privada', '17 dic 2026'],
      ['hotel - Gare du Nord · Van privada', '21 dic 2026'],
    ])
  })

  it('con una sola fecha, el de vuelta queda sin día y lleva la del de ida para deducirla', () => {
    const t = leer('Amsterdam Centraal \n hotel y hotel \n aeropuerto Schiphol (AMS)', null, '2026-12-21')
    expect(t[0]).toEqual({ descripcion: 'Amsterdam Centraal - hotel', fecha: '21 dic 2026', hora: null })
    expect(t[1]).toEqual({ descripcion: 'hotel - aeropuerto Schiphol (AMS)', fecha: null, hora: null, fechaIda: '21 dic 2026' })
  })

  it('«(ida y vuelta)»: el trayecto y su regreso', () => {
    expect(leer('Estación Barcelona Sants - Hotel en Barcelona (ida y vuelta)', 'Minibús compartido', '2026-12-14 y 2026-12-17').map((t) => [t.descripcion, t.fecha])).toEqual([
      ['Estación Barcelona Sants - hotel · Minibús compartido', '14 dic 2026'],
      ['hotel - Estación Barcelona Sants · Minibús compartido', '17 dic 2026'],
    ])
  })

  it('el tren leído: sin «Tren:» ni «Clase / tarifa:», y con la hora de la fecha', () => {
    expect(leer('Paris Nord -> Amsterdam Centraal', 'Tren: Eurostar 9325, Clase / tarifa: Eurostar Standard', '2026-12-21/lun 10:25')).toEqual([
      { descripcion: 'Paris Nord - Amsterdam Centraal · Eurostar 9325, Eurostar Standard', fecha: '21 dic 2026', hora: '10:25' },
    ])
    expect(vehiculoLegible('Tren: TGV INOUI 9714, 2ª clase Seconde')).toBe('TGV INOUI 9714, 2ª clase Seconde')
  })

  it('el tren escrito a mano en una línea: servicio, extremos, hora y clase; «(solo ida)» fuera', () => {
    expect(leer('Tren AVE 03071 Renfe: Madrid Puerta de Atocha 09:30 → Barcelona Sants 12:15 (Estándar) (solo ida)', null, '2026-12-14')).toEqual([
      { descripcion: 'Madrid Puerta de Atocha - Barcelona Sants · AVE 03071 Renfe, Estándar', fecha: '14 dic 2026', hora: '09:30' },
    ])
  })

  it('lo que no se reconoce sale como antes: un trayecto con lo leído', () => {
    expect(leer('Recogida en el puerto', 'Bus', null)).toEqual([{ descripcion: 'Recogida en el puerto · Bus', fecha: null, hora: null }])
    expect(leer('AEROPUERTO - HOTEL', null, null)).toEqual([{ descripcion: 'AEROPUERTO - HOTEL', fecha: null, hora: null }])
  })
})

describe('serviciosDelDocumento con un traslado de ida y vuelta', () => {
  const casilla = (campos: { label: string; valor: string }[]) => ({
    casillas: { grupo_completo: { campos, nombre: 'x', total: 1, moneda: 'COP', alertas: [], porTipo: [], leidaEn: '2026-10-13T00:00:00.000Z' } },
  })
  it('cuenta los trayectos, no las líneas; el día asignado es el del primero', () => {
    const item = {
      nombre: 'TRASLADO',
      grupo: 'traslado: Traslado en París',
      tarifa_pax: casilla([
        { label: 'Trayecto', valor: 'Gare de Lyon \n hotel y hotel \n Gare du Nord' },
        { label: 'Vehículo', valor: 'Van privada' },
        { label: 'Fecha', valor: '2026-12-17 y 2026-12-21' },
      ]),
    }
    const s = serviciosDelDocumento([item], '2026-12-10')
    expect(s.map((x) => [x.descripcion, x.fecha])).toEqual([
      ['Gare de Lyon - hotel · Van privada', '17 dic 2026'],
      ['hotel - Gare du Nord · Van privada', '21 dic 2026'],
    ])
    const conDia = serviciosDelDocumento([{ ...item, dia_relativo: 9, tarifas: [1] }], '2026-12-10')
    expect(conDia[0].fecha).toBe('18 dic 2026')
    expect(conDia.every((x) => x.tarifas?.[0] === 1)).toBe(true)
  })
})
