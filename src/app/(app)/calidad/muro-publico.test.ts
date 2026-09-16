/**
 * El muro de calidad con service_role solo se entrega a quien trae el token del enlace.
 *
 * El hueco (riesgo 11): `getMuroPorWorkspace(workspaceId)` estaba exportada desde
 * `calidad/actions.ts`, un archivo `'use server'`, o sea un endpoint alcanzable por POST
 * sin sesion. Leia el muro de cualquier workspace con service_role, y los tres gates del
 * muro publico (token, modulo, opt-in) los aplicaba solo la pagina `(public)/muro/[token]`.
 *
 * Lo que se fija aqui:
 *   - con el token correcto, modulo y opt-in, se entrega el muro y el nombre;
 *   - token equivocado, token corto, modulo apagado u opt-in ausente: `null` y la RPC
 *     NUNCA se llama (lo que importa es que no se lea con service_role, no solo lo que
 *     se devuelve);
 *   - ningun archivo `'use server'` exporta una lectura del muro, y la pagina publica
 *     pasa por `getMuroPublico`.
 *
 * EL DOBLE APLICA EL FILTRO POR TOKEN y tiene UN solo workspace sembrado: con dos, quitar
 * el filtro haria que `maybeSingle` fallara por varias filas y el caso del token
 * equivocado pasaria por la razon equivocada.
 *
 * VISTO FALLAR (2026-09-16):
 *   - con `calidad/actions.ts` y la pagina publica de `origin/main`: cayeron los 2 casos
 *     del contrato de archivos;
 *   - quitando `.eq('config_extra->>muro_token', token)` de `getMuroPublico`: cayo el
 *     caso del token equivocado (la RPC se llamo con el workspace sembrado).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, beforeEach, vi } from 'vitest'

type Fila = Record<string, unknown>

const MURO = { dia: '2026-09-16', periodos: {} }
const TOKEN = 'tok-regat-9f3a2c71'

const escenario = {
  workspace: null as Fila | null,
}

const rpc = vi.fn(async (_nombre: string, _args: Fila) => ({ data: MURO, error: null }))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    from: (tabla: string) => constructor(tabla),
    rpc: (nombre: string, args: Fila) => rpc(nombre, args),
  }),
}))

function constructor(tabla: string) {
  const filtros: Fila = {}
  const resolver = () => {
    if (tabla !== 'workspaces') throw new Error(`tabla inesperada en el doble: ${tabla}`)
    const ws = escenario.workspace
    if (!ws) return { data: null, error: null }
    const coincide = Object.entries(filtros).every(([c, v]) => {
      if (c === 'config_extra->>muro_token') {
        return ((ws.config_extra ?? {}) as Fila).muro_token === v
      }
      return ws[c] === v
    })
    return { data: coincide ? ws : null, error: null }
  }
  const q = {
    select: () => q,
    eq: (columna: string, valor: unknown) => {
      filtros[columna] = valor
      return q
    },
    maybeSingle: async () => resolver(),
    single: async () => resolver(),
  }
  return q
}

import { getMuroPublico } from './muro-publico'

function workspace(extra: Partial<{ modulo: boolean; publico: boolean }> = {}): Fila {
  return {
    id: 'ws-regat',
    name: 'Regat',
    modules: { calidad_llamadas: extra.modulo ?? true },
    config_extra: { muro_token: TOKEN, ...(extra.publico === false ? {} : { muro_publico: true }) },
  }
}

beforeEach(() => {
  escenario.workspace = workspace()
  rpc.mockClear()
})

describe('getMuroPublico — la puerta', () => {
  it('con el token correcto entrega el muro y el nombre', async () => {
    const r = await getMuroPublico(TOKEN)
    expect(r).toEqual({ data: MURO, nombreWorkspace: 'Regat' })
    expect(rpc).toHaveBeenCalledWith('get_calidad_muro', { p_workspace_id: 'ws-regat' })
  })

  it('con un token equivocado no lee el muro', async () => {
    const r = await getMuroPublico('tok-otro-00000000')
    expect(r).toBeNull()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('con un token corto ni consulta', async () => {
    const r = await getMuroPublico('corto')
    expect(r).toBeNull()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('con el modulo apagado no lee el muro', async () => {
    escenario.workspace = workspace({ modulo: false })
    expect(await getMuroPublico(TOKEN)).toBeNull()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('sin opt-in de muro publico no lee el muro', async () => {
    escenario.workspace = workspace({ publico: false })
    expect(await getMuroPublico(TOKEN)).toBeNull()
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('el muro no se lee desde una server action sin token', () => {
  const leer = (ruta: string) => readFileSync(ruta, 'utf8')

  function esUseServer(fuente: string): boolean {
    const sinCabecera = fuente.replace(/^(\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*/, '')
    return /^['"]use server['"]/.test(sinCabecera)
  }

  function archivosTs(dir: string): string[] {
    const salida: string[] = []
    for (const nombre of readdirSync(dir)) {
      const ruta = join(dir, nombre)
      if (statSync(ruta).isDirectory()) salida.push(...archivosTs(ruta))
      else if (/\.tsx?$/.test(nombre) && !nombre.endsWith('.test.ts')) salida.push(ruta)
    }
    return salida
  }

  it('ningun archivo `use server` exporta una lectura del muro por workspace', () => {
    const culpables = archivosTs('src').filter((ruta) => {
      const fuente = leer(ruta)
      return (
        esUseServer(fuente) &&
        /export\s+(async\s+function\s+(getMuroPorWorkspace|leerMuroDeWorkspace)\b|\{[^}]*\b(getMuroPorWorkspace|leerMuroDeWorkspace)\b)/.test(fuente)
      )
    })
    expect(culpables).toEqual([])
  })

  it('la pagina publica pasa por `getMuroPublico`', () => {
    const fuente = leer('src/app/(public)/muro/[token]/page.tsx')
    expect(fuente).toContain('getMuroPublico(token)')
    expect(fuente).not.toContain('getMuroPorWorkspace')
  })
})
