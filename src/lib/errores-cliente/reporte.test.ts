import { describe, it, expect } from 'vitest'
import { leerReporte, MAX_BYTES_REPORTE, MAX_STACK } from './reporte'

const base = {
  message: 'Cannot read properties of undefined',
  name: 'TypeError',
  digest: '123456',
  stack: 'TypeError: x\n    at y',
  pathname: '/tableros',
  host: 'soena.metrikone.co',
  version: 'dpl_abc',
  userAgent: 'Mozilla/5.0',
  origen: 'app',
}

describe('leerReporte', () => {
  it('un reporte valido pasa con sus campos', () => {
    const r = leerReporte(JSON.stringify(base))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.reporte).toMatchObject(base)
  })

  it('sin message se ignora (400): es el filtro minimo contra ruido', () => {
    expect(leerReporte(JSON.stringify({ ...base, message: '' }))).toEqual({ ok: false, status: 400 })
    expect(leerReporte(JSON.stringify({ ...base, message: '   ' }))).toEqual({ ok: false, status: 400 })
    const { message: _m, ...sinMensaje } = base
    void _m
    expect(leerReporte(JSON.stringify(sinMensaje))).toEqual({ ok: false, status: 400 })
  })

  it('cuerpo que no es JSON: 400', () => {
    expect(leerReporte('no es json')).toEqual({ ok: false, status: 400 })
  })

  it('cuerpo de mas de 8 KB: 413, por tamano real y por cabecera', () => {
    const grande = JSON.stringify({ ...base, stack: 'x'.repeat(MAX_BYTES_REPORTE) })
    expect(leerReporte(grande)).toEqual({ ok: false, status: 413 })
    expect(leerReporte(JSON.stringify(base), String(MAX_BYTES_REPORTE + 1))).toEqual({ ok: false, status: 413 })
  })

  it('la query string y el hash nunca llegan al log', () => {
    const r = leerReporte(JSON.stringify({ ...base, pathname: '/vinculacion/x?token=secreto#y' }))
    expect(r.ok && r.reporte.pathname).toBe('/vinculacion/x')
  })

  it('el stack se recorta a ~2 KB y los campos fuera de la lista se descartan', () => {
    const r = leerReporte(JSON.stringify({ ...base, stack: 's'.repeat(MAX_STACK + 500), email: 'a@b.co' }))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.reporte.stack).toHaveLength(MAX_STACK)
      expect(r.reporte).not.toHaveProperty('email')
    }
  })
})
