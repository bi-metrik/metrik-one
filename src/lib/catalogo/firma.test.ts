import { describe, it, expect } from 'vitest'
import { CABECERA_FIRMA, firmar, leerCabeceraFirma, sha256, VENTANA_SEGUNDOS, verificarFirma } from './firma'

const SECRETO = 'secreto-de-prueba-no-usar'
const AHORA = 1_789_000_000
const CUERPO = JSON.stringify({ slug: 'licencia-clarity', version: 1 })

const base = {
  metodo: 'POST',
  ruta: '/api/catalogo/versiones',
  cuerpo: CUERPO,
  secreto: SECRETO,
  ahoraSegundos: AHORA,
}


/**
 * `ResultadoFirma` es una unión discriminada a propósito: quien la use tiene que mirar `ok`
 * antes de leer el motivo. Aquí se estrecha una sola vez.
 */
const motivo = (r: ReturnType<typeof verificarFirma>) => (r.ok ? null : r.motivo)

const cabeceraValida = firmar({ metodo: 'POST', ruta: '/api/catalogo/versiones', cuerpo: CUERPO, t: AHORA }, SECRETO)

describe('una petición bien firmada entra', () => {
  it('con el reloj exacto', () => {
    expect(verificarFirma({ ...base, cabecera: cabeceraValida })).toEqual({ ok: true })
  })

  it('en los bordes de la ventana', () => {
    expect(verificarFirma({ ...base, cabecera: cabeceraValida, ahoraSegundos: AHORA + VENTANA_SEGUNDOS }).ok).toBe(true)
    expect(verificarFirma({ ...base, cabecera: cabeceraValida, ahoraSegundos: AHORA - VENTANA_SEGUNDOS }).ok).toBe(true)
  })

  it('un GET sin cuerpo', () => {
    const c = firmar({ metodo: 'GET', ruta: '/api/catalogo/huellas', cuerpo: '', t: AHORA }, SECRETO)
    expect(
      verificarFirma({ metodo: 'GET', ruta: '/api/catalogo/huellas', cuerpo: '', secreto: SECRETO, ahoraSegundos: AHORA, cabecera: c }),
    ).toEqual({ ok: true })
  })
})

describe('lo que NO entra', () => {
  it('sin secreto configurado en el servidor', () => {
    // El peor momento para dejar pasar algo es un entorno a medio configurar.
    expect(verificarFirma({ ...base, cabecera: cabeceraValida, secreto: undefined })).toEqual({
      ok: false,
      motivo: 'sin_secreto',
    })
    expect(motivo(verificarFirma({ ...base, cabecera: cabeceraValida, secreto: '' }))).toBe('sin_secreto')
  })

  it('sin cabecera, y una cabecera vacía no es una firma vacía válida', () => {
    expect(motivo(verificarFirma({ ...base, cabecera: null }))).toBe('sin_firma')
    expect(motivo(verificarFirma({ ...base, cabecera: '' }))).toBe('sin_firma')
    expect(motivo(verificarFirma({ ...base, cabecera: 't=1,v1=' }))).toBe('sin_firma')
  })

  it('con otro secreto', () => {
    expect(motivo(verificarFirma({ ...base, cabecera: cabeceraValida, secreto: 'otro' }))).toBe('no_coincide')
  })

  it('fuera de la ventana, en los dos sentidos', () => {
    expect(motivo(verificarFirma({ ...base, cabecera: cabeceraValida, ahoraSegundos: AHORA + VENTANA_SEGUNDOS + 1 })))
      .toBe('fuera_de_ventana')
    expect(motivo(verificarFirma({ ...base, cabecera: cabeceraValida, ahoraSegundos: AHORA - VENTANA_SEGUNDOS - 1 })))
      .toBe('fuera_de_ventana')
  })

  it('si el cuerpo cambió después de firmar', () => {
    expect(motivo(verificarFirma({ ...base, cabecera: cabeceraValida, cuerpo: CUERPO + ' ' }))).toBe('no_coincide')
  })

  it('reusando la firma de OTRA ruta', () => {
    // Sin la ruta dentro del mensaje, quien capture una lectura podría escribir.
    expect(motivo(verificarFirma({ ...base, cabecera: cabeceraValida, ruta: '/api/catalogo/huellas' })))
      .toBe('no_coincide')
  })

  it('reusando la firma de OTRO método sobre la misma ruta', () => {
    const c = firmar({ metodo: 'GET', ruta: '/api/catalogo/versiones', cuerpo: CUERPO, t: AHORA }, SECRETO)
    expect(motivo(verificarFirma({ ...base, cabecera: c }))).toBe('no_coincide')
  })

  it('cambiando el t de la cabecera sin refirmar (el t está dentro del mensaje)', () => {
    const manipulada = cabeceraValida.replace(`t=${AHORA}`, `t=${AHORA + 10}`)
    expect(motivo(verificarFirma({ ...base, cabecera: manipulada, ahoraSegundos: AHORA + 10 }))).toBe('no_coincide')
  })
})

describe('leerCabeceraFirma', () => {
  it('lee el formato bueno', () => {
    expect(leerCabeceraFirma(`t=17,v1=${'a'.repeat(64)}`)).toEqual({ t: 17, v1: 'a'.repeat(64) })
  })

  it('tolera espacios y el orden invertido', () => {
    expect(leerCabeceraFirma(`v1=${'B'.repeat(64)}, t=17`)).toEqual({ t: 17, v1: 'b'.repeat(64) })
  })

  const malos = [
    ['vacía', ''],
    ['sin t', `v1=${'a'.repeat(64)}`],
    ['sin v1', 't=17'],
    ['v1 corta', 't=17,v1=abc'],
    ['v1 que no es hex', `t=17,v1=${'z'.repeat(64)}`],
    ['t que no es número', `t=ayer,v1=${'a'.repeat(64)}`],
    ['t negativo', `t=-17,v1=${'a'.repeat(64)}`],
  ] as const
  for (const [nombre, valor] of malos) {
    it(`rechaza: ${nombre}`, () => expect(leerCabeceraFirma(valor)).toBeNull())
  }
})

describe('sha256', () => {
  it('es el hash conocido de la cadena vacía (guard del instrumento)', () => {
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  it('cambia con un solo carácter', () => {
    expect(sha256('a')).not.toBe(sha256('b'))
  })
})

describe('el nombre de la cabecera', () => {
  it('es el mismo que ONE ya usa hacia Valida', () => {
    expect(CABECERA_FIRMA).toBe('x-one-firma')
  })
})
