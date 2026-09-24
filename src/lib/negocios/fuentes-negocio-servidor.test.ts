/**
 * `@contacto`: el contacto del negocio entra al contexto como un bloque más, y SOLO se
 * consulta si alguien lo pide.
 */
import { describe, expect, it } from 'vitest'
import { contextoFuentesDelNegocio } from './fuentes-negocio-servidor'
import { SLUG_CONTACTO } from './fuentes-negocio'

type Respuesta = { data: unknown; error: unknown }

/** Un cliente de Supabase de mentira: cada tabla devuelve lo que se le da, y anota qué se pidió. */
function cliente(tablas: Record<string, unknown>) {
  const pedidas: string[] = []
  const builder = (tabla: string) => {
    const r: Respuesta = { data: tablas[tabla] ?? null, error: null }
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in']) b[m] = () => b
    b.maybeSingle = () => Promise.resolve(r)
    b.then = (ok: (v: Respuesta) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(r).then(ok, ko)
    return b
  }
  return {
    pedidas,
    from: (tabla: string) => {
      pedidas.push(tabla)
      return builder(tabla)
    },
    rpc: () => Promise.resolve({ data: true, error: null }),
  }
}

const ARGS = { negocioId: 'n1', lineaId: 'l1', etapaActualId: 'e1' }

describe('contextoFuentesDelNegocio con @contacto', () => {
  it('trae el correo y el celular del contacto, y le aplica', async () => {
    const sb = cliente({
      bloque_configs: [{ slug: 'rut', config_extra: {} }],
      negocio_bloques: [{ data: { campos: { email: { value: 'a@b.co' } } }, bloque_configs: { slug: 'rut' } }],
      negocios: { contactos: { nombre: 'ANA', telefono: '3001234567', email: 'Ana@Gmail.com' } },
    })
    const ctx = await contextoFuentesDelNegocio(sb, { ...ARGS, slugs: ['rut', SLUG_CONTACTO] })
    expect(ctx.porSlug[SLUG_CONTACTO]).toEqual({ nombre: 'ANA', telefono: '3001234567', email: 'Ana@Gmail.com' })
    expect(await ctx.aplica(SLUG_CONTACTO)).toBe(true)
    expect(ctx.porSlug.rut.email).toBe('a@b.co')
  })

  it('un negocio sin contacto no lo trae y no le aplica', async () => {
    const sb = cliente({ bloque_configs: [], negocio_bloques: [], negocios: { contactos: null } })
    const ctx = await contextoFuentesDelNegocio(sb, { ...ARGS, slugs: [SLUG_CONTACTO] })
    expect(ctx.porSlug[SLUG_CONTACTO]).toBeUndefined()
    expect(await ctx.aplica(SLUG_CONTACTO)).toBe(false)
  })

  it('si nadie lo pide, no consulta el negocio', async () => {
    const sb = cliente({ bloque_configs: [], negocio_bloques: [] })
    await contextoFuentesDelNegocio(sb, { ...ARGS, slugs: ['rut'] })
    expect(sb.pedidas).not.toContain('negocios')
  })
})
