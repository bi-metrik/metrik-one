/**
 * Lista de correos de prueba del cobro con tarjeta (`VALIDA_COBRO_CORREOS_PRUEBA`), en PRODUCCIÓN y
 * con el interruptor global en `false`: el registro (`crearEspacioValida`) decide con el correo de la
 * SESIÓN, nunca con lo que trae el cuerpo.
 *
 * Lo simulado: la base (`test/tablas-doble.ts`), la sesión, ePayco, la prueba de Valida y la
 * suscripción en prueba. Lo real: `condicionesVigentes`, `versionAceptada`, `pideMetodoPago` y todo
 * `registro-servidor.ts`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { crearDoble, type Tablas } from '../../../test/tablas-doble'

const sesion: { user: { id: string; email: string } | null } = { user: null }
const tablas: Tablas = { valida_registros: [], workspaces: [], profiles: [], staff: [], fiscal_profiles: [] }
const doble = crearDoble(tablas)
const clientesEpayco: unknown[] = []
const pruebas: { conCobro?: boolean }[] = []

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => doble.db }))
vi.mock('@/lib/supabase/auth-user', () => ({ getCachedUser: async () => ({ user: sesion.user }) }))
vi.mock('@/lib/suscripciones/pasarela/epayco', async (original) => ({
  ...(await original<typeof import('@/lib/suscripciones/pasarela/epayco')>()),
  registrarClienteEpayco: async (p: unknown) => {
    clientesEpayco.push(p)
    return { ok: true, ref: 'epayco:CLIENTE:TOKEN' }
  },
}))
vi.mock('./prueba-servidor', () => ({
  emitirPruebaDelEspacio: async (d: { conCobro?: boolean }) => {
    pruebas.push(d)
    return { tipo: 'ok', venceEn: new Date(Date.now() + 7 * 86_400_000).toISOString(), consultas: 10 }
  },
}))
vi.mock('./suscripcion-prueba-servidor', () => ({ asegurarSuscripcionEnPrueba: async () => ({ ok: true }) }))

const ENV_PRODUCCION = {
  VERCEL_ENV: 'production',
  VALIDA_REGISTRO_ABIERTO: '1',
  VALIDA_COBRO_TRAS_PRUEBA: '1',
  EPAYCO_HABILITADO: '1',
  EPAYCO_PUBLIC_KEY_METRIK: 'llave-publica-de-prueba',
  VALIDA_COBRO_CORREOS_PRUEBA: '@metrik.com.co, Diana@AFI.com.co',
  VALIDA_PRUEBA_CONSULTAS: undefined,
  VALIDA_PRUEBA_DIAS: undefined,
}
const envAntes: Record<string, string | undefined> = {}
beforeAll(() => {
  for (const [k, v] of Object.entries(ENV_PRODUCCION)) {
    envAntes[k] = process.env[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})
afterAll(() => {
  for (const [k, v] of Object.entries(envAntes)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})
beforeEach(() => {
  for (const t of Object.values(tablas)) t.length = 0
  clientesEpayco.length = 0
  pruebas.length = 0
})

const TARJETA = { token: 'XCX92PZqBKfmcWFbA', nombres: 'Diana', apellidos: 'Sierra', tipoDocumento: 'CC', documento: '1020304050', celular: '3001234567' }

async function registrar(correo: string, version: 'con' | 'sin', extra: Record<string, unknown> = {}) {
  const { crearEspacioValida } = await import('./registro-servidor')
  const { VIGENTES_CON_COBRO, VIGENTES_SIN_COBRO, versionAceptada } = await import('./condiciones')
  const { dvParaNit } = await import('./datos')
  sesion.user = { id: `u-${correo}`, email: correo }
  return crearEspacioValida({
    razonSocial: 'Empresa Ficticia S.A.S.',
    nit: '901234567',
    dv: dvParaNit('901234567'),
    acepta: true,
    condicionesVersion: versionAceptada(version === 'con' ? VIGENTES_CON_COBRO : VIGENTES_SIN_COBRO),
    recomendadoAfi: false,
    codigoAfi: null,
    ref: null,
    utm: {},
    ip: '181.50.1.2',
    ...(version === 'con' ? { tarjeta: TARJETA } : {}),
    ...extra,
  })
}

describe('registro en producción con la lista de pruebas del cobro', () => {
  it('el interruptor global sigue en false', async () => {
    const { CLAUSULA_COBRO_APROBADA_PARA_PRODUCCION } = await import('./condiciones-cobro')
    expect(CLAUSULA_COBRO_APROBADA_PARA_PRODUCCION).toBe(false)
  })

  it('correo de la sesión en la lista (por dominio): v2.1 + aviso v1.5, la tarjeta va a ePayco y el cobro queda programado', async () => {
    const r = await registrar('mauricio.moreno@METRIK.com.co', 'con')
    expect(r).toMatchObject({ tipo: 'ok' })
    expect(clientesEpayco).toHaveLength(1)
    expect(pruebas).toEqual([expect.objectContaining({ conCobro: true })])
    const reg = tablas.valida_registros[0]
    expect(reg).toMatchObject({ estado: 'creado', metodo_pago_estado: 'registrado', metodo_pago_ref: 'epayco:CLIENTE:TOKEN' })
    expect(String(reg.condiciones_version)).toMatch(/^condiciones-2\.1\+aviso-1\.5\+terminos/)
  })

  it('correo exacto de la lista, con otras mayúsculas: también', async () => {
    const r = await registrar('diana@afi.com.co', 'con')
    expect(r).toMatchObject({ tipo: 'ok' })
    expect(tablas.valida_registros[0]).toMatchObject({ metodo_pago_estado: 'registrado' })
  })

  it('correo fuera de la lista: v1.0 sin tarjeta, aunque el cuerpo mande la tarjeta', async () => {
    const r = await registrar('ana@acme.co', 'sin', { tarjeta: TARJETA })
    expect(r).toMatchObject({ tipo: 'ok' })
    expect(clientesEpayco).toHaveLength(0)
    expect(pruebas).toEqual([expect.objectContaining({ conCobro: false })])
    expect(tablas.valida_registros[0]).toMatchObject({ metodo_pago_estado: 'no_requerido', metodo_pago_ref: null })
    expect(String(tablas.valida_registros[0].condiciones_version)).toMatch(/^condiciones-1\.0\+/)
  })

  it('colarse por el cuerpo: la versión con cobro y la tarjeta sin que la sesión esté en la lista no pasan', async () => {
    const r = await registrar('ana@acme.co', 'con', { correo: 'mauricio.moreno@metrik.com.co' })
    expect(r).toMatchObject({ tipo: 'dato', campo: 'acepta' })
    expect(clientesEpayco).toHaveLength(0)
    expect(tablas.valida_registros).toHaveLength(0)
    expect(tablas.workspaces).toHaveLength(0)
  })

  it('un dominio parecido no entra: @metrik.com.co no habilita a @falso-metrik.com.co ni a @metrik.com.co.evil', async () => {
    for (const correo of ['ana@falso-metrik.com.co', 'ana@metrik.com.co.evil']) {
      const r = await registrar(correo, 'con')
      expect(r).toMatchObject({ tipo: 'dato', campo: 'acepta' })
    }
    expect(clientesEpayco).toHaveLength(0)
  })

  it('con la variable vacía, nadie: ni el dominio que antes estaba', async () => {
    const antes = process.env.VALIDA_COBRO_CORREOS_PRUEBA
    process.env.VALIDA_COBRO_CORREOS_PRUEBA = ' '
    try {
      expect(await registrar('mauricio.moreno@metrik.com.co', 'con')).toMatchObject({ tipo: 'dato', campo: 'acepta' })
      expect(await registrar('mauricio.moreno@metrik.com.co', 'sin')).toMatchObject({ tipo: 'ok' })
      expect(clientesEpayco).toHaveLength(0)
    } finally {
      process.env.VALIDA_COBRO_CORREOS_PRUEBA = antes
    }
  })
})
