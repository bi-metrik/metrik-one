import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => ({}) }))
vi.mock('@/lib/actions/get-workspace', () => ({ getWorkspace: vi.fn() }))

import { borrarIntegracion, guardarLlave, leerBoveda, probarConexion, type Actor } from './boveda-servidor'

const LLAVE = 'sk_live_SECRETA-ABCD1234'
const DUENO: Actor = { workspaceId: 'ws-1', userId: 'u-1', esDueno: true, puedeVer: true }
const ADMIN_METRIK: Actor = { ...DUENO, esDueno: false }

function cliente(respuestas: Record<string, { data: unknown; error: { code?: string; message: string } | null }> = {}) {
  return { rpc: vi.fn(async (fn: string) => respuestas[fn] ?? { data: null, error: null }) }
}

describe('bóveda de llaves', () => {
  it('solo el dueño carga, reemplaza o borra: a nadie más se le llama la base', async () => {
    const c = cliente()
    expect(await guardarLlave(ADMIN_METRIK, 'bold', 'bold_secret_key', LLAVE, c)).toEqual({ ok: false, error: expect.stringMatching(/dueño/) })
    expect(await borrarIntegracion(ADMIN_METRIK, 'bold', c)).toEqual({ ok: false, error: expect.stringMatching(/dueño/) })
    expect(c.rpc).not.toHaveBeenCalled()
  })

  it('guardar manda el actor y conserva la secreta anterior; la respuesta no trae la llave', async () => {
    const c = cliente()
    const r = await guardarLlave(DUENO, 'bold', 'bold_secret_key', `  ${LLAVE} `, c)
    expect(r).toEqual({ ok: true })
    expect(c.rpc).toHaveBeenCalledWith('boveda_guardar', {
      p_workspace_id: 'ws-1', p_clave: 'bold_secret_key', p_valor: LLAVE, p_actor: 'u-1', p_conservar_anterior: true,
    })
    expect(JSON.stringify(r)).not.toContain(LLAVE)
  })

  it('una clave fuera del catálogo o una llave con espacios no se guarda', async () => {
    const c = cliente()
    expect((await guardarLlave(DUENO, 'bold', 'drive_refresh_token', LLAVE, c)).ok).toBe(false)
    expect((await guardarLlave(DUENO, 'bold', 'bold_identity_key', 'con espacios dentro', c)).ok).toBe(false)
    expect(c.rpc).not.toHaveBeenCalled()
  })

  it('si la base falla citando el valor, el valor no sale ni a la respuesta ni al log', async () => {
    const logs: string[] = []
    const sp = vi.spyOn(console, 'error').mockImplementation((...a) => void logs.push(a.join(' ')))
    const c = cliente({ boveda_guardar: { data: null, error: { code: '23514', message: `valor ${LLAVE} rechazado` } } })
    const r = await guardarLlave(DUENO, 'bold', 'bold_secret_key', LLAVE, c)
    sp.mockRestore()
    expect(r.ok).toBe(false)
    expect(JSON.stringify(r) + logs.join()).not.toContain(LLAVE)
  })

  it('borrar desconecta todas las claves de Bold, incluida la anterior', async () => {
    const c = cliente()
    await borrarIntegracion(DUENO, 'bold', c)
    expect(c.rpc).toHaveBeenCalledWith('boveda_borrar', {
      p_workspace_id: 'ws-1', p_claves: ['bold_identity_key', 'bold_secret_key', 'bold_secret_key_anterior'], p_actor: 'u-1',
    })
  })

  it('el estado que llega a la pantalla trae solo configurada, últimos 4 y fecha', async () => {
    const c = cliente({
      // Aunque la base devolviera de más, solo pasan 4 caracteres.
      boveda_estado: { data: [{ clave: 'bold_secret_key', ultimos4: LLAVE, actualizado_at: '2026-10-26T17:00:00Z' }, { clave: 'drive_refresh_token', ultimos4: 'xxxx' }], error: null },
      boveda_auditoria_de: { data: [{ clave: 'bold_secret_key', accion: 'cargar', actor: 'Bibiana', created_at: '2026-10-26T17:00:00Z' }], error: null },
    })
    const r = await leerBoveda('ws-1', c)
    expect(JSON.stringify(r)).not.toContain(LLAVE)
    expect(JSON.stringify(r)).not.toContain('drive_refresh_token')
    expect(r.integraciones[0].claves).toEqual([
      { clave: 'bold_identity_key', etiqueta: 'Llave de identidad', configurada: false, ultimos4: null, actualizadoAt: null },
      { clave: 'bold_secret_key', etiqueta: 'Llave secreta', configurada: true, ultimos4: '1234', actualizadoAt: '2026-10-26T17:00:00Z' },
    ])
    expect(r.auditoria).toEqual([{ clave: 'bold_secret_key', accion: 'cargar', actor: 'Bibiana', createdAt: '2026-10-26T17:00:00Z' }])
  })

  it('probar conexión devuelve solo funciona / no funciona', async () => {
    const c = cliente({ leer_secretos_workspace: { data: { bold_identity_key: LLAVE }, error: null } })
    const r = await probarConexion(DUENO, 'bold', { cliente: c, fetch: (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch })
    expect(r).toEqual({ ok: true, funciona: true })
    const sin = await probarConexion(DUENO, 'bold', { cliente: cliente({ leer_secretos_workspace: { data: {}, error: null } }) })
    expect(sin).toEqual({ ok: true, funciona: false })
  })
})
