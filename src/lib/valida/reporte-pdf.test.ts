/**
 * La descarga de un PDF de Valida con la llave viva y con la llave vencida (defecto de Vera,
 * 2026-10-28). El núcleo es puro: la red y la ruta firmada son dobles.
 */
import { describe, it, expect, vi } from 'vitest'
import { pdfDeValida, type CredencialPdf, type DepsPdf } from './reporte-pdf'
import type { PeticionValida, ResultadoArchivoValida } from '@/lib/valida-api/cliente-nucleo'

const CLIENTE = '8c211c68-6c25-4beb-b364-c91c284d6379'
const CONSULTA = '11111111-2222-4333-8444-555555555555'
const OTRA = '22222222-3333-4444-8555-666666666666'
const ACTOR = { usuario_id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301', correo: 'gerencia@cda.co' }
const PDF = new TextEncoder().encode('%PDF-1.4 prueba')

function respuesta(status: number, cuerpo?: unknown): Response {
  if (status === 200) return new Response(PDF, { status, headers: { 'content-type': 'application/pdf' } })
  return new Response(JSON.stringify(cuerpo ?? {}), { status, headers: { 'content-type': 'application/json' } })
}

function deps(llaveStatus: number, firmado: ResultadoArchivoValida = { tipo: 'ok', status: 200, bytes: PDF }) {
  const fetchDoble = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    respuesta(llaveStatus, llaveStatus === 401 ? { error: 'invalid_api_key' } : { error: 'db_error' }),
  )
  const pedirFirmado = vi.fn(async (_p: PeticionValida) => firmado)
  const d: DepsPdf = { base: 'https://valida.test', fetch: fetchDoble as unknown as typeof fetch, pedirFirmado }
  return { d, fetchDoble, pedirFirmado }
}

const CRED: CredencialPdf = { llave: 'llave-del-espacio', clienteId: CLIENTE, actor: ACTOR }

describe('con la llave viva', () => {
  it('baja con la llave y no toca la ruta firmada', async () => {
    const { d, fetchDoble, pedirFirmado } = deps(200)
    const r = await pdfDeValida(CRED, { tipo: 'consulta', consultaId: CONSULTA }, d)
    expect(r).toMatchObject({ ok: true, via: 'llave' })
    if (r.ok) expect(r.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(fetchDoble.mock.calls[0][0]).toBe(`https://valida.test/api/v1/reporte/${CONSULTA}`)
    expect(pedirFirmado).not.toHaveBeenCalled()
  })

  it('un error que no es 401 se devuelve tal cual (no se reintenta como ONE)', async () => {
    const { d, pedirFirmado } = deps(500)
    expect(await pdfDeValida(CRED, { tipo: 'consulta', consultaId: CONSULTA }, d)).toEqual({ ok: false, error: 'db_error' })
    expect(pedirFirmado).not.toHaveBeenCalled()
  })
})

describe('con la llave vencida (401)', () => {
  it('el reporte de una consulta sale por la ruta firmada del cliente del espacio', async () => {
    const { d, pedirFirmado } = deps(401)
    const r = await pdfDeValida(CRED, { tipo: 'consulta', consultaId: CONSULTA }, d)
    expect(r).toMatchObject({ ok: true, via: 'one' })
    expect(pedirFirmado).toHaveBeenCalledWith({ metodo: 'GET', ruta: `/clientes/${CLIENTE}/reportes/${CONSULTA}`, actor: ACTOR })
  })

  it('el lote sale por la ruta firmada, con el actor también en el cuerpo firmado', async () => {
    const { d, fetchDoble, pedirFirmado } = deps(401)
    const r = await pdfDeValida(CRED, { tipo: 'lote', consultaIds: [CONSULTA, OTRA], titulo: 'Cargue' }, d)
    expect(r).toMatchObject({ ok: true, via: 'one' })
    expect(fetchDoble.mock.calls[0][0]).toBe('https://valida.test/api/v1/reporte-lote')
    expect(pedirFirmado).toHaveBeenCalledWith({
      metodo: 'POST',
      ruta: `/clientes/${CLIENTE}/reportes-lote`,
      actor: ACTOR,
      cuerpo: { actor: ACTOR, consulta_ids: [CONSULTA, OTRA], titulo: 'Cargue' },
    })
  })

  it('sin llave guardada también va como ONE (y sin cliente, el error de siempre)', async () => {
    const { d, fetchDoble, pedirFirmado } = deps(200)
    expect(await pdfDeValida({ ...CRED, llave: null }, { tipo: 'consulta', consultaId: CONSULTA }, d)).toMatchObject({ ok: true, via: 'one' })
    expect(fetchDoble).not.toHaveBeenCalled()
    pedirFirmado.mockClear()
    expect(await pdfDeValida({ llave: null, clienteId: null, actor: ACTOR }, { tipo: 'consulta', consultaId: CONSULTA }, d)).toEqual({
      ok: false,
      error: 'valida_api_key_no_configurada',
    })
    expect(pedirFirmado).not.toHaveBeenCalled()
  })

  it('sin actor o sin cliente válido no se firma nada: queda el 401 de la llave', async () => {
    for (const cred of [{ ...CRED, actor: null }, { ...CRED, clienteId: 'no-es-uuid' }]) {
      const { d, pedirFirmado } = deps(401)
      expect(await pdfDeValida(cred, { tipo: 'consulta', consultaId: CONSULTA }, d)).toEqual({ ok: false, error: 'invalid_api_key' })
      expect(pedirFirmado).not.toHaveBeenCalled()
    }
  })

  it('un id que no es UUID nunca entra en la ruta firmada (sin «../» hacia otra ruta de ONE)', async () => {
    const { d, pedirFirmado } = deps(401)
    expect(await pdfDeValida(CRED, { tipo: 'consulta', consultaId: '../llaves' }, d)).toEqual({ ok: false, error: 'not_found' })
    expect(await pdfDeValida(CRED, { tipo: 'lote', consultaIds: ['../x'], titulo: null }, d)).toEqual({
      ok: false,
      error: 'lote_sin_consultas_validas',
    })
    expect(pedirFirmado).not.toHaveBeenCalled()
  })

  it('lo que Valida rechaza por la ruta firmada llega con su código', async () => {
    const { d } = deps(401, { tipo: 'rechazada', status: 404, codigo: 'not_found', mensaje: 'x' })
    expect(await pdfDeValida(CRED, { tipo: 'consulta', consultaId: CONSULTA }, d)).toEqual({ ok: false, error: 'not_found' })
  })

  it('Valida sin responder por la ruta firmada: el 401 original, o tiempo agotado', async () => {
    expect(await pdfDeValida(CRED, { tipo: 'consulta', consultaId: CONSULTA }, deps(401, { tipo: 'no_disponible', motivo: 'sin_secreto' }).d)).toEqual({
      ok: false,
      error: 'invalid_api_key',
    })
    expect(await pdfDeValida(CRED, { tipo: 'consulta', consultaId: CONSULTA }, deps(401, { tipo: 'no_disponible', motivo: 'tiempo_agotado' }).d)).toEqual({
      ok: false,
      error: 'valida_tiempo_agotado',
    })
  })
})
