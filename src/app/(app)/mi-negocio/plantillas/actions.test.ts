/**
 * Permiso de las plantillas editables: la lista explícita manda, no el rol.
 *
 * Leidy es supervisor, igual que Deisy, y NO está en la lista: ninguna acción le responde
 * (ni leer, ni guardar, ni activar, ni restaurar, ni la vista previa), y no deja filas.
 * Deisy guarda versiones nuevas (sin sobreescribir), activa solo lo que cumple los
 * requisitos, y restaurar crea una versión nueva y la activa.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DJ_V1 } from '@/lib/plantillas-documento/v1'

type Fila = Record<string, unknown>

const WS = '7dea141d-d4da-483d-a78d-b14ef35500c5'
const DEISY = '00000000-0000-4000-8000-0000000c0001'
const LEIDY = '00000000-0000-4000-8000-0000000c0005'

const estado = {
  usuario: DEISY,
  impersonando: false,
  tablas: {} as Record<string, Fila[]>,
}

function consulta(tabla: string) {
  const eqs: Fila = {}
  let orden: { col: string; asc: boolean } | null = null
  let tope: number | null = null
  let insercion: Fila | null = null
  const filtradas = () => {
    let fs = (estado.tablas[tabla] ?? []).filter((f) => Object.entries(eqs).every(([c, v]) => f[c] === v))
    if (orden) {
      const { col, asc } = orden
      fs = [...fs].sort((a, b) => (Number(a[col]) - Number(b[col])) * (asc ? 1 : -1))
    }
    return tope == null ? fs : fs.slice(0, tope)
  }
  const q = {
    select: () => q,
    eq: (c: string, v: unknown) => { eqs[c] = v; return q },
    order: (col: string, o?: { ascending?: boolean }) => { orden = { col, asc: o?.ascending !== false }; return q },
    limit: (n: number) => { tope = n; return q },
    insert: (p: Fila) => { insercion = p; return q },
    upsert: async (p: Fila) => {
      const filas = (estado.tablas[tabla] ??= [])
      const i = filas.findIndex((f) => f.workspace_id === p.workspace_id && f.tipo === p.tipo)
      if (i >= 0) filas[i] = { ...p }
      else filas.push({ ...p })
      return { data: null, error: null }
    },
    single: async () => {
      if (insercion) {
        const fila = { id: `v-${Math.random().toString(16).slice(2)}`, created_at: '2026-10-29T20:00:00Z', ...insercion }
        ;(estado.tablas[tabla] ??= []).push(fila)
        return { data: fila, error: null }
      }
      return { data: filtradas()[0] ?? null, error: null }
    },
    maybeSingle: async () => ({ data: filtradas()[0] ?? null, error: null }),
    then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: filtradas(), error: null }).then(ok),
  }
  return q
}
const cliente = { from: (t: string) => consulta(t) }

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({ supabase: cliente, workspaceId: WS, userId: estado.usuario, role: 'supervisor', impersonating: estado.impersonando }),
}))
vi.mock('@/lib/supabase/auth-user', () => ({ getCachedUser: async () => ({ user: { id: estado.usuario } }) }))

import {
  activarVersionPlantilla,
  datosParaVistaPrevia,
  guardarVersionPlantilla,
  leerPlantilla,
  restaurarVersionPlantilla,
} from './actions'

const FUERA = 'No estás en la lista de personas que editan las plantillas de este espacio.'
const V1 = 'version-1'

beforeEach(() => {
  estado.usuario = DEISY
  estado.impersonando = false
  estado.tablas = {
    plantillas_documento_editores: [{ workspace_id: WS, user_id: DEISY }],
    profiles: [{ id: DEISY, full_name: 'Deisy Ramírez' }, { id: LEIDY, full_name: 'Leidy Llanos' }],
    plantillas_documento_versiones: [
      { id: V1, workspace_id: WS, tipo: 'declaracion-juramentada', version_n: 1, contenido: DJ_V1, created_at: '2026-10-29T00:00:00Z' },
    ],
    plantillas_documento_activas: [],
  }
})

const versiones = () => estado.tablas.plantillas_documento_versiones
const activas = () => estado.tablas.plantillas_documento_activas

describe('fuera de la lista (Leidy, supervisor)', () => {
  beforeEach(() => { estado.usuario = LEIDY })

  it('no puede guardar', async () => {
    expect(await guardarVersionPlantilla('declaracion-juramentada', DJ_V1)).toEqual({ ok: false, error: FUERA })
    expect(versiones()).toHaveLength(1)
  })

  it('no puede activar ni restaurar', async () => {
    expect(await activarVersionPlantilla(V1)).toEqual({ ok: false, error: FUERA })
    expect(await restaurarVersionPlantilla(V1)).toEqual({ ok: false, error: FUERA })
    expect(activas()).toEqual([])
    expect(versiones()).toHaveLength(1)
  })

  it('no puede leer el historial ni pedir datos de un negocio', async () => {
    expect(await leerPlantilla('declaracion-juramentada')).toEqual({ ok: false, error: FUERA })
    expect(await datosParaVistaPrevia('declaracion-juramentada', 'neg-1')).toEqual({ ok: false, error: FUERA })
  })
})

describe('en «Ver como» nadie edita, aunque la persona real esté en la lista', () => {
  it('rechaza guardar', async () => {
    estado.impersonando = true
    const r = await guardarVersionPlantilla('declaracion-juramentada', DJ_V1)
    expect(r).toEqual({ ok: false, error: 'En «Ver como» no se editan plantillas.' })
  })
})

describe('en la lista (Deisy)', () => {
  it('guardar crea una versión NUEVA, con autor, y no la activa', async () => {
    const r = await guardarVersionPlantilla('declaracion-juramentada', `${DJ_V1}\nNota final.`, ' cambio de prueba ')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.version).toMatchObject({ version_n: 2, creada_por: DEISY, creada_por_nombre: 'Deisy Ramírez', nota: 'cambio de prueba' })
    expect(r.faltantes).toEqual([])
    expect(versiones().find((v) => v.id === V1)?.contenido).toBe(DJ_V1)
    expect(activas()).toEqual([])
  })

  it('rechaza una variable desconocida o una estructura mal cerrada', async () => {
    const r1 = await guardarVersionPlantilla('declaracion-juramentada', `${DJ_V1}\n{{valor_total}}`)
    expect(r1).toMatchObject({ ok: false })
    expect(!r1.ok && r1.error).toMatch(/Variable desconocida \{\{valor_total\}\}/)
    const r2 = await guardarVersionPlantilla('declaracion-juramentada', `${DJ_V1}\n{{#si dos_titulares}}\nx`)
    expect(!r2.ok && r2.error).toMatch(/Falta cerrar \{\{\/si\}\}/)
    expect(versiones()).toHaveLength(1)
  })

  it('guarda sin requisitos mínimos, pero no deja activar', async () => {
    const r = await guardarVersionPlantilla('declaracion-juramentada', 'Solo un párrafo sin datos.')
    expect(r.ok && r.faltantes).toContain('Número de factura')
    if (!r.ok) return
    const a = await activarVersionPlantilla(r.version.id)
    expect(a.ok).toBe(false)
    expect(!a.ok && a.error).toMatch(/No se puede activar: .*Número de factura/)
    expect(activas()).toEqual([])
  })

  it('activa una versión completa: una sola fila por documento', async () => {
    expect(await activarVersionPlantilla(V1)).toEqual({ ok: true })
    const g = await guardarVersionPlantilla('declaracion-juramentada', `${DJ_V1}\n`)
    if (!g.ok) throw new Error(g.error)
    expect(await activarVersionPlantilla(g.version.id)).toEqual({ ok: true })
    expect(activas()).toEqual([expect.objectContaining({ workspace_id: WS, tipo: 'declaracion-juramentada', version_id: g.version.id, activada_por: DEISY })])
  })

  it('restaurar crea una versión nueva igual a la elegida y la activa', async () => {
    const g = await guardarVersionPlantilla('declaracion-juramentada', `${DJ_V1}\n`)
    if (!g.ok) throw new Error(g.error)
    await activarVersionPlantilla(g.version.id)
    const r = await restaurarVersionPlantilla(V1)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.version).toMatchObject({ version_n: 3, contenido: DJ_V1, restaurada_de: V1, nota: 'Restaurada de la versión 1' })
    expect(activas()[0].version_id).toBe(r.version.id)
  })

  it('no activa versiones de otro workspace', async () => {
    versiones().push({ id: 'ajena', workspace_id: 'otro', tipo: 'declaracion-juramentada', version_n: 9, contenido: DJ_V1 })
    expect(await activarVersionPlantilla('ajena')).toEqual({ ok: false, error: 'No se encontró esa versión.' })
  })
})
