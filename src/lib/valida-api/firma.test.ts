import { describe, expect, it } from 'vitest'
import { actorValido, encabezadosOne, firmarOne, headerFirmaOne } from './firma'

/**
 * Los vectores se calcularon FUERA de este código, con
 * `printf '%s' "<t>.<cuerpo>" | openssl dgst -sha256 -hmac <secreto>`. Sin eso la prueba solo
 * repetiría lo que hace `firmarOne`, y un error de construcción (el punto, el orden, el hex)
 * pasaría en verde y fallaría con 401 contra Valida.
 */
const SECRETO = 'secreto-de-prueba-no-real'
const T = 1789500000
const CUERPO = '{"actor":{"usuario_id":"11111111-1111-4111-8111-111111111111","correo":"juan@4dsoft.co"},"nombre":"ERP"}'

describe('firmarOne', () => {
  it('coincide con HMAC-SHA256 calculado por openssl sobre `${t}.${cuerpo}`', () => {
    expect(firmarOne(SECRETO, T, CUERPO)).toBe(
      '27d0c7370bd998f6087706a5f7d7bddb03fe9b61b0b5e638d3b44c641d54bd36',
    )
  })

  it('en un GET firma la cadena vacía, no `undefined` ni `{}`', () => {
    expect(firmarOne(SECRETO, T, '')).toBe(
      'f9625538f02233d2a5fe79fd2eb9f198ee7fee94b555e9021d5a4dc846326c58',
    )
  })

  it('un cambio de un byte en el cuerpo cambia la firma', () => {
    expect(firmarOne(SECRETO, T, CUERPO)).not.toBe(firmarOne(SECRETO, T, CUERPO.replace('ERP', 'ERQ')))
  })
})

describe('headerFirmaOne', () => {
  it('tiene el formato que parte `partirHeaderFirma` de Valida', () => {
    const h = headerFirmaOne(SECRETO, CUERPO, T)
    expect(h).toMatch(/^t=\d{1,15},v1=[0-9a-f]{64}$/)
    expect(h.startsWith(`t=${T},v1=`)).toBe(true)
  })
})

describe('actorValido', () => {
  it('acepta un uuid y un correo, y normaliza el correo a minúsculas', () => {
    expect(actorValido('11111111-1111-4111-8111-111111111111', ' Juan@4DSoft.CO ')).toEqual({
      usuario_id: '11111111-1111-4111-8111-111111111111',
      correo: 'juan@4dsoft.co',
    })
  })

  it('sin correo no hay actor: una escritura sin nadie detrás no se hace', () => {
    expect(actorValido('11111111-1111-4111-8111-111111111111', null)).toBeNull()
    expect(actorValido('11111111-1111-4111-8111-111111111111', '')).toBeNull()
  })

  it('rechaza un id que no es uuid', () => {
    expect(actorValido('no-es-uuid', 'a@b.co')).toBeNull()
  })
})

describe('encabezadosOne', () => {
  it('manda firma y actor en los tres encabezados que lee la guardia de Valida', () => {
    const actor = { usuario_id: '11111111-1111-4111-8111-111111111111', correo: 'juan@4dsoft.co' }
    const h = encabezadosOne(SECRETO, actor, '', T)
    expect(Object.keys(h).sort()).toEqual(['X-One-Actor', 'X-One-Actor-Correo', 'X-One-Firma'])
    expect(h['X-One-Firma']).toBe(`t=${T},v1=f9625538f02233d2a5fe79fd2eb9f198ee7fee94b555e9021d5a4dc846326c58`)
  })
})
