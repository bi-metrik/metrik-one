/**
 * Lo que la hoja de UNA persona pinta cuando se cambia de mes.
 *
 * El defecto que esto fija: el perfil ya recibia `?mes=`, pero el periodo solo entraba en
 * los KPIs. La tabla de abajo salia del arreglo completo de negocios, sin filtro, asi que
 * arriba decia "Ventas: 4" (septiembre) y abajo estaba la lista historica entera. Cambiar
 * de mes no movia ni una fila.
 *
 * Es una prueba de RENDER porque lo que se corrige es un hecho de pantalla. Mismo patron
 * que `equipo-comercial-tarjeta-mes.test.ts`: `renderToStaticMarkup` en el entorno `node`
 * de vitest alcanza para el primer render, que es donde vive todo lo que se afirma aca.
 *
 * ⚠️ Lo que NO cubre y por eso queda en el QA en pantalla: el clic. Sin DOM no se puede
 * pulsar el KPI y ver el panel abrirse con esos casos; aca se comprueba que la cifra es un
 * boton y que la de cero no lo es.
 *
 * ⚠️ Mutaciones corridas el 2026-09-10; cada una tumba al menos una prueba:
 *   la tabla vuelve a salir de `negocios` sin cortar ............ 3 pruebas
 *   el corte arranca en 'todos' con mes elegido ................. 3
 *   los contadores de fase se calculan sobre `negocios` ......... 1
 *   el pill del mes se pinta tambien en acumulado ............... 1
 *   el mes sin ventas cae a la lista historica .................. 1
 *   el KPI `Ventas` deja de ser boton ........................... 1
 *   el KPI en cero se vuelve boton .............................. 1
 *   se quita la nota de inventario .............................. 1
 *   el aviso de discrepancia se calla ........................... 1
 *   `Ver todas sus ventas` deja de apuntar al acumulado ......... 1
 *
 * Y sobre el selector compartido (`selector-mes.tsx`), cada una tumba una:
 *   las flechas no se apagan en acumulado ....................... 1
 *   la salida al acumulado se pinta tambien en `/equipo` ........ 1
 *   el rotulo no dice `Acumulado` ............................... 1
 *   el boton dice siempre `Ver acumulado` ....................... 1
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import type { ComercialPerfil, ComercialPerfilNegocio } from './comercial-types'
import type { RankingEquipo } from './comercial-ranking'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
  usePathname: () => '/equipo/comercial/staff-1',
  useSearchParams: () => new URLSearchParams(''),
}))

function negocio(over: Partial<ComercialPerfilNegocio> = {}): ComercialPerfilNegocio {
  return {
    id: 'n-1',
    codigo: 'V0001',
    nombre: 'Caso uno',
    stage: 'cobro',
    estado: 'abierto',
    etapa_nombre: 'Cobro',
    etapa_numero: 8,
    es_venta: false,
    fecha_venta: null,
    ultimo_avance: '2026-09-01T12:00:00Z',
    sla_horas: 48,
    sla_estado: 'a_tiempo',
    valor_aprobado: 1_000_000,
    valor_aprobado_con_iva: 1_190_000,
    honorario_recaudado: 0,
    tarifa_recaudada: 0,
    pendiente_honorario: 1_000_000,
    ...over,
  }
}

/**
 * Perfil de una persona con DOS ventas del mes y UN caso viejo que sigue abierto. Ese
 * caso viejo es el que separa las dos preguntas: no se vendio este mes, pero es suyo hoy.
 */
function perfilBase(over: Partial<ComercialPerfil> = {}): ComercialPerfil {
  return {
    responsable_id: 'staff-1',
    nombre: 'JESSICA TEJADA',
    position: 'Comercial',
    sin_responsable: false,
    anio: 2026,
    mes: 9,
    kpis: {
      negocios_total: 3,
      negocios_abiertos: 2,
      num_ventas: 2,
      valor_aprobado: 3_000_000,
      valor_aprobado_con_iva: 3_570_000,
      honorario_recaudado: 1_200_000,
      tarifa_recaudada: 0,
      pendiente_honorario: 1_800_000,
      vencidos: 0,
    },
    porStage: [],
    porEtapa: [],
    serie: [{ anio: 2026, mes: 8, label: 'Aug 26', num_ventas: 3, valor_aprobado: 1, honorario_recaudado: 1 }],
    negocios: [
      negocio({ id: 'n-1', codigo: 'VENTA-A', es_venta: true, fecha_venta: '2026-09-03', stage: 'ejecucion' }),
      negocio({ id: 'n-2', codigo: 'VENTA-B', es_venta: true, fecha_venta: '2026-09-11', stage: 'cobro' }),
      negocio({ id: 'n-3', codigo: 'VIEJO-C', es_venta: false, fecha_venta: '2026-06-02', stage: 'cerrado' }),
    ],
    ...over,
  }
}

const RANKING_VACIO: RankingEquipo = { personas: [], lideres: [], sinResponsable: null, total: 0 }

async function pintar(args: {
  perfil?: ComercialPerfil
  ranking?: RankingEquipo
  anio?: number | null
  mes?: number | null
}): Promise<string> {
  const mod = await import('./comercial/[staff_id]/comercial-perfil-client')
  const Cliente = mod.default
  return renderToStaticMarkup(
    React.createElement(Cliente, {
      perfil: args.perfil ?? perfilBase(),
      ranking: args.ranking ?? RANKING_VACIO,
      staffId: 'staff-1',
      anio: args.anio === undefined ? 2026 : args.anio,
      mes: args.mes === undefined ? 9 : args.mes,
      anioRef: 2026,
      mesRef: 9,
    }),
  )
}

/** El texto de la tabla, sin marcado: alcanza para afirmar que fila esta y cual no. */
function texto(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
}

describe('perfil comercial: la tabla de abajo obedece al mes', () => {
  it('con mes elegido abre en las ventas de ese mes, no en la lista completa', async () => {
    const html = texto(await pintar({}))
    expect(html).toContain('VENTA-A')
    expect(html).toContain('VENTA-B')
    // El caso viejo es suyo, pero no lo vendio en septiembre: no puede estar en el corte.
    expect(html).not.toContain('VIEJO-C')
  })

  it('el conteo del pill del mes es el mismo numero del KPI Ventas', async () => {
    const html = texto(await pintar({}))
    // KPI de arriba y pill de abajo, los dos en 2.
    expect(html).toContain('Vendidos en Septiembre 2026 2')
    expect(html).toContain('Ventas 2')
    // Y no hay nada que reportar: las dos cifras coinciden.
    expect(html).not.toContain('Las dos cifras deberian salir del mismo calculo')
  })

  it('el otro corte sigue disponible y trae todos sus casos', async () => {
    const html = texto(await pintar({}))
    expect(html).toContain('Todos sus casos 3')
  })

  it('los contadores de fase se recalculan sobre el corte, no sobre el historico', async () => {
    const html = texto(await pintar({}))
    // `cerrado` solo lo trae el caso viejo, que esta fuera del corte del mes: su pill no
    // se pinta. Antes el contador contaba sobre el arreglo completo.
    expect(html).toContain('Ejecucion 1')
    expect(html).toContain('Cobro 1')
    expect(html).not.toContain('Cerrado 1')
  })

  it('en acumulado no se pinta el pill del mes y la tabla trae todo', async () => {
    const html = texto(await pintar({ anio: null, mes: null }))
    expect(html).not.toContain('Vendidos en')
    expect(html).toContain('VIEJO-C')
    expect(html).toContain('Todos sus casos (3)')
  })

  it('un mes sin ventas lo dice, no cae a la lista historica', async () => {
    const perfil = perfilBase({
      kpis: { ...perfilBase().kpis, num_ventas: 0 },
      negocios: [negocio({ id: 'n-3', codigo: 'VIEJO-C', es_venta: false })],
    })
    const html = texto(await pintar({ perfil }))
    expect(html).toContain('Sin ventas en Septiembre 2026')
    expect(html).not.toContain('VIEJO-C')
  })

  it('avisa cuando la lista y el KPI no cuentan lo mismo', async () => {
    // El KPI dice 3 y la RPC marco 2: las dos definiciones de venta se separaron.
    const perfil = perfilBase({ kpis: { ...perfilBase().kpis, num_ventas: 3 } })
    const html = texto(await pintar({ perfil }))
    expect(html).toContain('Las dos cifras deberian salir del mismo calculo')
  })

  it('la salida al historico lleva al acumulado del mismo perfil', async () => {
    const html = await pintar({})
    expect(html).toContain('href="/equipo/comercial/staff-1?mes=acumulado"')
    expect(texto(html)).toContain('Ver todas sus ventas')
  })
})

describe('perfil comercial: la cifra de ventas se abre', () => {
  it('el KPI Ventas es un boton cuando hay ventas en el mes', async () => {
    const html = await pintar({})
    expect(html).toContain('Ver los casos detras de esta cifra')
  })

  it('una cifra en cero no es boton', async () => {
    const perfil = perfilBase({
      kpis: { ...perfilBase().kpis, num_ventas: 0 },
      negocios: [],
    })
    const html = await pintar({ perfil })
    expect(html).not.toContain('Ver los casos detras de esta cifra')
  })

  it('en acumulado tampoco es boton: el panel solo sabe responder por un mes', async () => {
    const html = await pintar({ anio: null, mes: null })
    expect(html).not.toContain('Ver los casos detras de esta cifra')
  })
})

/**
 * El selector es COMPARTIDO con `/equipo`, asi que se prueba aparte: un cambio para el perfil
 * (la salida al acumulado) no puede aparecerse en la otra pantalla, que no sabe responder
 * por el historico.
 */
describe('selector de mes compartido', () => {
  async function pintarSelector(props: {
    anio: number
    mes: number
    conAcumulado?: boolean
    enAcumulado?: boolean
  }): Promise<string> {
    const mod = await import('./selector-mes')
    return renderToStaticMarkup(React.createElement(mod.default, props))
  }

  it('en `/equipo` no ofrece el acumulado', async () => {
    const html = await pintarSelector({ anio: 2026, mes: 9 })
    expect(texto(html)).toContain('Septiembre 2026')
    expect(texto(html)).not.toContain('Ver acumulado')
    expect(html).not.toContain('disabled')
  })

  it('con un mes elegido, la salida al acumulado dice a donde lleva', async () => {
    const html = await pintarSelector({ anio: 2026, mes: 9, conAcumulado: true })
    expect(texto(html)).toContain('Ver acumulado')
    expect(html).not.toContain('disabled')
  })

  it('en acumulado apaga las flechas y ofrece volver al mes de referencia', async () => {
    const html = await pintarSelector({ anio: 2026, mes: 9, conAcumulado: true, enAcumulado: true })
    const t = texto(html)
    expect(t).toContain('Acumulado')
    expect(t).toContain('Ver Septiembre 2026')
    // Las dos flechas: no hay mes desde el cual moverse.
    expect(html.match(/disabled/g)?.length).toBe(2)
  })
})

describe('perfil comercial: lo que no se mueve con el mes lo dice', () => {
  it('los indicadores de inventario llevan su nota', async () => {
    const html = texto(await pintar({}))
    expect(html).toContain('Negocios activos 2 Inventario a hoy, no depende del mes')
    expect(html).toContain('Vencidos (SLA) 0 Inventario a hoy, no depende del mes')
    expect(html).toContain('Embudo por etapa (pendiente de recaudo) Inventario a hoy, no depende del mes')
  })

  it('los que si son del mes lo dicen tambien', async () => {
    const html = texto(await pintar({}))
    expect(html).toContain('Ventas 2 Septiembre 2026')
    expect(html).toContain('Honorario recaudado $1.200.000 Septiembre 2026')
  })
})
