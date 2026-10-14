import { describe, expect, it } from 'vitest'
import { facturacionEncendida, leerConfigFacturacion } from './config'

const WS = '6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
const SET = '2f1c9f76-7a37-4d93-9e79-2fbe7b7a7b1a'

const base = {
  FACTURACION_ELECTRONICA_HABILITADA: '1',
  ALIADDO_TOKEN: 'tok',
  ALIADDO_EMISOR_WORKSPACE_ID: WS,
}

describe('leerConfigFacturacion', () => {
  it('apagada por defecto', () => {
    expect(facturacionEncendida({})).toBe(false)
    expect(leerConfigFacturacion({})).toMatchObject({ ok: false, motivo: 'apagada' })
    expect(leerConfigFacturacion({ FACTURACION_ELECTRONICA_HABILITADA: 'true' })).toMatchObject({ ok: false, motivo: 'apagada' })
  })

  it('encendida sin token, modo o emisor: incompleta', () => {
    const r = leerConfigFacturacion({ FACTURACION_ELECTRONICA_HABILITADA: '1' })
    expect(r).toMatchObject({ ok: false, motivo: 'incompleta' })
    expect(r.ok ? '' : r.detalle).toContain('ALIADDO_TOKEN')
  })

  it('el modo va con sus mayúsculas exactas', () => {
    expect(leerConfigFacturacion({ ...base, ALIADDO_MODO: 'test' })).toMatchObject({ ok: false, motivo: 'incompleta' })
  })

  it('Test fuera de producción: sirve, con la URL de la doc por defecto', () => {
    expect(leerConfigFacturacion({ ...base, ALIADDO_MODO: 'Test', VERCEL_ENV: 'preview' })).toEqual({
      ok: true,
      config: {
        token: 'tok',
        modo: 'Test',
        apiUrl: 'https://api.muisca.io',
        testSetId: null,
        archivosUrl: null,
        emisorWorkspaceId: WS,
        desde: null,
      },
    })
  })

  it('Habilitation exige el testSetId', () => {
    expect(leerConfigFacturacion({ ...base, ALIADDO_MODO: 'Habilitation' })).toMatchObject({ ok: false, motivo: 'incompleta' })
    const r = leerConfigFacturacion({ ...base, ALIADDO_MODO: 'Habilitation', ALIADDO_TEST_SET_ID: SET })
    expect(r).toMatchObject({ ok: true, config: { testSetId: SET } })
  })

  it('Production solo en el despliegue de producción, y producción solo en Production', () => {
    expect(leerConfigFacturacion({ ...base, ALIADDO_MODO: 'Production', VERCEL_ENV: 'preview' })).toMatchObject({ ok: false, motivo: 'modo_no_permitido' })
    expect(leerConfigFacturacion({ ...base, ALIADDO_MODO: 'Production' })).toMatchObject({ ok: false, motivo: 'modo_no_permitido' })
    expect(leerConfigFacturacion({ ...base, ALIADDO_MODO: 'Test', VERCEL_ENV: 'production' })).toMatchObject({ ok: false, motivo: 'modo_no_permitido' })
    expect(leerConfigFacturacion({ ...base, ALIADDO_MODO: 'Production', VERCEL_ENV: 'production' })).toMatchObject({ ok: true })
  })

  it('la fecha de arranque del barrido tiene que ser una fecha', () => {
    expect(leerConfigFacturacion({ ...base, ALIADDO_MODO: 'Test', FACTURACION_ELECTRONICA_DESDE: '20-10-2026' })).toMatchObject({ ok: false })
    expect(leerConfigFacturacion({ ...base, ALIADDO_MODO: 'Test', FACTURACION_ELECTRONICA_DESDE: '2026-10-20' })).toMatchObject({ ok: true, config: { desde: '2026-10-20' } })
  })
})
