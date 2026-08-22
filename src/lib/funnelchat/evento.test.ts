import { describe, it, expect } from 'vitest'
import { extraerTelefono, resolver, contactoDeLaResolucion, type Candidato } from './evento'

const c = (id: string, nombre: string, telefono: string): Candidato => ({
  id,
  nombre,
  telefono,
  segmento: 'sin_contactar',
})

describe('extraerTelefono', () => {
  it('lo encuentra con el nombre que le haya puesto quien armo el flujo', () => {
    for (const clave of ['telefono', 'phone', 'celular', 'whatsapp', 'from']) {
      expect(extraerTelefono({ [clave]: '+57 312 722 6316' })?.nacional).toBe('3127226316')
    }
  })

  it('normaliza al numero nacional venga como venga', () => {
    expect(extraerTelefono({ telefono: '573127226316' })?.nacional).toBe('3127226316')
    expect(extraerTelefono({ telefono: '+57 (312) 722-6316' })?.nacional).toBe('3127226316')
    expect(extraerTelefono({ telefono: '3127226316' })?.nacional).toBe('3127226316')
  })

  it('acepta numero, no solo texto', () => {
    expect(extraerTelefono({ telefono: 3127226316 })?.nacional).toBe('3127226316')
  })

  it('mira un nivel de anidamiento y dice de donde lo saco', () => {
    const t = extraerTelefono({ contacto: { nombre: 'Ana', telefono: '3127226316' } })
    expect(t?.clave).toBe('contacto.telefono')
    expect(t?.nacional).toBe('3127226316')
  })

  it('prefiere el primer nivel sobre el anidado', () => {
    const t = extraerTelefono({ data: { phone: '3000000000' }, telefono: '3127226316' })
    expect(t?.clave).toBe('telefono')
  })

  it('ignora claves que no son portadoras y valores muy cortos', () => {
    expect(extraerTelefono({ documento: '3127226316' })).toBeNull()
    expect(extraerTelefono({ telefono: '312' })).toBeNull()
    expect(extraerTelefono({ prueba: 'soena' })).toBeNull()
    expect(extraerTelefono({})).toBeNull()
  })
})

describe('resolver', () => {
  const tel = { clave: 'telefono', crudo: '3127226316', nacional: '3127226316' }

  it('sin telefono, nombra las claves que si vinieron', () => {
    const r = resolver(null, [], ['prueba', 'nombre'])
    expect(r).toEqual({ estado: 'sin_telefono', claves_del_cuerpo: ['prueba', 'nombre'] })
  })

  it('un solo candidato resuelve', () => {
    const r = resolver(tel, [c('c1', 'Ana', '3127226316')], [])
    expect(r.estado).toBe('unico')
    expect(contactoDeLaResolucion(r)).toBe('c1')
  })

  it('REGRESION: con dos candidatos NO elige, y no fija contacto', () => {
    // Caso real de SOENA: una persona y su empresa comparten linea.
    const r = resolver(
      tel,
      [c('c1', 'AUTOALIADOS SAS', '3102589129'), c('c2', 'WILSON BELTRÁN', '310 2589129')],
      [],
    )
    expect(r.estado).toBe('ambiguo')
    expect(r.estado === 'ambiguo' && r.candidatos).toHaveLength(2)
    expect(contactoDeLaResolucion(r)).toBeNull()
  })

  it('cinco candidatos siguen siendo ambiguos, no "el primero"', () => {
    const cinco = ['a', 'b', 'c', 'd', 'e'].map((x) => c(x, x, '3208684813'))
    const r = resolver(tel, cinco, [])
    expect(r.estado).toBe('ambiguo')
    expect(contactoDeLaResolucion(r)).toBeNull()
  })

  it('telefono que no existe en la base se dice, no se calla', () => {
    const r = resolver(tel, [], [])
    expect(r).toEqual({ estado: 'sin_contacto', clave: 'telefono', nacional: '3127226316' })
    expect(contactoDeLaResolucion(r)).toBeNull()
  })
})

describe('movilNacional', () => {
  it('coincide con la regla de la base en las formas que de verdad llegan', async () => {
    const { movilNacional } = await import('./evento')
    expect(movilNacional('+57 312 722 6316')).toBe('3127226316')
    expect(movilNacional('573127226316')).toBe('3127226316')
    expect(movilNacional('+57 +57 3127226316')).toBe('3127226316') // indicativo duplicado
    expect(movilNacional('3001234567.0')).toBe('3001234567') // decimal de Excel
    expect(movilNacional('(312) 722-6316')).toBe('3127226316')
  })

  it('el decimal de Excel es justo donde numeroNacional se equivoca', async () => {
    const { movilNacional } = await import('./evento')
    const { numeroNacional } = await import('@/lib/busqueda/telefono')
    expect(numeroNacional('3001234567.0')).toBe('0012345670')
    expect(movilNacional('3001234567.0')).toBe('3001234567')
  })
})
