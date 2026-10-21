/**
 * Las acciones de la obra hacen cumplir en el servidor lo que la pantalla ofrece:
 *
 * - Solo dueño y administrador escriben (un supervisor o un solo lectura que llame la acción
 *   directo no marca nada).
 * - Sin la llave `modules.obras` no se toca la base.
 * - «Marcar pagada» con diferencia no escribe hasta que la persona dice que TODA la diferencia
 *   es retención; con «no» tampoco escribe (§6.3-d). La diferencia se lee de la vista, no de la
 *   pantalla.
 * - Una llegada que choca con el tope de dos obras por día devuelve el motivo legible.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const WS = '64010015-a9a2-4aca-be83-e456cf217d96'
const FACTURA = '11111111-1111-4111-8111-111111111111'
const OBRA = '22222222-2222-4222-8222-222222222222'
const COLAB = '33333333-3333-4333-8333-333333333333'

interface Escritura {
  tabla: string
  op: 'update' | 'insert' | 'delete'
  valores?: unknown
}

const estado: {
  role: string
  escrituras: Escritura[]
  tablas: Record<string, Record<string, unknown> | null>
  errorInsert: { code: string; message: string } | null
} = { role: 'owner', escrituras: [], tablas: {}, errorInsert: null }

function cliente() {
  return {
    from: (tabla: string) => {
      const q: Record<string, unknown> = {}
      let op: Escritura['op'] | null = null
      const cadena = () => q
      Object.assign(q, {
        select: cadena, eq: cadena, in: cadena, is: cadena, not: cadena, ilike: cadena, order: cadena, limit: cadena,
        update: (valores: unknown) => {
          op = 'update'
          estado.escrituras.push({ tabla, op, valores })
          return q
        },
        insert: (valores: unknown) => {
          op = 'insert'
          estado.escrituras.push({ tabla, op, valores })
          return q
        },
        delete: () => {
          op = 'delete'
          estado.escrituras.push({ tabla, op })
          return q
        },
        maybeSingle: async () => ({ data: estado.tablas[tabla] ?? null, error: null }),
        then: (ok: (v: unknown) => unknown) =>
          Promise.resolve(op === 'insert' && estado.errorInsert ? { data: null, error: estado.errorInsert } : { data: [], error: null }).then(ok),
      })
      return q
    },
  }
}

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({ supabase: cliente(), workspaceId: WS, userId: 'user-1', staffId: 'staff-1', role: estado.role, areas: [], error: null }),
}))
vi.mock('@/lib/modulos/exigir-modulo', async () => (await import('../../../../test/exigir-modulo-doble')).dobleExigirModulo())

import { reiniciarModulo } from '../../../../test/exigir-modulo-doble'
import { guardarLlegada, marcarFacturaPagada } from './obra-actions'

const facturaConDiferencia = {
  id: FACTURA,
  negocio_id: OBRA,
  empresa_id: null,
  numero_factura: 'FE-231',
  fecha_emision: '2026-10-15',
  monto: 25000000,
  estado: 'abierta',
  pagada_at: null,
  recibido: 23500000,
  saldo_pendiente: 1500000,
  retenido: null,
}

beforeEach(() => {
  estado.role = 'owner'
  estado.escrituras = []
  estado.errorInsert = null
  estado.tablas = { v_facturas_obra: facturaConDiferencia }
  reiniciarModulo(WS, { business: true, obras: true })
})

const escriturasEnFacturas = () => estado.escrituras.filter((e) => e.tabla === 'facturas')

describe('marcarFacturaPagada', () => {
  it('con diferencia pregunta y no escribe', async () => {
    const r = await marcarFacturaPagada(FACTURA)
    expect(r.ok).toBe(false)
    expect('pregunta' in r && r.diferencia).toBe(1500000)
    expect(escriturasEnFacturas()).toEqual([])
  })

  it('«no, hay otro descuento» no marca', async () => {
    const r = await marcarFacturaPagada(FACTURA, 'no')
    expect(r.ok).toBe(false)
    expect('noMarcada' in r).toBe(true)
    expect(escriturasEnFacturas()).toEqual([])
  })

  it('«sí, es retención» marca pagada con fecha y autor', async () => {
    const r = await marcarFacturaPagada(FACTURA, 'si')
    expect(r).toEqual({ ok: true })
    expect(escriturasEnFacturas()).toHaveLength(1)
    expect(escriturasEnFacturas()[0].valores).toMatchObject({ estado: 'pagada', pagada_por: 'user-1' })
  })

  it('un supervisor o un solo lectura no marca aunque llame directo', async () => {
    for (const role of ['supervisor', 'read_only', 'operator']) {
      estado.role = role
      const r = await marcarFacturaPagada(FACTURA, 'si')
      expect(r.ok).toBe(false)
    }
    expect(escriturasEnFacturas()).toEqual([])
  })

  it('sin la llave obras no toca la base', async () => {
    reiniciarModulo(WS, { business: true })
    const r = await marcarFacturaPagada(FACTURA, 'si')
    expect(r.ok).toBe(false)
    expect(escriturasEnFacturas()).toEqual([])
  })
})

describe('guardarLlegada', () => {
  it('el tope de dos obras por día vuelve con el motivo legible', async () => {
    estado.tablas = { negocios: { id: OBRA, estado: 'abierto' } }
    estado.errorInsert = { code: '23514', message: 'llegada: ya hay dos obras ese día (jornada completa o media, Anexo 2.3)' }
    const r = await guardarLlegada(null, { collaborator_id: COLAB, negocio_id: OBRA, fecha: '2026-10-01', hora: '07:10' })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toContain('dos obras distintas')
    expect(estado.escrituras.find((e) => e.tabla === 'llegadas_obra')?.valores).toMatchObject({ canal: 'app', hora: '2026-10-01T07:10:00-05:00' })
  })

  it('una obra cerrada no recibe llegadas', async () => {
    estado.tablas = { negocios: { id: OBRA, estado: 'completado' } }
    const r = await guardarLlegada(null, { collaborator_id: COLAB, negocio_id: OBRA, fecha: '2026-10-01', hora: '07:10' })
    expect(r.ok).toBe(false)
    expect(estado.escrituras).toEqual([])
  })
})
