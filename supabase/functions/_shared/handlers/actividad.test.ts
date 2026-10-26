import { beforeEach, describe, expect, it, vi } from 'vitest'

// La ruta sin agente (`handleActividad`): de una nota de voz guarda la transcripción entera, no lo que entendió el parser.

vi.mock('../wa-lookup.ts', () => ({
  findNegocioByCode: vi.fn(async () => ({ id: 'n-s', nombre: 'Clarity — Sabor', codigo: 'S2 26 1' })),
  findNegocios: vi.fn(async () => []),
  findActiveNegocios: vi.fn(async () => [
    { id: 'n-s', nombre: 'Clarity — Sabor', codigo: 'S2 26 1' },
    { id: 'n-a', nombre: 'Concesión', codigo: 'A1 26 1' },
  ]),
  clienteDelNegocio: () => null,
}))
vi.mock('../wa-session.ts', () => ({ completeSession: vi.fn(async () => {}) }))

import { handleActividad } from './actividad'

// Del tamaño de la nota del 2026-10-26 (4.451 caracteres). Texto inventado.
const DICTADO = Array.from({ length: 60 }, (_, i) => `En el evento, punto ${i + 1}: la cocina trabaja con siete personas de planta.`).join(' ')
const DEL_PARSER = 'Evento del viernes: cocina con siete personas de planta.'

let filas: Array<{ contenido: string }>
let enviados: string[]

function ctxDe(p: { tipo: 'audio' | 'text'; texto: string; fields: Record<string, unknown>; state?: string; context?: Record<string, unknown>; boton?: string }) {
  const supabase = {
    from: (tabla: string) => ({
      insert: async (rows: Array<{ contenido: string }>) => { if (tabla === 'activity_log') filas.push(...rows); return { error: null } },
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  }
  const ctx = {
    user: { workspace_id: 'w', user_id: null, name: 'Mauricio Prueba' },
    message: { phone: '573000000000', text: p.texto, type: p.tipo, interactive_reply: p.boton },
    session: { id: 's', state: p.state ?? 'started', context: p.context ?? {} },
    parsed: { intent: 'ACTIVIDAD', fields: p.fields },
    supabase,
    sendMessage: async (t: string) => { enviados.push(t) },
    sendOptions: async () => {},
    sendButtons: async (t: string) => { enviados.push(t) },
    updateSession: vi.fn(async () => {}),
  }
  return ctx
}

const guardado = () => filas.map((f) => f.contenido.replace(/^\S+ \[Mauricio Prueba\] (\(\d+\/\d+\) )?/, '')).join(' ')

beforeEach(() => { filas = []; enviados = [] })

describe('ruta sin agente: una nota de voz se guarda tal cual', () => {
  it('con el código del negocio: la transcripción entera, con lo del parser arriba como resumen', async () => {
    await handleActividad(ctxDe({ tipo: 'audio', texto: DICTADO, fields: { project_code: 'S2 26 1', activity_text: DEL_PARSER } }) as never)
    expect(filas.length).toBeGreaterThan(15)
    for (const f of filas) expect([...f.contenido].length).toBeLessThanOrEqual(280)
    const todo = guardado().replace(/\s+/g, '')
    expect(todo.startsWith(`Resumen:${DEL_PARSER}`.replace(/\s+/g, ''))).toBe(true)
    expect(todo).toContain(DICTADO.replace(/\s+/g, ''))
    expect(enviados.at(-1)).toMatch(/con tu nota de voz tal cual en \d+ comentarios seguidos$/)
  })

  it('cuando pregunta el negocio, el toque guarda la nota entera y lo dice', async () => {
    const primero = ctxDe({ tipo: 'audio', texto: DICTADO, fields: { activity_text: DEL_PARSER } })
    await handleActividad(primero as never)
    expect(filas).toEqual([])
    const guardadoEnSesion = primero.updateSession.mock.calls[0][1] as Record<string, unknown>
    expect(guardadoEnSesion.activity_tal_cual).toBe(true)
    await handleActividad(ctxDe({
      tipo: 'text', texto: 'S2 26 1', fields: {}, state: 'awaiting_selection', boton: 'act_pick_0',
      context: { ...guardadoEnSesion, options: [{ id: 'pick_0', label: 'Clarity — Sabor', extra: { negocio_id: 'n-s' } }] },
    }) as never)
    expect(guardado().replace(/\s+/g, '')).toContain(DICTADO.replace(/\s+/g, ''))
    expect(enviados.at(-1)).toMatch(/con tu nota de voz tal cual/)
  })

  it('un escrito sigue guardando lo que entendió el parser, y no promete «completo»', async () => {
    const largo = Array.from({ length: 10 }, (_, i) => `Punto ${i + 1}: revisamos el cobro con la gente de Alfa y quedó pendiente.`).join(' ')
    await handleActividad(ctxDe({ tipo: 'text', texto: `en el S2 26 1: ${largo}`, fields: { project_code: 'S2 26 1', activity_text: largo } }) as never)
    expect(guardado().replace(/\s+/g, '')).toBe(largo.replace(/\s+/g, ''))
    expect(enviados.at(-1)).not.toMatch(/complet|tal cual/)
    expect(enviados.at(-1)).toMatch(/, en \d+ comentarios seguidos$/)
  })
})
