import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * «Quiero una demostración» es idempotente por espacio: el segundo clic (u otra persona del mismo
 * CDA, u otra pestaña) no crea otro lead ni vuelve a avisar. La garantía la da el único
 * `(workspace_origen_id, servicio)` de `interes_servicios`; este doble lo replica devolviendo 23505
 * como la base, y ESCRIBE de verdad, para poder contar cuántos contactos quedaron.
 *
 * Y la medición: una fila por evento, con el espacio y la persona de quien llama, y nunca lanza.
 */

interface Fila {
  [k: string]: unknown
}

function dobleSupabase() {
  const tablas: Record<string, Fila[]> = {
    interes_servicios: [],
    contactos: [],
    sugerencias_eventos: [],
    profiles: [{ id: 'u1', full_name: 'Ana María Ruiz' }, { id: 'u2', full_name: 'Pedro Gil' }],
    workspaces: [{ id: 'ws-cda', slug: 'cda-norte', name: 'CDA Norte' }],
  }
  let secuencia = 0
  const fallarEn = new Set<string>()

  function from(tabla: string) {
    const filtros: [string, unknown][] = []
    const filtrar = () => tablas[tabla].filter((f) => filtros.every(([k, v]) => f[k] === v))
    const q = {
      select: () => q,
      eq: (k: string, v: unknown) => {
        filtros.push([k, v])
        return q
      },
      maybeSingle: async () => ({ data: filtrar()[0] ?? null, error: null }),
      insert: (fila: Fila) => {
        const resultado = (() => {
          if (fallarEn.has(tabla)) return { data: null, error: { code: '42501', message: `sin permiso en ${tabla}` } }
          if (
            tabla === 'interes_servicios' &&
            tablas[tabla].some((f) => f.workspace_origen_id === fila.workspace_origen_id && f.servicio === fila.servicio)
          ) {
            return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }
          }
          const nueva = { id: `id-${++secuencia}`, ...fila }
          tablas[tabla].push(nueva)
          return { data: { id: nueva.id }, error: null }
        })()
        return {
          select: () => ({ maybeSingle: async () => resultado }),
          then: (ok: (r: { error: unknown }) => unknown) => Promise.resolve({ error: resultado.error }).then(ok),
        }
      },
      update: (cambios: Fila) => ({
        eq: async (k: string, v: unknown) => {
          for (const f of tablas[tabla]) if (f[k] === v) Object.assign(f, cambios)
          return { error: null }
        },
      }),
      delete: () => ({
        eq: async (k: string, v: unknown) => {
          tablas[tabla] = tablas[tabla].filter((f) => f[k] !== v)
          return { error: null }
        },
      }),
    }
    return q
  }

  return {
    tablas,
    fallarEn,
    cliente: {
      from,
      auth: { admin: { getUserById: async (id: string) => ({ data: { user: { email: `${id}@cda.co` } } }) } },
    },
  }
}

let doble = dobleSupabase()
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => doble.cliente }))

const { pedirContactoSustenta, registrarEventoSugerencia } = await import('./sustenta-servidor')

const pedir = (usuarioId: string) =>
  pedirContactoSustenta({
    workspaceId: 'ws-cda',
    usuarioId,
    role: 'owner',
    empresaIdEnMetrik: null,
    cobradorId: 'otro-espacio',
    empresaNombre: 'CDA Norte S.A.S.',
  })

describe('«Quiero una demostración»', () => {
  const fetchEspia = vi.fn(async () => new Response('{}', { status: 200 }))

  beforeEach(() => {
    doble = dobleSupabase()
    fetchEspia.mockClear()
    vi.stubGlobal('fetch', fetchEspia)
    vi.stubEnv('RESEND_API_KEY', 'prueba')
  })

  it('la primera vez crea UN lead, avisa una vez y devuelve el primer nombre', async () => {
    const r = await pedir('u1')
    expect(r).toEqual({ ok: true, yaExistia: false, avisoEnviado: true, nombre: 'Ana' })
    expect(doble.tablas.interes_servicios).toHaveLength(1)
    expect(doble.tablas.contactos).toHaveLength(1)
    expect(doble.tablas.interes_servicios[0].contacto_id).toBe(doble.tablas.contactos[0].id)
    expect(fetchEspia).toHaveBeenCalledTimes(1)
  })

  it('el segundo clic no crea otro lead ni vuelve a avisar', async () => {
    await pedir('u1')
    const r = await pedir('u1')
    expect(r).toEqual({ ok: true, yaExistia: true, avisoEnviado: false, nombre: null })
    expect(doble.tablas.interes_servicios).toHaveLength(1)
    expect(doble.tablas.contactos).toHaveLength(1)
    expect(fetchEspia).toHaveBeenCalledTimes(1)
  })

  it('otra persona del mismo CDA tampoco: el lead es por espacio', async () => {
    await pedir('u1')
    const r = await pedir('u2')
    expect(r.ok && r.yaExistia).toBe(true)
    expect(doble.tablas.contactos).toHaveLength(1)
  })

  it('si el contacto no se pudo crear, suelta el reclamo para poder reintentar', async () => {
    doble.fallarEn.add('contactos')
    const fallo = await pedir('u1')
    expect(fallo.ok).toBe(false)
    expect(doble.tablas.interes_servicios).toHaveLength(0)
    doble.fallarEn.delete('contactos')
    const reintento = await pedir('u1')
    expect(reintento.ok && !reintento.yaExistia).toBe(true)
    expect(doble.tablas.contactos).toHaveLength(1)
  })

  it('el aviso a MeTRIK habla de una demostración', async () => {
    await pedir('u1')
    const cuerpo = JSON.parse((fetchEspia.mock.calls[0] as unknown as [string, { body: string }])[1].body)
    expect(cuerpo.subject).toBe('[ONE · cda-norte] CDA Norte S.A.S. pidió una demostración de Sustenta')
    expect(cuerpo.reply_to).toBe('u1@cda.co')
  })
})

describe('la medición', () => {
  beforeEach(() => {
    doble = dobleSupabase()
  })

  it('una fila por evento, con el espacio y la persona que llama', async () => {
    await registrarEventoSugerencia({ workspaceId: 'ws-cda', usuarioId: 'u1', evento: 'vista' })
    await registrarEventoSugerencia({ workspaceId: 'ws-cda', usuarioId: 'u1', evento: 'vista' })
    await registrarEventoSugerencia({ workspaceId: 'ws-cda', usuarioId: 'u1', evento: 'cta', origen: 'panel' })
    expect(doble.tablas.sugerencias_eventos).toHaveLength(3)
    expect(doble.tablas.sugerencias_eventos[2]).toMatchObject({
      workspace_id: 'ws-cda',
      profile_id: 'u1',
      clave: 'sustenta',
      evento: 'cta',
      origen: 'panel',
    })
  })

  it('solo el clic lleva origen', async () => {
    await registrarEventoSugerencia({ workspaceId: 'ws-cda', usuarioId: 'u1', evento: 'descarte', origen: 'panel' })
    expect(doble.tablas.sugerencias_eventos[0].origen).toBeNull()
  })

  it('si la escritura falla no lanza: una medición no rompe la pantalla', async () => {
    doble.fallarEn.add('sugerencias_eventos')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(registrarEventoSugerencia({ workspaceId: 'ws-cda', usuarioId: 'u1', evento: 'panel' })).resolves.toBeUndefined()
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
})
