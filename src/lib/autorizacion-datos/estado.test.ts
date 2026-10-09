import { describe, expect, it } from 'vitest'
import { faltaParaAvanzar, faseDe, hayMenores, leerEstado } from './estado'
import { debeEnviarCorreo } from './correo'
import { CONFIG_POR_DEFECTO } from './texto'

const base = {
  existe: true,
  contacto: { nombre: 'MAURICIO MORENO', email: 'cliente@correo-inventado.co' },
  texto: { id: 't', version: 'v1.0', mayor: 1, menor: 0 },
  vigente: { generales: false, sensibles: false, menores: false, ofertas: false },
}

describe('gate autorizacion_datos', () => {
  it('sin autorización frena', () => {
    expect(faltaParaAvanzar(leerEstado(base), { menores: false })).toBe('generales')
  })

  it('cliente recurrente que ya autorizó pasa sin volver a firmar', () => {
    const e = leerEstado({ ...base, vigente: { ...base.vigente, generales: true } })
    expect(faltaParaAvanzar(e, { menores: false })).toBeNull()
  })

  it('con menores en el viaje exige también la casilla de menores', () => {
    const e = leerEstado({ ...base, vigente: { ...base.vigente, generales: true } })
    expect(faltaParaAvanzar(e, { menores: true })).toBe('menores')
    const con = leerEstado({ ...base, vigente: { ...base.vigente, generales: true, menores: true } })
    expect(faltaParaAvanzar(con, { menores: true })).toBeNull()
  })

  it('la marca manual vieja no cuenta (la RPC no la suma a vigente)', () => {
    const e = leerEstado({ ...base, manual_sin_evidencia: { fecha: '2026-10-01' } })
    expect(faltaParaAvanzar(e, { menores: false })).toBe('generales')
  })

  it('sin contacto frena con su propio mensaje; lo ilegible se lee como no autorizado', () => {
    expect(faltaParaAvanzar(leerEstado({ existe: false }), { menores: false })).toBe('sin_contacto')
    expect(faltaParaAvanzar(leerEstado({ ...base, vigente: { generales: 'true' } }), { menores: false })).toBe('generales')
  })
})

describe('menores del viaje', () => {
  it('niños o infantes mayores de 0 en cualquier bloque', () => {
    expect(hayMenores([{ destino: 'x' }, { adultos: 2, ninos: 0, infantes: '1' }])).toBe(true)
    expect(hayMenores([{ adultos: 2, ninos: 0, infantes: 0 }])).toBe(false)
    expect(hayMenores([{ ninos: '' }, null])).toBe(false)
  })
})

describe('fase en el bloque', () => {
  it('aprobada / reaceptar / rechazada / enviada / pendiente', () => {
    expect(faseDe(leerEstado({ ...base, vigente: { ...base.vigente, generales: true } }))).toBe('aprobada')
    expect(faseDe(leerEstado({ ...base, requiere_reaceptar: true }))).toBe('reaceptar')
    expect(faseDe(leerEstado({ ...base, pendiente: { token: 'x', rechazado_at: '2026-10-08' } }))).toBe('rechazada')
    expect(faseDe(leerEstado({ ...base, pendiente: { token: 'x', correo_enviado_at: '2026-10-08' } }))).toBe('enviada')
    expect(faseDe(leerEstado(base))).toBe('pendiente')
  })
})

describe('correo con el link', () => {
  const encendido = { ...CONFIG_POR_DEFECTO, correoAlCrear: true }
  const ahoraMs = Date.parse('2026-10-08T15:00:00Z')

  it('al crear un viaje sale si está encendido, hay correo y no autorizó', () => {
    expect(debeEnviarCorreo({ estado: leerEstado(base), config: encendido, origen: 'al_crear', textoPublicado: true, ahoraMs }))
      .toEqual({ ok: true, email: 'cliente@correo-inventado.co' })
  })

  it('apagado por workspace no sale solo (a mano sí)', () => {
    const e = leerEstado(base)
    expect(debeEnviarCorreo({ estado: e, config: CONFIG_POR_DEFECTO, origen: 'al_crear', textoPublicado: true, ahoraMs })).toEqual({ ok: false, motivo: 'apagado' })
    expect(debeEnviarCorreo({ estado: e, config: CONFIG_POR_DEFECTO, origen: 'manual', textoPublicado: true, ahoraMs }).ok).toBe(true)
  })

  it('no se manda si ya autorizó', () => {
    const e = leerEstado({ ...base, vigente: { ...base.vigente, generales: true } })
    expect(debeEnviarCorreo({ estado: e, config: encendido, origen: 'al_crear', textoPublicado: true, ahoraMs })).toEqual({ ok: false, motivo: 'ya_autorizo' })
  })

  it('no se duplica: un pendiente con correo reciente frena el automático', () => {
    const hace2dias = new Date(ahoraMs - 2 * 86400_000).toISOString()
    const e = leerEstado({ ...base, pendiente: { token: 'x', correo_enviado_at: hace2dias } })
    expect(debeEnviarCorreo({ estado: e, config: encendido, origen: 'al_crear', textoPublicado: true, ahoraMs })).toEqual({ ok: false, motivo: 'enviado_reciente' })
    const hace8dias = new Date(ahoraMs - 8 * 86400_000).toISOString()
    const viejo = leerEstado({ ...base, pendiente: { token: 'x', correo_enviado_at: hace8dias } })
    expect(debeEnviarCorreo({ estado: viejo, config: encendido, origen: 'al_crear', textoPublicado: true, ahoraMs }).ok).toBe(true)
  })

  it('a mano solo frena el doble toque (10 minutos)', () => {
    const hace2min = new Date(ahoraMs - 2 * 60_000).toISOString()
    const e = leerEstado({ ...base, pendiente: { token: 'x', correo_enviado_at: hace2min } })
    expect(debeEnviarCorreo({ estado: e, config: encendido, origen: 'manual', textoPublicado: true, ahoraMs })).toEqual({ ok: false, motivo: 'enviado_reciente' })
  })

  it('sin correo o sin texto publicado no sale', () => {
    const sinCorreo = leerEstado({ ...base, contacto: { nombre: 'Ana', email: null } })
    expect(debeEnviarCorreo({ estado: sinCorreo, config: encendido, origen: 'al_crear', textoPublicado: true, ahoraMs })).toEqual({ ok: false, motivo: 'sin_correo' })
    expect(debeEnviarCorreo({ estado: leerEstado(base), config: encendido, origen: 'al_crear', textoPublicado: false, ahoraMs })).toEqual({ ok: false, motivo: 'sin_texto' })
  })
})
