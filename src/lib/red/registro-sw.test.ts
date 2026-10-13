import { describe, expect, it, vi } from 'vitest'
import { sincronizarServiceWorker } from './registro-sw'

function registro(script: string) {
  return { active: { scriptURL: `https://soena.metrikone.co${script}` }, unregister: vi.fn(async () => true) } as unknown as ServiceWorkerRegistration
}

describe('registro del service worker', () => {
  it('activo lo registra con alcance / y sin cache HTTP para la revisión', async () => {
    const register = vi.fn(async () => ({}) as ServiceWorkerRegistration)
    const r = await sincronizarServiceWorker(true, { register, getRegistrations: vi.fn() })
    expect(r).toBe('registrado')
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/', updateViaCache: 'none' })
  })

  it('inactivo (interruptor apagado o fuera de producción) desregistra SOLO el suyo', async () => {
    const propio = registro('/sw.js')
    const ajeno = registro('/otro-sw.js')
    const r = await sincronizarServiceWorker(false, { register: vi.fn(), getRegistrations: async () => [propio, ajeno] })
    expect(r).toBe('desregistrado')
    expect(propio.unregister).toHaveBeenCalled()
    expect(ajeno.unregister).not.toHaveBeenCalled()
  })

  it('sin soporte o con error no rompe nada', async () => {
    expect(await sincronizarServiceWorker(true, null)).toBe('sin-soporte')
    const register = vi.fn(async () => {
      throw new Error('SecurityError')
    })
    expect(await sincronizarServiceWorker(true, { register, getRegistrations: vi.fn() })).toBe('error')
    expect(await sincronizarServiceWorker(false, { register: vi.fn(), getRegistrations: async () => [] })).toBe('nada')
  })
})
