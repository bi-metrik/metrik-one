/**
 * `registrarDevolucionDinero` (SOE-007): quién puede, y qué llega a la base.
 *
 * El permiso se prueba por el camino REAL (`ctxPagosExternos` → `puedeGestionarPagosExternos`):
 * solo se reemplaza `getWorkspace`. La función de la base se reemplaza por un doble que
 * registra la llamada; lo que la base hace con ella (neto, cierre, caso ya cerrado, cobro
 * intacto) lo prueba `lib/cobros/devolucion-dinero-sql.test.ts` contra Postgres.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const WS = '00000000-0000-4000-8000-0000000000aa'
const NEGOCIO = '00000000-0000-4000-8000-0000000000bb'

let sesion: { role: string; areas: string[] } = { role: 'owner', areas: [] }
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({
    supabase: {},
    workspaceId: WS,
    userId: 'perfil-1',
    staffId: 'staff-1',
    role: sesion.role,
    areas: sesion.areas,
    error: null,
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
// La idempotencia no es lo que se prueba aquí: pasa directo a la acción.
vi.mock('@/lib/idempotencia/accion', () => ({
  accionIdempotente: (_o: unknown, fn: () => unknown) => fn(),
}))

const rpc = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({ rpc: (...a: unknown[]) => rpc(...a) }),
}))

import { registrarDevolucionDinero } from './devoluciones-dinero'

const ENTRADA = {
  negocio_id: NEGOCIO,
  monto: 637500,
  fecha: '2026-10-08',
  motivo: 'La clienta desistió y se le devolvió el anticipo',
  cerrar_caso: false,
}

beforeEach(() => {
  rpc.mockReset()
  rpc.mockResolvedValue({
    data: { ok: true, devolucion_id: 'd-1', cerro_caso: false, ya_cerrado: false, neto_antes: 637500, neto_despues: 0 },
    error: null,
  })
  sesion = { role: 'owner', areas: [] }
})

describe('quién puede registrar una devolución', () => {
  it.each([
    ['owner', []],
    ['admin', []],
    ['supervisor', ['financiera']],
    ['operator', ['financiera']],
    ['supervisor', ['direccion']],
  ])('%s con áreas %j sí', async (role, areas) => {
    sesion = { role, areas }
    const r = await registrarDevolucionDinero(ENTRADA)
    expect(r).toMatchObject({ success: true })
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['supervisor', ['comercial']],
    ['operator', ['operaciones']],
    ['operator', []],
    ['contador', ['financiera']],
    ['read_only', ['financiera']],
  ])('%s con áreas %j no, y no llega a la base', async (role, areas) => {
    sesion = { role, areas }
    const r = await registrarDevolucionDinero(ENTRADA)
    expect(r).toMatchObject({ success: false })
    expect((r as { error: string }).error).toMatch(/financiera/)
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('lo que llega a la base', () => {
  it('sin cierre: no manda razón', async () => {
    await registrarDevolucionDinero({ ...ENTRADA, razon_cierre: 'desistio' })
    const [nombre, args] = rpc.mock.calls[0]
    expect(nombre).toBe('registrar_devolucion_dinero')
    expect(args).toMatchObject({
      p_workspace_id: WS,
      p_negocio_id: NEGOCIO,
      p_fecha: '2026-10-08',
      p_monto: 637500,
      p_cerrar_caso: false,
      p_razon_cierre: null,
      p_profile_id: 'perfil-1',
      p_staff_id: 'staff-1',
      p_soporte: null,
    })
  })

  it('con cierre: manda la razón y su etiqueta para el historial', async () => {
    rpc.mockResolvedValue({
      data: { ok: true, devolucion_id: 'd-1', cerro_caso: true, ya_cerrado: false, neto_antes: 637500, neto_despues: 0 },
      error: null,
    })
    const r = await registrarDevolucionDinero({ ...ENTRADA, cerrar_caso: true, razon_cierre: 'desistio' })
    expect(r).toEqual({ success: true, cerro_caso: true, ya_cerrado: false, neto_despues: 0 })
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_cerrar_caso: true,
      p_razon_cierre: 'desistio',
      p_razon_label: 'El cliente desistio',
    })
  })

  it('un caso ya cerrado: lo dice, sin error', async () => {
    rpc.mockResolvedValue({
      data: { ok: true, devolucion_id: 'd-1', cerro_caso: false, ya_cerrado: true, neto_antes: 637500, neto_despues: 0 },
      error: null,
    })
    const r = await registrarDevolucionDinero({ ...ENTRADA, cerrar_caso: true })
    expect(r).toMatchObject({ success: true, cerro_caso: false, ya_cerrado: true })
  })

  it('el rechazo de la base por superar el neto llega en palabras', async () => {
    rpc.mockResolvedValue({ data: { ok: false, codigo: 'supera_neto', neto: 337500 }, error: null })
    const r = await registrarDevolucionDinero({ ...ENTRADA, monto: 400000 })
    expect(r).toMatchObject({ success: false })
    expect((r as { error: string }).error).toMatch(/recaudado neto/)
    expect((r as { error: string }).error).toMatch(/337\.500/)
  })

  it('valida antes de llamar: monto, fecha futura, motivo y razón inventada', async () => {
    for (const malo of [
      { monto: 0 },
      { fecha: '2999-01-01' },
      { motivo: 'corto' },
      { cerrar_caso: true, razon_cierre: 'inventada' },
    ]) {
      const r = await registrarDevolucionDinero({ ...ENTRADA, ...malo })
      expect(r, JSON.stringify(malo)).toMatchObject({ success: false })
    }
    expect(rpc).not.toHaveBeenCalled()
  })

  it('un soporte fuera del workspace se rechaza sin llamar a la base', async () => {
    const r = await registrarDevolucionDinero({
      ...ENTRADA,
      soporte: { storage_path: 'otro-ws/devoluciones/x.pdf', file_name: 'x.pdf' },
    })
    expect(r).toMatchObject({ success: false })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('el soporte viaja como referencia de ONE, no como URL pública', async () => {
    await registrarDevolucionDinero({
      ...ENTRADA,
      soporte: { storage_path: `${WS}/devoluciones/x.pdf`, file_name: 'x.pdf', mime_type: 'application/pdf' },
    })
    const soporte = rpc.mock.calls[0][1].p_soporte as Record<string, unknown>
    expect(soporte.storage_path).toBe(`${WS}/devoluciones/x.pdf`)
    expect(String(soporte.url)).toMatch(/^one:\/\//)
  })
})
