import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { confirmarPagoCobroProgramado as deLaApp } from './confirmar-cobro-programado'
import { confirmarPagoCobroProgramado as delBot } from '../../../supabase/functions/_shared/confirmar-cobro-programado'

/**
 * El bot de WhatsApp (acción `ingreso`, 2026-10-21) marca una cuota como pagada con una COPIA de la escritura de la app
 * (una edge function no importa `src/`). Esta prueba corre las dos contra el mismo doble y exige las mismas consultas,
 * en el mismo orden, con los mismos filtros y el mismo patch. Si alguien cambia una sin la otra, falla aquí.
 */

function doble(fila: Record<string, unknown>) {
  const log: unknown[] = []
  const db = {
    from(tabla: string) {
      const paso: { tabla: string; patch?: Record<string, unknown>; filtros: unknown[]; select?: boolean } = { tabla, filtros: [] }
      log.push(paso)
      const filtros: ((f: Record<string, unknown>) => boolean)[] = []
      const q = {
        update(p: Record<string, unknown>) { paso.patch = p; return q },
        eq(col: string, v: unknown) { paso.filtros.push(['eq', col, v]); filtros.push((f) => f[col] === v); return q },
        is(col: string, v: unknown) { paso.filtros.push(['is', col, v]); filtros.push((f) => (f[col] ?? null) === v); return q },
        select(c: string) {
          paso.select = true
          paso.filtros.push(['select', c])
          const aplica = tabla === 'cobros' && filtros.every((fn) => fn(fila))
          if (aplica) Object.assign(fila, paso.patch)
          return Promise.resolve({ data: aplica ? [{ id: fila.id }] : [], error: null })
        },
        then(res: (v: { error: null }) => void) { res({ error: null }) },
      }
      return q
    },
  }
  return { db: db as unknown as SupabaseClient, log, fila }
}

const BASE = { id: 'c1', workspace_id: 'ws', tipo_cobro: 'programado', fecha: null, anulado_at: null, monto: 400000 }
const CASOS = [
  { cobroId: 'c1', workspaceId: 'ws', fecha: '2026-10-21' },
  { cobroId: 'c1', workspaceId: 'ws', fecha: '2026-10-21', monto: 250000, notas: 'abono' },
  { cobroId: 'c1', workspaceId: 'ws', fecha: '2026-10-21', externalRef: 'TX', fuente: 'bold', quitarRetencionIva: true },
]

describe('la copia del bot escribe exactamente lo mismo que la app', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-21T20:00:00Z')) })
  afterEach(() => { vi.useRealTimers() })

  for (const c of CASOS) {
    it(`mismas consultas y mismo resultado: ${JSON.stringify(c)}`, async () => {
      const a = doble({ ...BASE })
      const b = doble({ ...BASE })
      const ra = await deLaApp(a.db, c)
      const rb = await delBot(b.db as never, c)
      expect(rb).toEqual(ra)
      expect(b.log).toEqual(a.log)
      expect(b.fila).toEqual(a.fila)
    })
  }

  it('ya confirmada: las dos dicen ya_confirmado y no escriben', async () => {
    const a = doble({ ...BASE, fecha: '2026-10-01' })
    const b = doble({ ...BASE, fecha: '2026-10-01' })
    expect(await delBot(b.db as never, CASOS[0])).toEqual(await deLaApp(a.db, CASOS[0]))
    expect(b.log).toEqual(a.log)
  })
})
