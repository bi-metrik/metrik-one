import { describe, it, expect } from 'vitest'
import { buscarContactoDuplicado, mensajeDuplicado, type ContactoDuplicado } from './dedup'

const WS = '7dea141d-d4da-483d-a78d-b14ef35500c5'

/** Supabase falso: registra con qué se llamó la RPC y devuelve lo que se le diga. */
function fakeSupabase(respuesta: { data?: unknown; error?: { message: string } | null }) {
  const llamadas: Array<{ fn: string; args: Record<string, unknown> }> = []
  const client = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      llamadas.push({ fn, args })
      return Promise.resolve({ data: respuesta.data ?? null, error: respuesta.error ?? null })
    },
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: client as any, llamadas }
}

const UN_DUPLICADO: ContactoDuplicado = {
  id: 'c-1', nombre: 'MADELEINE PEREZ RUA',
  telefono: '+57 311 409 4122', email: 'maperu13@hotmail.com', motivo: 'telefono',
}

describe('buscarContactoDuplicado', () => {
  it('devuelve el contacto que ya tiene ese teléfono', async () => {
    const { client } = fakeSupabase({ data: [UN_DUPLICADO] })
    const r = await buscarContactoDuplicado(client, WS, { telefono: '3114094122' })
    expect(r?.nombre).toBe('MADELEINE PEREZ RUA')
    expect(r?.motivo).toBe('telefono')
  })

  it('devuelve null cuando no hay coincidencia', async () => {
    const { client } = fakeSupabase({ data: [] })
    expect(await buscarContactoDuplicado(client, WS, { telefono: '3000000000' })).toBeNull()
  })

  // Un contacto sin teléfono ni correo no tiene con qué chocar: ni se consulta.
  // Importa porque la vía del bot y la creación inline llaman siempre.
  it('no consulta la base si no hay teléfono ni correo', async () => {
    const { client, llamadas } = fakeSupabase({ data: [UN_DUPLICADO] })
    expect(await buscarContactoDuplicado(client, WS, { telefono: '  ', email: null })).toBeNull()
    expect(llamadas).toHaveLength(0)
  })

  // El caso que decide si esto sirve: un fallo de la consulta NO puede leerse
  // como "no hay duplicado". Si se tragara el error, el guardián se apagaría
  // solo, en silencio, justo cuando la base está en problemas.
  it('propaga el error en vez de dar vía libre', async () => {
    const { client } = fakeSupabase({ error: { message: 'timeout' } })
    await expect(buscarContactoDuplicado(client, WS, { telefono: '3114094122' }))
      .rejects.toThrow(/timeout/)
  })

  it('pasa el id a excluir para que editar no choque consigo mismo', async () => {
    const { client, llamadas } = fakeSupabase({ data: [] })
    await buscarContactoDuplicado(client, WS, { telefono: '3114094122' }, 'c-1')
    expect(llamadas[0].args.p_excluir_id).toBe('c-1')
  })
})

describe('mensajeDuplicado', () => {
  it('nombra a la persona y dice qué hacer', () => {
    expect(mensajeDuplicado(UN_DUPLICADO))
      .toBe('Ese teléfono ya es de MADELEINE PEREZ RUA. Abre ese contacto en vez de crear uno nuevo.')
  })

  it('distingue el correo del teléfono', () => {
    expect(mensajeDuplicado({ ...UN_DUPLICADO, motivo: 'email' })).toMatch(/^Ese correo/)
  })
})
