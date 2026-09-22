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

/**
 * Lo que responde `emails_cliente_negocio`: el correo al que DE VERDAD le llega el aviso.
 *
 * Es una fuente aparte del contacto a propósito. La regla de precedencia (el correo del
 * RUT gana) vive SOLO en SQL, así que aquí se dobla su RESPUESTA, no su lógica: lo que
 * estas pruebas fijan es que el panel use esa respuesta y no `contactos.email`.
 */
let emailsPorNegocio: Record<string, string | null>
/** Si está puesto, la RPC falla. */
let fallaRpc: string | null
/** Llamadas a la RPC, para afirmar que la página no hace una por cobro. */
let llamadasRpc: Array<{ fn: string; ids: string[] }>

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    rpc: async (fn: string, args: { p_negocio_ids: string[] }) => {
      llamadasRpc.push({ fn, ids: args.p_negocio_ids })
      if (fallaRpc) return { data: null, error: { message: fallaRpc } }
      return {
        data: args.p_negocio_ids.map(id => ({ negocio_id: id, email: emailsPorNegocio[id] ?? null })),
        error: null,
      }
    },
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
  fallaRpc = null
  llamadasRpc = []
  // El caso base: el negocio no tiene RUT con correo, así que la RPC cae al del contacto
  // y devuelve exactamente lo mismo que `contactos.email`.
  emailsPorNegocio = { 'neg-1': 'jose@ejemplo.com' }
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

  it('sin correo en NINGUNA parte el recibo SI se emite: es aviso, no bloqueo', async () => {
    // El correo solo decide si al cliente se le avisa. Contarlo como faltante era la
    // otra mitad del contador que mentia.
    //
    // ⚠️ "Sin correo" es que no lo tenga NI el RUT NI el contacto, o sea que la RPC no
    // devuelva ninguno. Mirar solo `contactos.email` es lo que hacía falsa la
    // advertencia en 112 de los 119 casos donde salía.
    contactos[0].email = null
    emailsPorNegocio = {}
    const { data } = await getControlRecibos()

    const pendiente = data!.pagos.find(p => p.cobro_id === 'c2')!
    expect(pendiente.faltantes).toEqual([])
    expect(pendiente.avisos).toContain('al cliente no se le avisa: no hay correo')
    expect(pendiente.correo).toBeNull()
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
 * El honorario que se ABONA a la factura (2026-09-22).
 *
 * El panel no puede ofrecer un botón que vuelva sin emitir nada. Tres casos en que el
 * honorario no lo resuelve un clic: el negocio no tiene factura (se abona al facturar),
 * el pago trae retención (lo cruza Tesorería) o una emisión anterior ya lo dejó «a mano».
 */
describe('getControlRecibos — el honorario que se abona a la factura', () => {
  const LINEA_ABONO = {
    id: 'lin-1',
    config_extra: {
      siigo: {
        recibo_por_concepto: {
          honorario: { document_id: 4594, concepto: 'Honorarios de asesoría', tipo: 'abono' },
          pasante: { document_id: 33546, concepto: 'Recaudo pago certificación UPME' },
        },
      },
    },
  }
  const fila = (id: string) => (getControlRecibos().then(r => r.data!.pagos.find(p => p.cobro_id === id)!))

  beforeEach(() => {
    lineas = [LINEA_ABONO]
    reparto = [
      { cobro_id: 'c1', a_tramo1: 0, a_tramo2: 0, a_tarifa: 701_812, excedente: 0 },
      { cobro_id: 'c2', a_tramo1: 637_500, a_tramo2: 0, a_tarifa: 0, excedente: 0 },
    ]
    cobros[0].siigo_recibo = null
  })

  it('sin factura, un pago de puro honorario NO es emitible: falta la factura', async () => {
    const c2 = await fila('c2')
    expect(c2.estado).toBe('pendiente')
    expect(c2.faltantes).toEqual(['la factura del negocio: el honorario se abona a ella'])
  })

  it('sin factura, un pago mixto SÍ es emitible (sale la tarifa), con el aviso del honorario', async () => {
    reparto[0] = { cobro_id: 'c1', a_tramo1: 318_750, a_tramo2: 0, a_tarifa: 383_062, excedente: 0 }
    const c1 = await fila('c1')
    expect(c1.faltantes).toEqual([])
    expect(c1.avisos).toContain('el honorario se abona a la factura cuando se emita: ahora sale solo la tarifa')
  })

  it('con factura, el pago de puro honorario se puede emitir', async () => {
    negocios[0].metadata = { ...(negocios[0].metadata as Fila), siigo_factura: { numero: 'FV-2-540', siigo_id: 'x' } }
    const c2 = await fila('c2')
    expect(c2.faltantes).toEqual([])
  })

  it('con factura y retención, lo cruza Tesorería: no es emitible', async () => {
    negocios[0].metadata = { ...(negocios[0].metadata as Fila), siigo_factura: { numero: 'FV-2-540', siigo_id: 'x' } }
    cobros[1].retencion = 50_000
    const c2 = await fila('c2')
    expect(c2.faltantes).toEqual(['el abono a mano en Siigo: el pago trae retención'])
  })

  it('un «a mano» guardado se nombra por su razón, y no cuenta como recibo', async () => {
    negocios[0].metadata = { ...(negocios[0].metadata as Fila), siigo_factura: { numero: 'FV-2-540', siigo_id: 'x' } }
    cobros[1].siigo_recibo = [{
      componente: 'honorario', abono_a_mano: { motivo: 'factura_saldada', detalle: '…' }, valor: 637_500, at: '', por: null,
    }]
    const c2 = await fila('c2')
    expect(c2.estado).toBe('pendiente')
    expect(c2.recibos).toEqual([])
    expect(c2.faltantes).toEqual(['el abono a mano en Siigo: la factura ya no tenía saldo (sobrepago)'])
  })

  it('un abono emitido dice a qué factura se abonó', async () => {
    cobros[1].siigo_recibo = [{
      numero: 'RC-1-90', archivo_url: null, componente: 'honorario', tipo: 'abono',
      factura: { numero: 'FV-2-540', siigo_id: 'x' },
    }]
    const c2 = await fila('c2')
    expect(c2.estado).toBe('con_recibo')
    expect(c2.recibos).toEqual([{ numero: 'RC-1-90', url: null, componente: 'honorario', abono_de: 'FV-2-540' }])
  })

  it('CONTROL: en una línea sin abono el mismo pago sin factura sí es emitible', async () => {
    lineas = [{ id: 'lin-1', config_extra: { siigo: { recibo_por_concepto: {
      honorario: { document_id: 4594, concepto: 'Honorarios de asesoría' },
    } } } }]
    const c2 = await fila('c2')
    expect(c2.faltantes).toEqual([])
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

/**
 * A quién se le avisa lo decide la MISMA fuente que el aviso, no el contacto.
 *
 * EL CASO QUE IMPORTA: V0502 de SOENA. El panel decía "al cliente no se le avisa: no hay
 * correo" —el contacto, Paula Andrea Oliveros, no tiene correo— y el aviso salió igual, a
 * `johncifuentes@hotmail.com`, el titular del RUT. Esa frase no es decorativa: quien emite
 * la lee para decidir si le toca avisarle al cliente por otro lado, y en ese caso la leyó.
 *
 * MEDIDO CONTRA PRODUCCIÓN el 2026-09-22 sobre los 410 cobros pendientes de SOENA: la
 * advertencia salía en **119** casos y era FALSA en **112**; en otros **73** la columna
 * `correo` mostraba una dirección distinta de la que iba a recibir el soporte; y solo **7**
 * no tenían de verdad a dónde avisar.
 *
 * LAS QUE SE VIERON FALLAR contra `origin/main` (advertencia y columna leídas de
 * `contactos.email`):
 *   - "contacto sin correo y RUT con correo → NO sale la advertencia" → salía
 *   - "la columna muestra la dirección que recibe"                    → mostraba la del contacto
 *   - "el destinatario se resuelve en una sola ida"                   → no se resolvía
 *   - "si no se puede resolver, el panel lo dice"                     → mostraba el del contacto
 *
 * La de "sin correo en NINGUNA parte" (arriba) pasa en las dos versiones a propósito: está
 * para que el arreglo no tape una advertencia legítima.
 */
describe('getControlRecibos — el destinatario sale de email_cliente_negocio', () => {
  it('el contacto no tiene correo pero el RUT sí: la advertencia NO sale', async () => {
    contactos[0].email = null
    emailsPorNegocio = { 'neg-1': 'johncifuentes@hotmail.com' }
    const { data } = await getControlRecibos()

    const pendiente = data!.pagos.find(p => p.cobro_id === 'c2')!
    expect(pendiente.avisos).not.toContain('al cliente no se le avisa: no hay correo')
    expect(pendiente.correo).toBe('johncifuentes@hotmail.com')
  })

  it('la columna correo muestra la dirección que RECIBE, no la del contacto', async () => {
    contactos[0].email = 'paula@ejemplo.com'
    emailsPorNegocio = { 'neg-1': 'titular@rut.co' }
    const { data } = await getControlRecibos()

    expect(data!.pagos.find(p => p.cobro_id === 'c2')!.correo).toBe('titular@rut.co')
  })

  it('los correos de la página se resuelven en UNA ida a la base, no una por cobro', async () => {
    // El panel muestra 410 cobros sobre ~300 negocios en SOENA: una llamada por cobro son
    // 410 idas y vueltas por carga de pantalla.
    negocios.push({
      id: 'neg-2', codigo: 'V0502', nombre: 'Cliente Dos', contacto_id: 'ct-1',
      carpeta_url: 'https://drive/y', linea_id: 'lin-1', metadata: {},
    })
    cobros.push({
      id: 'c3', negocio_id: 'neg-2', monto: 550035, fecha: '2026-09-01', concepto: 'Abono',
      siigo_recibo: null, recibo_no_aplica: null,
    })
    await getControlRecibos()

    expect(llamadasRpc).toHaveLength(1)
    expect(llamadasRpc[0].fn).toBe('emails_cliente_negocio')
    // Por NEGOCIO, no por cobro: los dos pagos de neg-1 preguntan una sola vez.
    expect(llamadasRpc[0].ids).toEqual(['neg-1', 'neg-2'])
  })

  it('si no se puede resolver el destinatario, el panel DICE que falló', async () => {
    // Caer al correo del contacto sería volver a la respuesta equivocada con la misma cara
    // que la correcta, que es exactamente el defecto que esto corrige.
    fallaRpc = 'function public.emails_cliente_negocio(uuid[]) does not exist'
    const r = await getControlRecibos()

    expect(r.data).toBeNull()
    expect(r.error).toContain('emails_cliente_negocio')
  })
})
