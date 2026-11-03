import { describe, expect, it } from 'vitest'

import { leerTramos, regresoEsLaLlegadaDeLaIda, tramosDeCampos } from './tramos-vuelo'
import { tramosDelItem } from './detalle-viaje'

/**
 * M9-3 (QA de punta a punta del 2026-10-29, viaje 09): el Iberia BOG→MAD de solo ida sale
 * 16:55 del 1-jul y llega 08:45 del 2-jul. La lectura tomó la llegada (+1 día) como «Regreso
 * 2027-07-02» y copió las horas de la ida al regreso: ONE imprimió un «MADRID 16:55 → BOGOTÁ
 * 08:45» que nadie pidió (PDF, día a día, servicio y recordatorio de check-in).
 *
 * La firma del fantasma: regreso = salida + 1 día, la ida llega antes de la hora a la que sale
 * (vuelo nocturno) y el regreso no trae horas propias (vacías o las mismas de la ida).
 */

const campos = (d: Record<string, string>) => (slug: string) => d[slug]

// Lo que leyó la captura del viaje 09 (`items.tramos` del ítem 46824e19…, SELECT del 2026-10-29).
const IBERIA_NOCTURNO = {
  origen: 'Bogotá', destino: 'Madrid',
  fecha_salida: '2027-07-01', hora_salida: '16:55', hora_llegada: '08:45',
  fecha_regreso: '2027-07-02', hora_salida_regreso: '16:55', hora_llegada_regreso: '08:45',
  numero_vuelo: 'IB 6584', escalas: '0',
}

describe('M9-3 · un vuelo nocturno de solo ida no inventa regreso', () => {
  it('Iberia BOG→MAD nocturno: un solo tramo, con su número', () => {
    const { tramos, numerosSinTramo } = tramosDeCampos(campos(IBERIA_NOCTURNO))
    expect(tramos).toHaveLength(1)
    expect(tramos[0]).toMatchObject({ sentido: 'ida', fecha: '2027-07-01', salida: '16:55', llegada: '08:45', numero: 'IB6584' })
    expect(numerosSinTramo).toBeNull()
  })

  it('también cuando la lectura dejó el regreso sin horas, o la fecha sin año', () => {
    const sinHoras = { ...IBERIA_NOCTURNO, hora_salida_regreso: '', hora_llegada_regreso: '' }
    expect(tramosDeCampos(campos(sinHoras)).tramos).toHaveLength(1)
    const sinAnio = { ...IBERIA_NOCTURNO, fecha_salida: '--07-01/jue', fecha_regreso: '--07-02/vie' }
    expect(tramosDeCampos(campos(sinAnio)).tramos).toHaveLength(1)
    const finDeMes = { ...IBERIA_NOCTURNO, fecha_salida: '2027-06-30', fecha_regreso: '2027-07-01' }
    expect(tramosDeCampos(campos(finDeMes)).tramos).toHaveLength(1)
  })

  it('los tramos ya guardados con el regreso fantasma se leen sin él', () => {
    const guardados = tramosDeCampos(campos({ ...IBERIA_NOCTURNO, numero_vuelo: '' }))
    // Lo que quedó en la base antes del arreglo: dos tramos, el segundo copiado de la ida.
    const viejo = [
      { sentido: 'ida', origen: 'Bogotá', destino: 'Madrid', fecha: '2027-07-01', salida: '16:55', llegada: '08:45', numero: null, escala: null, directo: true, equipaje: guardados.tramos[0].equipaje },
      { sentido: 'regreso', origen: 'Madrid', destino: 'Bogotá', fecha: '2027-07-02', salida: '16:55', llegada: '08:45', numero: null, escala: null, directo: null, equipaje: guardados.tramos[0].equipaje },
    ]
    const leidos = leerTramos(viejo)
    expect(leidos).toHaveLength(1)
    expect(leidos?.[0].sentido).toBe('ida')
  })

  it('el ítem guardado recupera el número de la ida desde la lectura', () => {
    const viejo = [
      { sentido: 'ida', origen: 'Bogotá', destino: 'Madrid', fecha: '2027-07-01', salida: '16:55', llegada: '08:45', numero: null, escala: null, directo: true, equipaje: { personal: null, mano: null, bodega: null } },
      { sentido: 'regreso', origen: 'Madrid', destino: 'Bogotá', fecha: '2027-07-02', salida: '16:55', llegada: '08:45', numero: null, escala: null, directo: null, equipaje: { personal: null, mano: null, bodega: null } },
    ]
    const { tramos } = tramosDelItem({ tramos: viejo } as never, IBERIA_NOCTURNO)
    expect(tramos).toHaveLength(1)
    expect(tramos[0].numero).toBe('IB6584')
  })

  it('un regreso real no se toca: otro día, otras horas, o una ida que no es nocturna', () => {
    // Ida y vuelta de verdad a la semana.
    expect(tramosDeCampos(campos({ ...IBERIA_NOCTURNO, fecha_regreso: '2027-07-15' })).tramos).toHaveLength(2)
    // Regreso al día siguiente con horas propias.
    expect(tramosDeCampos(campos({ ...IBERIA_NOCTURNO, hora_salida_regreso: '11:30', hora_llegada_regreso: '14:50' })).tramos).toHaveLength(2)
    // Ida de día (llega después de salir): un regreso al día siguiente es plausible.
    expect(tramosDeCampos(campos({
      origen: 'Bogotá', destino: 'Medellín', fecha_salida: '2026-11-12', hora_salida: '06:00', hora_llegada: '07:00',
      fecha_regreso: '2026-11-13',
    })).tramos).toHaveLength(2)
    // Sin horas de la ida no se puede saber: se respeta lo leído.
    expect(regresoEsLaLlegadaDeLaIda({ fecha: '2027-07-01', salida: null, llegada: null }, { fecha: '2027-07-02', salida: null, llegada: null })).toBe(false)
  })
})
