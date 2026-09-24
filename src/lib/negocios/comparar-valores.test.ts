/**
 * Las comparaciones del cruce `coincide`, con los pares reales que se midieron en los
 * certificados UPME de SOENA el 2026-09-24 (315 certificados de casos abiertos).
 */
import { describe, expect, it } from 'vitest'
import { coinciden } from './comparar-valores'
import { evaluarCruces, leerCruces, slugsDeCruces } from './cruces'
import type { ContextoFuentes } from './fuentes-negocio'

describe('coinciden', () => {
  it('tokens: mismo nombre en cualquier orden, sin tildes, con un nombre repetido', () => {
    expect(coinciden('BENAVIDES MORENO SANTIAGO', 'Santiago Benavides Moreno', 'tokens')).toBe(true)
    expect(coinciden('MAURICIO MAURICIO AFANADOR BARRIOS', 'AFANADOR BARRIOS MAURICIO', 'tokens')).toBe(true)
    expect(coinciden('LEON CASTAÑO JUAN BERNANDO', 'LEON CASTANO JUAN BERNARDO', 'tokens')).toBe(false)
  })

  it('palabra_comun: «MG» contra «MG» sí (antes exigía 3 letras), el año solo no', () => {
    expect(coinciden('MG', 'MG', 'palabra_comun')).toBe(true)
    expect(coinciden('TOYOTA', 'Tesla', 'palabra_comun')).toBe(false)
    expect(coinciden('2026', 'X 2026', 'palabra_comun')).toBe(false)
  })

  it('equivalencias: Deepal es una marca de Changan', () => {
    expect(coinciden('DEEPAL', 'CHANGAN', 'palabra_comun')).toBe(false)
    expect(coinciden('DEEPAL', 'CHANGAN', 'palabra_comun', { equivalencias: [['deepal', 'changan']] })).toBe(true)
  })

  it('contenido: razón social con o sin sigla', () => {
    expect(coinciden('AUTOMOTORES SAS', 'AUTOMOTORES', 'contenido')).toBe(true)
    expect(coinciden('AUTOMOTORES SAS', 'OTRA EMPRESA SAS', 'contenido')).toBe(false)
  })

  it('compacto: VIN con o sin espacios y guiones', () => {
    expect(coinciden('LGX CE4CB 5P0123456', 'lgxce4cb5p0123456', 'compacto')).toBe(true)
    expect(coinciden('LGXCE4CB5P0123456', 'LGXCE4CB5P0123457', 'compacto')).toBe(false)
  })

  it('monto: con tolerancia, y en millones no', () => {
    expect(coinciden('143800000', '$ 143.800.500', 'monto')).toBe(true)
    // V0064 medido: el certificado dice $130.530.973 y la factura $143.800.000.
    expect(coinciden('130530973', '143800000', 'monto')).toBe(false)
  })

  it('correo: sin mayúsculas ni espacios, y una letra distinta es otra dirección', () => {
    expect(coinciden('CaroSalazarC@Gmail.com', ' carosalazarc@gmail.com ', 'correo')).toBe(true)
    expect(coinciden('carosalazarc@ gmail.com', 'carosalazarc@gmail.com', 'correo')).toBe(true)
    expect(coinciden('mailto:a.b@x.co', 'a.b@x.co', 'correo')).toBe(true)
    // V0210 medido: el certificado dice «hotmaiol.com».
    expect(coinciden('lady.barrueto@hotmaiol.com', 'lady.barrueto@hotmail.com', 'correo')).toBe(false)
    // Dos textos iguales que no son un correo no «coinciden».
    expect(coinciden('no aplica', 'no aplica', 'correo')).toBe(false)
  })

  it('falta un lado: no coinciden (quien llama decide que calla)', () => {
    expect(coinciden('', 'X', 'tokens')).toBe(false)
    expect(coinciden('X', null, 'compacto')).toBe(false)
  })
})

describe('cruce coincide', () => {
  const CRUCE = {
    slug: 'certificado_nombre',
    tipo: 'coincide',
    mensaje: 'El certificado UPME trae «{a_valor}» y los RUT dicen «{b_valor}».',
    a: { source_bloque_slug: 'concepto_upme_anexos', alternativas: ['concepto_upme'], field: 'nombre_certificado' },
    b: [
      { source_bloque_slug: 'rut', field: 'razon_social' },
      { source_bloque_slug: 'rut_solicitante_2', field: 'razon_social' },
    ],
    modo: 'tokens',
    bloquea_en_etapas: [9],
  }
  const cruces = leerCruces({ cruces: [CRUCE, { ...CRUCE, slug: 'mal', modo: 'inventado' }] })

  function ctx(porSlug: Record<string, Record<string, unknown>>, noAplica: string[] = []): ContextoFuentes {
    return { porSlug, aplica: async s => s in porSlug && !noAplica.includes(s), evaluar: async () => true, etiqueta: () => null }
  }

  it('solo acepta modos conocidos y carga todos los bloques que menciona', () => {
    expect(cruces.map(c => c.slug)).toEqual(['certificado_nombre'])
    expect(slugsDeCruces(cruces).sort()).toEqual(['concepto_upme', 'concepto_upme_anexos', 'rut', 'rut_solicitante_2'])
  })

  it('coincide con ALGUNO: el certificado a nombre del segundo titular no es contradicción', async () => {
    const c = ctx({
      concepto_upme: { nombre_certificado: 'SALAZAR HERRERA ISABEL CRISTINA' },
      rut: { razon_social: 'CASTRILLON CASTAÑO ARLEY GIOVANNI' },
      rut_solicitante_2: { razon_social: 'SALAZAR HERRERA ISABEL CRISTINA' },
    })
    expect(await evaluarCruces(cruces, c, 9)).toEqual([])
  })

  it('no coincide con ninguno: contradicción que frena en Certificación', async () => {
    const c = ctx({
      concepto_upme: { nombre_certificado: 'BEDOYA ZAMAYO MARISLEN' },
      rut: { razon_social: 'BEDOYA TAMAYO MADELEN' },
    })
    const [r] = await evaluarCruces(cruces, c, 9)
    expect(r.bloquea).toBe(true)
    expect(r.mensaje).toBe('El certificado UPME trae «BEDOYA ZAMAYO MARISLEN» y los RUT dicen «BEDOYA TAMAYO MADELEN».')
    expect((await evaluarCruces(cruces, c, 13))[0].bloquea).toBe(false)
  })

  it('calla sin certificado, o sin nada con qué compararlo', async () => {
    expect(await evaluarCruces(cruces, ctx({ rut: { razon_social: 'X Y' } }), 9)).toEqual([])
    expect(await evaluarCruces(cruces, ctx({ concepto_upme: { nombre_certificado: 'X Y' } }), 9)).toEqual([])
  })

  it('el bloque que no le aplica al caso no cuenta', async () => {
    const c = ctx(
      { concepto_upme: { nombre_certificado: 'X Y' }, rut: { razon_social: 'Z W' } },
      ['rut'],
    )
    expect(await evaluarCruces(cruces, c, 9)).toEqual([])
  })
})
