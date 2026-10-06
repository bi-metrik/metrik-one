/**
 * El bloqueo de todo ONE (ampliación del 2026-10-06, Mauricio): toda entrada de texto pasa por
 * `texto-latino.ts`. Los dobles cirílicos y griegos se convierten solos; una letra de otra
 * escritura en un campo que va a un documento oficial frena con el campo y la letra.
 */
import { describe, expect, it } from 'vitest'
import {
  aLetraLatina,
  camposOficialesNoValidos,
  esCampoOficial,
  formularioLatino,
  primerCampoOficialNoValido,
  textoLatinoProfundo,
} from './texto-latino'
import { sanearDataDelNavegador } from '@/lib/negocios/data-escribible'

describe('los casos del barrido de producción', () => {
  it('el griego idéntico se convierte solo: «ΤΟ», «JOHΝ», «XΕΙ»', () => {
    expect(aLetraLatina('ΤΟ')).toBe('TO')
    expect(aLetraLatina('JOHΝ')).toBe('JOHN')
    expect(aLetraLatina('XΕΙ')).toBe('XEI')
  })

  it('un nombre entero en cirílico («РОСАЛИА ГРАНДА») no se adivina: se frena', () => {
    const r = primerCampoOficialNoValido({ nombre: 'РОСАЛИА ГРАНДА' }, () => 'Nombre')
    expect(r?.caracteres).toEqual(['Л', 'И', 'Г', 'Д'])
    expect(r?.mensaje).toMatch(/^El campo «Nombre» tiene unos caracteres no válidos/)
  })
})

describe('campos oficiales', () => {
  it('nombre, identificación, dirección, municipio, correo, placa y línea', () => {
    for (const c of ['nombre', 'primer_apellido', 'razon_social', 'numero_identificacion', 'nit', 'direccion', 'municipio', 'correo_electronico', 'email', 'placa', 'linea_vehiculo', 'full_name']) {
      expect(esCampoOficial(c), c).toBe(true)
    }
  })

  it('una nota o un comentario no frenan nada', () => {
    for (const c of ['observaciones', 'notas', 'comentario', 'valor_anticipo']) expect(esCampoOficial(c), c).toBe(false)
    expect(primerCampoOficialNoValido({ notas: 'Привет' })).toBeNull()
  })

  it('un símbolo no es una letra mal leída: no frena', () => {
    expect(primerCampoOficialNoValido({ direccion: 'CALLE 5 → 7 ✓' })).toBeNull()
  })

  it('solo revisa las claves que se acaban de mandar', () => {
    const datos = { nombre: 'МЕЛА', direccion: 'CALLE 5' }
    expect(primerCampoOficialNoValido(datos, undefined, ['direccion'])).toBeNull()
    expect(primerCampoOficialNoValido(datos, undefined, ['nombre'])?.campo).toBe('nombre')
  })
})

describe('entradas', () => {
  it('textoLatinoProfundo: objetos, listas y valores que no son texto', () => {
    expect(textoLatinoProfundo({ a: 'В', b: [{ c: 'ΤΟ' }], n: 3, x: null })).toEqual({ a: 'B', b: [{ c: 'TO' }], n: 3, x: null })
  })

  it('formularioLatino convierte y frena por campo', () => {
    const fd = new FormData()
    fd.set('nombre', 'JOHΝ РЕREZ')
    fd.set('telefono', '300')
    const ok = formularioLatino(fd)
    expect(ok.ok && ok.formData.get('nombre')).toBe('JOHN PEREZ')
    fd.set('nombre', 'RESTREPO МЕЛА')
    const mal = formularioLatino(fd, (c) => (c === 'nombre' ? 'Nombre' : c))
    expect(mal.ok).toBe(false)
    if (!mal.ok) expect(mal.mensaje).toBe('El campo «Nombre» tiene un carácter no válido: "Л". Corrígelo y vuelve a generar.')
  })

  it('lo que se escribe en un bloque se guarda con los dobles latinos', () => {
    const r = sanearDataDelNavegador({
      entrante: { direccion: 'CIR 2 66 В 151' },
      guardada: {},
      tipo: 'datos',
      configExtra: { fields: [{ slug: 'direccion', type: 'text' }] },
      workspaceId: 'ws',
      modo: 'mezcla',
    })
    expect(r.direccion).toBe('CIR 2 66 B 151')
  })
})

describe('el gate', () => {
  it('encuentra el campo oficial no válido en un bloque de datos y en uno de documento', () => {
    const malos = camposOficialesNoValidos([
      { bloque: 'Titularidad', data: { nombre_certificado: 'RESTREPO МЕЛА', notas: 'Привет' } },
      { bloque: 'RUT', data: { campos: { direccion: { value: 'САЛСА', confidence: 0.9, manual: true } } } },
      { bloque: 'Limpio', data: { nombre: 'ANA', campos: { municipio: { value: 'CAJICA' } } } },
    ])
    expect(malos).toEqual([
      { bloque: 'Titularidad', campo: 'nombre_certificado', caracteres: ['Л'] },
      { bloque: 'RUT', campo: 'direccion', caracteres: ['Л'] },
    ])
  })
})
