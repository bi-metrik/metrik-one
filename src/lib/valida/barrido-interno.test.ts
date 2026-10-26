import { describe, expect, it } from 'vitest'
import type { ValidaResultado } from '@/lib/actions/valida-consultas'
import {
  CLIENTE_VALIDA_METRIK,
  MAX_ERRORES_SEGUIDOS,
  claveIdempotenciaBarrido,
  ejecutarBarrido,
  idsResueltos,
  leerEstadoCuenta,
  lineasHallazgo,
  planBarrido,
  referenciaBarrido,
  resumirRegistro,
  type ConsultaPrevia,
  type CuerpoBarrido,
  type RegistroBarrido,
  type RespuestaValida,
} from './barrido-interno'
import type { ConsultaEnError } from './reproceso-tipo-documento'

// Datos inventados: ningún nombre ni documento real.
const fila = (id: string, documento_tipo: string, extra: Partial<ConsultaEnError> = {}): ConsultaEnError => ({
  id,
  tipo_persona: 'natural',
  nombre_consultado: 'Persona De Prueba',
  documento_tipo,
  documento_numero: '10000001',
  ...extra,
})

const resultado = (severidad: ValidaResultado['severidad'], id: string, matches: ValidaResultado['matches'] = []): ValidaResultado => ({
  consulta_id: id,
  severidad,
  total_matches: matches.length,
  matches,
  hash_reporte: `h-${id}`,
  fecha_reporte: '2026-10-24T10:00:00Z',
})

const match = (lista: string, resultado: 'exacto' | 'posible', match_por: string | null) => ({
  lista,
  lista_nombre: `Lista ${lista}`,
  tier: 'A' as never,
  vinculante_colombia: true,
  nombre_coincidencia: 'NOMBRE INVENTADO DE LA LISTA',
  score: 0.99,
  resultado,
  fundamento_legal: null,
  match_por,
  documento_coincidencia: { tipo: 'CC', numero: '99999999' } as never,
})

function dobles(respuestas: Record<string, RespuestaValida> = {}, previas: Record<string, ConsultaPrevia> = {}) {
  const llamadas: Array<{ clave: string; cuerpo: CuerpoBarrido }> = []
  const registros: RegistroBarrido[] = []
  return {
    llamadas,
    registros,
    deps: {
      llamar: async (cuerpo: CuerpoBarrido, clave: string) => {
        llamadas.push({ clave, cuerpo })
        return respuestas[clave] ?? { ok: true as const, data: resultado('sin_hallazgo', `val-${clave}`) }
      },
      previa: async (ref: string) => previas[ref] ?? null,
      registrar: (r: RegistroBarrido) => {
        registros.push(r)
      },
      ahora: () => new Date('2026-10-24T10:00:00Z'),
    },
  }
}

describe('cuerpo y rastro de cada consulta', () => {
  it('normaliza el tipo con la función del lote y ata la consulta a la fila de AFI', () => {
    const p = planBarrido(fila('afi-1', 'CEDULA'))
    expect(p).toEqual({
      accion: 'consultar',
      tipoOriginal: 'CEDULA',
      tipo: 'CC',
      inferido: false,
      cuerpo: {
        tipo: 'natural',
        nombre: 'Persona De Prueba',
        documento: { tipo: 'CC', numero: '10000001' },
        referencia_externa: 'afi-valida-consultas-afi-1',
      },
    })
    expect(planBarrido(fila('a', 'TI'))).toMatchObject({ tipo: 'TI' })
    expect(planBarrido(fila('b', 'PP', { documento_numero: 'AB123456' }))).toMatchObject({ tipo: 'PAS' })
    expect(planBarrido(fila('c', 'X'))).toEqual({ accion: 'aparte', tipoOriginal: 'X', motivo: 'tipo_no_deducible' })
  })

  it('la referencia y la llave caben en los límites de Valida (128 y 64 ASCII) con un uuid', () => {
    const uuid = '77ddc3f2-83aa-4a29-aa7f-18a6f6196c5b'
    expect(referenciaBarrido(uuid).length).toBeLessThanOrEqual(128)
    expect(claveIdempotenciaBarrido(uuid).length).toBeLessThanOrEqual(64)
    expect(claveIdempotenciaBarrido(uuid)).toMatch(/^[\x21-\x7e]+$/)
  })
})

describe('la corrida', () => {
  it('consulta lo pendiente, salta lo resuelto y lo que Valida ya tiene, y junta los hallazgos', async () => {
    const d = dobles(
      { [claveIdempotenciaBarrido('b')]: { ok: true, data: resultado('alto', 'val-b', [match('OFAC', 'exacto', 'documento')]) } },
      { [referenciaBarrido('c')]: { consulta_id: 'val-c', severidad: 'medio', total_matches: 1 } },
    )
    const r = await ejecutarBarrido(
      [fila('a', 'CEDULA'), fila('b', 'PP'), fila('c', 'TI'), fila('d', 'X'), fila('e', 'CEDULA')],
      new Set(['e']),
      d.deps,
    )
    expect(d.llamadas.map((l) => l.clave)).toEqual([claveIdempotenciaBarrido('a'), claveIdempotenciaBarrido('b')])
    expect(r).toMatchObject({
      revisadas: 5,
      yaHechas: 1,
      porSeveridad: { sin_hallazgo: 1, alto: 1, medio: 1 },
      errores: [],
      aparte: [{ afi_id: 'd', motivo: 'tipo_no_deducible' }],
      detenido: null,
    })
    expect(r.hallazgos).toEqual([
      { afi_id: 'b', valida_consulta_id: 'val-b', severidad: 'alto', coincidencias: [{ lista: 'OFAC', resultado: 'exacto', match_por: 'documento' }] },
      { afi_id: 'c', valida_consulta_id: 'val-c', severidad: 'medio', coincidencias: null },
    ])
    expect(d.registros.map((x) => [x.afi_id, x.estado])).toEqual([
      ['a', 'consultada'],
      ['b', 'consultada'],
      ['c', 'previa'],
      ['d', 'aparte'],
    ])
  })

  it('402 detiene la corrida; un 400 de una fila no', async () => {
    const d = dobles({
      [claveIdempotenciaBarrido('a')]: { ok: false, error: 'validation_error', status: 400 },
      [claveIdempotenciaBarrido('b')]: { ok: false, error: 'bolsa_agotada', status: 402 },
    })
    const r = await ejecutarBarrido([fila('a', 'CEDULA'), fila('b', 'CEDULA'), fila('c', 'CEDULA')], new Set(), d.deps)
    expect(d.llamadas).toHaveLength(2)
    expect(r.detenido).toBe('bolsa_agotada')
    expect(r.errores.map((e) => e.afi_id)).toEqual(['a', 'b'])
  })

  it(`${MAX_ERRORES_SEGUIDOS} errores de red seguidos detienen; un éxito reinicia la cuenta`, async () => {
    const red = { ok: false as const, error: 'TimeoutError' }
    const filas = Array.from({ length: 10 }, (_, i) => fila(`f${i}`, 'CEDULA'))
    const respuestas: Record<string, RespuestaValida> = {}
    for (const f of filas) respuestas[claveIdempotenciaBarrido(f.id)] = red
    respuestas[claveIdempotenciaBarrido('f2')] = { ok: true, data: resultado('sin_hallazgo', 'v2') }
    const d = dobles(respuestas)
    const r = await ejecutarBarrido(filas, new Set(), d.deps)
    // f0, f1 fallan; f2 sale; f3..f7 son 5 seguidos.
    expect(d.llamadas).toHaveLength(8)
    expect(r.detenido).toMatch(/errores seguidos/)
  })

  it('sin poder revisar la consulta previa no consulta a ciegas', async () => {
    const d = dobles()
    d.deps.previa = async () => {
      throw new Error('HTTP 500')
    }
    const r = await ejecutarBarrido([fila('a', 'CEDULA')], new Set(), d.deps)
    expect(d.llamadas).toHaveLength(0)
    expect(r.detenido).toMatch(/consulta previa/)
  })
})

describe('el registro', () => {
  const linea = (r: Partial<RegistroBarrido>) => JSON.stringify({ en: 'x', tipo_original: 'CEDULA', ...r })

  it('resueltas = consultadas, previas y apartadas; los errores se reintentan; líneas rotas se ignoran', () => {
    const ids = idsResueltos([
      linea({ afi_id: 'a', estado: 'consultada' }),
      linea({ afi_id: 'b', estado: 'error' }),
      linea({ afi_id: 'c', estado: 'previa' }),
      linea({ afi_id: 'd', estado: 'aparte' }),
      '{"afi_id":"e","est',
      '',
    ])
    expect([...ids].sort()).toEqual(['a', 'c', 'd'])
  })

  it('el total manda el último registro de cada fila, y un error no pisa una resuelta', () => {
    const t = resumirRegistro([
      linea({ afi_id: 'a', estado: 'error', error: 'TimeoutError' }),
      linea({ afi_id: 'a', estado: 'consultada', severidad: 'bajo', valida_consulta_id: 'va', matches: [match('ONU', 'posible', 'nombre') as never] }),
      linea({ afi_id: 'b', estado: 'consultada', severidad: 'sin_hallazgo', valida_consulta_id: 'vb' }),
      linea({ afi_id: 'b', estado: 'error', error: 'x' }),
      linea({ afi_id: 'c', estado: 'error', error: 'validation_error', status: 400 }),
    ])
    expect(t.porSeveridad).toEqual({ bajo: 1, sin_hallazgo: 1 })
    expect(t.errores).toEqual([{ afi_id: 'c', error: 'validation_error', status: 400 }])
    expect(t.hallazgos).toEqual([
      { afi_id: 'a', valida_consulta_id: 'va', severidad: 'bajo', coincidencias: [{ lista: 'ONU', resultado: 'posible', match_por: 'nombre' }] },
    ])
  })

  it('lo impreso de un hallazgo no lleva nombres ni documentos', () => {
    const r = resultado('alto', 'val-1', [match('OFAC', 'exacto', 'documento')])
    const texto = lineasHallazgo({
      afi_id: 'afi-1',
      valida_consulta_id: r.consulta_id,
      severidad: r.severidad,
      coincidencias: r.matches.map((m) => ({ lista: m.lista, resultado: m.resultado, match_por: m.match_por ?? null })),
    }).join('\n')
    expect(texto).toContain('afi-1')
    expect(texto).toContain('val-1')
    expect(texto).toContain('lista=OFAC')
    expect(texto).toContain('criterio=exacto/documento')
    expect(texto).not.toMatch(/NOMBRE INVENTADO|Persona De Prueba|99999999|10000001/)
  })
})

describe('la cuenta antes de correr', () => {
  it('sin plan (409 sin_plan_asignado) alcanza: no hay bolsa ni bloqueo por mora', () => {
    expect(leerEstadoCuenta(409, { error: 'sin_plan_asignado' }, 750).puede).toBe(true)
  })

  it('una bolsa que no cubre las pendientes, o cortada, no arranca', () => {
    const bolsa = (saldo: number, bloqueada = false) => ({
      modalidad: 'bolsa',
      cliente: { cliente_id: CLIENTE_VALIDA_METRIK },
      bolsa: { saldo, bloqueada, estado: bloqueada ? 'agotada' : 'activa' },
    })
    expect(leerEstadoCuenta(200, bolsa(749), 750).puede).toBe(false)
    expect(leerEstadoCuenta(200, bolsa(750), 750).puede).toBe(true)
    expect(leerEstadoCuenta(200, bolsa(5000, true), 750).puede).toBe(false)
  })

  it('mensual: solo frena la mora; otra cuenta o una llave rechazada tampoco arrancan', () => {
    const mensual = (cobro: Record<string, boolean>, cliente_id = CLIENTE_VALIDA_METRIK) => ({ modalidad: 'mensual', cliente: { cliente_id }, cobro })
    expect(leerEstadoCuenta(200, mensual({ bloqueado: false, cuenta_vencida_sin_pago: false }), 750).puede).toBe(true)
    expect(leerEstadoCuenta(200, mensual({ bloqueado: true }), 750).puede).toBe(false)
    expect(leerEstadoCuenta(200, mensual({ cuenta_vencida_sin_pago: true }), 750).puede).toBe(false)
    expect(leerEstadoCuenta(200, mensual({}, 'otro-cliente'), 750).puede).toBe(false)
    expect(leerEstadoCuenta(401, { error: 'invalid_api_key' }, 750).puede).toBe(false)
    expect(leerEstadoCuenta(500, {}, 750).puede).toBe(false)
  })
})
