/**
 * Dos server actions registradas que no pedian sesion y leian con credenciales globales.
 *
 * Hallazgo de la segunda ronda del riesgo 11, barriendo el manifiesto de server actions
 * del build (no estaban en la lista del encargo):
 *   - `consultarEpayco(refPayco)` consulta la cuenta de ePayco de las variables de entorno
 *     y devuelve el desglose de la transaccion, con el nombre del pagador y los montos.
 *     Las referencias son numericas: sin sesion se podian recorrer.
 *   - `listarConsultas()` de `valida.ts` lista las ultimas consultas SARLAFT hechas con la
 *     llave global de Valida: nombres y documentos consultados.
 *
 * Lo que se fija aqui: sin sesion ninguna de las dos sale a la red; con sesion, si.
 *
 * VISTO FALLAR (2026-09-16) contra `epayco-actions.ts` y `valida.ts` de `origin/main`:
 * caen los 2 casos sin sesion; los 2 con sesion siguen verdes. Quitando cada guarda del
 * archivo nuevo cae 1 caso por guarda.
 *
 * TERCERA RONDA (2026-09-16): la sesion no basta. La cuenta de ePayco es la de SOENA y la
 * llave de Valida es la GLOBAL de MeTRIK: ahora las abre el modulo del workspace
 * (`fab_pago_epayco`; Sustenta, que es de quien es `/compliance/validacion`). Los casos
 * "con sesion" pasan a declarar el workspace con el que corren, y se agregan los de un
 * workspace con sesion y sin el modulo (4D SOFT, Termotech, un CDA).
 * VISTO FALLAR contra `origin/main`: caen los 4 casos sin modulo; los de control siguen
 * verdes. Quitando la guarda de modulo de `consultarEpayco` caen 2; de `validarPersona`, 1;
 * de `listarConsultas`, 1.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

const sesion: { workspaceId: string | null } = { workspaceId: null }

const consultarTransaccionEpayco = vi.fn(async (_ref: number) => ({ estado: 'Rechazada' }))
const fetchValida = vi.fn(async (_url: unknown, _init?: unknown) => ({
  ok: true,
  status: 200,
  json: async () => ({ consultas: [] }),
}))

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({
    supabase: {},
    workspaceId: sesion.workspaceId,
    error: sesion.workspaceId ? null : 'No autenticado',
  }),
}))
vi.mock('@/lib/epayco', () => ({
  consultarTransaccionEpayco: (ref: number) => consultarTransaccionEpayco(ref),
}))
vi.mock('@/lib/siigo/recibo-automatico', () => ({ emitirReciboAutomatico: async () => null }))
vi.mock('@/lib/cobros/aviso-sobrepago-servidor', () => ({ avisarSobrepagoSiCorresponde: async () => null }))
vi.mock('@/lib/modulos/exigir-modulo', async () =>
  (await import('../../../test/exigir-modulo-doble')).dobleExigirModulo())

import { consultarEpayco, registrarPagoEpayco } from './epayco-actions'
import { listarConsultas, validarPersona } from './valida'
import { estadoModulo, MODULES, reiniciarModulo } from '../../../test/exigir-modulo-doble'

/** La sesion de las pruebas: `getWorkspace` y la puerta de modulo ven el mismo workspace. */
function conSesion(workspaceId: string | null, modules: Record<string, boolean> | null) {
  sesion.workspaceId = workspaceId
  reiniciarModulo(workspaceId ?? '', modules)
  estadoModulo.workspaceId = workspaceId
}

beforeEach(() => {
  conSesion(null, null)
  consultarTransaccionEpayco.mockClear()
  fetchValida.mockClear()
  vi.stubGlobal('fetch', fetchValida)
  process.env.VALIDA_API_KEY = 'llave-global-de-prueba'
})

describe('consultarEpayco', () => {
  it('sin sesion no consulta ePayco', async () => {
    const r = await consultarEpayco('123456')
    expect(r).toEqual({ success: false, error: 'No autenticado' })
    expect(consultarTransaccionEpayco).not.toHaveBeenCalled()
  })

  it('SOENA (cobra por ePayco) consulta', async () => {
    conSesion('ws-soena', { ...MODULES.soena })
    await consultarEpayco('123456')
    expect(consultarTransaccionEpayco).toHaveBeenCalledWith(123456)
  })

  it('4D SOFT, con sesion y sin Clarity, no recorre los pagos de SOENA', async () => {
    conSesion('ws-4dsoft', { ...MODULES.cuatroDSoft })
    const r = await consultarEpayco('123456')
    expect(r.success).toBe(false)
    expect(consultarTransaccionEpayco).not.toHaveBeenCalled()
  })

  it('Termotech, Clarity sin pasarela, tampoco: la cuenta es la de SOENA', async () => {
    conSesion('ws-termotech', { ...MODULES.termotech })
    const r = await consultarEpayco('123456')
    expect(r.success).toBe(false)
    expect(consultarTransaccionEpayco).not.toHaveBeenCalled()
  })

  it('registrar un pago ePayco tampoco re-consulta la cuenta sin el modulo', async () => {
    conSesion('ws-termotech', { ...MODULES.termotech })
    const desglose = { ref_payco: 123456 } as unknown as Parameters<typeof registrarPagoEpayco>[2]
    const r = await registrarPagoEpayco('bloque-1', 'neg-1', desglose, 'pago', { validarEpayco: true })
    expect(r.success).toBe(false)
    expect(consultarTransaccionEpayco).not.toHaveBeenCalled()
  })
})

describe('listarConsultas y validarPersona (Valida con la llave global)', () => {
  it('sin sesion no llama a Valida', async () => {
    const r = await listarConsultas()
    expect(r.ok).toBe(false)
    expect(fetchValida).not.toHaveBeenCalled()
  })

  it('alma-afi (Sustenta, de quien es /compliance/validacion) llama', async () => {
    conSesion('ws-alma', { ...MODULES.almaAfi })
    const r = await listarConsultas()
    expect(r.ok).toBe(true)
    expect(fetchValida).toHaveBeenCalledTimes(1)
  })

  it('4D SOFT no lista las consultas de la llave de MeTRIK', async () => {
    conSesion('ws-4dsoft', { ...MODULES.cuatroDSoft })
    const r = await listarConsultas()
    expect(r).toEqual({ ok: false, error: 'modulo_no_activo' })
    expect(fetchValida).not.toHaveBeenCalled()
  })

  it('un CDA con su propio modulo Valida tampoco consulta con la llave de MeTRIK', async () => {
    conSesion('ws-cda', { ...MODULES.cda })
    const r = await validarPersona({ tipo: 'natural', nombre: 'Juan Perez' })
    expect(r).toEqual({ ok: false, error: 'modulo_no_activo' })
    expect(fetchValida).not.toHaveBeenCalled()
  })
})
