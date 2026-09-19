/**
 * El control de recibos: de la plata que entró, cuál está acusada.
 *
 * EL CASO QUE IMPORTA: la lista es POR PAGO. Mientras el recibo se manejó desde la cola
 * de facturación, la unidad era el NEGOCIO, y un negocio con tres pagos se veía como
 * una línea. El 24% de los negocios de SOENA ya recibió más de un pago (medido el
 * 2026-09-02), así que agrupar escondía justo lo que hay que ver.
 *
 * SE VIERON FALLAR contra una versión que agrupaba por negocio o que escondía los
 * marcados:
 *   - "dos pagos del mismo negocio son dos líneas"  → salía una
 *   - "un pago marcado no cuenta como pendiente"    → seguía pendiente
 *   - "el marcado no desaparece de la lista"        → se perdía sin auditoría
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const WS = 'ws-soena'

type Fila = Record<string, unknown>
let cobros: Fila[]
let negocios: Fila[]
let contactos: Fila[]
let bloquesRut: Fila[]
/** Líneas del workspace. Solo las que declaran `recibo_por_concepto` cambian algo. */
let lineas: Fila[]
/** `v_cobro_valor`: el reparto canónico. Vacío = el panel ni lo consulta. */
let reparto: Fila[]

vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({ workspaceId: WS, staffId: 's1', role: 'admin', areas: ['financiera'] }),
}))

vi.mock('@/lib/permissions/can-edit', () => ({ canEditBloque: () => true }))

vi.mock('@/lib/supabase/paginar', () => ({
  traerTodo: async (consulta: (d: number, h: number) => Promise<{ data: Fila[] }>) => {
    const r = await consulta(0, 999)
    return r.data
  },
}))

/** Si está puesto, la consulta a esa tabla falla: simula una columna que no existe. */
let fallaTabla: string | null
/** Columnas pedidas a cada tabla, para poder afirmar sobre ellas. */
let selects: Record<string, string>

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    from: (tabla: string) => {
      const fuente = tabla === 'cobros' ? () => cobros
        : tabla === 'negocios' ? () => negocios
        : tabla === 'negocio_bloques' ? () => bloquesRut
        : tabla === 'lineas_negocio' ? () => lineas
        : tabla === 'v_cobro_valor' ? () => reparto
        : () => contactos
      const chain = {
        select: (cols: string) => { selects[tabla] = cols; return chain },
        eq: () => chain,
        is: () => chain,
        not: () => chain,
        in: () => chain,
        order: () => chain,
        range: async () => {
          if (fallaTabla === tabla) throw new Error(`column ${tabla}.inexistente does not exist`)
          return { data: fuente(), error: null }
        },
      }
      return chain
    },
  }),
}))

import { getControlRecibos } from './recibos-control-actions'

beforeEach(() => {
  fallaTabla = null
  selects = {}
  negocios = [{
    id: 'neg-1', codigo: 'V0451', nombre: 'Cliente Uno', contacto_id: 'ct-1',
    carpeta_url: 'https://drive/x', linea_id: 'lin-1',
    metadata: { siigo_cliente: { siigo_id: 'cli-1', identificacion: '1110584384' } },
  }]
  bloquesRut = []
  // La línea NO declara `recibo_por_concepto`: es el estado de toda la base hoy.
  lineas = [{ id: 'lin-1', config_extra: { siigo: { recibo_concepto: 'Dinero recibido del cliente' } } }]
  reparto = []
  contactos = [{ id: 'ct-1', nombre: 'José Noel', email: 'jose@ejemplo.com' }]
  cobros = [
    {
      id: 'c1', negocio_id: 'neg-1', monto: 701812, fecha: '2026-09-02', concepto: 'Abono',
      siigo_recibo: { numero: 'RC-1-65', archivo_url: 'https://drive/rc65' }, recibo_no_aplica: null,
    },
    {
      id: 'c2', negocio_id: 'neg-1', monto: 637500, fecha: '2026-08-31', concepto: 'Abono',
      siigo_recibo: null, recibo_no_aplica: null,
    },
  ]
})

describe('getControlRecibos — el control es por pago, no por negocio', () => {
  it('dos pagos del mismo negocio son dos líneas, con su propio estado', async () => {
    const { data } = await getControlRecibos()

    expect(data!.pagos).toHaveLength(2)
    expect(data!.pagos.map(p => p.estado)).toEqual(['con_recibo', 'pendiente'])
    expect(data!.pagos[0].recibo_numero).toBe('RC-1-65')
    expect(data!.pagos[0].recibo_url).toBe('https://drive/rc65')
  })

  it('un pago marcado como que no aplica sale de pendientes pero no de la lista', async () => {
    cobros[1].recibo_no_aplica = { motivo: 'Negocio ya facturado' }
    const { data } = await getControlRecibos()

    expect(data!.totales.pendientes).toBe(0)
    expect(data!.totales.no_aplica).toBe(1)
    // Sigue visible: un pendiente que desaparece sin rastro es uno que nadie audita.
    expect(data!.pagos).toHaveLength(2)
    expect(data!.pagos.find(p => p.cobro_id === 'c2')!.no_aplica_motivo).toBe('Negocio ya facturado')
  })

  it('que el negocio esté facturado NO decide el estado del recibo', async () => {
    negocios[0].metadata = { siigo_cliente: { siigo_id: 'cli-1' }, siigo_factura: { numero: 'FV-2-429' } }
    const { data } = await getControlRecibos()

    const pendiente = data!.pagos.find(p => p.cobro_id === 'c2')!
    expect(pendiente.facturado).toBe(true)
    expect(pendiente.estado).toBe('pendiente')
  })

  it('sin RUT y sin marca de tercero, el pago NO se puede emitir', async () => {
    // Es lo unico que frena de verdad: sin identificacion no hay tercero que crear.
    negocios[0].metadata = {}
    const { data } = await getControlRecibos()

    const pendiente = data!.pagos.find(p => p.cobro_id === 'c2')!
    expect(pendiente.faltantes).toEqual(['RUT del cliente'])
    expect(data!.totales.emitibles).toBe(0)
  })

  it('con RUT cargado se puede emitir aunque el tercero no exista todavia en Siigo', async () => {
    // `asegurarClienteSiigo` lo crea en la misma emision a partir del RUT. Exigir la
    // marca previa dejaba 17 de 47 pendientes de SOENA marcados como no emitibles
    // (medido el 2026-09-08) sin que nada los frenara de verdad.
    negocios[0].metadata = {}
    bloquesRut = [{ negocio_id: 'neg-1', data: { campos: { numero_identificacion: { value: '1110584384' } } } }]
    const { data } = await getControlRecibos()

    const pendiente = data!.pagos.find(p => p.cobro_id === 'c2')!
    expect(pendiente.faltantes).toEqual([])
    expect(data!.totales.emitibles).toBe(1)
  })

  it('un bloque de RUT presente pero VACIO no alcanza', async () => {
    // Los 5 casos bloqueados de SOENA tenian el bloque creado sin un solo campo.
    negocios[0].metadata = {}
    bloquesRut = [{ negocio_id: 'neg-1', data: { campos: {} } }]
    const { data } = await getControlRecibos()

    expect(data!.pagos.find(p => p.cobro_id === 'c2')!.faltantes).toEqual(['RUT del cliente'])
  })

  it('sin correo el recibo SI se emite: es aviso, no bloqueo', async () => {
    // El correo solo decide si al cliente se le avisa. Contarlo como faltante era la
    // otra mitad del contador que mentia.
    contactos[0].email = null
    const { data } = await getControlRecibos()

    const pendiente = data!.pagos.find(p => p.cobro_id === 'c2')!
    expect(pendiente.faltantes).toEqual([])
    expect(pendiente.avisos).toContain('al cliente no se le avisa: no hay correo')
    expect(data!.totales.emitibles).toBe(1)
  })

  it('sin carpeta del negocio tambien se emite: el PDF se archiva despues', async () => {
    negocios[0].carpeta_url = null
    const { data } = await getControlRecibos()

    const pendiente = data!.pagos.find(p => p.cobro_id === 'c2')!
    expect(pendiente.faltantes).toEqual([])
    expect(pendiente.avisos).toContain('el PDF no queda archivado: el negocio no tiene carpeta')
    expect(data!.totales.emitibles).toBe(1)
  })

  it('un pago sin faltantes cuenta como emitible', async () => {
    const { data } = await getControlRecibos()

    expect(data!.totales.pendientes).toBe(1)
    expect(data!.totales.emitibles).toBe(1)
    expect(data!.totales.valor_pendiente).toBe(637500)
  })
})

/**
 * El estado de un pago deja de ser binario.
 *
 * EL CASO QUE IMPORTA: un cobro MIXTO al que se le emitió el recibo del honorario y no
 * el de la plata de terceros. Tiene marca, así que con el criterio anterior
 * (`siigo_recibo.numero` a secas) salía `con_recibo` y desaparecía de la lista sobre la
 * que hay que actuar — el panel volvería a esconder trabajo, que es justo lo que el
 * PR #581 corrigió. Medido en producción el 2026-09-19: 63 de los 425 cobros vivos de
 * SOENA son mixtos.
 *
 * SE VIERON FALLAR contra el criterio anterior:
 *   - "un mixto a medias se ve PENDIENTE"          → salía `con_recibo`
 *   - "la fila dice qué componente falta"          → no existía el dato
 *   - "los DOS recibos se listan"                  → solo el primero
 */
describe('getControlRecibos — un pago mixto a medias sigue pendiente', () => {
  /** Como queda una línea que sí declara recibo por concepto. Los ids son ejemplos. */
  const LINEA_POR_CONCEPTO = {
    id: 'lin-1',
    config_extra: {
      siigo: {
        recibo_concepto: 'Dinero recibido del cliente',
        recibo_por_concepto: {
          honorario: { document_id: 101, concepto: 'Honorarios de asesoría' },
          pasante: { document_id: 202, concepto: 'Recaudo para pago de tarifa UPME' },
        },
      },
    },
  }

  /** c1 es mixto: $701.812 = $400.000 de honorario + $301.812 de terceros. */
  const REPARTO_MIXTO = {
    cobro_id: 'c1', a_tramo1: 400_000, a_tramo2: 0, a_tarifa: 301_812, excedente: 0,
  }

  beforeEach(() => {
    lineas = [LINEA_POR_CONCEPTO]
    reparto = [REPARTO_MIXTO]
    // Solo salió el del honorario: el de terceros falló y hay que reintentarlo.
    cobros[0].siigo_recibo = [
      { numero: 'RC-1-70', archivo_url: 'https://drive/rc70', componente: 'honorario' },
    ]
  })

  it('un mixto con UN recibo de DOS se ve PENDIENTE, no resuelto', async () => {
    const { data } = await getControlRecibos()

    const mixto = data!.pagos.find(p => p.cobro_id === 'c1')!
    expect(mixto.estado).toBe('pendiente')
    expect(data!.totales.con_recibo).toBe(0)
  })

  it('la fila dice QUÉ componente falta, para que el pendiente se pueda resolver', async () => {
    const { data } = await getControlRecibos()

    expect(data!.pagos.find(p => p.cobro_id === 'c1')!.componentes_pendientes).toEqual(['pasante'])
  })

  it('con los DOS emitidos queda resuelto, y los dos se listan', async () => {
    cobros[0].siigo_recibo = [
      { numero: 'RC-1-70', archivo_url: 'https://drive/rc70', componente: 'honorario' },
      { numero: 'RC-9-3', archivo_url: 'https://drive/rc93', componente: 'pasante' },
    ]
    const { data } = await getControlRecibos()

    const mixto = data!.pagos.find(p => p.cobro_id === 'c1')!
    expect(mixto.estado).toBe('con_recibo')
    expect(mixto.recibos.map(r => r.numero)).toEqual(['RC-1-70', 'RC-9-3'])
    expect(mixto.componentes_pendientes).toEqual([])
  })

  it('un cobro PURO no queda esperando un componente que no tiene', async () => {
    // c2 no tiene fila de reparto en este escenario: sin plata en la otra bolsa, un
    // solo recibo lo resuelve. Exigirle dos lo dejaría pendiente para siempre.
    reparto = [REPARTO_MIXTO, { cobro_id: 'c2', a_tramo1: 637_500, a_tramo2: 0, a_tarifa: 0, excedente: 0 }]
    cobros[1].siigo_recibo = [{ numero: 'RC-1-71', archivo_url: null, componente: 'honorario' }]
    const { data } = await getControlRecibos()

    expect(data!.pagos.find(p => p.cobro_id === 'c2')!.estado).toBe('con_recibo')
  })

  // ── Lo que protege a las 17 marcas ya escritas ──
  it('una marca VIEJA (objeto, sin componente) sigue contando como resuelta', async () => {
    // 16 en `soena` y 1 en `metrik`, medidas el 2026-09-19. Acusan el TOTAL: no se sabe
    // qué componente respaldan, y re-emitir consume numeración que no se deshace. Los 3
    // mixtos que ya tienen recibo se quedan como están (decisión de Mauricio).
    cobros[0].siigo_recibo = { numero: 'RC-1-65', archivo_url: 'https://drive/rc65' }
    const { data } = await getControlRecibos()

    const mixto = data!.pagos.find(p => p.cobro_id === 'c1')!
    expect(mixto.estado).toBe('con_recibo')
    expect(mixto.componentes_pendientes).toEqual([])
    expect(mixto.recibo_numero).toBe('RC-1-65')
  })
})

/**
 * Control de compatibilidad: una línea sin `recibo_por_concepto` no paga nada.
 *
 * Es lo que protege a `metrik`, a `valida` y a SOENA mientras el comprobante de la
 * plata de terceros no exista.
 */
describe('getControlRecibos — sin recibo por concepto nada cambia', () => {
  it('no consulta el reparto: ninguna línea lo necesita', async () => {
    await getControlRecibos()

    expect(selects['v_cobro_valor']).toBeUndefined()
  })

  it('un solo recibo resuelve el pago, aunque el cobro sea mixto', async () => {
    reparto = [{ cobro_id: 'c1', a_tramo1: 400_000, a_tramo2: 0, a_tarifa: 301_812, excedente: 0 }]
    const { data } = await getControlRecibos()

    expect(data!.pagos.find(p => p.cobro_id === 'c1')!.estado).toBe('con_recibo')
  })
})

/**
 * Un control de plata que falla tiene que DECIRLO.
 *
 * EL CASO QUE IMPORTA: pedí `cobros.concepto`, que no existe (el concepto vive en
 * `notas`). La consulta fallaba, el action devolvía null, y la pestaña solo se dibujaba
 * cuando el control venía lleno: desaparecía entera. La pantalla se veía normal, apenas
 * sin una pestaña, que es indistinguible de "esto todavía no existe".
 *
 * Los dobles no validan nombres de columna, así que la prueba no puede atrapar el
 * nombre malo. Lo que sí puede es garantizar el contrato del que depende la pantalla
 * para no volver a callarse: ante un fallo, `error` viene lleno y `data` en null.
 */
describe('getControlRecibos — un fallo se reporta, no se esconde', () => {
  it('devuelve el error en vez de lanzarlo, para que la pantalla lo pueda mostrar', async () => {
    fallaTabla = 'cobros'
    const r = await getControlRecibos()

    expect(r.data).toBeNull()
    expect(r.error).toContain('does not exist')
  })

  it('el concepto del pago se lee de `notas`, que es donde vive', async () => {
    await getControlRecibos()

    expect(selects.cobros).toContain('notas')
    expect(selects.cobros).not.toMatch(/\bconcepto\b/)
  })
})
