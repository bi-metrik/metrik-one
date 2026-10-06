import { describe, expect, it, vi } from 'vitest'
import { filasDeEventos, guardarEventosRed } from './guardar-eventos'
import type { EventoRed } from './eventos'

const T = 1_790_000_000_000
const ctx = { workspaceId: 'ws-1', personaStaffId: 'staff-1', operador: 'Claro', asn: 14080, ciudad: 'Bogotá', dispositivo: 'escritorio' }

const eventos: EventoRed[] = [
  { tipo: 'pulso', id: 'p1', t0: T, t1: T + 300_000, visible_ms: 300_000, offline_ms: 0, sw: true, vercel: { n: 20, perdidas: 1 }, control: { n: 20, perdidas: 0 } },
  { tipo: 'corte', id: 'c1', inicio: T + 10_000, dur_ms: 4_200.4, vercel: true, control: false, sw: true },
  { tipo: 'falla', id: 'f1', t: T + 20_000, superficie: 'carga', recuperado: true, intentos: 2 },
]

describe('red_eventos: filas', () => {
  it('una fila por evento, con su fecha, superficie y el resto en detalle', () => {
    const [p, c, f] = filasDeEventos(ctx, eventos)
    expect(p).toMatchObject({ id: 'p1', tipo: 'pulso', superficie: null, dur_ms: null, sw: true, ocurrido_at: new Date(T + 300_000).toISOString() })
    expect(p.detalle).toMatchObject({ visible_ms: 300_000, vercel: { n: 20, perdidas: 1 } })
    expect(p.detalle).not.toHaveProperty('id')
    expect(c).toMatchObject({ tipo: 'corte', dur_ms: 4_200, operador: 'Claro', asn: 14080, persona_staff_id: 'staff-1' })
    expect(c.detalle).toMatchObject({ vercel: true, control: false })
    expect(f).toMatchObject({ tipo: 'falla', superficie: 'carga', sw: null, workspace_id: 'ws-1' })
    expect(f.detalle).toMatchObject({ recuperado: true, intentos: 2 })
  })

  it('upsert por id que ignora repetidos; un error no lanza', async () => {
    const upsert = vi.fn(async () => ({ error: null }))
    const svc = { from: vi.fn(() => ({ upsert })) }
    expect(await guardarEventosRed(svc as never, ctx, eventos)).toBe(true)
    expect(svc.from).toHaveBeenCalledWith('red_eventos')
    expect(upsert).toHaveBeenCalledWith(expect.any(Array), { onConflict: 'id', ignoreDuplicates: true })

    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const malo = { from: () => ({ upsert: async () => ({ error: { message: 'relation does not exist' } }) }) }
    expect(await guardarEventosRed(malo as never, ctx, eventos)).toBe(false)
    err.mockRestore()
  })
})
