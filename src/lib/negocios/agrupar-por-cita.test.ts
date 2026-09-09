import { describe, expect, it } from 'vitest'
import {
  agruparPorCita,
  ETIQUETA_ESPERANDO,
  GRUPO_CITA_ESPERANDO,
  GRUPO_CITA_VENCIDA,
  GRUPO_SIN_CITA,
} from './agrupar-por-cita'

const HOY = '2026-09-09'

type N = { id: string; fecha_cita?: string | null; cita_pendiente?: boolean }

const lista: N[] = [
  { id: 'manana-tarde', fecha_cita: '2026-09-10T14:00' },
  { id: 'esperando', fecha_cita: null, cita_pendiente: true },
  { id: 'vencida-vieja', fecha_cita: '2026-08-06' },
  { id: 'hoy', fecha_cita: '2026-09-09T08:00' },
  { id: 'sin-cita', fecha_cita: null, cita_pendiente: false },
  { id: 'manana-temprano', fecha_cita: '2026-09-10T07:00' },
  { id: 'vencida-ayer', fecha_cita: '2026-09-08T09:00' },
  { id: 'lejana', fecha_cita: '2026-10-03' },
]

describe('agruparPorCita', () => {
  it('pone las vencidas primero, los dias ascendentes en medio y los sin fecha al final', () => {
    const grupos = agruparPorCita(lista, HOY)
    expect(grupos.map((g) => g.dia)).toEqual([
      GRUPO_CITA_VENCIDA,
      '2026-09-09',
      '2026-09-10',
      '2026-10-03',
      GRUPO_CITA_ESPERANDO,
      GRUPO_SIN_CITA,
    ])
  })

  it('rotula los dias como los lee la operacion', () => {
    const grupos = agruparPorCita(lista, HOY)
    expect(grupos.map((g) => g.etiqueta)).toEqual([
      'Cita vencida',
      'Hoy',
      'Mañana',
      'Sáb 3 oct',
      ETIQUETA_ESPERANDO,
      'Sin cita registrada',
    ])
  })

  it('dentro del dia manda la hora: la de las 7 antes que la de las 14', () => {
    const grupos = agruparPorCita(lista, HOY)
    const manana = grupos.find((g) => g.dia === '2026-09-10')
    expect(manana?.items.map((n) => n.id)).toEqual(['manana-temprano', 'manana-tarde'])
  })

  it('entre las vencidas, la mas reciente arriba: la de ayer todavia se remonta', () => {
    const [vencidas] = agruparPorCita(lista, HOY)
    expect(vencidas.items.map((n) => n.id)).toEqual(['vencida-ayer', 'vencida-vieja'])
  })

  // ⚠️ La razon de ser de la pantalla. Medido en produccion el 9-sep-2026: 46
  // negocios abiertos en Notificacion, los 46 con via de solicitud registrada y
  // ninguno con fecha. Si el orden por cita solo mostrara a los que tienen fecha,
  // quedarian invisibles justo aqui.
  it('separa "esperando la fecha" de "este negocio no va a ir a la DIAN"', () => {
    const grupos = agruparPorCita(lista, HOY)
    const esperando = grupos.find((g) => g.dia === GRUPO_CITA_ESPERANDO)
    const sinCita = grupos.find((g) => g.dia === GRUPO_SIN_CITA)
    expect(esperando?.items.map((n) => n.id)).toEqual(['esperando'])
    expect(sinCita?.items.map((n) => n.id)).toEqual(['sin-cita'])
  })

  it('una cita de HOY que ya paso de hora sigue siendo de hoy, no vencida', () => {
    // El corte es por DIA civil, no por instante: una cita de hoy a las 8:00 vista
    // a las 15:00 no se manda al grupo de las vencidas a media jornada.
    const grupos = agruparPorCita([{ id: 'hoy', fecha_cita: '2026-09-09T08:00' }], HOY)
    expect(grupos.map((g) => g.dia)).toEqual(['2026-09-09'])
  })

  it('un valor heredado de solo dia encabeza su dia, sin hora inventada', () => {
    const grupos = agruparPorCita(
      [
        { id: 'con-hora', fecha_cita: '2026-09-26T09:30' },
        { id: 'solo-dia', fecha_cita: '2026-09-26' },
      ],
      HOY,
    )
    expect(grupos[0].items.map((n) => n.id)).toEqual(['solo-dia', 'con-hora'])
  })

  it('una fecha ilegible no es una cita: cae en el grupo de los que no tienen', () => {
    const grupos = agruparPorCita([{ id: 'x', fecha_cita: 'pendiente' }], HOY)
    expect(grupos.map((g) => g.dia)).toEqual([GRUPO_SIN_CITA])
  })

  it('no pierde ni duplica negocios', () => {
    const grupos = agruparPorCita(lista, HOY)
    const ids = grupos.flatMap((g) => g.items.map((n) => n.id))
    expect(ids.sort()).toEqual(lista.map((n) => n.id).sort())
  })

  it('no crea grupos vacios ni con una lista vacia', () => {
    expect(agruparPorCita([], HOY)).toEqual([])
    const soloFuturas = agruparPorCita([{ id: 'a', fecha_cita: '2026-09-20' }], HOY)
    expect(soloFuturas.map((g) => g.dia)).toEqual(['2026-09-20'])
  })

  it('no muta la lista que recibe', () => {
    const copia = [...lista]
    agruparPorCita(lista, HOY)
    expect(lista).toEqual(copia)
  })
})
