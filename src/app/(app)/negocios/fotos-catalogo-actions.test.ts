/**
 * Las acciones de «Fotos de la propuesta» sobre el doble de Supabase: quién puede, qué se puede
 * pedir y que el nombre de la foto salga de la cotización, no del navegador.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'

import { base, clienteFalso, type Fila } from '../../../../test/cotizacion-pdf-doble'

const sesion = vi.hoisted(() => ({ role: 'operator' as string }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({ supabase: clienteFalso(), workspaceId: WS, staffId: 's-1', role: sesion.role, error: null }),
}))
vi.mock('@/lib/fotos/catalogo-almacen', async (original) => ({
  ...(await original<typeof import('@/lib/fotos/catalogo-almacen')>()),
  guardarEnCatalogo: async (ws: string, tipo: string) => `one://fotos-catalogo/${ws}/${tipo}/0123456789abcdef.jpg`,
  enlaceDeCatalogo: async () => 'https://firmada.example/foto.jpg',
  borrarDeCatalogo: async () => {},
}))

const WS = '11111111-2222-3333-4444-555555555555'
const COT = 'cot-1'

import { fotosDeLaPropuesta, subirFotoPropia } from './fotos-catalogo-actions'

function sembrar(motor: boolean) {
  base.secuencia = 0
  base.tablas = {
    workspaces: [{ id: WS, cotizacion_template_slug: 'trappvel', config_extra: motor ? { documento_viaje: { motor: 'html' } } : {} }],
    cotizaciones: [{ id: COT, workspace_id: WS }],
    items: [
      { id: 'i-1', cotizacion_id: COT, nombre: 'Tour Johnny Cay', grupo: 'actividad: Tour en San Andrés', tarifa_pax: null, descripcion: null },
      { id: 'i-2', cotizacion_id: 'otra', nombre: 'Tour ajeno', grupo: 'actividad: Tour', tarifa_pax: null, descripcion: null },
    ],
    fotos_catalogo: [],
  }
}

async function dataUrl(): Promise<string> {
  const b = await sharp({ create: { width: 900, height: 600, channels: 3, background: { r: 30, g: 160, b: 190 } } }).jpeg().toBuffer()
  return `data:image/jpeg;base64,${b.toString('base64')}`
}

beforeEach(() => {
  sesion.role = 'operator'
  sembrar(true)
})

describe('fotos de la propuesta', () => {
  it('sin la propuesta nueva encendida, no hay panel', async () => {
    sembrar(false)
    const r = await fotosDeLaPropuesta(COT)
    expect(r).toEqual({ ok: false, error: expect.stringContaining('propuesta nueva') })
  })

  it('lista lo que pide ESTA cotización, sin foto todavía', async () => {
    const r = await fotosDeLaPropuesta(COT)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.fotos.map((f) => [f.tipo, f.nombre, f.foto])).toEqual([['actividad', 'Tour Johnny Cay', null]])
  })

  it('subir la propia: la llave tiene que ser de la cotización; el nombre lo pone el servidor', { timeout: 20_000 }, async () => {
    const ajena = await subirFotoPropia(COT, 'actividad', 'tour ajeno|', await dataUrl())
    expect(ajena).toEqual({ ok: false, error: expect.stringContaining('no es de esta cotización') })
    const r = await subirFotoPropia(COT, 'actividad', 'tour johnny cay|', await dataUrl())
    expect(r.ok).toBe(true)
    const filas = base.tablas.fotos_catalogo as Fila[]
    expect(filas).toHaveLength(1)
    expect(filas[0]).toMatchObject({ workspace_id: WS, tipo: 'actividad', nombre: 'Tour Johnny Cay', origen: 'asesora', revisada: true, created_by: 's-1' })
    if (r.ok) expect(r.fotos[0].foto).toMatchObject({ origen: 'asesora', url: 'https://firmada.example/foto.jpg', credito: null })
  })

  it('un rol de solo lectura no cambia fotos', async () => {
    sesion.role = 'read_only'
    expect(await subirFotoPropia(COT, 'actividad', 'tour johnny cay|', await dataUrl())).toEqual({ ok: false, error: expect.stringContaining('no cambiarlas') })
  })

  it('lo que no es una foto no entra', async () => {
    expect(await subirFotoPropia(COT, 'actividad', 'tour johnny cay|', 'data:text/html;base64,PHNjcmlwdD4=')).toEqual({ ok: false, error: expect.stringContaining('no es una foto') })
  })
})
