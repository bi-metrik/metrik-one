'use server'

/**
 * Control de recibos de caja: qué plata que entró tiene su recibo y cuál no.
 *
 * ── Por qué vive aparte de facturación ──────────────────────────────────────
 *
 * Decisión de Mauricio (2026-09-07). Hasta hoy el recibo se emitía desde la cola de
 * facturación, y eso obligaba a que un pago apareciera donde se decide facturar. Son
 * dos controles distintos: la factura se emite por el honorario pactado, el recibo
 * acusa la plata que entregó el cliente, y ninguno depende del otro. Un caso ya
 * facturado seguía necesitando el recibo de sus pagos, así que quien buscaba pagos sin
 * acusar tenía que entrar por la pestaña "Ya facturados", que es exactamente el sitio
 * donde nadie los busca.
 *
 * Este control responde una sola pregunta: **de la plata que entró, cuál está acusada.**
 *
 * ── Los tres estados de un pago ─────────────────────────────────────────────
 *
 *  - `con_recibo`  — toda su plata está acusada. Trae número y enlace al PDF.
 *  - `no_aplica`   — marcado con `recibo_no_aplica`. Es el corte histórico del
 *                    2026-09-07: los pagos de negocios ya facturados no llevan recibo
 *                    retroactivo. Se muestran, no se esconden: un pendiente que
 *                    desaparece sin dejar rastro es un pendiente que nadie audita.
 *  - `pendiente`   — el resto. Es la única lista sobre la que hay que actuar.
 *
 * ── Tener UN recibo ya no basta para estar acusado ──────────────────────────
 *
 * Desde el recibo por concepto (2026-09-19), una línea puede declarar que un pago
 * mixto sale en DOS documentos: el honorario y la plata de terceros. **Un cobro con el
 * honorario emitido y la tarifa no está PENDIENTE, no resuelto.** Si se viera resuelto,
 * el panel volvería a esconder trabajo, que es justo lo que el PR #581 corrigió.
 *
 * Para saberlo hacen falta dos cosas que antes no se leían: el reparto del cobro
 * (`v_cobro_valor`, que dice cuánta plata hay en cada bolsa) y la configuración de la
 * línea del negocio (que dice si esa línea parte sus recibos). **Una línea que no lo
 * declara se comporta exactamente como antes**, y ninguna lo declara hoy.
 *
 * Un cobro anulado no aparece: no documenta plata recibida.
 */

import { getWorkspace } from '@/lib/actions/get-workspace'
import { createServiceClient } from '@/lib/supabase/server'
import { canEditBloque, type Area, type Role, type UserContext } from '@/lib/permissions/can-edit'
import { traerTodo } from '@/lib/supabase/paginar'
import {
  abonosAManoDelCobro,
  componentesConValor,
  hayReciboPorElTotal,
  leerReciboPorConcepto,
  primerRecibo,
  reciboCompleto,
  recibosDelCobro,
  repartoDeCobro,
  type ComponenteRecibo,
  type FilaReparto,
} from '@/lib/siigo/recibo-componentes'
import { ETIQUETA_ABONO_A_MANO, esMotivoAbonoAMano, retencionDelCobro } from '@/lib/siigo/abono'

export type EstadoRecibo = 'con_recibo' | 'no_aplica' | 'pendiente'

export interface PagoConRecibo {
  cobro_id: string
  negocio_id: string
  negocio_codigo: string | null
  cliente: string | null
  /**
   * La dirección a la que de VERDAD le llega el aviso del recibo, resuelta con
   * `email_cliente_negocio` (la misma fuente que usa `notificar-etapa`): el correo del
   * RUT gana, el del contacto es el respaldo.
   *
   * ⚠️ No es `contactos.email`. Leerlo de ahí era el defecto: el titular del RUT es el
   * dueño de la plata y el contacto muchas veces es quien vendió.
   */
  correo: string | null
  monto: number
  fecha: string | null
  concepto: string | null
  estado: EstadoRecibo
  /** Número del PRIMER recibo del cobro. Null si todavía no tiene ninguno. */
  recibo_numero: string | null
  /** Enlace al PDF del PRIMER recibo. Puede faltar aunque el recibo exista. */
  recibo_url: string | null
  /**
   * Todos los recibos del cobro, en orden de emisión.
   *
   * Es lo que permite mostrar los dos documentos de un pago mixto. Con un solo recibo
   * trae una entrada, y con la marca vieja (objeto suelto) también: el helper tolera
   * las dos formas.
   */
  recibos: Array<{
    numero: string
    url: string | null
    componente: ComponenteRecibo | null
    /** Número de la factura a la que se abonó. Solo en los abonos (`DebtPayment`). */
    abono_de?: string | null
  }>
  /**
   * Qué le falta por acusar a un cobro que YA tiene algún recibo.
   *
   * Vacío en el caso normal. Con contenido significa que la emisión quedó a medias y
   * hay que reintentarla: el panel lo dice en vez de dejar el pendiente sin explicación.
   */
  componentes_pendientes: ComponenteRecibo[]
  /** Por qué no lleva recibo. Solo en `no_aplica`. */
  no_aplica_motivo: string | null
  /** El negocio ya tiene factura. Se muestra como contexto, NO decide el estado. */
  facturado: boolean
  /**
   * Lo que de verdad IMPIDE emitir. Hoy es una sola cosa: sin RUT no hay
   * identificación con la que crear el tercero en Siigo.
   *
   * ⚠️ Antes esta lista incluía "tercero en Siigo" y "correo del cliente", y ninguna
   * de las dos frena: `asegurarClienteSiigo` crea el tercero a partir del RUT en la
   * misma emisión, y el correo solo decide si al cliente se le avisa. Medido el
   * 2026-09-08 en SOENA, el contador decía **19 emitibles de 47** cuando el número
   * real era **42**: la pestaña escondía más de la mitad del trabajo que sí se podía
   * resolver, que es la forma más cara de equivocarse en un tablero — nadie va a
   * buscar lo que el sistema afirma que no se puede hacer.
   */
  faltantes: string[]
  /**
   * Lo que va a salir peor de lo normal, pero NO frena la emisión.
   *
   * Se declara aparte en vez de callarse: el recibo sale igual, y quien lo emite
   * merece saber de antemano que el cliente no se va a enterar o que el PDF no va a
   * quedar archivado. Mezclarlo con `faltantes` fue justo lo que rompió el contador.
   */
  avisos: string[]
}

/**
 * ⚠️ El concepto del pago vive en `cobros.notas`. No hay columna `concepto`.
 *
 * Pedirla hacía fallar la consulta entera, y como la pestaña solo se dibujaba cuando el
 * control venía lleno, el control desaparecía sin decir nada (2026-09-07). Los dobles de
 * las pruebas no validan nombres de columna, así que esto solo lo ve producción o
 * alguien mirando el esquema.
 */
export interface ControlRecibos {
  pagos: PagoConRecibo[]
  totales: {
    pendientes: number
    con_recibo: number
    no_aplica: number
    valor_pendiente: number
    /** Pendientes que se pueden emitir hoy: los que no tienen nada que los frene. */
    emitibles: number
  }
}

/** Mismo criterio de área que facturación: el recaudo es del área financiera. */
async function ctxFinanciero(): Promise<
  { ok: true; workspaceId: string } | { ok: false; error: string }
> {
  const { workspaceId, staffId, role, areas, error } = await getWorkspace()
  if (error || !workspaceId) return { ok: false, error: error ?? 'No autenticado' }
  const user: UserContext = {
    id: staffId ?? '',
    role: (role ?? 'read_only') as Role,
    areas: (areas ?? []) as Area[],
  }
  if (!canEditBloque(user, { stage: 'cobro' }, [])) {
    return { ok: false, error: 'Solo el área financiera puede ver el control de recibos' }
  }
  return { ok: true, workspaceId }
}

export async function getControlRecibos(): Promise<{ data: ControlRecibos | null; error?: string }> {
  const ctx = await ctxFinanciero()
  if (!ctx.ok) return { data: null, error: ctx.error }
  try {
    return { data: await armarControl(ctx.workspaceId) }
  } catch (e) {
    // Igual que la cola de facturación: una lista recortada tiene el mismo aspecto que
    // una lista entera, y aquí decide si se emite un documento contable. Se prefiere
    // una pantalla que dice que falló.
    return { data: null, error: (e as Error).message }
  }
}

async function armarControl(workspaceId: string): Promise<ControlRecibos> {
  const svc = createServiceClient()

  type FilaCobro = {
    id: string
    negocio_id: string | null
    monto: number | null
    fecha: string | null
    notas: string | null
    tipo_cobro: string | null
    /** Objeto (forma vieja) o lista: se lee con los helpers, nunca de frente. */
    siigo_recibo: unknown
    recibo_no_aplica: { motivo?: string } | null
    /** Con retención, el abono del honorario no lo hace ONE: lo cruza Tesorería. */
    retencion: number | string | null
  }

  const cobros = await traerTodo<FilaCobro>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (d, h) => (svc as any)
      .from('cobros')
      .select('id, negocio_id, monto, fecha, notas, tipo_cobro, siigo_recibo, recibo_no_aplica, retencion')
      .eq('workspace_id', workspaceId)
      .is('anulado_at', null)
      .not('fecha', 'is', null)
      .order('id')
      .range(d, h),
    { etiqueta: 'recibos/cobros' },
  )

  const negocioIds = [...new Set(cobros.map(c => c.negocio_id).filter((v): v is string => !!v))]
  if (negocioIds.length === 0) {
    return { pagos: [], totales: { pendientes: 0, con_recibo: 0, no_aplica: 0, valor_pendiente: 0, emitibles: 0 } }
  }

  type FilaNegocio = {
    id: string
    codigo: string | null
    nombre: string | null
    contacto_id: string | null
    carpeta_url: string | null
    linea_id: string | null
    metadata: Record<string, unknown> | null
  }

  const negocios = await traerTodo<FilaNegocio>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (d, h) => (svc as any)
      .from('negocios')
      .select('id, codigo, nombre, contacto_id, carpeta_url, linea_id, metadata')
      .in('id', negocioIds)
      .order('id')
      .range(d, h),
    { etiqueta: 'recibos/negocios' },
  )
  const porId = new Map(negocios.map(n => [n.id, n]))

  // ── Qué componentes espera cada cobro ──
  //
  // Solo hace falta para las líneas que declaran `recibo_por_concepto`. Hoy no lo
  // declara ninguna, así que las dos lecturas de abajo se saltan enteras y el panel
  // cuesta exactamente lo mismo que antes.
  const lineaIds = [...new Set(negocios.map(n => n.linea_id).filter((v): v is string => !!v))]
  const lineas = lineaIds.length === 0 ? [] : await traerTodo<{ id: string; config_extra: Record<string, unknown> | null }>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (d, h) => (svc as any)
      .from('lineas_negocio').select('id, config_extra').in('id', lineaIds).order('id').range(d, h),
    { etiqueta: 'recibos/lineas' },
  )
  const porConceptoPorLinea = new Map(
    lineas.map(l => [l.id, leerReciboPorConcepto((l.config_extra ?? {}).siigo)]),
  )
  const algunaLineaParteRecibos = [...porConceptoPorLinea.values()].some(v => v != null)

  // El reparto solo se lee si alguna línea lo necesita: es la vista del P&L, y pedirla
  // por gusto en cada carga del panel es trabajo que nadie usa.
  const repartoPorCobro = new Map<string, FilaReparto>()
  if (algunaLineaParteRecibos) {
    const filas = await traerTodo<FilaReparto & { cobro_id: string }>(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (d, h) => (svc as any)
        .from('v_cobro_valor')
        .select('cobro_id, a_tramo1, a_tramo2, a_tarifa, excedente')
        .eq('workspace_id', workspaceId)
        .order('cobro_id')
        .range(d, h),
      { etiqueta: 'recibos/reparto' },
    )
    for (const f of filas) repartoPorCobro.set(f.cobro_id, f)
  }

  /**
   * Los componentes que ESTE cobro tiene que acusar.
   *
   * Vacío significa "basta un recibo cualquiera", que es el criterio de siempre y el
   * que aplica a toda línea sin `recibo_por_concepto`.
   */
  const esperadosDe = (c: FilaCobro): ComponenteRecibo[] => {
    const lineaId = c.negocio_id ? porId.get(c.negocio_id)?.linea_id : null
    const cfg = lineaId ? porConceptoPorLinea.get(lineaId) : null
    if (!cfg) return []
    const reparto = repartoDeCobro(repartoPorCobro.get(c.id) ?? null, {
      monto: Number(c.monto ?? 0),
      tipo_cobro: c.tipo_cobro,
    })
    // Sin reparto no se sabe qué falta. Se cae al criterio de siempre en vez de
    // declarar pendiente un cobro que quizá ya está completo.
    return componentesConValor(reparto).filter(comp => cfg[comp] != null)
  }

  /**
   * Qué dice el panel del honorario en una línea que lo ABONA a la factura.
   *
   * Tres casos en que el botón NO resolvería el honorario, y el panel lo dice antes de
   * que alguien lo oprima: el negocio todavía no tiene factura (se abona al facturar),
   * el pago trae retención (lo cruza Tesorería), o una emisión anterior ya lo dejó «a
   * mano» con su razón. Si el honorario es lo ÚNICO que falta es un faltante (el botón
   * no haría nada); si falta también la tarifa es solo un aviso, porque el botón sí
   * emite la tarifa y el cobro no puede quedarse sin su RC-3 por culpa del honorario.
   */
  const delAbono = (
    c: FilaCobro,
    esperados: ComponenteRecibo[],
    facturado: boolean,
  ): { faltantes: string[]; avisos: string[] } => {
    const out = { faltantes: [] as string[], avisos: [] as string[] }
    const lineaId = c.negocio_id ? porId.get(c.negocio_id)?.linea_id : null
    const cfg = lineaId ? porConceptoPorLinea.get(lineaId) : null
    if (cfg?.honorario?.tipo !== 'abono' || hayReciboPorElTotal(c.siigo_recibo)) return out

    const emitidos = new Set(recibosDelCobro(c.siigo_recibo).map(m => m.componente))
    const faltan = esperados.filter(comp => !emitidos.has(comp))
    if (!faltan.includes('honorario')) return out
    const destino = faltan.length === 1 ? out.faltantes : out.avisos

    const aMano = abonosAManoDelCobro(c.siigo_recibo).find(m => m.componente === 'honorario')
    if (aMano) {
      const motivo = aMano.abono_a_mano.motivo
      destino.push(`el abono a mano en Siigo: ${esMotivoAbonoAMano(motivo) ? ETIQUETA_ABONO_A_MANO[motivo] : aMano.abono_a_mano.detalle}`)
    } else if (!facturado) {
      destino.push(faltan.length === 1
        ? 'la factura del negocio: el honorario se abona a ella'
        : 'el honorario se abona a la factura cuando se emita: ahora sale solo la tarifa')
    } else if (retencionDelCobro(c.retencion) > 0) {
      destino.push(`el abono a mano en Siigo: ${ETIQUETA_ABONO_A_MANO.retencion}`)
    }
    return out
  }

  const contactoIds = [...new Set(negocios.map(n => n.contacto_id).filter((v): v is string => !!v))]
  const contactos = contactoIds.length === 0 ? [] : await traerTodo<{ id: string; nombre: string | null; email: string | null }>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (d, h) => (svc as any)
      .from('contactos').select('id, nombre, email').in('id', contactoIds).order('id').range(d, h),
    { etiqueta: 'recibos/contactos' },
  )
  const contactoPorId = new Map(contactos.map(c => [c.id, c]))

  // ── ¿A quién se le avisa de verdad? ──
  //
  // Lo resuelve la MISMA fuente que el aviso: `email_cliente_negocio`, que prefiere el
  // correo del RUT y solo cae al del contacto si el RUT no lo trae. El panel leía
  // `contacto.email` a secas y decía lo contrario de lo que el sistema hacía: medido
  // contra producción el 2026-09-22 sobre los 410 cobros pendientes de SOENA, la
  // advertencia "no hay correo" salía en 119 casos y era FALSA en 112, y en otros 73 la
  // dirección mostrada no era la que iba a recibir el soporte. Quien emite lee esa frase
  // para decidir si le toca avisarle al cliente por otro lado.
  //
  // La precedencia NO se copia aquí a propósito: el titular del RUT es el dueño de la
  // plata y el contacto muchas veces es quien vendió. Dos definiciones de "a quién se le
  // escribe" se desincronizan sin que nadie lo note, que es exactamente cómo nació este
  // defecto.
  const emailPorNegocio = await correosDelCliente(svc, negocioIds)

  // ── ¿Hay con qué identificar al cliente ante Siigo? ──
  //
  // La marca `siigo_cliente` responde que sí sin leer nada más: el tercero ya existe.
  // Cuando no está, la respuesta la tiene el RUT, porque `asegurarClienteSiigo` crea
  // el tercero con la identificación que saca de ahí. Por eso solo se lee el RUT de
  // los negocios que hacen falta —los pendientes sin marca—, y no el de todos: en
  // SOENA eso baja la lectura de ~300 negocios a ~17.
  const negociosPendientes = new Set(
    cobros
      .filter(c => !reciboCompleto(c.siigo_recibo, esperadosDe(c)) && !c.recibo_no_aplica && c.negocio_id)
      .map(c => c.negocio_id as string),
  )
  const sinMarca = [...negociosPendientes].filter(id => {
    const meta = (porId.get(id)?.metadata ?? {}) as Record<string, Record<string, unknown> | undefined>
    return !meta.siigo_cliente?.identificacion
  })

  type FilaRut = { negocio_id: string; data: { campos?: Record<string, { value?: unknown }> } | null }
  const bloquesRut = sinMarca.length === 0 ? [] : await traerTodo<FilaRut>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (d, h) => (svc as any)
      .from('negocio_bloques')
      .select('negocio_id, data, bloque_configs!inner(slug)')
      .in('negocio_id', sinMarca)
      .eq('bloque_configs.slug', 'rut')
      .order('id')
      .range(d, h),
    { etiqueta: 'recibos/rut' },
  )

  // Mismo criterio que la cola de facturación (`rutPorNegocio`): un RUT sin cédula ni
  // NIT no sirve, aunque el bloque exista. En SOENA los 5 casos medidos el 2026-09-08
  // tenían el bloque creado y vacío, así que juzgar por su presencia habría dicho que
  // se podían emitir.
  const conIdentificacion = new Set(
    bloquesRut
      .filter(b => {
        const campos = b.data?.campos ?? {}
        const v = (k: string) => String(campos[k]?.value ?? '').trim()
        return !!(v('numero_identificacion') || v('nit'))
      })
      .map(b => b.negocio_id),
  )

  const pagos: PagoConRecibo[] = cobros.map(c => {
    const neg = c.negocio_id ? porId.get(c.negocio_id) : undefined
    const meta = (neg?.metadata ?? {}) as Record<string, Record<string, unknown> | undefined>
    const contacto = neg?.contacto_id ? contactoPorId.get(neg.contacto_id) : undefined

    // A quién le llega el aviso: lo dice la RPC, no el contacto. Ver `correosDelCliente`.
    const correo = (c.negocio_id ? emailPorNegocio.get(c.negocio_id) : null) ?? null

    const esperados = esperadosDe(c)
    const marcas = recibosDelCobro(c.siigo_recibo)

    // ⚠️ Un cobro con UN recibo de DOS no es `con_recibo`. Ver el encabezado.
    const estado: EstadoRecibo = reciboCompleto(c.siigo_recibo, esperados)
      ? 'con_recibo'
      : c.recibo_no_aplica
        ? 'no_aplica'
        : 'pendiente'

    // Lo que falta solo se nombra cuando el cobro ya tiene algún recibo: ahí la emisión
    // quedó a medias y el panel puede decir cuál. Sin ninguno, el pendiente se explica
    // solo y repetir los dos componentes sería ruido.
    const emitidos = new Set(marcas.map(m => m.componente).filter(Boolean))
    const componentesPendientes = estado === 'pendiente' && marcas.length > 0
      ? esperados.filter(comp => !emitidos.has(comp))
      : []

    // Lo que impediría emitir y lo que solo va a salir peor. Se calculan siempre para
    // que la lista diga por qué un pendiente no se puede resolver hoy, en vez de
    // dejar que falle al oprimir.
    const faltantes: string[] = []
    const avisos: string[] = []
    if (estado === 'pendiente') {
      const identificado = !!meta.siigo_cliente?.identificacion
        || (!!c.negocio_id && conIdentificacion.has(c.negocio_id))
      if (!identificado) faltantes.push('RUT del cliente')

      // ── El honorario que se ABONA a la factura ──
      // Lo que ONE no puede resolver con un clic se dice como faltante, para que el
      // botón no prometa un recibo que va a volver sin emitir nada.
      const del = delAbono(c, esperados, !!meta.siigo_factura?.numero)
      faltantes.push(...del.faltantes)
      avisos.push(...del.avisos)
      // El PDF se archiva DESPUÉS de emitir y su fallo no deshace el recibo, que ya
      // consumió numeración en Siigo. Frenar por esto dejaría plata sin acusar por un
      // problema de archivo.
      if (!neg?.carpeta_url) avisos.push('el PDF no queda archivado: el negocio no tiene carpeta')
      if (!correo) avisos.push('al cliente no se le avisa: no hay correo')
    }

    return {
      cobro_id: c.id,
      negocio_id: c.negocio_id ?? '',
      negocio_codigo: neg?.codigo ?? null,
      cliente: contacto?.nombre ?? neg?.nombre ?? null,
      correo,
      monto: Number(c.monto ?? 0),
      fecha: c.fecha,
      concepto: c.notas,
      estado,
      recibo_numero: primerRecibo(c.siigo_recibo)?.numero ?? null,
      recibo_url: primerRecibo(c.siigo_recibo)?.archivo_url ?? null,
      recibos: marcas.map(m => ({
        numero: m.numero,
        url: m.archivo_url ?? null,
        componente: m.componente ?? null,
        abono_de: m.tipo === 'abono' ? m.factura?.numero ?? null : null,
      })),
      componentes_pendientes: componentesPendientes,
      no_aplica_motivo: (c.recibo_no_aplica?.motivo as string | undefined) ?? null,
      facturado: !!meta.siigo_factura?.numero,
      faltantes,
      avisos,
    }
  })

  // Lo más reciente primero: es donde está el trabajo que todavía se puede resolver.
  pagos.sort((a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? ''))

  const pendientes = pagos.filter(p => p.estado === 'pendiente')
  return {
    pagos,
    totales: {
      pendientes: pendientes.length,
      con_recibo: pagos.filter(p => p.estado === 'con_recibo').length,
      no_aplica: pagos.filter(p => p.estado === 'no_aplica').length,
      valor_pendiente: pendientes.reduce((s, p) => s + p.monto, 0),
      emitibles: pendientes.filter(p => p.faltantes.length === 0).length,
    },
  }
}

/**
 * Los correos a los que de verdad les llega el aviso, por negocio.
 *
 * Delega en `emails_cliente_negocio`, que no es más que `email_cliente_negocio` —la
 * fuente única, la que usa `notificar-etapa`— aplicada a una lista. La regla de
 * precedencia vive SOLO en SQL: ver la migración `20260922000001`.
 *
 * Por lotes de 500 y no de una: PostgREST recorta cualquier respuesta en 1.000 filas
 * devolviendo 200 y sin `error`, así que una sola llamada con todos los negocios sería
 * correcta hoy (~300 en SOENA) y empezaría a perder correos en silencio el día que
 * pasen de mil. Con lotes de 500 son dos idas a la base por cada mil negocios, no una
 * por negocio, que es lo que había que evitar.
 *
 * Si la función no está en la base, esto LANZA. Es deliberado: el panel entero dice que
 * falló en vez de volver a mostrar el correo del contacto, que es la respuesta
 * equivocada con la misma cara que la correcta.
 */
async function correosDelCliente(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc: any,
  negocioIds: string[],
): Promise<Map<string, string>> {
  const porNegocio = new Map<string, string>()
  for (let i = 0; i < negocioIds.length; i += 500) {
    const { data, error } = await svc.rpc('emails_cliente_negocio', {
      p_negocio_ids: negocioIds.slice(i, i + 500),
    })
    if (error) {
      throw new Error(
        `No se pudo resolver a quién se le avisa (emails_cliente_negocio): ${error.message}`,
      )
    }
    for (const fila of (data ?? []) as Array<{ negocio_id: string; email: string | null }>) {
      if (fila.email) porNegocio.set(fila.negocio_id, fila.email)
    }
  }
  return porNegocio
}
