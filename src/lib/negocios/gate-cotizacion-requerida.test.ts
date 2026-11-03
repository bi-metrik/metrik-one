/**
 * Gate `cotizacion_requerida` (barrido ámbar, 2026-10-22).
 *
 * VISTO FALLAR (2026-10-22): sin el filtro de vivas → cae «solo rechazadas o vencidas frena»;
 * sin la guarda del opt-in → cae «una etapa que no lo declara no consulta nada».
 */
import { describe, expect, it } from 'vitest'
import { evaluarGateCotizacionRequerida, MENSAJE_GATE_COTIZACION_REQUERIDA } from './gate-cotizacion-requerida'

function doble(filas: Array<{ estado: string | null }>, error: unknown = null) {
  const llamadas: string[] = []
  const filtros: Record<string, unknown> = {}
  const q = {
    select: () => q,
    eq: (c: string, v: unknown) => { filtros[c] = v; return q },
    then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: error ? null : filas, error }).then(ok),
  }
  return { from: (t: string) => { llamadas.push(t); return q }, llamadas, filtros }
}

const args = (gates: string[], mensajes: Record<string, string> = {}) => ({ workspaceId: 'ws-1', negocioId: 'neg-1', gates, mensajes })

describe('evaluarGateCotizacionRequerida', () => {
  it('sin ninguna cotización frena con «Falta armar la cotización»', async () => {
    const sb = doble([])
    expect(await evaluarGateCotizacionRequerida(sb, args(['cotizacion_requerida']))).toBe(MENSAJE_GATE_COTIZACION_REQUERIDA)
    expect(MENSAJE_GATE_COTIZACION_REQUERIDA).toBe('Falta armar la cotización')
    expect(sb.filtros).toMatchObject({ workspace_id: 'ws-1', negocio_id: 'neg-1' })
  })

  it('con una cotización viva pasa (borrador cuenta)', async () => {
    expect(await evaluarGateCotizacionRequerida(doble([{ estado: 'borrador' }]), args(['cotizacion_requerida']))).toBeNull()
    expect(await evaluarGateCotizacionRequerida(doble([{ estado: 'rechazada' }, { estado: 'aceptada' }]), args(['cotizacion_requerida']))).toBeNull()
  })

  it('solo rechazadas o vencidas frena', async () => {
    const sb = doble([{ estado: 'rechazada' }, { estado: 'Vencida' }])
    expect(await evaluarGateCotizacionRequerida(sb, args(['cotizacion_requerida']))).toBe(MENSAJE_GATE_COTIZACION_REQUERIDA)
  })

  it('respeta el mensaje configurado de la etapa', async () => {
    const r = await evaluarGateCotizacionRequerida(doble([]), args(['cotizacion_requerida'], { cotizacion_requerida: 'Arma la cotización primero' }))
    expect(r).toBe('Arma la cotización primero')
  })

  it('si la lectura falla, frena (fail-closed)', async () => {
    const r = await evaluarGateCotizacionRequerida(doble([{ estado: 'borrador' }], { message: 'caída' }), args(['cotizacion_requerida']))
    expect(r).toMatch(/No se pudieron leer las cotizaciones/)
  })

  it('una etapa que no lo declara no consulta nada', async () => {
    const sb = doble([])
    expect(await evaluarGateCotizacionRequerida(sb, args(['margen_sobre_piso']))).toBeNull()
    expect(sb.llamadas).toEqual([])
  })
})
