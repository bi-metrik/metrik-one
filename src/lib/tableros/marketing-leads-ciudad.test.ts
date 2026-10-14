import { describe, expect, it } from 'vitest'
import { leadsConCiudad, type InteraccionMeta } from './marketing-leads-ciudad'
import {
  CIUDADES_NOMBRADAS,
  OTRAS_CIUDADES,
  SIN_CIUDAD,
  lenteCohorte,
  lenteMes,
  leadsPorCiudad,
  type FilaMarketing,
} from './marketing'

const CAMPO = '¿en_qué_ciudad_reside?'
const it_ = (
  contactoId: string,
  campaignId: string,
  ocurridaAt: string,
  ciudad?: string,
): InteraccionMeta => ({
  contactoId,
  campaignId,
  ocurridaAt,
  createdAt: null,
  fieldData: [
    { name: 'full_name', values: ['X'] },
    ...(ciudad === undefined ? [] : [{ name: CAMPO, values: [ciudad] }]),
  ],
})

describe('leadsConCiudad', () => {
  it('un lead es un contacto por campaña, en el mes de Bogotá de su primera interacción', () => {
    const leads = leadsConCiudad([
      // 1-sep 03:00 UTC es 31-ago en Bogotá: cuenta en agosto, como en la vista.
      it_('c1', 'A', '2026-09-01T03:00:00Z', 'Cali'),
      it_('c1', 'A', '2026-09-20T15:00:00Z', 'Cali'),
      it_('c1', 'B', '2026-09-20T15:00:00Z', 'Cali'),
    ])
    expect(leads).toHaveLength(2)
    expect(leads.find(l => l.campaignId === 'A')?.mes).toBe('2026-08-01')
    expect(leads.find(l => l.campaignId === 'B')?.mes).toBe('2026-09-01')
  })

  it('un lead sin campo de ciudad cae en «Sin ciudad»', () => {
    const [l] = leadsConCiudad([it_('c1', 'A', '2026-09-02T15:00:00Z')])
    expect(l.ciudad).toBeNull()
    const lc = leadsPorCiudad([], [l], null)
    expect(lc.totales[SIN_CIUDAD]).toBe(1)
  })

  it('manda la ciudad de la primera interacción que la trae', () => {
    const [l] = leadsConCiudad([
      it_('c1', 'A', '2026-09-10T15:00:00Z', 'Bogotá'),
      it_('c1', 'A', '2026-09-02T15:00:00Z'),
      it_('c1', 'A', '2026-09-05T15:00:00Z', 'medellin'),
    ])
    expect(l.ciudad).toBe('Medellin')
    expect(l.mes).toBe('2026-09-01')
  })

  it('las variantes de escritura se muestran con un solo nombre, con tilde', () => {
    const leads = leadsConCiudad([
      it_('c1', 'A', '2026-09-02T15:00:00Z', 'Medellín'),
      it_('c2', 'A', '2026-09-02T15:00:00Z', 'medellin '),
      it_('c3', 'A', '2026-09-02T15:00:00Z', 'MEDELLIN'),
      it_('c4', 'A', '2026-09-02T15:00:00Z', 'rionegro antioquia'),
    ])
    expect(leads.map(l => l.ciudad)).toEqual(['Medellín', 'Medellín', 'Medellín', 'Rionegro'])
  })
})

const fila = (p: Partial<FilaMarketing> & Pick<FilaMarketing, 'campaignId' | 'mes'>): FilaMarketing => ({
  campana: p.campaignId, gasto: 0, leads: 0, formularios: 0, negocios: 0, ventas: 0,
  honorario: 0, recaudado: 0, primerLead: null, ultimoLead: null, status: null, sincronizadoAt: null,
  ...p,
})

describe('leadsPorCiudad', () => {
  // Interacciones: A tiene 3 contactos en septiembre y 1 en agosto; B, 2 en septiembre.
  const interacciones = [
    it_('a1', 'A', '2026-09-02T15:00:00Z', 'Cali'),
    it_('a1', 'A', '2026-09-03T15:00:00Z', 'Cali'), // el mismo contacto: un solo lead
    it_('a2', 'A', '2026-09-02T15:00:00Z', 'Barranquilla'),
    it_('a3', 'A', '2026-09-02T15:00:00Z'),
    it_('a4', 'A', '2026-08-02T15:00:00Z', 'Envigado'),
    it_('b1', 'B', '2026-09-02T15:00:00Z', 'Medellín'),
    it_('b2', 'B', '2026-09-02T15:00:00Z', 'cali'),
  ]
  const leads = leadsConCiudad(interacciones)
  // Las filas de la vista para esos mismos leads.
  const filas = [
    fila({ campaignId: 'A', mes: '2026-09-01', leads: 3 }),
    fila({ campaignId: 'A', mes: '2026-08-01', leads: 1 }),
    fila({ campaignId: 'B', mes: '2026-09-01', leads: 2 }),
    fila({ campaignId: null, mes: '2026-09-01', ventas: 4 }),
  ]

  it('la suma por ciudad iguala los leads de cada campaña, en las dos lentes', () => {
    for (const [campanas, mes] of [
      [lenteMes(filas, '2026-09-01'), '2026-09-01'],
      [lenteMes(filas, '2026-08-01'), '2026-08-01'],
      [lenteCohorte(filas), null],
    ] as const) {
      const lc = leadsPorCiudad(campanas, leads, mes)
      for (const c of campanas.filter(c => !c.sinRastro)) {
        expect(lc.filas.find(f => f.campaignId === c.campaignId)?.total ?? 0).toBe(c.leads)
      }
      expect(lc.total).toBe(campanas.filter(c => !c.sinRastro).reduce((s, c) => s + c.leads, 0))
    }
  })

  it('la lente MES solo cuenta los leads de ese mes', () => {
    const lc = leadsPorCiudad(lenteMes(filas, '2026-09-01'), leads, '2026-09-01')
    expect(lc.columnas).toEqual(['Cali', 'Barranquilla', 'Medellín', OTRAS_CIUDADES, SIN_CIUDAD])
    expect(lc.totales.Cali).toBe(2)
    expect(lc.totales[SIN_CIUDAD]).toBe(1)
    expect(lc.filas.map(f => f.campaignId)).toEqual(['A', 'B'])
  })

  it('nombra las ciudades con más leads y manda el resto a «Otras ciudades»', () => {
    const muchas = Array.from({ length: CIUDADES_NOMBRADAS + 3 }, (_, i) => ({
      campaignId: 'A', mes: '2026-09-01', ciudad: `Ciudad ${String.fromCharCode(65 + i)}`,
    }))
    const extra = { campaignId: 'A', mes: '2026-09-01', ciudad: 'Ciudad A' }
    const lc = leadsPorCiudad([], [...muchas, extra], null)
    expect(lc.columnas).toHaveLength(CIUDADES_NOMBRADAS + 2)
    expect(lc.columnas[0]).toBe('Ciudad A')
    expect(lc.totales[OTRAS_CIUDADES]).toBe(3)
    expect(lc.otras.map(o => o.ciudad)).toEqual(['Ciudad G', 'Ciudad H', 'Ciudad I'])
    expect(lc.total).toBe(muchas.length + 1)
  })

  it('si sobra UNA sola ciudad, se nombra en vez de esconderla en «Otras»', () => {
    const siete = Array.from({ length: CIUDADES_NOMBRADAS + 1 }, (_, i) => ({
      campaignId: 'A', mes: '2026-09-01', ciudad: `Ciudad ${i}`,
    }))
    const lc = leadsPorCiudad([], siete, null)
    expect(lc.otras).toHaveLength(0)
    expect(lc.columnas).toHaveLength(CIUDADES_NOMBRADAS + 3)
  })

  it('un lead de una campaña que la tabla no tiene se pinta, no se pierde', () => {
    const lc = leadsPorCiudad([], [{ campaignId: 'Z', mes: '2026-09-01', ciudad: null }], null)
    expect(lc.filas).toEqual([expect.objectContaining({ campaignId: 'Z', campana: 'Z', total: 1 })])
  })
})
