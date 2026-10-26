/**
 * Lo que entra a `cardumen-ingesta` viene de una pagina publica sin sesion: la validacion
 * es lo unico que separa una fila de `cardumen_respuestas` de cualquier POST de internet.
 *
 * VISTO FALLAR (mutacion): quitando el `!/^[a-z0-9][a-z0-9-]*$/` del slug pasan los tres
 * casos de `estudio invalido`; quitando el chequeo de claves vacias pasa `payload vacio`;
 * cambiando `CLAVES_SESION` a solo `session_id` cae el caso de `sessionId`.
 */
import { describe, expect, it } from 'vitest'
import { CLAVES_SESION, LIMITE_BYTES, idSesionDelPayload, validarCuerpo } from './validar'

const base = { estudio: 'cardumen-instrumento-adultos', payload: { q1: 'a' } }

describe('validarCuerpo', () => {
  it('acepta el envio minimo y deja token y lang en null', () => {
    const v = validarCuerpo(base)
    expect(v).toEqual({ ok: true, cuerpo: { estudio: base.estudio, token: null, lang: null, payload: { q1: 'a' } } })
  })

  it('rechaza lo que no es objeto', () => {
    for (const malo of [null, undefined, 'x', 3, [base]]) {
      expect(validarCuerpo(malo).ok).toBe(false)
    }
  })

  it('rechaza un estudio ausente, vacio o con forma que no es slug', () => {
    for (const estudio of [undefined, '', '   ', 'Adultos', 'a b', '../otro', '-malo', 'x'.repeat(81)]) {
      const v = validarCuerpo({ ...base, estudio })
      expect(v.ok, String(estudio)).toBe(false)
      if (!v.ok) expect(v.motivo).toBe('estudio invalido')
    }
  })

  it('recorta espacios del estudio pero no inventa uno', () => {
    const v = validarCuerpo({ ...base, estudio: '  cardumen-instrumento-ninos ' })
    expect(v.ok && v.cuerpo.estudio).toBe('cardumen-instrumento-ninos')
  })

  it('rechaza payload que no es objeto, y tambien el objeto vacio', () => {
    for (const payload of [undefined, null, 'x', [1], {}]) {
      expect(validarCuerpo({ ...base, payload }).ok, JSON.stringify(payload)).toBe(false)
    }
  })

  it('guarda el token recortado a 64 y nunca mas largo', () => {
    expect(validarCuerpo({ ...base, token: '  573159509103 ' }).ok).toBe(true)
    const v = validarCuerpo({ ...base, token: '9'.repeat(200) })
    expect(v.ok && v.cuerpo.token?.length).toBe(64)
  })

  it('un token que no es texto util queda en null, no rompe el envio', () => {
    for (const token of [undefined, null, '', '   ', 42, {}]) {
      const v = validarCuerpo({ ...base, token })
      expect(v.ok && v.cuerpo.token).toBe(null)
    }
  })

  it('solo es/en/pt son idioma; cualquier otra cosa es null (no se guarda basura)', () => {
    for (const [entra, sale] of [['es', 'es'], ['EN', 'en'], ['pt', 'pt'], ['fr', null], ['', null], [7, null]] as const) {
      const v = validarCuerpo({ ...base, lang: entra })
      expect(v.ok && v.cuerpo.lang, String(entra)).toBe(sale)
    }
  })
})

describe('idSesionDelPayload', () => {
  it('reconoce las tres grafias del id de sesion y dice con cual vino', () => {
    for (const clave of CLAVES_SESION) {
      expect(idSesionDelPayload({ [clave]: ' s-1 ' })).toEqual({ clave, id: 's-1' })
    }
  })

  it('sin id de sesion devuelve null: ese envio no tiene llave de idempotencia', () => {
    expect(idSesionDelPayload({ q1: 'a' })).toBe(null)
    expect(idSesionDelPayload({ session_id: '' })).toBe(null)
    expect(idSesionDelPayload({ session_id: 123 })).toBe(null)
    expect(idSesionDelPayload({ session_id: 'x'.repeat(201) })).toBe(null)
  })
})

describe('LIMITE_BYTES', () => {
  it('es 1 MB: el audio en base64 queda fuera a proposito', () => {
    expect(LIMITE_BYTES).toBe(1_000_000)
  })
})
