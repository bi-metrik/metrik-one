import { beforeEach, describe, expect, it } from 'vitest'
import {
  cambiarPublicacion,
  confirmarCambio,
  guardarProducto,
  guardarPublicacion,
  listarPendientes,
  registrarLote,
  registrarVenta,
} from './nucleo'
import { repoEnMemoria } from './repo-memoria'
import type { Autor, RepoFerreteria } from './tipos'

const WS = 'ws-dimpro'
const DIETMAR: Autor = { tipo: 'persona', id: 'perfil-dietmar', nombre: 'Dietmar Niño' }
const AGENTE: Autor = { tipo: 'agente', id: null, nombre: 'Agente MeTRIK' }
const CRON: Autor = { tipo: 'cron', id: null, nombre: 'Cron Mac' }

let reloj = '2026-10-01T10:00:00.000Z'
let repo: RepoFerreteria & { estado: ReturnType<typeof repoEnMemoria>['estado'] }

async function sembrar() {
  // Costo F 80.000 → piso ≈ 86.418, regla 1,25 x = 100.000.
  await guardarProducto(repo, WS, { sku: 'EKM80', nombre: 'Esmeril 800 W', marca: 'Ekon', costo: { fecha_lista: '2026-09-23', costo_f: 80_000, costo_d: 90_000 } }, reloj)
  await guardarProducto(repo, WS, { sku: 'EKM80-B', nombre: 'Esmeril 800 W (banco)', costo: { fecha_lista: '2026-09-23', costo_f: 40_000 } }, reloj)
  const r = await guardarPublicacion(
    repo,
    WS,
    { codigo: 'MP-01', sku: 'EKM80', titulo: 'Esmeril Ekon 800 W', precio: 120_000, estado: 'activa', linea: 'ticket_alto' },
    { origen: 'canal', autor: AGENTE, ahora: reloj },
  )
  expect(r.ok).toBe(true)
}

async function pub() {
  const p = await repo.publicacionPorCodigo(WS, 'MP-01')
  if (!p) throw new Error('sin MP-01')
  return p
}

beforeEach(async () => {
  reloj = '2026-10-01T10:00:00.000Z'
  repo = repoEnMemoria(undefined, () => reloj)
  await sembrar()
})

describe('SKU exacto', () => {
  it('EKM80 y EKM80-B son productos distintos', () => {
    expect(repo.estado.productos.map((p) => p.sku).sort()).toEqual(['EKM80', 'EKM80-B'])
  })
})

describe('piso del precio al guardar desde ONE', () => {
  it('rechaza un precio con ganancia negativa y no toca nada', async () => {
    const antes = await pub()
    const r = await cambiarPublicacion(repo, WS, antes, { precio: 70_000 }, { origen: 'one', autor: DIETMAR, ahora: reloj, motivo: 'liquidar' })
    expect(r).toMatchObject({ ok: false, codigo: 'ganancia_negativa' })
    expect((await pub()).precio).toBe(120_000)
    expect(repo.estado.eventos.filter((e) => e.tipo === 'cambio_precio')).toHaveLength(0)
  })

  it('bajo 1,25 x costo F sin motivo se rechaza', async () => {
    const r = await cambiarPublicacion(repo, WS, await pub(), { precio: 95_000 }, { origen: 'one', autor: DIETMAR, ahora: reloj })
    expect(r).toMatchObject({ ok: false, codigo: 'falta_motivo' })
  })

  it('bajo 1,25 x costo F con motivo se guarda y el motivo queda en la bitácora', async () => {
    const r = await cambiarPublicacion(repo, WS, await pub(), { precio: 95_000 }, { origen: 'one', autor: DIETMAR, ahora: reloj, motivo: 'Igualar Homecenter' })
    expect(r).toMatchObject({ ok: true, estado: 'actualizada' })
    const ev = repo.estado.eventos.find((e) => e.tipo === 'cambio_precio')
    expect(ev).toMatchObject({ valor_anterior: '120000', valor_nuevo: '95000', motivo: 'Igualar Homecenter', autor_tipo: 'persona', autor_id: 'perfil-dietmar' })
  })

  it('usa el costo de la lista MÁS RECIENTE', async () => {
    // Lista nueva con costo más alto: 95.000 queda con pérdida.
    await guardarProducto(repo, WS, { sku: 'EKM80', costo: { fecha_lista: '2026-10-01', costo_f: 100_000 } }, reloj)
    const r = await cambiarPublicacion(repo, WS, await pub(), { precio: 95_000 }, { origen: 'one', autor: DIETMAR, ahora: reloj, motivo: 'x' })
    expect(r).toMatchObject({ ok: false, codigo: 'ganancia_negativa' })
  })

  it('el agente tampoco puede publicar bajo el piso', async () => {
    const r = await guardarPublicacion(
      repo,
      WS,
      { codigo: 'MP-02', sku: 'EKM80-B', titulo: 'Esmeril banco', precio: 30_000 },
      { origen: 'canal', autor: AGENTE, ahora: reloj },
    )
    expect(r).toMatchObject({ ok: false, codigo: 'ganancia_negativa' })
    expect(await repo.publicacionPorCodigo(WS, 'MP-02')).toBeNull()
  })
})

describe('pendiente_en_canal', () => {
  it('un cambio de precio hecho en ONE queda pendiente, con versión nueva', async () => {
    const r = await cambiarPublicacion(repo, WS, await pub(), { precio: 110_000 }, { origen: 'one', autor: DIETMAR, ahora: reloj })
    expect(r).toMatchObject({ ok: true, pendiente_en_canal: true })
    const p = await pub()
    expect(p).toMatchObject({ pendiente_en_canal: true, pendiente_desde: reloj, version_canal: 1 })
  })

  it('cambiar solo la línea (dato interno) no deja nada pendiente en el canal', async () => {
    await cambiarPublicacion(repo, WS, await pub(), { linea: 'impulso' }, { origen: 'one', autor: DIETMAR, ahora: reloj })
    expect(await pub()).toMatchObject({ linea: 'impulso', pendiente_en_canal: false, version_canal: 0 })
    expect(repo.estado.eventos.at(-1)).toMatchObject({ tipo: 'cambio_dato', campo: 'linea' })
  })

  it('lo que escribe el agente ya está en el canal: no queda pendiente', async () => {
    const r = await guardarPublicacion(repo, WS, { codigo: 'MP-01', precio: 115_000 }, { origen: 'canal', autor: AGENTE, ahora: reloj })
    expect(r).toMatchObject({ ok: true, pendiente_en_canal: false })
  })

  it('un guardado sin cambios no escribe bitácora', async () => {
    const n = repo.estado.eventos.length
    const r = await cambiarPublicacion(repo, WS, await pub(), { precio: 120_000, titulo: '  Esmeril Ekon 800 W ' }, { origen: 'one', autor: DIETMAR, ahora: reloj })
    expect(r).toMatchObject({ ok: true, estado: 'sin_cambios' })
    expect(repo.estado.eventos).toHaveLength(n)
  })

  it('el ciclo completo: pendiente → el cron lo pide → lo confirma aplicado', async () => {
    await cambiarPublicacion(repo, WS, await pub(), { precio: 110_000, estado: 'pausada' }, { origen: 'one', autor: DIETMAR, ahora: reloj })

    reloj = '2026-10-02T06:00:00.000Z'
    const pendientes = await listarPendientes(repo, WS)
    expect(pendientes).toHaveLength(1)
    expect(pendientes[0]).toMatchObject({ codigo: 'MP-01', version: 1, deseado: { precio: 110_000, estado: 'pausada' } })
    expect(pendientes[0].cambios.map((c) => c.tipo).sort()).toEqual(['cambio_estado', 'cambio_precio'])

    const c = await confirmarCambio(repo, WS, { codigo: 'MP-01', version: 1, resultado: 'aplicado', visto: { precio: 110_000, estado: 'pausada' } }, { autor: CRON, ahora: reloj })
    expect(c.estado).toBe('aplicado')
    expect(await pub()).toMatchObject({ pendiente_en_canal: false, pendiente_desde: null, intentos_fallidos: 0 })
    expect(repo.estado.eventos.at(-1)).toMatchObject({ tipo: 'aplicado_en_canal', autor_tipo: 'cron' })
    expect(await listarPendientes(repo, WS)).toEqual([])
  })

  it('si lo visto al releer no coincide, sigue pendiente con el error', async () => {
    await cambiarPublicacion(repo, WS, await pub(), { precio: 110_000 }, { origen: 'one', autor: DIETMAR, ahora: reloj })
    const c = await confirmarCambio(repo, WS, { codigo: 'MP-01', version: 1, resultado: 'aplicado', visto: { precio: 120_000 } }, { autor: CRON, ahora: reloj })
    expect(c.estado).toBe('no_coincide')
    expect(await pub()).toMatchObject({ pendiente_en_canal: true, intentos_fallidos: 1 })
    expect((await pub()).ultimo_error_canal).toContain('precio visto 120000')
  })

  it('dos corridas con error acumulan dos intentos (la pantalla lo pinta en rojo)', async () => {
    await cambiarPublicacion(repo, WS, await pub(), { estado: 'pausada' }, { origen: 'one', autor: DIETMAR, ahora: reloj })
    await confirmarCambio(repo, WS, { codigo: 'MP-01', version: 1, resultado: 'error', error: 'Botón no encontrado' }, { autor: CRON, ahora: reloj })
    await confirmarCambio(repo, WS, { codigo: 'MP-01', version: 1, resultado: 'error', error: 'Sesión caída' }, { autor: CRON, ahora: reloj })
    expect(await pub()).toMatchObject({ pendiente_en_canal: true, intentos_fallidos: 2, ultimo_error_canal: 'Sesión caída' })
    expect(repo.estado.eventos.filter((e) => e.tipo === 'error_en_canal')).toHaveLength(2)
  })

  it('un cambio nuevo mientras el cron aplicaba el anterior no se pierde', async () => {
    await cambiarPublicacion(repo, WS, await pub(), { precio: 110_000 }, { origen: 'one', autor: DIETMAR, ahora: reloj })
    const [p] = await listarPendientes(repo, WS)
    // Dietmar vuelve a cambiar antes de que el cron confirme.
    await cambiarPublicacion(repo, WS, await pub(), { precio: 105_000 }, { origen: 'one', autor: DIETMAR, ahora: reloj })
    const c = await confirmarCambio(repo, WS, { codigo: 'MP-01', version: p.version, resultado: 'aplicado', visto: { precio: 110_000 } }, { autor: CRON, ahora: reloj })
    expect(c.estado).toBe('obsoleto')
    expect(await pub()).toMatchObject({ pendiente_en_canal: true, precio: 105_000, version_canal: 2 })
  })

  it('confirmar dos veces el mismo cambio es inofensivo', async () => {
    await cambiarPublicacion(repo, WS, await pub(), { precio: 110_000 }, { origen: 'one', autor: DIETMAR, ahora: reloj })
    await confirmarCambio(repo, WS, { codigo: 'MP-01', version: 1, resultado: 'aplicado', visto: { precio: 110_000 } }, { autor: CRON, ahora: reloj })
    const otra = await confirmarCambio(repo, WS, { codigo: 'MP-01', version: 1, resultado: 'aplicado', visto: { precio: 110_000 } }, { autor: CRON, ahora: reloj })
    expect(otra.estado).toBe('sin_pendiente')
  })
})

describe('lote diario', () => {
  it('guarda mediciones, captura el link de la primera corrida y rechaza códigos desconocidos', async () => {
    const r = await registrarLote(
      repo,
      WS,
      {
        fecha: '2026-10-02',
        mediciones: [
          { codigo: 'MP-01', clics: 14, link: 'https://www.facebook.com/marketplace/item/123/', id_aviso: '123' },
          { codigo: 'MP-99', clics: 3 },
        ],
        conversaciones: [{ codigo: 'MP-01', interesado: 'Carlos R.', canal: 'messenger' }],
      },
      { autor: CRON, ahora: reloj },
    )
    expect(r).toMatchObject({ mediciones: 1, conversaciones: 1, links_capturados: 1 })
    expect(r.rechazadas).toEqual([{ tipo: 'medicion', codigo: 'MP-99', motivo: 'La publicación no existe en ONE.' }])
    expect(await pub()).toMatchObject({ link: 'https://www.facebook.com/marketplace/item/123/', id_aviso: '123' })
  })

  it('reintentar el mismo lote no duplica mediciones ni conversaciones', async () => {
    const lote = {
      fecha: '2026-10-02',
      mediciones: [{ codigo: 'MP-01', clics: 14 }],
      conversaciones: [{ codigo: 'MP-01', interesado: 'Carlos R.', canal: 'messenger' as const }],
    }
    await registrarLote(repo, WS, lote, { autor: CRON, ahora: reloj })
    await registrarLote(repo, WS, { ...lote, conversaciones: [{ ...lote.conversaciones[0], resultado: 'cotizo' as const }] }, { autor: CRON, ahora: reloj })
    expect(repo.estado.mediciones).toHaveLength(1)
    expect(repo.estado.conversaciones).toHaveLength(1)
    expect(repo.estado.conversaciones[0].resultado).toBe('cotizo')
  })
})

describe('venta', () => {
  it('congela el costo F vigente en la fecha del primer pago y calcula la ganancia', async () => {
    await guardarProducto(repo, WS, { sku: 'EKM80', costo: { fecha_lista: '2026-10-15', costo_f: 90_000 } }, reloj)
    const r = await registrarVenta(repo, WS, await pub(), { fecha_primer_pago: '2026-10-03', precio_final: 120_000, ruta: 'despacho' }, DIETMAR)
    expect(r).toMatchObject({ ok: true })
    // Costo del 23-sep (80.000), no el del 15-oct.
    expect(repo.estado.ventas[0]).toMatchObject({ costo_dia: 80_000, ganancia: Math.round(120_000 * 0.777933 - 80_000 * 0.840336) })
    expect(repo.estado.eventos.at(-1)).toMatchObject({ tipo: 'venta' })
  })
})
