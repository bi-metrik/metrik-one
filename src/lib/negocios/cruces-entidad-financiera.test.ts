/**
 * SOE-012: si la factura del vehículo está a nombre de un banco, la titularidad tiene que
 * ser leasing. Cruce `entidad_financiera` con la configuración que se le aplica a la línea
 * GIT EV/HEV de SOENA (la aplica la sesión principal; esta es la misma, al carácter).
 *
 * Datos inventados con la forma de los reales, salvo el comprador de V0294 (un banco, no
 * una persona).
 */
import { describe, expect, it } from 'vitest'
import { cumpleCondicion } from './condicion-bloque'
import { evaluarCruces, leerCruces, slugsDeCruces } from './cruces'
import type { ContextoFuentes } from './fuentes-negocio'

const CRUCE_SOENA = {
  slug: 'factura_banco_exige_leasing',
  tipo: 'entidad_financiera',
  mensaje:
    'La factura está a nombre de {entidad} y la titularidad dice «{valor}». Con un banco en la factura, la titularidad es leasing.',
  lista: { source_bloque_slug: 'factura_venta_vehiculo', field: 'compradores' },
  dato: { source_bloque_slug: 'titularidad', field: 'modalidad_solicitante' },
  valores: ['leasing'],
  bloquea_en_etapas: [4, 5, 6, 7],
}
const CRUCES = leerCruces({ cruces: [CRUCE_SOENA] })

// `condition` de cada bloque en producción (bloque_configs.config_extra.condition).
const CONDICION_BLOQUE: Record<string, Record<string, unknown> | null> = {
  tipo_de_solicitante: null,
  titularidad: { field: 'tipo_persona', value: 'natural', source_bloque_slug: 'tipo_de_solicitante' },
  factura_venta_vehiculo: null,
}
const OPCIONES: Record<string, string> = {
  unico: 'Un solo solicitante',
  copropiedad: 'Copropiedad (dos personas naturales)',
  leasing: 'Leasing (banco co-titular)',
}

function ctx(porSlug: Record<string, Record<string, unknown>>): ContextoFuentes {
  const evaluar = async (c: Record<string, unknown>) => cumpleCondicion(c as never, { porSlug, porEtapaOrden: {} })
  return {
    porSlug,
    evaluar,
    aplica: async slug => {
      if (!(slug in CONDICION_BLOQUE)) return false
      const c = CONDICION_BLOQUE[slug]
      return c ? evaluar(c) : true
    },
    etiqueta: (slug, field, valor) =>
      slug === 'titularidad' && field === 'modalidad_solicitante' ? OPCIONES[String(valor)] ?? null : null,
  }
}

const caso = (compradores: string | null, modalidad: string | null) => ({
  tipo_de_solicitante: { tipo_persona: 'natural' },
  ...(compradores !== null ? { factura_venta_vehiculo: { compradores } } : {}),
  ...(modalidad !== null ? { titularidad: { modalidad_solicitante: modalidad } } : {}),
})

const BANCO = 'BANCOLOMBIA (8909039388)'

describe('cruce entidad_financiera (SOE-012)', () => {
  it('la configuración es válida y pide la factura y la titularidad', () => {
    expect(CRUCES).toHaveLength(1)
    expect(CRUCES[0].tipo).toBe('entidad_financiera')
    expect(slugsDeCruces(CRUCES).sort()).toEqual(['factura_venta_vehiculo', 'titularidad'])
  })

  it('banco en la factura + titularidad «unico»: frena en Titularidad (4) con el mensaje', async () => {
    const [c, ...resto] = await evaluarCruces(CRUCES, ctx(caso(BANCO, 'unico')), 4)
    expect(resto).toEqual([])
    expect(c.bloquea).toBe(true)
    expect(c.mensaje).toBe(
      'La factura está a nombre de BANCOLOMBIA y la titularidad dice «Un solo solicitante». Con un banco en la factura, la titularidad es leasing.',
    )
    expect(c.huella).toBeTruthy()
  })

  it('frena en 4, 5, 6 y 7; en las demás etapas solo avisa', async () => {
    for (const etapa of [4, 5, 6, 7]) {
      const r = await evaluarCruces(CRUCES, ctx(caso(BANCO, 'copropiedad')), etapa)
      expect(r.map(c => c.bloquea)).toEqual([true])
    }
    for (const etapa of [1, 3, 8, 9, null]) {
      const r = await evaluarCruces(CRUCES, ctx(caso(BANCO, 'unico')), etapa)
      expect(r.map(c => c.bloquea)).toEqual([false])
    }
  })

  it('banco + leasing: pasa (V0294)', async () => {
    expect(await evaluarCruces(CRUCES, ctx(caso(BANCO, 'leasing')), 4)).toEqual([])
    expect(await evaluarCruces(CRUCES, ctx(caso(BANCO, ' Leasing ')), 7)).toEqual([])
  })

  it('banco junto a una persona natural también exige leasing', async () => {
    const r = await evaluarCruces(
      CRUCES,
      ctx(caso('PEREZ GOMEZ ANA MARIA (52000111); Banco de Bogotá S.A. (8600029644)', 'unico')),
      5,
    )
    expect(r).toHaveLength(1)
    expect(r[0].mensaje).toContain('a nombre de Banco de Bogotá S.A. y')
  })

  it('persona natural con cédula que empieza por 8 o 9 no es un banco', async () => {
    for (const comp of ['RUIZ LOPEZ CARLOS ANDRES (9876543210)', 'GOMEZ ARIAS LUISA (8012345678)']) {
      expect(await evaluarCruces(CRUCES, ctx(caso(comp, 'unico')), 4)).toEqual([])
    }
  })

  it('una empresa que no es financiera no cuenta', async () => {
    expect(await evaluarCruces(CRUCES, ctx(caso('LUYAN INGENIERIA SAS (901234567)', 'unico')), 4)).toEqual([])
  })

  it('sin titularidad, sin factura o con la titularidad fuera del caso: calla', async () => {
    expect(await evaluarCruces(CRUCES, ctx(caso(BANCO, null)), 4)).toEqual([])
    expect(await evaluarCruces(CRUCES, ctx(caso(null, 'unico')), 4)).toEqual([])
    expect(await evaluarCruces(CRUCES, ctx(caso('', 'unico')), 4)).toEqual([])
    const juridica = { ...caso(BANCO, 'unico'), tipo_de_solicitante: { tipo_persona: 'juridica' } }
    expect(await evaluarCruces(CRUCES, ctx(juridica), 4)).toEqual([])
  })

  it('la huella cambia si cambia la titularidad (la excepción con motivo no se arrastra)', async () => {
    const [a] = await evaluarCruces(CRUCES, ctx(caso(BANCO, 'unico')), 4)
    const [b] = await evaluarCruces(CRUCES, ctx(caso(BANCO, 'copropiedad')), 4)
    expect(a.huella).not.toBe(b.huella)
  })

  it('una entrada mal formada se ignora', () => {
    expect(leerCruces({ cruces: [{ ...CRUCE_SOENA, valores: [] }] })).toEqual([])
    expect(leerCruces({ cruces: [{ ...CRUCE_SOENA, dato: { source_bloque_slug: 'titularidad' } }] })).toEqual([])
    expect(leerCruces({ cruces: [{ ...CRUCE_SOENA, lista: undefined }] })).toEqual([])
  })
})
