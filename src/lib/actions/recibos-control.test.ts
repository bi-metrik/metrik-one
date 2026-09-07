/**
 * El control de recibos: de la plata que entró, cuál está acusada.
 *
 * EL CASO QUE IMPORTA: la lista es POR PAGO. Mientras el recibo se manejó desde la cola
 * de facturación, la unidad era el NEGOCIO, y un negocio con tres pagos se veía como
 * una línea. El 24% de los negocios de SOENA ya recibió más de un pago (medido el
 * 2026-09-02), así que agrupar escondía justo lo que hay que ver.
 *
 * SE VIERON FALLAR contra una versión que agrupaba por negocio o que escondía los
 * marcados:
 *   - "dos pagos del mismo negocio son dos líneas"  → salía una
 *   - "un pago marcado no cuenta como pendiente"    → seguía pendiente
 *   - "el marcado no desaparece de la lista"        → se perdía sin auditoría
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const WS = 'ws-soena'

type Fila = Record<string, unknown>
let cobros: Fila[]
let negocios: Fila[]
let contactos: Fila[]

vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({ workspaceId: WS, staffId: 's1', role: 'admin', areas: ['financiera'] }),
}))

vi.mock('@/lib/permissions/can-edit', () => ({ canEditBloque: () => true }))

vi.mock('@/lib/supabase/paginar', () => ({
  traerTodo: async (consulta: (d: number, h: number) => Promise<{ data: Fila[] }>) => {
    const r = await consulta(0, 999)
    return r.data
  },
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    from: (tabla: string) => {
      const fuente = tabla === 'cobros' ? () => cobros : tabla === 'negocios' ? () => negocios : () => contactos
      const chain = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        not: () => chain,
        in: () => chain,
        order: () => chain,
        range: async () => ({ data: fuente(), error: null }),
      }
      return chain
    },
  }),
}))

import { getControlRecibos } from './recibos-control-actions'

beforeEach(() => {
  negocios = [{
    id: 'neg-1', codigo: 'V0451', nombre: 'Cliente Uno', contacto_id: 'ct-1',
    carpeta_url: 'https://drive/x',
    metadata: { siigo_cliente: { siigo_id: 'cli-1' } },
  }]
  contactos = [{ id: 'ct-1', nombre: 'José Noel', email: 'jose@ejemplo.com' }]
  cobros = [
    {
      id: 'c1', negocio_id: 'neg-1', monto: 701812, fecha: '2026-09-02', concepto: 'Abono',
      siigo_recibo: { numero: 'RC-1-65', archivo_url: 'https://drive/rc65' }, recibo_no_aplica: null,
    },
    {
      id: 'c2', negocio_id: 'neg-1', monto: 637500, fecha: '2026-08-31', concepto: 'Abono',
      siigo_recibo: null, recibo_no_aplica: null,
    },
  ]
})

describe('getControlRecibos — el control es por pago, no por negocio', () => {
  it('dos pagos del mismo negocio son dos líneas, con su propio estado', async () => {
    const { data } = await getControlRecibos()

    expect(data!.pagos).toHaveLength(2)
    expect(data!.pagos.map(p => p.estado)).toEqual(['con_recibo', 'pendiente'])
    expect(data!.pagos[0].recibo_numero).toBe('RC-1-65')
    expect(data!.pagos[0].recibo_url).toBe('https://drive/rc65')
  })

  it('un pago marcado como que no aplica sale de pendientes pero no de la lista', async () => {
    cobros[1].recibo_no_aplica = { motivo: 'Negocio ya facturado' }
    const { data } = await getControlRecibos()

    expect(data!.totales.pendientes).toBe(0)
    expect(data!.totales.no_aplica).toBe(1)
    // Sigue visible: un pendiente que desaparece sin rastro es uno que nadie audita.
    expect(data!.pagos).toHaveLength(2)
    expect(data!.pagos.find(p => p.cobro_id === 'c2')!.no_aplica_motivo).toBe('Negocio ya facturado')
  })

  it('que el negocio esté facturado NO decide el estado del recibo', async () => {
    negocios[0].metadata = { siigo_cliente: { siigo_id: 'cli-1' }, siigo_factura: { numero: 'FV-2-429' } }
    const { data } = await getControlRecibos()

    const pendiente = data!.pagos.find(p => p.cobro_id === 'c2')!
    expect(pendiente.facturado).toBe(true)
    expect(pendiente.estado).toBe('pendiente')
  })

  it('dice qué le falta a un pago que todavía no se puede emitir', async () => {
    negocios[0].metadata = {}
    contactos[0].email = null
    const { data } = await getControlRecibos()

    const pendiente = data!.pagos.find(p => p.cobro_id === 'c2')!
    expect(pendiente.faltantes).toEqual(['tercero en Siigo', 'correo del cliente'])
    expect(data!.totales.emitibles).toBe(0)
  })

  it('un pago sin faltantes cuenta como emitible', async () => {
    const { data } = await getControlRecibos()

    expect(data!.totales.pendientes).toBe(1)
    expect(data!.totales.emitibles).toBe(1)
    expect(data!.totales.valor_pendiente).toBe(637500)
  })
})
