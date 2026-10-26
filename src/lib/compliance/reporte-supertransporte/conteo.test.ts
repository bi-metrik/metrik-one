import { describe, expect, it } from 'vitest'
import {
  calcularReporte,
  listasDeMatches,
  llaveContraparte,
  SIN_SEGMENTO,
  type ConsultaReporte,
  type EntradaReporte,
} from './conteo'
import { resolverPeriodo } from './periodos'

const HOY = '2026-10-08'
const PROV = 'seg-prov'
const EMP = 'seg-emp'
const CLI = 'seg-cli'
const METRIK = 'perfil-metrik'

let n = 0
function consulta(p: Partial<ConsultaReporte> & { created_at: string }): ConsultaReporte {
  n += 1
  return {
    id: `c${n}`,
    created_by: 'perfil-alma',
    documento_tipo: 'CC',
    documento_numero: null,
    nombre_consultado: null,
    segmento_id: null,
    severidad: 'sin_hallazgo',
    error_mensaje: null,
    total_matches: 0,
    tier_maximo: null,
    listas: [],
    ...p,
  }
}

function entrada(consultas: ConsultaReporte[], extra: Partial<EntradaReporte> = {}): EntradaReporte {
  return {
    periodo: resolverPeriodo({ periodo: '2026-08_2026-09' }, HOY),
    consultas,
    segmentos: [
      { id: PROV, nombre: 'Contraparte', orden: 1, activo: true },
      { id: EMP, nombre: 'Empleado', orden: 2, activo: true },
      { id: CLI, nombre: 'Cliente viejo', orden: 3, activo: false },
    ],
    creadoresExcluidos: new Set([METRIK]),
    sujetos: [],
    expedientes: [],
    ...extra,
  }
}

const lit = (r: ReturnType<typeof calcularReporte>, letra: string) => r.literales.find((l) => l.letra === letra)!

describe('llaveContraparte', () => {
  it('normaliza el documento y no mira el tipo', () => {
    expect(llaveContraparte('900.123.456-7', 'X')).toBe(llaveContraparte(' 9001234567 ', 'Y'))
  })
  it('sin documento usa el nombre sin tildes ni espacios de más', () => {
    expect(llaveContraparte(null, '  José   Pérez ')).toBe(llaveContraparte('', 'JOSE PEREZ'))
  })
  it('sin nada, null', () => {
    expect(llaveContraparte(null, '  ')).toBeNull()
  })
})

describe('calcularReporte — conteo distinto y exclusiones', () => {
  it('cuenta contrapartes distintas, no consultas', () => {
    const r = calcularReporte(entrada([
      consulta({ created_at: '2026-08-10T15:00:00Z', documento_numero: '123', segmento_id: PROV }),
      consulta({ created_at: '2026-09-10T15:00:00Z', documento_numero: '1.2.3', segmento_id: PROV }),
      consulta({ created_at: '2026-09-11T15:00:00Z', documento_numero: '456', segmento_id: EMP }),
    ]))
    expect(lit(r, 'c').valor).toBe(2)
    expect(lit(r, 'c').desglose).toEqual([
      { segmento: 'Contraparte', valor: 1 },
      { segmento: 'Empleado', valor: 1 },
    ])
    expect(r.nominal.conocimiento.find((f) => f.documento_numero === '1.2.3')?.consultas).toBe(2)
  })

  it('excluye consultas de MéTRIK y con error, y las cuenta aparte', () => {
    const r = calcularReporte(entrada([
      consulta({ created_at: '2026-08-10T15:00:00Z', documento_numero: '1', segmento_id: PROV }),
      consulta({ created_at: '2026-08-10T15:00:00Z', documento_numero: '2', created_by: METRIK, total_matches: 3 }),
      consulta({ created_at: '2026-08-10T15:00:00Z', documento_numero: '3', severidad: 'error' }),
      consulta({ created_at: '2026-08-10T15:00:00Z', documento_numero: '4', error_mensaje: 'timeout' }),
    ]))
    expect(lit(r, 'c').valor).toBe(1)
    expect(lit(r, 'e').valor).toBe(0)
    expect(r.excluidas).toEqual({ metrik: 1, error: 2 })
    expect(r.nominal.excluidas).toHaveLength(3)
  })

  it('el periodo se mide en hora de Bogotá', () => {
    // 2026-10-01T03:00Z es 30-sep 22:00 en Bogotá: entra en ago–sep.
    const r = calcularReporte(entrada([
      consulta({ created_at: '2026-10-01T03:00:00Z', documento_numero: '1', segmento_id: PROV }),
      consulta({ created_at: '2026-08-01T04:00:00Z', documento_numero: '2', segmento_id: PROV }),
    ]))
    expect(lit(r, 'c').valor).toBe(1)
    expect(r.nominal.conocimiento[0].documento_numero).toBe('1')
  })

  it('una contraparte cae en un solo segmento: el de su consulta más reciente', () => {
    const r = calcularReporte(entrada([
      consulta({ created_at: '2026-08-10T15:00:00Z', documento_numero: '1', segmento_id: PROV }),
      consulta({ created_at: '2026-09-10T15:00:00Z', documento_numero: '1', segmento_id: EMP }),
    ]))
    expect(lit(r, 'c').desglose).toEqual([
      { segmento: 'Contraparte', valor: 0 },
      { segmento: 'Empleado', valor: 1 },
    ])
  })

  it('las consultas sin segmento van a un bucket visible; un segmento activo sin consultas es 0 real', () => {
    const r = calcularReporte(entrada([
      consulta({ created_at: '2026-08-10T15:00:00Z', documento_numero: '1' }),
    ]))
    expect(r.segmentos).toEqual(['Contraparte', 'Empleado', SIN_SEGMENTO])
    expect(lit(r, 'c').desglose).toEqual([
      { segmento: 'Contraparte', valor: 0 },
      { segmento: 'Empleado', valor: 0 },
      { segmento: SIN_SEGMENTO, valor: 1 },
    ])
  })

  it('un segmento inactivo solo aparece si tiene algo en el periodo', () => {
    const sin = calcularReporte(entrada([consulta({ created_at: '2026-08-10T15:00:00Z', documento_numero: '1', segmento_id: PROV })]))
    expect(sin.segmentos).not.toContain('Cliente viejo')
    const con = calcularReporte(entrada([consulta({ created_at: '2026-08-10T15:00:00Z', documento_numero: '1', segmento_id: CLI })]))
    expect(con.segmentos).toContain('Cliente viejo')
  })
})

describe('calcularReporte — literales sin dato (nunca un cero falso)', () => {
  it('a sin sujetos cargados es "sin dato", no 0; b depende de a', () => {
    const r = calcularReporte(entrada([consulta({ created_at: '2026-08-10T15:00:00Z', documento_numero: '1', segmento_id: PROV })]))
    expect(lit(r, 'a').estado).toBe('sin_dato')
    expect(lit(r, 'a').valor).toBeNull()
    expect(lit(r, 'a').desglose.every((d) => d.valor === null)).toBe(true)
    expect(lit(r, 'a').causa).toMatch(/Sin base de terceros/)
    expect(lit(r, 'b').estado).toBe('sin_dato')
    expect(lit(r, 'f').estado).toBe('sin_dato')
  })

  it('con base cargada, a cuenta vigentes y b es la cobertura sobre ellos', () => {
    const r = calcularReporte(entrada(
      [consulta({ created_at: '2026-08-10T15:00:00Z', documento_numero: '1', segmento_id: PROV })],
      {
        sujetos: [
          { id: 's1', tipo: 'proveedor', documento_tipo: 'NIT', documento_numero: '1', nombre: 'A', segmento_id: PROV, relacion_desde: '2026-01-01', relacion_hasta: null },
          { id: 's2', tipo: 'proveedor', documento_tipo: 'NIT', documento_numero: '2', nombre: 'B', segmento_id: PROV, relacion_desde: '2026-01-01', relacion_hasta: null },
          // cerrada antes del periodo: no cuenta
          { id: 's3', tipo: 'empleado', documento_tipo: 'CC', documento_numero: '3', nombre: 'C', segmento_id: EMP, relacion_desde: '2025-01-01', relacion_hasta: '2026-07-31' },
        ],
      },
    ))
    expect(lit(r, 'a').valor).toBe(2)
    expect(lit(r, 'b').valor).toBe(50)
    expect(lit(r, 'b').desglose.find((d) => d.segmento === 'Contraparte')?.valor).toBe(50)
    // Empleado sin vigentes: cobertura indefinida, no 0 %
    expect(lit(r, 'b').desglose.find((d) => d.segmento === 'Empleado')?.valor).toBeNull()
  })

  it('d sin expedientes es "sin dato"; con expedientes cuenta solo los decididos', () => {
    const sin = calcularReporte(entrada([]))
    expect(lit(sin, 'd').estado).toBe('sin_dato')
    const con = calcularReporte(entrada([], {
      expedientes: [
        { id: 'x1', documento_tipo: 'NIT', documento_numero: '9', nombre: 'P', estado: 'aprobado', creado_en: '2026-08-01T15:00:00Z', actualizado_en: '2026-09-01T15:00:00Z' },
        { id: 'x2', documento_tipo: 'NIT', documento_numero: '8', nombre: 'Q', estado: 'pendiente_revision', creado_en: '2026-09-01T15:00:00Z', actualizado_en: '2026-09-01T15:00:00Z' },
      ],
    }))
    expect(lit(con, 'd').valor).toBe(1)
    expect(lit(con, 'd').estado).toBe('parcial')
    expect(lit(con, 'd').detalle.join(' ')).toMatch(/1 expediente abierto/)
    // el decidido también es conocimiento (c)
    expect(lit(con, 'c').valor).toBe(1)
  })
})

describe('calcularReporte — literal e y detalle mensual', () => {
  it('cuenta contrapartes con coincidencia devuelta y las describe por tier y por lista', () => {
    const r = calcularReporte(entrada([
      consulta({ created_at: '2026-08-10T15:00:00Z', documento_numero: '1', segmento_id: PROV, total_matches: 2, severidad: 'alto', tier_maximo: 'tier_4', listas: ['INCIDENTES JUDICIALES', 'INCIDENTES JUDICIALES'] }),
      consulta({ created_at: '2026-09-10T15:00:00Z', documento_numero: '1', segmento_id: PROV, total_matches: 0 }),
      consulta({ created_at: '2026-09-11T15:00:00Z', documento_numero: '2', segmento_id: EMP, total_matches: 1, severidad: 'alto', tier_maximo: 'sin_clasificar', listas: ['NSN MEDIOS'] }),
    ]))
    const e = lit(r, 'e')
    expect(e.valor).toBe(2)
    expect(e.detalle).toContain('Tier · Fuera del perímetro SARLAFT: 1')
    expect(e.detalle).toContain('Tier · Fuente no clasificada: 1')
    expect(e.detalle).toContain('Lista · INCIDENTES JUDICIALES: 1')
    expect(e.detalle[0]).toMatch(/no confirmadas/)
    // la fila de c refleja la consulta más reciente; la de e, la que trajo el match
    expect(r.nominal.conocimiento.find((f) => f.documento_numero === '1')?.coincidencias).toBe(0)
    expect(r.nominal.coincidencias.find((f) => f.documento_numero === '1')?.coincidencias).toBe(2)
  })

  it('detalle mes a mes con contrapartes distintas por mes', () => {
    const r = calcularReporte(entrada([
      consulta({ created_at: '2026-08-10T15:00:00Z', documento_numero: '1', segmento_id: PROV }),
      consulta({ created_at: '2026-09-10T15:00:00Z', documento_numero: '1', segmento_id: PROV }),
      consulta({ created_at: '2026-09-12T15:00:00Z', documento_numero: '1', segmento_id: PROV }),
      consulta({ created_at: '2026-09-12T15:00:00Z', documento_numero: '2', segmento_id: EMP, total_matches: 1 }),
    ]))
    expect(r.mensual.map((m) => [m.mes, m.consultas, m.contrapartes, m.conCoincidencia])).toEqual([
      ['2026-08', 1, 1, 0],
      ['2026-09', 3, 2, 1],
    ])
    expect(r.mensual[1].porSegmento).toEqual({ Contraparte: 1, Empleado: 1 })
    // sin deduplicar entre meses el total sería 3; deduplicado es 2
    expect(lit(r, 'c').valor).toBe(2)
  })
})

describe('listasDeMatches', () => {
  it('lee lista o detalle.lista e ignora lo que no es texto', () => {
    expect(listasDeMatches([{ lista: 'A' }, { detalle: { lista: 'B' } }, null, { lista: 3 }])).toEqual(['A', 'B'])
    expect(listasDeMatches(null)).toEqual([])
  })
})
