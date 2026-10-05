import { describe, expect, it } from 'vitest'
import { coincideEtag, etagDe } from './etag'

describe('etag', () => {
  it('es estable por contenido y cambia si cambia el cuerpo', () => {
    const a = etagDe('{"items":[],"total":0}')
    expect(a).toMatch(/^"[A-Za-z0-9_-]+"$/)
    expect(etagDe('{"items":[],"total":0}')).toBe(a)
    expect(etagDe('{"items":[],"total":1}')).not.toBe(a)
  })

  it('If-None-Match: exacto, debil, en lista y comodin', () => {
    const e = etagDe('x')
    expect(coincideEtag(e, e)).toBe(true)
    expect(coincideEtag(`W/${e}`, e)).toBe(true)
    expect(coincideEtag(`"otro", ${e}`, e)).toBe(true)
    expect(coincideEtag('*', e)).toBe(true)
  })

  it('sin cabecera o con otro ETag no coincide', () => {
    const e = etagDe('x')
    expect(coincideEtag(null, e)).toBe(false)
    expect(coincideEtag('', e)).toBe(false)
    expect(coincideEtag(etagDe('y'), e)).toBe(false)
  })
})
