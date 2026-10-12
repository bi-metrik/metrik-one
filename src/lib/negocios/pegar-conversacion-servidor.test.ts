/**
 * La server action de «Pegar conversación»: revalida el permiso ANTES de llamar al modelo, escribe con la marca de
 * `updated_at`, y en la actividad queda la huella, nunca el chat. Base y modelo falsos (datos inventados).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const estado = vi.hoisted(() => ({
  guard: { ok: true } as { ok: boolean; error?: string },
  bloque: { data: {} as Record<string, unknown>, updated_at: 't0' as string | null },
  updates: [] as Array<{ data: Record<string, unknown>; marca: string | null | undefined }>,
  /** Cuántas escrituras deben fallar por la marca (alguien guardó en el medio). */
  choques: 0,
  actividad: [] as Array<Record<string, unknown>>,
}))

const CAMPOS = [
  { slug: 'destino', label: 'Destino', tipo: 'texto', nivel: 'minimo', pregunta: '¿A dónde viajan?' },
  { slug: 'adultos', label: 'Adultos', tipo: 'numero', nivel: 'minimo', pregunta: '¿Cuántos adultos viajan?' },
]

function supabaseFalso() {
  return {
    from(tabla: string) {
      expect(tabla).toBe('negocio_bloques')
      let cambios: Record<string, unknown> | null = null
      let marca: string | null | undefined
      const q = {
        select(cols: string) {
          if (cambios) {
            const ok = estado.choques === 0 && marca === estado.bloque.updated_at
            if (estado.choques > 0) {
              estado.choques--
              estado.bloque = { data: { ...estado.bloque.data, adultos: 4 }, updated_at: 't1' }
            }
            if (ok) {
              estado.updates.push({ data: cambios.data as Record<string, unknown>, marca })
              estado.bloque = { data: cambios.data as Record<string, unknown>, updated_at: 't2' }
            }
            return Promise.resolve({ data: ok ? [{ id: 'nb1' }] : [], error: null })
          }
          ;(q as { cols?: string }).cols = cols
          return q
        },
        update(c: Record<string, unknown>) { cambios = c; return q },
        eq(col: string, v: string) { if (col === 'updated_at') marca = v; return q },
        is(col: string) { if (col === 'updated_at') marca = null; return q },
        maybeSingle() {
          const cols = (q as { cols?: string }).cols ?? ''
          if (cols.includes('bloque_configs')) {
            return Promise.resolve({ data: { negocio_id: 'neg1', bloque_configs: { config_extra: { fields: CAMPOS } }, negocios: { codigo: 'P 26 9', nombre: 'Prueba', contactos: { nombre: 'Cliente Inventado' } } }, error: null })
          }
          return Promise.resolve({ data: { ...estado.bloque }, error: null })
        },
      }
      return q
    },
  }
}

vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({ supabase: supabaseFalso(), workspaceId: 'ws1', staffId: 'st1', error: null }),
}))
vi.mock('@/lib/permissions/guard-negocio', () => ({ guardEditarBloque: async () => estado.guard }))
vi.mock('@/lib/negocios/casilla-compartida', () => ({ resolverDestinoCompartido: async (_s: unknown, id: string) => id }))
vi.mock('@/lib/activity/registrar-actividad', () => ({
  registrarActividad: async (_s: unknown, fila: Record<string, unknown>) => { estado.actividad.push(fila); return { ok: true, id: 'a1' } },
}))
vi.mock('@/lib/server-keys', () => ({ getServerKey: () => 'llave-falsa' }))

const CHAT = '[10/10/26, 9:00] Cliente Inventado: queremos ir a Cartagena\n[10/10/26, 9:01] Cliente Inventado: somos 2 adultos'
const salidaModelo = {
  mensajes: [{ n: 1, clase: 'cliente' }, { n: 2, clase: 'cliente' }],
  valores: { destino: { valor: 'Cartagena', frase: 'queremos ir a Cartagena' }, adultos: { valor: '2', frase: 'somos 2 adultos' } },
  dudas: [],
  otros: [],
}
const fetchFalso = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({
  candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(salidaModelo) }] } }],
}), { status: 200 }))

beforeEach(() => {
  estado.guard = { ok: true }
  estado.bloque = { data: {}, updated_at: 't0' }
  estado.updates = []
  estado.choques = 0
  estado.actividad = []
  fetchFalso.mockClear()
  vi.stubGlobal('fetch', fetchFalso)
})

const { pegarConversacion } = await import('./pegar-conversacion-servidor')

describe('pegarConversacion', () => {
  it('sin permiso de editar el bloque no llama al modelo ni escribe', async () => {
    estado.guard = { ok: false, error: 'Tu rol o área no permite editar en esta fase del negocio' }
    const r = await pegarConversacion('nb1', CHAT)
    expect(r.error).toBe('Tu rol o área no permite editar en esta fase del negocio')
    expect(fetchFalso).not.toHaveBeenCalled()
    expect(estado.updates).toEqual([])
  })

  it('llena como sugerido con la marca de updated_at y deja la huella, no el chat, en la actividad', async () => {
    const r = await pegarConversacion('nb1', CHAT)
    expect(r.error).toBeNull()
    expect(estado.updates).toHaveLength(1)
    expect(estado.updates[0].marca).toBe('t0')
    expect(estado.updates[0].data).toMatchObject({ destino: 'CARTAGENA', adultos: 2 })
    expect(Object.keys(estado.updates[0].data._sugeridos as object).sort()).toEqual(['adultos', 'destino'])
    const contenido = String(estado.actividad[0].contenido)
    expect(contenido).toMatch(/^Conversación pegada \(huella [0-9a-f]{16}, 2 mensajes\)\. Sugirió: Destino, Adultos\.$/)
    expect(contenido.toLowerCase()).not.toContain('cartagena')
    expect(estado.actividad[0]).toMatchObject({ autor_id: 'st1', entidad_id: 'neg1', tipo: 'cambio_sistema' })
    // El prompt del chat nombra el viaje; la llave no viaja en el cuerpo.
    const cuerpo = String(fetchFalso.mock.calls[0][1]?.body)
    expect(cuerpo).toContain('El viaje es P 26 9 «Prueba», del cliente Cliente Inventado.')
    expect(cuerpo).not.toContain('llave-falsa')
    if (r.error === null) expect(r.valores).toEqual({ destino: 'CARTAGENA', adultos: 2 })
  })

  it('si alguien guardó mientras el modelo leía, relee y lo de la persona gana', async () => {
    estado.choques = 1
    const r = await pegarConversacion('nb1', CHAT)
    expect(r.error).toBeNull()
    expect(estado.updates).toHaveLength(1)
    expect(estado.updates[0].marca).toBe('t1')
    expect(estado.updates[0].data.adultos).toBe(4)
    expect((estado.updates[0].data._conflictos as Record<string, { valor: unknown }>).adultos.valor).toBe(2)
  })

  it('un modelo que no responde no escribe nada', async () => {
    fetchFalso.mockImplementationOnce(async () => new Response('caído', { status: 503 }))
    const r = await pegarConversacion('nb1', CHAT)
    expect(r.error).toBe('No pude leer la conversación. Intenta de nuevo en un momento.')
    expect(estado.updates).toEqual([])
    expect(estado.actividad).toEqual([])
  })

  it('texto vacío no llega al modelo', async () => {
    expect((await pegarConversacion('nb1', ' \n‎ ')).error).toBe('No hay texto que leer.')
    expect(fetchFalso).not.toHaveBeenCalled()
  })
})
