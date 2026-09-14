import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => ({}) }))

import { leerSecretosWorkspace, secretoConRespaldo, workspacePorSecreto } from './workspace'

function cliente(respuesta: { data: unknown; error: { code?: string; message: string } | null }) {
  const rpc = vi.fn(async () => respuesta)
  return { rpc }
}

describe('leerSecretosWorkspace', () => {
  it('devuelve solo claves conocidas con texto', async () => {
    const c = cliente({
      data: { drive_refresh_token: 'rt', siigo_access_key: '', otra_cosa: 'x', valida_api_key: 42 },
      error: null,
    })
    await expect(leerSecretosWorkspace('ws-1', c)).resolves.toEqual({ drive_refresh_token: 'rt' })
    expect(c.rpc).toHaveBeenCalledWith('leer_secretos_workspace', { p_workspace_id: 'ws-1' })
  })

  it('sin la migracion aplicada (PGRST202) responde vacio para caer a config_extra', async () => {
    const c = cliente({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })
    await expect(leerSecretosWorkspace('ws-1', c)).resolves.toEqual({})
  })

  it('cualquier otro error se lanza: no se disfraza de credencial ausente', async () => {
    const c = cliente({ data: null, error: { code: '57014', message: 'timeout' } })
    await expect(leerSecretosWorkspace('ws-1', c)).rejects.toThrow(/timeout/)
  })
})

describe('secretoConRespaldo', () => {
  it('Vault gana sobre config_extra', () => {
    expect(
      secretoConRespaldo({ siigo_access_key: 'vault' }, { siigo_access_key: 'viejo' }, 'siigo_access_key'),
    ).toBe('vault')
  })

  it('sin Vault usa config_extra, incluida la ruta anidada de FunnelChat', () => {
    expect(secretoConRespaldo({}, { valida_api_key: 'k' }, 'valida_api_key')).toBe('k')
    expect(
      secretoConRespaldo({}, { funnelchat: { webhook_token: 't' } }, 'funnelchat_webhook_token'),
    ).toBe('t')
  })

  it('vacios y tipos raros cuentan como ausentes', () => {
    expect(secretoConRespaldo({}, { valida_api_key: '' }, 'valida_api_key')).toBeUndefined()
    expect(secretoConRespaldo({}, { funnelchat: 'no-objeto' }, 'funnelchat_webhook_token')).toBeUndefined()
    expect(secretoConRespaldo({}, null, 'drive_client_id')).toBeUndefined()
  })
})

describe('workspacePorSecreto', () => {
  it('devuelve el workspace que resuelve Vault', async () => {
    const c = cliente({ data: 'ws-9', error: null })
    await expect(workspacePorSecreto('funnelchat_webhook_token', 'tok', c)).resolves.toBe('ws-9')
    expect(c.rpc).toHaveBeenCalledWith('workspace_por_secreto', {
      p_clave: 'funnelchat_webhook_token',
      p_valor: 'tok',
    })
  })

  it('null si nadie la tiene o si falta la migracion; lanza con otros errores', async () => {
    await expect(workspacePorSecreto('funnelchat_webhook_token', 'x', cliente({ data: null, error: null }))).resolves.toBeNull()
    await expect(
      workspacePorSecreto('funnelchat_webhook_token', 'x', cliente({ data: null, error: { code: 'PGRST202', message: '' } })),
    ).resolves.toBeNull()
    await expect(
      workspacePorSecreto('funnelchat_webhook_token', 'x', cliente({ data: null, error: { code: 'XX000', message: 'boom' } })),
    ).rejects.toThrow(/boom/)
  })
})
