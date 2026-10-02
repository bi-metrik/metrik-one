import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/version/build', () => ({ versionDelBuild: () => 'dpl_servidor' }))

const { POST } = await import('./route')

let errorSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => errorSpy.mockRestore())

const enviar = (cuerpo: string, headers: Record<string, string> = {}) =>
  POST(new Request('http://soena.localhost:3000/api/errores-cliente', { method: 'POST', body: cuerpo, headers }))

describe('POST /api/errores-cliente', () => {
  it('deja UNA linea [error-cliente] con nivel error y responde 204', async () => {
    const res = await enviar(JSON.stringify({ message: 'boom', pathname: '/tableros?x=1', version: 'dpl_viejo' }))

    expect(res.status).toBe(204)
    expect(errorSpy).toHaveBeenCalledTimes(1)
    const [etiqueta, linea] = errorSpy.mock.calls[0]
    expect(etiqueta).toBe('[error-cliente]')
    expect(JSON.parse(linea as string)).toMatchObject({
      message: 'boom',
      pathname: '/tableros',
      version: 'dpl_viejo',
      versionServidor: 'dpl_servidor',
    })
  })

  it('registra si la pantalla se recargo sola (autoRecarga)', async () => {
    const res = await enviar(JSON.stringify({ message: 'Load failed', name: 'TypeError', autoRecarga: true }))
    expect(res.status).toBe(204)
    expect(JSON.parse(errorSpy.mock.calls[0][1] as string)).toMatchObject({ autoRecarga: true })
  })

  it('autoRecarga que no es booleano: 400', async () => {
    const res = await enviar(JSON.stringify({ message: 'x', autoRecarga: 'si' }))
    expect(res.status).toBe(400)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('sin message: 400 y nada en el log', async () => {
    const res = await enviar(JSON.stringify({ pathname: '/x' }))
    expect(res.status).toBe(400)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('cuerpo grande: 413 y nada en el log', async () => {
    const res = await enviar(JSON.stringify({ message: 'x'.repeat(9000) }))
    expect(res.status).toBe(413)
    expect(errorSpy).not.toHaveBeenCalled()
  })
})
