import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  consecutivoDeNumero,
  desplazarNumero,
  formatNumeroCuenta,
  siguienteConsecutivo,
  siguienteNumeroCuenta,
} from './numero-cuenta'

describe('formatNumeroCuenta', () => {
  it('arma el numero canonico con mes y consecutivo padded', () => {
    expect(formatNumeroCuenta(2026, 8, 4)).toBe('CC-2026-08-004')
    expect(formatNumeroCuenta(2026, 12, 1)).toBe('CC-2026-12-001')
  })

  it('no trunca un consecutivo de cuatro cifras', () => {
    expect(formatNumeroCuenta(2026, 8, 1234)).toBe('CC-2026-08-1234')
  })
})

describe('consecutivoDeNumero', () => {
  it('extrae el NNN de un numero canonico', () => {
    expect(consecutivoDeNumero('CC-2026-08-003')).toBe(3)
  })

  it('ignora lo que no tiene la forma esperada', () => {
    // El generador uniforme insertaba este literal cuando el RPC no respondia.
    // Contarlo como consecutivo seria peor que ignorarlo.
    expect(consecutivoDeNumero('CC-2026-08-PREVIEW')).toBeNull()
    expect(consecutivoDeNumero('')).toBeNull()
    expect(consecutivoDeNumero(null)).toBeNull()
    expect(consecutivoDeNumero(undefined)).toBeNull()
  })
})

describe('siguienteConsecutivo', () => {
  it('es max+1 sobre los numeros del periodo', () => {
    expect(siguienteConsecutivo(['CC-2026-08-001', 'CC-2026-08-003', 'CC-2026-08-002'])).toBe(4)
  })

  it('empieza en 1 cuando no hay ninguno', () => {
    expect(siguienteConsecutivo([])).toBe(1)
  })

  it('salta los numeros ilegibles en vez de reventar', () => {
    expect(siguienteConsecutivo(['CC-2026-08-002', 'CC-2026-08-PREVIEW', null])).toBe(3)
  })
})

describe('desplazarNumero', () => {
  it('corre el consecutivo conservando el ancho', () => {
    expect(desplazarNumero('CC-2026-08-004', 2)).toBe('CC-2026-08-006')
  })

  it('con offset 0 devuelve el mismo numero', () => {
    expect(desplazarNumero('CC-2026-08-004', 0)).toBe('CC-2026-08-004')
  })

  it('deja intacto lo que no puede leer', () => {
    expect(desplazarNumero('CC-2026-08-PREVIEW', 1)).toBe('CC-2026-08-PREVIEW')
  })
})

// ── siguienteNumeroCuenta contra un cliente falso ────────────────────

type Fila = { numero: string | null }

function fakeSupabase(opts: {
  rpc: { data: unknown; error: { message: string } | null }
  filas?: Fila[]
  onRpc?: (args: Record<string, unknown>) => void
}): SupabaseClient {
  return {
    rpc: async (_fn: string, args: Record<string, unknown>) => {
      opts.onRpc?.(args)
      return opts.rpc
    },
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        then: (resolve: (v: { data: Fila[] }) => unknown) => resolve({ data: opts.filas ?? [] }),
      }
      return q
    },
  } as unknown as SupabaseClient
}

describe('siguienteNumeroCuenta', () => {
  it('usa el numero del RPC — es la fuente unica de la serie', async () => {
    const args: Record<string, unknown>[] = []
    const sb = fakeSupabase({
      rpc: { data: 'CC-2026-08-004', error: null },
      onRpc: (a) => args.push(a),
    })
    expect(await siguienteNumeroCuenta(sb, 'ws', 2026, 8)).toBe('CC-2026-08-004')
    // El RPC de produccion se llama con p_anio (sin ñ): con p_año PostgREST no
    // encuentra la funcion y el numero se caeria al fallback en silencio.
    expect(args[0]).toEqual({ p_workspace_id: 'ws', p_anio: 2026, p_mes: 8 })
  })

  it('desplaza el numero del RPC cuando se pide offset (dry-run)', async () => {
    const sb = fakeSupabase({ rpc: { data: 'CC-2026-08-004', error: null } })
    expect(await siguienteNumeroCuenta(sb, 'ws', 2026, 8, 2)).toBe('CC-2026-08-006')
  })

  it('cae a max+1 sobre las filas si el RPC falla', async () => {
    const sb = fakeSupabase({
      rpc: { data: null, error: { message: 'function not found' } },
      filas: [{ numero: 'CC-2026-08-001' }, { numero: 'CC-2026-08-002' }],
    })
    expect(await siguienteNumeroCuenta(sb, 'ws', 2026, 8)).toBe('CC-2026-08-003')
  })

  it('cae a max+1 si el RPC devuelve algo ilegible, en vez de insertarlo tal cual', async () => {
    const sb = fakeSupabase({
      rpc: { data: 'no-es-un-numero', error: null },
      filas: [{ numero: 'CC-2026-08-007' }],
    })
    expect(await siguienteNumeroCuenta(sb, 'ws', 2026, 8)).toBe('CC-2026-08-008')
  })

  it('arranca en 001 cuando el periodo esta vacio y el RPC no responde', async () => {
    const sb = fakeSupabase({ rpc: { data: null, error: { message: 'timeout' } }, filas: [] })
    expect(await siguienteNumeroCuenta(sb, 'ws', 2026, 9)).toBe('CC-2026-09-001')
  })
})
