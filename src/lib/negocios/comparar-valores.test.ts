/**
 * Las comparaciones del cruce `coincide`, con los pares reales que se midieron en los
 * certificados UPME de SOENA el 2026-09-24 (315 certificados de casos abiertos).
 */
import { describe, expect, it } from 'vitest'
import { coinciden, nombresCoinciden } from './comparar-valores'
import { evaluarCruces, leerCruces, slugsDeCruces } from './cruces'
import { normalizarTexto } from './texto-normalizado'
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
    // V0208 medido: la IA leyó «l» donde el PDF dice «1». Esa confusión se tolera; otra letra no.
    expect(coinciden('diegotamayol@gmail.com', 'diegotamayo1@gmail.com', 'correo')).toBe(true)
    expect(coinciden('jrporrasg1@yahoo.com', 'jprrorasg1@yahoo.com', 'correo')).toBe(false)
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

  it('el certificado con una letra griega y el RUT sin el segundo apellido no avisan', async () => {
    const c = ctx({
      concepto_upme: { nombre_certificado: 'GARCIA MEJIA PEDRO ΑNTONIO' },
      rut: { razon_social: 'GARCIA  PEDRO ANTONIO' },
    })
    expect(await evaluarCruces(cruces, c, 9)).toEqual([])
  })
})

/**
 * Las reglas del 2026-10-01, con datos INVENTADOS que reproducen la forma de los avisos
 * falsos medidos en SOENA (V0507, V0521, V0531, modelos de carro con otros espacios).
 */
describe('falsos avisos del certificado (2026-10-01)', () => {
  it('homoglifos: una letra griega o cirílica que imita a la latina es la latina', () => {
    // «Ν» griega (U+039D) y «Α» griega, como las que mete la lectura del PDF.
    expect(coinciden('PEREZ ROJAS ΝICOLAS ΑNDRES', 'PEREZ ROJAS NICOLAS ANDRES', 'tokens')).toBe(true)
    // «С» y «О» cirílicas.
    expect(coinciden('СASTRO LОPEZ ANA', 'CASTRO LOPEZ ANA', 'tokens')).toBe(true)
    expect(normalizarTexto('ΤΟΥΟΤΑ')).toBe('toyota')
  })

  it('homoglifos en todo modo de texto, no solo en `tokens`', () => {
    expect(coinciden('ΚΙΑ', 'KIA', 'palabra_comun')).toBe(true)
    expect(coinciden('ΜOTORES DEL SUR SAS', 'MOTORES DEL SUR', 'contenido')).toBe(true)
  })

  it('una palabra menos en un lado, con tres en común: el mismo nombre', () => {
    // El RUT leído sin el segundo apellido y con doble espacio (forma de V0521).
    expect(coinciden('GARCIA  PEDRO ANTONIO', 'GARCIA MEJIA PEDRO ANTONIO', 'tokens')).toBe(true)
    expect(coinciden('Pedro Antonio García Mejía', 'GARCIA PEDRO ANTONIO', 'tokens')).toBe(true)
  })

  it('dos personas distintas con apellidos en común NO coinciden', () => {
    // Un apellido en común.
    expect(coinciden('GARCIA MEJIA PEDRO', 'GARCIA LOPEZ LUISA', 'tokens')).toBe(false)
    // Hermanos: dos apellidos en común, a cada lado le sobra un nombre.
    expect(coinciden('GARCIA MEJIA PEDRO', 'GARCIA MEJIA LUISA', 'tokens')).toBe(false)
    // Con solo dos palabras en común no alcanza, aunque a uno le falte una sola.
    expect(coinciden('GARCIA PEDRO', 'GARCIA MEJIA PEDRO', 'tokens')).toBe(false)
    // Faltan dos palabras: no es el mismo nombre escrito de otra forma.
    expect(coinciden('GARCIA MEJIA PEDRO', 'GARCIA MEJIA PEDRO ANTONIO JOSE', 'tokens')).toBe(false)
    // Una letra distinta sigue siendo otro nombre.
    expect(coinciden('GARCIA MEJIA PEDRO', 'GARCIA MEJIA PEDRA', 'tokens')).toBe(false)
  })

  it('nombresCoinciden es la regla que usan los dos motores', () => {
    expect(nombresCoinciden('GARCIA  PEDRO ANTONIO', 'GARCIA MEJIA PEDRO ANTONIO')).toBe(true)
    expect(nombresCoinciden('', 'GARCIA')).toBe(false)
  })

  it('sigla con puntos: «S.A.S.» es «SAS»', () => {
    expect(coinciden('Motores del Sur SAS', 'MOTORES DEL SUR, S.A.S.', 'contenido')).toBe(true)
    expect(coinciden('MOTORES DEL SUR S.A.', 'Motores del Sur SA', 'contenido')).toBe(true)
    expect(normalizarTexto('Ing. J. Perez')).toBe('ing j perez')
  })

  it('el mismo texto con otros espacios coincide; otro modelo no', () => {
    expect(coinciden('RAV4', 'RAV 4', 'palabra_comun')).toBe(true)
    expect(coinciden('X', 'X', 'palabra_comun')).toBe(true)
    expect(coinciden('EV5', 'EV3', 'palabra_comun')).toBe(false)
  })
})
