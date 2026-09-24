import { beforeEach, describe, expect, it } from 'vitest'
import { atenderPeticion, type PeticionApi } from './api'
import { cambiarPublicacion } from './nucleo'
import { repoEnMemoria } from './repo-memoria'
import { generarToken, hashToken, tokenDeCabecera } from './token'

const WS = 'ws-dimpro'
const OTRO_WS = 'ws-otro'
const AHORA = '2026-10-02T06:00:00.000Z'

let repo: ReturnType<typeof repoEnMemoria>
let tokenCron: string
let tokenAgente: string

function pedir(p: Partial<PeticionApi> & { recurso: string }, token: string | null = tokenCron) {
  return atenderPeticion(repo, {
    metodo: p.metodo ?? 'POST',
    recurso: p.recurso,
    authorization: token === null ? null : `Bearer ${token}`,
    cuerpo: p.cuerpo ?? null,
    ahora: p.ahora ?? AHORA,
  })
}

beforeEach(async () => {
  repo = repoEnMemoria(undefined, () => AHORA)
  tokenCron = generarToken()
  tokenAgente = generarToken()
  repo.estado.modulos[WS] = true
  repo.estado.tokens.push(
    { id: 't-cron', workspace_id: WS, nombre: 'Cron Mac', escritor: 'cron', revocado_at: null, token_hash: hashToken(tokenCron) },
    { id: 't-agente', workspace_id: WS, nombre: 'Agente MeTRIK', escritor: 'agente', revocado_at: null, token_hash: hashToken(tokenAgente) },
  )
  // El agente carga un producto y publica.
  const prod = await pedir(
    { recurso: 'productos', cuerpo: { productos: [{ sku: 'EKM80', nombre: 'Esmeril 800 W', costo: { fecha_lista: '2026-09-23', costo_f: 80_000 } }] } },
    tokenAgente,
  )
  expect(prod.status).toBe(200)
  const pub = await pedir(
    { recurso: 'publicaciones', cuerpo: { publicaciones: [{ codigo: 'MP-01', sku: 'EKM80', titulo: 'Esmeril', precio: 120_000, estado: 'activa' }] } },
    tokenAgente,
  )
  expect(pub.cuerpo).toMatchObject({ resultados: [{ codigo: 'MP-01', estado: 'creada', pendiente_en_canal: false }] })
})

describe('autenticación', () => {
  it('sin cabecera responde 401', async () => {
    const r = await pedir({ recurso: 'pendientes', metodo: 'GET' }, null)
    expect(r.status).toBe(401)
  })

  it('un token inventado responde 401', async () => {
    const r = await pedir({ recurso: 'pendientes', metodo: 'GET' }, generarToken())
    expect(r.status).toBe(401)
  })

  it('un token revocado responde 401', async () => {
    repo.estado.tokens[0].revocado_at = '2026-10-01T00:00:00Z'
    const r = await pedir({ recurso: 'pendientes', metodo: 'GET' })
    expect(r).toMatchObject({ status: 401, cuerpo: { error: { codigo: 'token_invalido' } } })
  })

  it('con el módulo apagado responde 403', async () => {
    repo.estado.modulos[WS] = false
    const r = await pedir({ recurso: 'pendientes', metodo: 'GET' })
    expect(r.status).toBe(403)
  })

  it('la cabecera exige Bearer y el prefijo fer_', () => {
    expect(tokenDeCabecera(null)).toBeNull()
    expect(tokenDeCabecera('Basic abc')).toBeNull()
    expect(tokenDeCabecera('Bearer xyz')).toBeNull()
    const t = generarToken()
    expect(tokenDeCabecera(`Bearer ${t}`)).toBe(t)
  })

  it('registra el último uso del token', async () => {
    await pedir({ recurso: 'pendientes', metodo: 'GET' })
    expect(repo.estado.tokens[0].ultimo_uso_at).toBe(AHORA)
  })

  it('el token solo ve su workspace', async () => {
    const tokenAjeno = generarToken()
    repo.estado.modulos[OTRO_WS] = true
    repo.estado.tokens.push({ id: 't-ajeno', workspace_id: OTRO_WS, nombre: 'otro', escritor: 'cron', revocado_at: null, token_hash: hashToken(tokenAjeno) })
    const r = await pedir(
      { recurso: 'confirmaciones', cuerpo: { confirmaciones: [{ codigo: 'MP-01', version: 0, resultado: 'error', error: 'x' }] } },
      tokenAjeno,
    )
    expect(r.cuerpo).toMatchObject({ resultados: [{ codigo: 'MP-01', estado: 'no_encontrada' }] })
  })
})

describe('contrato de rutas', () => {
  it('recurso desconocido 404 y método equivocado 405', async () => {
    expect((await pedir({ recurso: 'otra' })).status).toBe(404)
    expect((await pedir({ recurso: 'pendientes', metodo: 'POST' })).status).toBe(405)
    expect((await pedir({ recurso: 'lote', metodo: 'GET' })).status).toBe(405)
    expect((await pedir({ recurso: 'constructor', metodo: 'GET' })).status).toBe(404)
  })

  it('cuerpo inválido responde 400 con el detalle', async () => {
    const r = await pedir({ recurso: 'lote', cuerpo: { fecha: '02/10/2026', mediciones: [] } })
    expect(r).toMatchObject({ status: 400, cuerpo: { error: { codigo: 'cuerpo_invalido' } } })
  })

  it('«aplicado» sin lo visto al releer se rechaza', async () => {
    const r = await pedir({ recurso: 'confirmaciones', cuerpo: { confirmaciones: [{ codigo: 'MP-01', version: 0, resultado: 'aplicado' }] } })
    expect(r.status).toBe(400)
  })
})

describe('GET publicaciones', () => {
  it('devuelve el catálogo del workspace ordenado por código, sin descripción ni etiquetas', async () => {
    await pedir(
      {
        recurso: 'publicaciones',
        cuerpo: {
          publicaciones: [
            { codigo: 'MP-03', sku: 'EKM80', titulo: 'Esmeril 3', precio: 130_000, estado: 'activa', linea: 'impulso', descripcion: 'larga', etiquetas: ['a'] },
            { codigo: 'MP-02', sku: 'EKM80', titulo: 'Esmeril 2', precio: 125_000, estado: 'pausada', link: 'https://www.facebook.com/marketplace/item/123', id_aviso: '123', fecha_publicacion: '2026-09-23' },
          ],
        },
      },
      tokenAgente,
    )
    // Una publicación de otro workspace no se cuela.
    repo.estado.publicaciones.push({ ...repo.estado.publicaciones[0], id: 'pub-ajena', workspace_id: OTRO_WS, codigo: 'MP-00' })

    const r = await pedir({ recurso: 'publicaciones', metodo: 'GET' })
    expect(r.status).toBe(200)
    expect(r.cuerpo).toEqual({
      generado_at: AHORA,
      publicaciones: [
        { codigo: 'MP-01', sku: 'EKM80', canal: 'marketplace', titulo: 'Esmeril', precio: 120_000, estado: 'activa', linea: null, link: null, id_aviso: null, fecha_publicacion: null, pendiente_en_canal: false },
        { codigo: 'MP-02', sku: 'EKM80', canal: 'marketplace', titulo: 'Esmeril 2', precio: 125_000, estado: 'pausada', linea: null, link: 'https://www.facebook.com/marketplace/item/123', id_aviso: '123', fecha_publicacion: '2026-09-23', pendiente_en_canal: false },
        { codigo: 'MP-03', sku: 'EKM80', canal: 'marketplace', titulo: 'Esmeril 3', precio: 130_000, estado: 'activa', linea: 'impulso', link: null, id_aviso: null, fecha_publicacion: null, pendiente_en_canal: false },
      ],
    })
    // El orden de las claves es el del contrato.
    const primera = (r.cuerpo as { publicaciones: Record<string, unknown>[] }).publicaciones[0]
    expect(Object.keys(primera)).toEqual(['codigo', 'sku', 'canal', 'titulo', 'precio', 'estado', 'linea', 'link', 'id_aviso', 'fecha_publicacion', 'pendiente_en_canal'])
  })

  it('refleja lo pendiente de aplicar en el canal', async () => {
    const p = (await repo.publicacionPorCodigo(WS, 'MP-01'))!
    await cambiarPublicacion(repo, WS, p, { precio: 110_000 }, {
      origen: 'one',
      autor: { tipo: 'persona', id: 'perfil-dietmar', nombre: 'Dietmar' },
      ahora: '2026-10-01T15:00:00.000Z',
    })
    const r = await pedir({ recurso: 'publicaciones', metodo: 'GET' })
    expect(r.cuerpo).toMatchObject({ publicaciones: [{ codigo: 'MP-01', precio: 110_000, pendiente_en_canal: true }] })
  })

  it('lo leen el cron y el agente; sin token es 401', async () => {
    expect((await pedir({ recurso: 'publicaciones', metodo: 'GET' }, tokenCron)).status).toBe(200)
    expect((await pedir({ recurso: 'publicaciones', metodo: 'GET' }, tokenAgente)).status).toBe(200)
    expect((await pedir({ recurso: 'publicaciones', metodo: 'GET' }, null)).status).toBe(401)
  })

  it('leer no escribe nada', async () => {
    const antes = structuredClone({ p: repo.estado.publicaciones, e: repo.estado.eventos })
    await pedir({ recurso: 'publicaciones', metodo: 'GET' })
    expect({ p: repo.estado.publicaciones, e: repo.estado.eventos }).toEqual(antes)
  })

  it('un workspace sin publicaciones devuelve la lista vacía', async () => {
    repo.estado.publicaciones = []
    const r = await pedir({ recurso: 'publicaciones', metodo: 'GET' })
    expect(r).toMatchObject({ status: 200, cuerpo: { publicaciones: [] } })
  })
})

describe('corrida del cron', () => {
  it('pide pendientes, confirma y sube el lote', async () => {
    // Dietmar cambia el precio en ONE.
    const p = (await repo.publicacionPorCodigo(WS, 'MP-01'))!
    await cambiarPublicacion(repo, WS, p, { precio: 110_000 }, {
      origen: 'one',
      autor: { tipo: 'persona', id: 'perfil-dietmar', nombre: 'Dietmar' },
      ahora: '2026-10-01T15:00:00.000Z',
    })

    // (1) pide
    const pend = await pedir({ recurso: 'pendientes', metodo: 'GET' })
    expect(pend.status).toBe(200)
    const { pendientes } = pend.cuerpo as { pendientes: { codigo: string; version: number; deseado: { precio: number } }[] }
    expect(pendientes).toMatchObject([{ codigo: 'MP-01', version: 1, deseado: { precio: 110_000 } }])

    // (2)-(3) aplica y confirma con lo que vio
    const conf = await pedir({
      recurso: 'confirmaciones',
      cuerpo: { confirmaciones: [{ codigo: 'MP-01', version: 1, resultado: 'aplicado', visto: { precio: 110_000, estado: 'activa' } }] },
    })
    expect(conf.cuerpo).toMatchObject({ resultados: [{ codigo: 'MP-01', estado: 'aplicado' }] })
    const pend2 = await pedir({ recurso: 'pendientes', metodo: 'GET' })
    expect((pend2.cuerpo as { pendientes: unknown[] }).pendientes).toEqual([])

    // (4) sube el lote
    const lote = await pedir({
      recurso: 'lote',
      cuerpo: {
        fecha: '2026-10-02',
        mediciones: [{ codigo: 'MP-01', clics: 21, estado_visto: 'activa' }],
        conversaciones: [{ codigo: 'MP-01', interesado: 'Ana P.', canal: 'messenger', resultado: 'pregunto', id_externo: 'hilo-9' }],
      },
    })
    expect(lote).toMatchObject({ status: 200, cuerpo: { mediciones: 1, conversaciones: 1, rechazadas: [] } })
    expect(repo.estado.eventos.find((e) => e.tipo === 'aplicado_en_canal')).toMatchObject({ autor_tipo: 'cron', autor_nombre: 'Cron Mac' })
  })

  it('el agente no puede publicar bajo el piso por la API', async () => {
    const r = await pedir(
      { recurso: 'publicaciones', cuerpo: { publicaciones: [{ codigo: 'MP-01', precio: 90_000 }] } },
      tokenAgente,
    )
    expect(r.cuerpo).toMatchObject({ resultados: [{ codigo: 'MP-01', estado: 'rechazada', codigo_error: 'falta_motivo' }] })
    const r2 = await pedir(
      { recurso: 'publicaciones', cuerpo: { publicaciones: [{ codigo: 'MP-01', precio: 90_000, motivo: 'Competencia a 89.900' }] } },
      tokenAgente,
    )
    expect(r2.cuerpo).toMatchObject({ resultados: [{ codigo: 'MP-01', estado: 'actualizada', pendiente_en_canal: false }] })
    expect(repo.estado.eventos.find((e) => e.tipo === 'cambio_precio')).toMatchObject({ motivo: 'Competencia a 89.900', autor_tipo: 'agente' })
  })

  it('las notas entran a la bitácora', async () => {
    const r = await pedir({ recurso: 'eventos', cuerpo: { eventos: [{ codigo: 'MP-01', tipo: 'nota', texto: 'Meta la mandó a revisión' }] } }, tokenAgente)
    expect(r.cuerpo).toMatchObject({ resultados: [{ codigo: 'MP-01', estado: 'registrado' }] })
    expect(repo.estado.eventos.at(-1)).toMatchObject({ tipo: 'nota', valor_nuevo: 'Meta la mandó a revisión' })
  })
})
