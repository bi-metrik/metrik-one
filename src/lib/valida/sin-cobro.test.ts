import { describe, expect, it } from 'vitest'
import { confirmaSinCobro, headersSinCobro, veredictoPruebaPrevia } from './sin-cobro'

// Secreto inventado. El mismo vector está en metrik-valida (lib/consultas/sin-cobro.test.ts): si
// uno de los dos cambia el formato de la firma, se cae.
const SECRETO = 'secreto-de-prueba-no-es-el-real'
const VECTOR = 'e8234e0bdf6f430fa9932c9cd59cc480051d1ca3df484b775da1ec3c547413e8'

describe('marca de consulta sin cobro', () => {
  it('firma motivo y cuerpo como Valida (vector compartido)', () => {
    expect(headersSinCobro(SECRETO, 'reproceso MeTRIK: prueba', '{"tipo":"natural"}', 1_800_000_000)).toEqual({
      'X-Valida-Sin-Cobro': `t=1800000000,v1=${VECTOR}`,
      'X-Valida-Sin-Cobro-Motivo': 'reproceso MeTRIK: prueba',
    })
  })

  it('el motivo es ASCII: una tilde rompería el encabezado HTTP', () => {
    expect(() => headersSinCobro(SECRETO, 'reproceso MéTRIK', '{}')).toThrow('motivo_sin_cobro_invalido')
    expect(() => headersSinCobro(SECRETO, 'no', '{}')).toThrow('motivo_sin_cobro_invalido')
  })

  it('solo una respuesta con encabezado Y cuerpo confirma el sin cobro', () => {
    expect(confirmaSinCobro('true', { sin_cobro: { motivo: 'x' } })).toBe(true)
    expect(confirmaSinCobro(null, { sin_cobro: { motivo: 'x' } })).toBe(false)
    expect(confirmaSinCobro('true', { consulta_id: 'c' })).toBe(false)
    expect(confirmaSinCobro(null, { consulta_id: 'c' })).toBe(false)
  })

  it('la prueba previa solo pasa con 403 al secreto falso y 400 validation_error al real', () => {
    const r403 = { status: 403, error: 'sin_cobro_no_autorizado' }
    const r400 = { status: 400, error: 'validation_error' }
    expect(veredictoPruebaPrevia(r403, r400)).toBeNull()
    // Valida sin el cambio: ignora la marca, el cuerpo {} da 400 (o 402 con la bolsa cortada).
    expect(veredictoPruebaPrevia(r400, r400)).toContain('no reconoce')
    expect(veredictoPruebaPrevia({ status: 402, error: 'bolsa_agotada' }, r400)).toContain('no reconoce')
    // El secreto local no es el de Valida.
    expect(veredictoPruebaPrevia(r403, r403)).toContain('no es el de Valida')
    expect(veredictoPruebaPrevia(r403, { status: 500, error: 'db_error' })).toContain('inesperada')
  })
})
