import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { confirmarPagoCobroProgramado } from './confirmar-cobro-programado'

/**
 * Doble que APLICA los filtros del update sobre una fila en memoria: sin eso, la guarda
 * `fecha is null` podría faltar y la prueba pasaría igual.
 */
function doble(fila: Record<string, unknown>) {
  const escrituras: { tabla: string; patch: Record<string, unknown> }[] = []
  const db = {
    from(tabla: string) {
      let patch: Record<string, unknown> = {}
      const filtros: ((f: Record<string, unknown>) => boolean)[] = []
      const q = {
        update(p: Record<string, unknown>) {
          patch = p
          return q
        },
        eq(col: string, v: unknown) {
          filtros.push((f) => f[col] === v)
          return q
        },
        is(col: string, v: unknown) {
          filtros.push((f) => (f[col] ?? null) === v)
          return q
        },
        select() {
          const aplica = tabla === 'cobros' && filtros.every((fn) => fn(fila))
          if (aplica) {
            Object.assign(fila, patch)
            escrituras.push({ tabla, patch })
          }
          return Promise.resolve({ data: aplica ? [{ id: fila.id }] : [], error: null })
        },
        then(res: (v: { error: null }) => void) {
          if (tabla === 'notificaciones') escrituras.push({ tabla, patch })
          res({ error: null })
        },
      }
      return q
    },
  }
  return { db: db as unknown as SupabaseClient, escrituras, fila }
}

const BASE = { id: 'c1', workspace_id: 'ws', tipo_cobro: 'programado', fecha: null, anulado_at: null, monto: 100 }

describe('confirmarPagoCobroProgramado', () => {
  it('confirma un cobro programado sin fecha y cierra sus avisos', async () => {
    const d = doble({ ...BASE })
    const r = await confirmarPagoCobroProgramado(d.db, {
      cobroId: 'c1', workspaceId: 'ws', fecha: '2026-09-25', externalRef: 'bold-TX1', fuente: 'bold', monto: 120,
    })
    expect(r).toEqual({ ok: true })
    expect(d.fila).toMatchObject({ fecha: '2026-09-25', vencido: false, external_ref: 'bold-TX1', fuente: 'bold', monto: 120 })
    expect(d.escrituras.map((e) => e.tabla)).toEqual(['cobros', 'notificaciones'])
  })

  it('no toca un cobro ya pagado, anulado, de otro espacio o que no es programado', async () => {
    for (const extra of [{ fecha: '2026-09-01' }, { anulado_at: '2026-09-01T00:00:00Z' }, { workspace_id: 'otro' }, { tipo_cobro: 'pago' }]) {
      const d = doble({ ...BASE, ...extra })
      const r = await confirmarPagoCobroProgramado(d.db, { cobroId: 'c1', workspaceId: 'ws', fecha: '2026-09-25' })
      expect(r).toMatchObject({ ok: false, motivo: 'ya_confirmado' })
      expect(d.escrituras).toHaveLength(0)
    }
  })

  it('sin referencia ni monto, solo pone la fecha (el botón manual)', async () => {
    const d = doble({ ...BASE })
    await confirmarPagoCobroProgramado(d.db, { cobroId: 'c1', workspaceId: 'ws', fecha: '2026-09-25' })
    expect(d.escrituras[0].patch).toEqual({ fecha: '2026-09-25', vencido: false })
  })
})
