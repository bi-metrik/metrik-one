import { describe, expect, it } from 'vitest'
import {
  aciertaCifra, aciertaCodigo, agregar, candidatasInsercion, contieneNombre, insercionesFalsas, llaveCifra, llaveCodigo, medir,
  normalizarConCifras, tabla, veredicto, wer,
} from './metricas'
import type { Agregado, Intento } from './metricas'

describe('cifras dichas en palabras o en dígitos', () => {
  it('«millones» y «mil» se vuelven un valor', () => {
    expect(normalizarConCifras('un millón trescientos cincuenta mil pesos')).toEqual(['1350000', 'pesos'])
    expect(normalizarConCifras('8 millones')).toEqual(['8000000'])
    expect(normalizarConCifras('2 millones 300 mil')).toEqual(['2300000'])
    expect(normalizarConCifras('dos millones y medio')).toEqual(['2500000'])
    expect(normalizarConCifras('treinta y cinco mil en almuerzo')).toEqual(['35000', 'en', 'almuerzo'])
    expect(normalizarConCifras('$1.350.000')).toEqual(['1350000'])
    expect(normalizarConCifras('350,000')).toEqual(['350000'])
    expect(normalizarConCifras('mil quinientos')).toEqual(['1500'])
  })
  it('la coma corta: «60 mil, me pagó 40» son dos cifras', () => {
    expect(normalizarConCifras('sesenta mil, me pagó 40')).toEqual(['60000', 'me', 'pago', '40'])
  })
  it('lo dictado de a dígitos o de a grupos no se suma', () => {
    expect(normalizarConCifras('uno cero dos tres')).toEqual(['1', '0', '2', '3'])
    expect(normalizarConCifras('i uno veintiséis cinco')).toEqual(['i', '1', '26', '5'])
    expect(normalizarConCifras('cincuenta y dos, ochocientos setenta y tres, cuatrocientos diez')).toEqual(['52', '873', '410'])
  })
  it('una cifra acierta por valor; una cédula, por la cadena de dígitos', () => {
    expect(llaveCifra('sesenta mil')).toEqual({ valor: '60000' })
    expect(llaveCifra('uno cero dos tres cuatro cinco seis siete ocho nueve')).toEqual({ digitos: '1023456789' })
    expect(aciertaCifra('Marcela, 60.000, me pagó 40', 'sesenta mil')).toBe(true)
    expect(aciertaCifra('me pagó 40 mil', '40')).toBe(false)
    expect(aciertaCifra('cédula 1.023.456.789', 'uno cero dos tres cuatro cinco seis siete ocho nueve')).toBe(true)
    expect(aciertaCifra('cédula 52873410', 'cincuenta y dos, ochocientos setenta y tres, cuatrocientos diez')).toBe(true)
    expect(aciertaCifra('cédula 1023456780', 'uno cero dos tres cuatro cinco seis siete ocho nueve')).toBe(false)
  })
})

describe('códigos', () => {
  it('«I1 26 5» acierta escrito de varias formas, y no «I1 26 50»', () => {
    expect(llaveCodigo('I1 26 5')).toBe('i1265')
    expect(aciertaCodigo('para el negocio I1 26 5 son', 'I1 26 5')).toBe(true)
    expect(aciertaCodigo('para el negocio I 1 26 5', 'I1 26 5')).toBe(true)
    expect(aciertaCodigo('negocio i1-26-5', 'I1 26 5')).toBe(true)
    expect(aciertaCodigo('el i uno veintiséis cinco', 'I1 26 5')).toBe(true)
    expect(aciertaCodigo('el I1 26 50', 'I1 26 5')).toBe(false)
    expect(aciertaCodigo('el Y1 26 5', 'I1 26 5')).toBe(false)
    expect(aciertaCodigo('factura F E 45 87', 'FE 4587')).toBe(true)
  })
})

describe('nombres e inserción falsa', () => {
  it('el nombre acierta sin tildes ni mayúsculas; «Jeimy» no es «Yeimy»', () => {
    expect(contieneNombre('le hice microblading a yeimy castano', 'Yeimy Castaño')).toBe(true)
    expect(contieneNombre('le hice microblading a Jeimy Castaño', 'Yeimy Castaño')).toBe(false)
    expect(contieneNombre('Castaño Yeimy', 'Yeimy Castaño')).toBe(false)
  })
  it('cuenta las palabras de la base que no se dijeron (no las comunes ni las de la referencia)', () => {
    const c = candidatasInsercion(['Maryory Salazar', 'Marcela Giraldo', 'Lifting de pestañas'], 'Marcela vino a lifting de pestañas')
    expect(c.sort()).toEqual(['giraldo', 'lifting', 'maryory', 'salazar'].filter((w) => w !== 'lifting').sort())
    expect(insercionesFalsas('Marcela Giraldo vino a lifting', c)).toEqual(['giraldo'])
    expect(insercionesFalsas('Llegó Maryory Pineda', c)).toEqual(['maryory'])
  })
})

describe('WER', () => {
  it('con las cifras como valor en los dos lados', () => {
    expect(wer('me pagó cuarenta mil', 'me pagó 40.000')).toBe(0)
    expect(wer('uno dos tres cuatro', 'uno dos tres')).toBeCloseTo(0.25)
    expect(wer('hola', '')).toBe(1)
  })
})

describe('medida, agregado y veredicto con transcripciones fijas', () => {
  const marcasLau02 = [
    { tipo: 'nombre' as const, texto: 'Marcela' }, { tipo: 'nombre' as const, texto: 'lifting de pestañas' },
    { tipo: 'cifra' as const, texto: 'sesenta mil' }, { tipo: 'cifra' as const, texto: '40' },
  ]
  const ref = 'Marcela vino a lifting de pestañas, sesenta mil, me pagó 40.'
  const cand = candidatasInsercion(['Marcela Giraldo', 'Marcia Londoño'], ref)
  it('mide nombres, cifras, inserción y WER de una transcripción', () => {
    const m = medir({ referencia: ref, marcas: marcasLau02, candidatas: cand, transcripcion: 'Marcia vino a lifting de pestañas, 60.000, me pagó 40.' })
    expect(m.nombres).toEqual({ aciertos: 1, total: 2, fallados: ['Marcela'] })
    expect(m.cifras.aciertos).toBe(2)
    expect(m.codigos.total).toBe(0)
    expect(m.inserciones).toEqual(['marcia'])
    expect(m.wer).toBeCloseTo(1 / 10)
  })
  it('agrega por modelo y con o sin pistas; los fallos no cuentan en las tasas', () => {
    const base = { referencia: ref, marcas: marcasLau02, candidatas: cand }
    const intentos: Intento[] = [
      { modelo: 'm', conPistas: false, guion: 'lau-02', repeticion: 1, medida: medir({ ...base, transcripcion: 'Marcia vino a lifting de pestañas, 60.000, me pagó 40.' }) },
      { modelo: 'm', conPistas: false, guion: 'lau-02', repeticion: 2, medida: null, error: 'GEMINI_HTTP_503' },
      { modelo: 'm', conPistas: true, guion: 'lau-02', repeticion: 1, medida: medir({ ...base, transcripcion: ref }) },
      { modelo: 'm', conPistas: true, guion: 'lau-02', repeticion: 2, medida: medir({ ...base, transcripcion: 'Marcela Giraldo vino a lifting de pestañas, 60.000, me pagó 40.' }) },
    ]
    const [sin, con] = agregar(intentos)
    expect(sin).toMatchObject({ conPistas: false, intentos: 2, fallos: 1, nombres: 0.5, cifras: 1, codigos: null, insercionPorNota: 1, notasConInsercion: 1 })
    expect(con).toMatchObject({ conPistas: true, intentos: 2, fallos: 0, nombres: 1, insercionPorNota: 0.5, notasConInsercion: 0.5 })
    expect(veredicto(sin, con).adoptar).toBe(true)
    const t = tabla([sin, con])
    expect(t).toMatch(/\nm +sin +2 +1 +50.0 %/)
    expect(t).toMatch(/m: ADOPTAR pistas/)
  })
  it('no se adoptan si sube la inserción falsa aunque mejoren los nombres', () => {
    const a = (o: Partial<Agregado>): Agregado => ({ modelo: 'm', conPistas: false, intentos: 60, fallos: 0, nombres: 0.8, cifras: 0.9, codigos: 0.5, insercionPorNota: 0.1, notasConInsercion: 0.1, wer: 0.1, ...o })
    expect(veredicto(a({}), a({ conPistas: true, nombres: 0.95, insercionPorNota: 0.2 }))).toEqual({ adoptar: false, motivo: 'sube la inserción falsa' })
    expect(veredicto(a({}), a({ conPistas: true, nombres: 0.95, codigos: 0.4 })).adoptar).toBe(false)
    expect(veredicto(a({}), a({ conPistas: true })).adoptar).toBe(false)
    expect(veredicto(a({}), a({ conPistas: true, fallos: 3, nombres: 0.95 })).adoptar).toBe(false)
  })
})
