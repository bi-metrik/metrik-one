'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { createServiceClient } from '@/lib/supabase/server'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { renderToBuffer } from '@react-pdf/renderer'
import CotizacionPDF from '@/lib/pdf/cotizacion-pdf'
import type { CotizacionPDFProps } from '@/lib/pdf/cotizacion-props'
import {
  bloquesParaPDF,
  contextoDeCotizacion,
  leerItinerarios,
} from '@/lib/cotizaciones/itinerarios-datos'
import {
  armarFilasDeRegistro,
  contextoDelViaje,
  registrarSalidaAlCliente,
} from '@/lib/cotizaciones/registro-decisiones'
import { leerAdicionalesDeItems } from '@/lib/cotizaciones/itinerarios-datos'
import {
  adicionalesPorItem,
  etiquetaDeAdicional,
  totalesDeAdicionales,
} from '@/lib/cotizaciones/adicionales'
import { aportaAlTotal, lineasQueDescribeElDocumento } from '@/lib/cotizaciones/lineas-del-documento'
import { avisosDeCobertura } from '@/lib/cotizaciones/cobertura-opciones'
import { diasDelItinerario, fueraDelPrecio, itemsSugeridos, sugeridosVisibles } from '@/lib/cotizaciones/dia-relativo'
import {
  cargosEnDestinoDeItems,
  destinoDeItinerario,
  duracionDelViaje,
  hotelesDeItems,
  leerConfigDocumentoViaje,
  rangoDeFechas,
  vuelosDeItems,
} from '@/lib/cotizaciones/detalle-viaje'
import { leerViajeDelNegocio } from '@/lib/cotizaciones/viaje-negocio'
import { describirOcupacion } from '@/lib/cotizaciones/tarifa-pasajero'
import { hayTarifaPorPasajero, lineasDesactualizadas, motivoParaNoEnviar } from '@/lib/cotizaciones/captura-desactualizada'
import { MENSAJE_SIN_PASAJEROS } from '@/lib/cotizaciones/captura-desactualizada-datos'
import {
  PLANTILLA_POR_DEFECTO,
  plantillaCotizacionPropia,
  plantillaImprimePreciosConIva,
  plantillaUsaFotosDeCiudad,
  plantillaUsaTextoDelCliente,
} from '@/lib/pdf/plantillas-cotizacion'
import { avisoDelTextoEnPdf, leerDocumentoCliente, textoParaElViaje } from '@/lib/cotizaciones/documento-cliente'
import { vigenciaEnDias } from '@/lib/cotizaciones/condiciones-comerciales'
import { fotosDeCiudad } from '@/lib/pdf/fotos-ciudad'
import { fotosDelViaje } from '@/lib/pdf/fotos-del-viaje'
import { precioPorHabitacionDeItem, precioPorPasajeroDeItem, preciosPorPasajeroDelViaje } from '@/lib/cotizaciones/precio-pasajero-pdf'
import { calcularFiscal, type FiscalProfile } from '@/lib/fiscal/calculos'
import {
  MOTIVO_IVA_INCLUIDO_SIN_PLANTILLA,
  clienteParaRetenciones,
  fiscalSobreIngresoPropio,
  ivaIncluidoEnElPrecio,
  ivaSobreIngresoPropio,
  leerConfigIvaCotizacion,
  motivoIvaSinCalcular,
} from '@/lib/fiscal/iva-cotizacion'
import { ivaDeLaCotizacion, type IvaDeCotizacion } from '@/lib/fiscal/iva-cotizacion-datos'
import { createElement } from 'react'
import {
  isPdfRenderConfigured,
  renderCotizacion as renderViaService,
  type CotizacionRenderPayload,
  type CotizacionRenderItem,
} from '@/lib/pdf/pdf-render-client'
import { uploadFileToDrive, createDriveFolder } from '@/lib/google-drive'
import { usaAlmacenamientoExterno } from '@/lib/almacenamiento/proveedor'
import { almacenamientoExternoDe } from '@/lib/almacenamiento/supabase-externo'
import { evaluarSalida } from '@/lib/cotizaciones/piso-salida-datos'
import { motivoSinRecomendada } from '@/lib/cotizaciones/tarifas'
import { ponerMarcaDeBorrador } from '@/lib/pdf/marca-borrador'
import { avisoDeBorrador, motivosDeBorrador } from '@/lib/cotizaciones/motivos-borrador'

// Campos agregados por migration 20260515000001 — pendiente regenerar database.ts
// post-apply. Hasta entonces, accedemos via cast tipado a este shape.
type CotizacionNuevosCampos = {
  lugar_entrega: string | null
  tiempo_entrega: string | null
  anticipo_pct: number | null
  anticipo_terminos: string | null
  saldo_terminos: string | null
  observaciones_extra: string[] | null
  // Terminos y condiciones al final de la cotizacion (migration
  // 20260903100000). El dato ya viaja hasta aqui; donde se imprime lo
  // define el rediseno del PDF, que va en un encargo aparte.
  terminos_condiciones: string | null
}

function formatMoney(n: number): string {
  // Formato colombiano: 16.800.000 (sin signo, sin decimales)
  return Math.round(n).toLocaleString('es-CO').replace(/,/g, '.')
}

function extractDriveFolderId(url: string | null | undefined): string | null {
  if (!url) return null
  const match = url.match(/folders\/([a-zA-Z0-9_-]+)/)
  return match ? match[1] : null
}

/**
 * Workspace con almacenamiento externo: el PDF queda en `negocios/<id>/cotizaciones/`
 * del proyecto del cliente. En un workspace en Drive no hace nada (`externo: false`)
 * y cada camino sigue exactamente como estaba.
 *
 * Como la subida a Drive de siempre, NUNCA tumba el PDF: si no se puede guardar, el
 * PDF se entrega igual y el motivo vuelve como `aviso` para que la pantalla lo diga.
 * Si la marca de proveedor no se puede leer, se asume externo: sin Drive por las dudas.
 */
async function guardarPdfEnAlmacenamientoExterno(
  workspaceId: string,
  negocioId: string | null,
  nombre: string,
  buffer: Buffer,
): Promise<{ externo: boolean; referencia: string | null; aviso: string | null }> {
  try {
    if (!(await usaAlmacenamientoExterno(workspaceId))) return { externo: false, referencia: null, aviso: null }
    // Cotización de oportunidad (legacy, sin negocio): no hay prefijo de negocio donde guardarla.
    if (!negocioId) return { externo: true, referencia: null, aviso: null }
    const almacenamiento = await almacenamientoExternoDe(workspaceId)
    if (!almacenamiento) return { externo: true, referencia: null, aviso: null }
    const guardado = await almacenamiento.subirArchivo({
      negocioId,
      subcarpeta: 'cotizaciones',
      nombre,
      buffer,
      mime: 'application/pdf',
      tipoBloque: 'cotizacion',
    })
    return { externo: true, referencia: guardado.referencia, aviso: null }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[cotizacion-pdf] el PDF no quedó guardado en el almacenamiento externo:', msg)
    return { externo: true, referencia: null, aviso: `El PDF se generó pero no quedó guardado: ${msg}` }
  }
}

/**
 * El registro de decisiones de combinación (§3.2 del diseño de ranuras).
 *
 * ## Por qué ESTE es el momento de «la cotización sale al cliente»
 *
 * §3.2.1 R2 pide registrar *«cuando la cotización sale al cliente, no en cada edición
 * de la tabla»*, y ese evento no existe limpio en el código. Los dos candidatos reales
 * eran éste y `enviarCotizacionNegocio` (el paso `borrador → enviada`). Se eligió
 * generar el documento, por tres razones:
 *
 *  · **Es lo único que produce el documento que el cliente recibe.** `enviada` es un
 *    estado: no manda un correo, no adjunta nada, no genera un PDF. Lo que ve el
 *    cliente sale de aquí, y desde el #800 con la plantilla propia de Trappvel.
 *  · **`enviada` ocurre UNA sola vez y R3 necesita que se repita.** Esa acción exige
 *    `estado === 'borrador'` y además rechaza una segunda si ya hay otra enviada: una
 *    reemisión con otra combinación —*«ese cambio de opinión es exactamente la señal
 *    que interesa»*— nunca llegaría a registrarse. Generar el PDF sí se repite.
 *  · **Los errores no son simétricos.** Registrar una descarga que nadie mandó deja
 *    una fila de más, ruido débil que se puede filtrar por cotización. No registrar
 *    las reemisiones deja fuera justo la señal que el registro existe para capturar.
 *
 * Queda dicho para que se discuta: si mañana aparece un envío de verdad (correo al
 * cliente), el disparo se mueve ahí y esta llamada se va.
 *
 * ## Nunca bloquea
 *
 * Cuando esto corre el PDF ya existe. *«Una cotización que no se puede emitir porque
 * no pudo guardar una fila de aprendizaje es el peor intercambio posible.»* Todo fallo
 * —incluida la tabla sin crear, que es el estado esperado hasta que se aplique el
 * SQL— se reporta por consola y la cotización sale igual.
 *
 * ## Coste
 *
 * Una consulta para una cotización sin tarifas (lee los itinerarios y sale). Solo
 * cuando hay tarifas marcadas para la propuesta lee además ítems, viaje y staff. Esas
 * lecturas se repiten con las de `bloquesParaPDF` en el camino de @react-pdf; se
 * prefirió repetirlas a atar el registro a la forma de esa función, que sirve a la
 * plantilla y tiene otro dueño.
 */
async function registrarDecisionesDeLaSalida(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  args: {
    workspaceId: string
    cotizacionId: string
    negocioId: string | null
    staffId: string | null
  },
): Promise<void> {
  try {
    const filas = await leerItinerarios(supabase, args.cotizacionId)
    // `null` = las tablas de itinerarios no están; `[]` = R6, esta cotización no las usa.
    if (filas === null || filas.length === 0) return
    const salen = filas.filter(f => f.vaEnPropuesta)
    // Ninguna tarifa marcada: el PDF imprimió la lista plana y no salió ninguna
    // combinación al cliente. No hay decisión que registrar.
    if (salen.length === 0) return

    const ctx = await contextoDeCotizacion(supabase, args.cotizacionId)
    if (!ctx) return

    const { viaje } = await leerViajeDelNegocio(supabase, args.negocioId)

    // R6 del registro · quién eligió, con su nombre congelado. Sin ficha de staff
    // queda en null: mejor sin autor que con el equivocado.
    let nombreQuien: string | null = null
    if (args.staffId) {
      const { data: staff } = await supabase
        .from('staff')
        .select('full_name')
        .eq('id', args.staffId)
        .maybeSingle()
      nombreQuien = (staff as { full_name: string | null } | null)?.full_name ?? null
    }

    const aInsertar = armarFilasDeRegistro({
      workspaceId: args.workspaceId,
      cotizacionId: args.cotizacionId,
      negocioId: args.negocioId,
      ctx,
      filas: salen,
      // Una marca por salida, igual para las tres tarifas.
      contexto: contextoDelViaje(viaje, todayBogotaISO()),
      quien: { staffId: args.staffId, nombre: nombreQuien },
      salidaAt: new Date().toISOString(),
    })

    // Cliente de SERVICIO: la tabla es server-only (guarda precios de proveedor) y no
    // concede nada a `authenticated`. El `workspace_id` sale de la sesión, no del
    // navegador.
    await registrarSalidaAlCliente(createServiceClient(), aInsertar)
  } catch (e) {
    console.error(
      '[cotizacion-pdf] el registro de decisiones falló; la cotización salió igual:',
      e instanceof Error ? e.message : String(e),
    )
  }
}

export async function generateCotizacionPDF(cotizacionId: string) {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  // Get cotización (left join — puede ser de oportunidad o de negocio)
  const { data: cot } = await supabase
    .from('cotizaciones')
    .select('*, oportunidades(empresa_id, contacto_id, descripcion)')
    .eq('id', cotizacionId)
    .single()

  if (!cot) return { success: false, error: 'Cotización no encontrada' }

  // ¿Puede salir al cliente? Bajo el margen mínimo y sin la autorización del dueño, el
  // PDF se descarga IGUAL —hace falta ver los borradores— pero con marca de agua, y no
  // se guarda ni se registra: no es un documento del cliente. Donde la línea no exige
  // el piso en la salida, `aplica` es falso y todo sigue como antes.
  const salida = await evaluarSalida(supabase, {
    servicio: createServiceClient,
    workspaceId,
    cotizacionId,
    staffId: staffId ?? null,
    registrarPerdida: true,
  })
  // El borrador se decide más abajo, cuando se sabe si el IVA se pudo calcular.
  const salidaBloquea = salida?.aplica === true && salida.bloquea

  /**
   * La Recomendada manda el documento (decisión del 2026-09-22): con tarifas, el TOTAL y
   * la leyenda «corresponde a la opción recomendada» salen de ella. Sin la Recomendada en
   * la propuesta el total sería un supuesto, así que el PDF sale como borrador, igual que
   * bajo el margen mínimo. Sin tarifas (`[]`, R6) no dice nada y todo sigue como antes.
   */
  const sinRecomendada = motivoSinRecomendada((await leerItinerarios(supabase, cotizacionId)) ?? [])

  // Get empresa: primero por oportunidad, luego por negocio, luego fallback
  type EmpresaRow = {
    nombre: string | null
    numero_documento: string | null
    contacto_nombre: string | null
    contacto_email: string | null
    tipo_persona: string | null
    regimen_tributario: string | null
    gran_contribuyente: boolean | null
    agente_retenedor: boolean | null
    telefono?: string | null
    direccion_fiscal?: string | null
    municipio?: string | null
    departamento?: string | null
  }
  let empresa: EmpresaRow | null = null

  const opp = cot.oportunidades as { empresa_id: string | null } | null
  if (opp?.empresa_id) {
    const { data: empData } = await supabase
      .from('empresas')
      .select('nombre, numero_documento, contacto_nombre, contacto_email, tipo_persona, regimen_tributario, gran_contribuyente, agente_retenedor, telefono, direccion_fiscal, municipio, departamento')
      .eq('id', opp.empresa_id)
      .single()
    empresa = empData
  }

  // Para cotizaciones de negocio, intentar obtener empresa del negocio
  type NegocioInfo = { id: string; nombre: string | null; carpeta_url: string | null }
  let negocioInfo: NegocioInfo | null = null

  if (cot.negocio_id) {
    const { data: negocio } = await supabase
      .from('negocios')
      .select('id, nombre, carpeta_url, empresa_id, empresas(nombre, numero_documento, contacto_nombre, contacto_email, tipo_persona, regimen_tributario, gran_contribuyente, agente_retenedor, telefono, direccion_fiscal, municipio, departamento)')
      .eq('id', cot.negocio_id)
      .single()
    if (negocio) {
      negocioInfo = { id: negocio.id, nombre: negocio.nombre, carpeta_url: negocio.carpeta_url }
      if (!empresa) {
        empresa = (negocio.empresas as EmpresaRow | null) ?? null
      }
    }
  }

  // Fallback: empresa genérica para renderizar el PDF
  if (!empresa) {
    empresa = {
      nombre: 'Cliente',
      numero_documento: null,
      contacto_nombre: null,
      contacto_email: null,
      tipo_persona: 'juridica',
      regimen_tributario: 'responsable',
      gran_contribuyente: false,
      agente_retenedor: false,
    }
  }

  // Get workspace (vendor) info incluyendo template slug
  type WorkspaceRow = {
    name: string
    logo_url: string | null
    color_primario: string | null
    cotizacion_template_slug: string | null
    /** De aquí salen el pie y la firma del documento de viaje (`leerConfigDocumentoViaje`). */
    config_extra: unknown
  }
  const { data: wsRaw } = await supabase
    .from('workspaces')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .select('name, logo_url, color_primario, cotizacion_template_slug, config_extra' as any)
    .eq('id', workspaceId)
    .single()
  const ws = (wsRaw as unknown as WorkspaceRow | null) ?? null

  // Get vendor fiscal profile
  type VendorFiscalRow = {
    person_type: string | null
    tax_regime: string | null
    self_withholder: boolean | null
    ica_rate: number | null
    ica_city: string | null
    nit: string | null
    razon_social?: string | null
    telefono?: string | null
    email_fiscal?: string | null
    direccion_fiscal?: string | null
    municipio?: string | null
    departamento?: string | null
  }
  const { data: vendorFiscal } = await supabase
    .from('fiscal_profiles')
    .select('person_type, tax_regime, self_withholder, ica_rate, ica_city, nit, razon_social, telefono, email_fiscal, direccion_fiscal, municipio, departamento')
    .eq('workspace_id', workspaceId)
    .single<VendorFiscalRow>()

  // Get items
  type ItemRow = {
    id?: string
    nombre: string | null
    descripcion: string | null
    precio_venta: number
    descuento_porcentaje: number | null
    cantidad: number | null
    subtotal?: number | null
    es_ajuste?: boolean | null
    orden?: number | null
    /** Las tres llegan `undefined` mientras `20260914200000` no este aplicada. */
    unidad?: string | null
    grupo?: string | null
    opcion_de?: string | null
    /** `20260915000000`. Ausente = sin dia y se muestra, el comportamiento de antes. */
    dia_relativo?: number | null
    mostrar_en_sugeridos?: boolean | null
    /** `20260915120000`. Ausente = entra al precio, el comportamiento de antes. */
    entra_al_precio?: boolean | null
    /** `20260916231500`. Ausente = la línea se cobra por el grupo, como antes. */
    tarifa_pax?: unknown
    /** `20260923233000` (B2/B3). Ausentes = se derivan de la lectura, como antes. */
    cargo_destino_valor?: number | string | null
    cargo_destino_moneda?: string | null
    tramos?: unknown
    rubros?: { valor_total: number | null; sugerido?: boolean | null }[] | null
  }

  /**
   * El descuento que el CLIENTE puede ver.
   *
   * En una línea con costo, `descuento_porcentaje` es el descuento de COMPRA: ya está
   * descontado del costo y por tanto del precio. Mostrarlo aquí se lo cobraría al
   * cliente por segunda vez y dejaría un documento que no cuadra con su propio total.
   * Las líneas sin costo son las de antes del rediseño, donde ese número sí era un
   * descuento comercial de la línea.
   */
  const descuentoVisible = (it: { descuento_porcentaje: number | null; subtotal?: number | null }) =>
    (Number(it.subtotal) || 0) > 0 ? 0 : Number(it.descuento_porcentaje) || 0
  let items: ItemRow[] = []
  if (cot.modo === 'detallada') {
    // `select('*')` y no la lista de columnas: `unidad` la agrega la migracion
    // `20260914200000` y nombrarla devolveria un 400 mientras no este aplicada, o sea
    // que el PDF dejaria de generarse. Misma tolerancia que en duplicar.
    // Los rubros viajan con la línea para saber si el costo por pasajero confirmado sigue
    // siendo su costo: si alguien los editó después, el reparto ya no se imprime.
    const { data: itemsData } = await supabase
      .from('items')
      .select('*, rubros(*)')
      .eq('cotizacion_id', cotizacionId)
      .order('orden')
    items = (itemsData ?? []) as unknown as ItemRow[]
  }

  /**
   * R-A1 · qué líneas aportan al total cuando no hay itinerario principal.
   *
   * Una ranura con dos vuelos imprimía las DOS líneas al cliente y sumaba las dos en
   * el Subtotal, contra un TOTAL que salía de `valor_total`. Dos cifras del mismo
   * dinero que no cuadran, en el documento que el cliente sí suma.
   *
   * Es el MISMO helper que usa `recalcularTotales` para escribir `valor_total`, así
   * que el documento no puede discrepar con la pantalla. Sin ranuras con alternativas
   * devuelve todos los ítems y el PDF de siempre no cambia una línea.
   *
   * Una sugerencia FUERA DEL PRECIO no aporta: no entra al detalle ni al Subtotal, y
   * se imprime con su precio en «actividades adicionales no incluidas» (abajo).
   *
   * La regla vive en `lineas-del-documento.ts`: la comparte el redactor del texto para
   * el cliente, que tiene que describir las mismas líneas que este documento imprime.
   */
  const aporta = aportaAlTotal(items)

  /**
   * §4.3 · el aviso de cobertura también sale AQUÍ, no solo en el editor.
   *
   * Quien imprime no siempre es quien cargó, y este documento es el que se le manda al
   * cliente: el banner del editor no lo ve alguien que entra, abre la cotización y le
   * da a descargar. Es el mismo helper y la misma frase que la pantalla, así que las dos
   * superficies no pueden decir cosas distintas del mismo problema.
   *
   * ⚠️ AVISA, NO BLOQUEA. El PDF se genera igual: dos opciones con coberturas distintas
   * pueden ser legítimas y esto no tiene con qué juzgarlo. Lo que no puede pasar es que
   * salga en silencio.
   */
  const avisosCobertura = avisosDeCobertura(
    items.filter(i => i.id).map(i => ({
      id: i.id as string,
      nombre: i.nombre,
      grupo: i.grupo ?? null,
      opcion_de: i.opcion_de ?? null,
      es_ajuste: i.es_ajuste ?? false,
      orden: i.orden ?? 0,
      dia_relativo: i.dia_relativo ?? null,
      entra_al_precio: i.entra_al_precio ?? null,
      tarifa_pax: i.tarifa_pax,
    })),
  ).map(a => a.texto)

  /**
   * Brief del 2026-09-22 · las líneas con el pantallazo o el costo de OTROS pasajeros.
   *
   * Mismo criterio que el aviso de cobertura: quien imprime no siempre es quien cargó, y el
   * cambio que las dejó viejas suele ocurrir en el negocio (los pasajeros del viaje), no en
   * la cotización.
   *
   * Con alguna línea así, el PDF es un BORRADOR (decisión de Mauricio del 2026-09-22): se
   * descarga —hace falta verlo—, pero con marca de agua «pantallazos por actualizar» en
   * cada página, y no se guarda ni se registra como salida al cliente. Es la MISMA regla
   * (`lineasDesactualizadas` + `motivoParaNoEnviar`) que el aviso del editor y el freno de
   * «Enviar»/«Aprobar» (`captura-desactualizada-datos.ts`): tres superficies, una fuente.
   * Además el reparto por pasajero de una confirmación vieja no se imprime
   * (`precioPorPasajeroDeItem`).
   *
   * Los pasajeros del viaje se leen UNA vez y solo si alguna línea tiene tarifa por
   * pasajero: una cotización que no es de viaje no paga la consulta (R6). Si esa lectura
   * falla, borrador: sin los pasajeros no se puede saber si el precio es el de hoy, y un
   * PDF limpio lo afirmaría.
   */
  const conTarifaPorPasajero = hayTarifaPorPasajero(items)
  const lecturaDelViaje = negocioInfo && conTarifaPorPasajero
    ? await leerViajeDelNegocio(supabase, negocioInfo.id)
    : null
  const viajeDelNegocio = lecturaDelViaje && !lecturaDelViaje.error ? lecturaDelViaje.viaje : null
  const sinPasajerosDelViaje = lecturaDelViaje?.error != null
  const composicionViaje = viajeDelNegocio?.composicion ?? null
  const desactualizadas = conTarifaPorPasajero
    ? lineasDesactualizadas(
        items.filter(i => i.id).map(i => ({
          id: i.id as string,
          nombre: i.nombre,
          grupo: i.grupo ?? null,
          es_ajuste: i.es_ajuste ?? false,
          tarifa_pax: i.tarifa_pax,
        })),
        composicionViaje,
      )
    : []
  const avisosCaptura = desactualizadas.map(l => `«${l.nombre}»: ${l.motivos.join(' ')}`)
  /** El motivo de borrador por pantallazos, con el texto del freno de envío. */
  const motivoPantallazos = sinPasajerosDelViaje
    ? MENSAJE_SIN_PASAJEROS
    : motivoParaNoEnviar(desactualizadas)

  // Calculate fiscal
  type Regimen = FiscalProfile['regimen_tributario']
  const vendorProfile: FiscalProfile = {
    tipo_persona: (vendorFiscal?.person_type as 'natural' | 'juridica') || 'natural',
    regimen_tributario: (vendorFiscal?.tax_regime as Regimen) || 'responsable',
    gran_contribuyente: false,
    agente_retenedor: false,
    autorretenedor: vendorFiscal?.self_withholder ?? false,
    ica_rate: vendorFiscal?.ica_rate ?? null,
    ica_city: vendorFiscal?.ica_city ?? null,
  }

  const buyerProfile: FiscalProfile = {
    tipo_persona: (empresa.tipo_persona as 'natural' | 'juridica') || 'juridica',
    regimen_tributario: (empresa.regimen_tributario as Regimen) || 'responsable',
    gran_contribuyente: empresa.gran_contribuyente ?? false,
    agente_retenedor: empresa.agente_retenedor ?? false,
    autorretenedor: false,
    ica_rate: null,
    ica_city: null,
  }

  // `valor_total` YA es el precio final: `recalcularTotales` guarda ahí el resultado
  // de la cascada con el descuento comercial aplicado, y `descuento_valor` al lado
  // como el monto de ese descuento. Restarlo otra vez le mostraba al cliente una base
  // más baja que la del sistema, y liquidaba el IVA sobre esa base equivocada. Sin
  // descuento no se notaba: por eso llevaba tiempo ahí.
  const valorNeto = cot.valor_total
  let fiscal = calcularFiscal(valorNeto, vendorProfile, buyerProfile)

  /**
   * El IVA sobre el INGRESO PROPIO (`iva-cotizacion.ts`, regla de Felipe del 2026-09-22):
   * solo en el workspace que declara `config_extra.iva_cotizacion.base = ingreso_propio`.
   *
   * ⚠️ Sin esa declaración no se lee nada más y `fiscal` es el de la línea de arriba, byte
   * a byte el de siempre: ningún otro workspace cambia un peso ni paga una consulta.
   *
   * ⚠️ El perfil del vendedor se lee de la BASE (`iva_responsible`), no del mapeo viejo de
   * arriba: ese traduce `tax_regime = 'ordinario'` como «no responsable» y deja el IVA en 0.
   * Se conserva intacto para los demás; aquí no se usa.
   */
  const configIva = leerConfigIvaCotizacion(ws?.config_extra)
  let ivaCot: IvaDeCotizacion | null = null
  if (ivaSobreIngresoPropio(configIva)) {
    ivaCot = await ivaDeLaCotizacion(supabase, { workspaceId, cotizacionId, config: configIva })
    if (ivaCot) {
      fiscal = fiscalSobreIngresoPropio({
        subtotal: valorNeto,
        liquidacion: ivaCot.vigente,
        perfil: ivaCot.perfil,
        cliente: clienteParaRetenciones(empresa),
      })
    }
  }

  /**
   * Borrador: bajo el margen mínimo sin la autorización del dueño (hueco 1), con una línea
   * cuyo IVA no se pudo calcular porque tiene precio y no tiene costo, con pantallazos de
   * otros pasajeros (ver `motivoPantallazos`) o con tarifas y sin la Recomendada en la
   * propuesta (ver `sinRecomendada`). En todos los casos el PDF se descarga IGUAL
   * —hace falta ver los borradores— pero con marca de agua, y no se guarda ni se registra:
   * no es un documento del cliente. No se inventa una base de IVA.
   */
  const ivaSinCalcular = ivaCot !== null && !ivaCot.calculable
  // Con el IVA DENTRO del precio, solo una plantilla que lo sepa imprimir dice la verdad: las
  // demás pintan «Subtotal, IVA, TOTAL» y sumarían con los ojos un IVA que el TOTAL no trae.
  // Hoy solo Trappvel cotiza así, y su plantilla sabe; esto frena al siguiente que no.
  const ivaIncluidoSinPlantilla = ivaCot !== null
    && ivaIncluidoEnElPrecio(configIva)
    && !plantillaImprimePreciosConIva(ws?.cotizacion_template_slug ?? PLANTILLA_POR_DEFECTO)
  // Los motivos REALES, en un solo sitio (`motivos-borrador.ts`): la marca de agua y el
  // aviso de pantalla salen de esta misma lista. Es borrador si hay al menos uno, que es
  // exactamente el OR de las condiciones. La Recomendada fuera de la propuesta tiene su
  // propio motivo: sin ella el total es un supuesto, y eso no es un problema de margen.
  const motivosBorrador = motivosDeBorrador({
    pantallazos: motivoPantallazos !== null,
    sinRecomendada: sinRecomendada !== null,
    faltaCosto: salida?.aplica === true && salida.faltaCosto !== null,
    margen: salidaBloquea,
    ivaSinCalcular,
    ivaIncluidoSinPlantilla,
  })
  const esBorrador = motivosBorrador.length > 0
  const avisoBorrador = esBorrador
    ? avisoDeBorrador(motivosBorrador, {
        pantallazos: motivoPantallazos,
        recomendada: sinRecomendada,
        incompleto: salida?.aplica === true ? salida.faltaCosto : null,
        margen: salidaBloquea ? salida!.mensaje : null,
        iva_sin_calcular: ivaSinCalcular ? motivoIvaSinCalcular(ivaCot!.sinCosto) : null,
        iva_incluido_sin_plantilla: ivaIncluidoSinPlantilla ? MOTIVO_IVA_INCLUIDO_SIN_PLANTILLA : null,
      })
    : null

  // ============================================================
  // Que plantilla visual usa la cotizacion de este workspace
  // ============================================================
  // Una sola columna decide: `workspaces.cotizacion_template_slug`. El registro de
  // `plantillas-cotizacion.ts` dice que motor la atiende.
  //
  //   PATH A — servicio WeasyPrint externo: solo si las env vars METRIK_PDF_RENDER_*
  //            estan configuradas, el slug no es el default Y no tiene plantilla propia.
  //   PATH B — @react-pdf, aqui mismo: plantilla propia del registro si la hay, y si no
  //            la generica de MeTRIK. Es tambien el fallback si PATH A falla.
  // ============================================================
  const templateSlug = ws?.cotizacion_template_slug ?? PLANTILLA_POR_DEFECTO
  // Si el slug tiene plantilla @react-pdf propia, se resuelve abajo (PATH B) y NO se
  // llama al servicio externo: pedirle un template que no tiene daria un 4xx y una
  // caida al fallback, o sea el PDF generico con aspecto de exito.
  const plantillaPropia = plantillaCotizacionPropia(templateSlug)
  const useService =
    isPdfRenderConfigured() && templateSlug !== PLANTILLA_POR_DEFECTO && !plantillaPropia

  if (useService) {
    // Cast a la cotizacion para acceder a campos nuevos hasta regenerar database.ts
    const cotExt = cot as unknown as typeof cot & CotizacionNuevosCampos
    const subtotal = valorNeto
    const ivaPct = 19
    const ivaValor = fiscal.iva ?? 0
    const totalConIva = subtotal + ivaValor

    // R-A1 · solo las que aportan: ver `aporta`. Sin alternativas, es `items` entero.
    const renderItems: CotizacionRenderItem[] = items.filter(aporta).map((it, idx) => {
      const cant = Number(it.cantidad) || 1
      const unit = Number(it.precio_venta) || 0
      const desc = descuentoVisible(it)
      const total = cant * unit * (1 - desc / 100)
      return {
        numero: idx + 1,
        descripcion: [it.nombre, it.descripcion].filter(Boolean).join('\n'),
        cantidad: String(cant),
        valor_unitario: formatMoney(unit),
        valor_total: formatMoney(total),
      }
    })

    const fechaEnvio = cot.fecha_envio
      ? new Date(cot.fecha_envio as string)
      : new Date()
    const fechaStr = `${fechaEnvio.getDate()}/${fechaEnvio.getMonth() + 1}/${fechaEnvio.getFullYear()}`

    // validez_dias: derivada de las fechas; sin ellas, el default historico de 30.
    const validezDias =
      vigenciaEnDias(cot.fecha_envio as string | null, cot.fecha_validez as string | null) ?? 30

    // observaciones_extra de la cotizacion + linea de forma de pago si hay anticipo
    const obsExtra: string[] = Array.isArray(cotExt.observaciones_extra)
      ? cotExt.observaciones_extra
      : []
    const observacionesExtra = [...obsExtra]
    if (cotExt.anticipo_pct) {
      const anticipoValor = subtotal * (Number(cotExt.anticipo_pct) / 100)
      const saldoValor = subtotal - anticipoValor
      const antTerms = cotExt.anticipo_terminos ?? 'CONTRA ORDEN DE COMPRA'
      const saldoTerms =
        cotExt.saldo_terminos ?? 'CONTRA ENTREGA FINAL DE ENTREGABLES'
      observacionesExtra.push(
        `<b>FORMA DE PAGO (VALORES SIN IVA):</b><br>` +
          `· ${cotExt.anticipo_pct}% ANTICIPO ${antTerms} — $${formatMoney(anticipoValor)}.<br>` +
          `· ${100 - Number(cotExt.anticipo_pct)}% SALDO ${saldoTerms} — $${formatMoney(saldoValor)}.<br>` +
          `EL IVA SE FACTURA PROPORCIONALMENTE EN CADA PAGO.`,
      )
    } else if (cot.condiciones_pago) {
      observacionesExtra.push(`<b>FORMA DE PAGO:</b> ${cot.condiciones_pago}`)
    }

    const payload: CotizacionRenderPayload = {
      numero_cot: cot.codigo ?? String(cot.consecutivo ?? ''),
      cliente: empresa.nombre ?? 'Cliente',
      nit_cliente: empresa.numero_documento ?? '',
      proyecto: negocioInfo?.nombre ?? cot.descripcion ?? '',
      fecha: fechaStr,
      items: renderItems,
      subtotal: formatMoney(subtotal),
      iva_pct: ivaPct,
      iva_valor: formatMoney(ivaValor),
      valor_total_con_iva: formatMoney(totalConIva),
      lugar_entrega: cotExt.lugar_entrega ?? '',
      validez_dias: validezDias,
      tiempo_entrega: cotExt.tiempo_entrega ?? 'POR DEFINIR CON LA ORDEN DE COMPRA',
      observaciones_extra: observacionesExtra,
      powered_by_metrik: true, // workspaces no-MeTRIK siempre llevan Powered by
    }

    try {
      const renderizado = await renderViaService(templateSlug, payload)

      // Borrador (bajo el piso, IVA sin calcular o pantallazos de otros pasajeros): marca de
      // agua y fuera. Ni almacenamiento, ni Drive, ni registro de decisiones — no es un
      // documento del cliente.
      if (esBorrador) {
        const conMarca = await ponerMarcaDeBorrador(renderizado, motivosBorrador)
        return {
          success: true,
          pdf: conMarca.toString('base64'),
          filename: `${cot.codigo ?? cot.consecutivo}-BORRADOR.pdf`,
          fiscal,
          borrador: true as const,
          aviso: avisoBorrador,
          avisosCobertura,
          // Un borrador también sale con los pantallazos de otros pasajeros: quien lo
          // descargó tiene que saberlo antes de corregir el margen, no después.
          avisosCaptura,
          renderedVia: 'weasyprint' as const,
        }
      }

      const buffer = renderizado
      const filename = `${cot.codigo ?? cot.consecutivo}.pdf`

      // Almacenamiento externo: el PDF va al proyecto del cliente y Drive ni se intenta.
      const externo = await guardarPdfEnAlmacenamientoExterno(workspaceId, negocioInfo?.id ?? null, filename, buffer)

      // Subida opcional a Drive si el negocio tiene carpeta configurada.
      // createDriveFolder() es find-or-create (busca por nombre+parent antes de crear).
      let driveFileId: string | null = null
      let driveWebViewLink: string | null = null
      const driveFolderId = extractDriveFolderId(negocioInfo?.carpeta_url)
      if (!externo.externo && driveFolderId && negocioInfo) {
        try {
          const subFolderId = await createDriveFolder(
            'cotizaciones',
            driveFolderId,
            workspaceId,
          )
          const uploaded = await uploadFileToDrive(
            buffer,
            filename,
            'application/pdf',
            subFolderId,
            workspaceId,
          )
          driveFileId = uploaded.fileId
          driveWebViewLink = uploaded.webViewLink
        } catch (e) {
          // No bloquear el PDF si falla la subida — solo log
          console.warn('[cotizacion-pdf] Drive upload failed:', (e as Error).message)
        }
      }

      // El documento ya existe: desde aquí, lo que salió al cliente salió. Ver el
      // encabezado del helper para por qué éste es el momento de «sale al cliente».
      await registrarDecisionesDeLaSalida(supabase, {
        workspaceId,
        cotizacionId,
        negocioId: negocioInfo?.id ?? null,
        staffId: staffId ?? null,
      })

      return {
        success: true,
        pdf: buffer.toString('base64'),
        filename,
        fiscal,
        driveFileId,
        driveWebViewLink,
        archivoReferencia: externo.referencia,
        aviso: externo.aviso,
        avisosCobertura,
        avisosCaptura,
        renderedVia: 'weasyprint' as const,
      }
    } catch (e) {
      console.error('[cotizacion-pdf] Service render failed, falling back to react-pdf:', (e as Error).message)
      // cae al PATH B abajo
    }
  }

  // ============================================================
  // PATH B (fallback) — @react-pdf/renderer (legacy, pre-Fase 2)
  // ============================================================

  // Quien firma el documento. Se resuelve SOLO si la plantilla lo imprime, para no
  // cobrarle una consulta a los workspaces que no lo usan.
  //
  // OJO con lo que este dato significa: `cotizaciones` no guarda quien la creo, asi
  // que esto es el staff que APRETO GENERAR, no necesariamente quien la elaboro. Si
  // el usuario no tiene ficha de staff queda null y la plantilla omite la firma.
  let emisor: { nombre: string; cargo: string | null } | null = null
  if (plantillaPropia && staffId) {
    const { data: staff } = await supabase
      .from('staff')
      .select('full_name, position')
      .eq('id', staffId)
      .maybeSingle<{ full_name: string | null; position: string | null }>()
    if (staff?.full_name) {
      emisor = { nombre: staff.full_name, cargo: staff.position ?? null }
    }
  }

  // R7 · los bloques de la propuesta. `null` cuando la cotizacion no tiene
  // itinerarios o ninguno va en la propuesta: ahi el PDF imprime la lista plana de
  // siempre. El corte vive en `bloquesParaPDF` y no en la plantilla porque hay mas
  // de una plantilla, y una regla repetida es una regla que se desincroniza.
  const bloques = await bloquesParaPDF(supabase, cotizacionId)
  const itemPorId = new Map(items.filter(i => i.id).map(i => [i.id as string, i]))

  /**
   * Los adicionales de cada variante, para el documento del cliente (§1.2 del diseño).
   *
   * ⚠️ Van DENTRO de la línea, no como ítem aparte, y su plata TIENE que entrar en el
   * total impreso: `items.precio_venta` guarda el precio BASE, así que sin este sumando
   * la columna que el cliente suma quedaría por debajo del TOTAL, que sale de
   * `valor_total` y sí los incluye.
   *
   * Lectura tolerante: sin la tabla devuelve vacío y el PDF sale exactamente como hoy.
   */
  const filasAdicionales = await leerAdicionalesDeItems(supabase, [...itemPorId.keys()])
  const adicionalesPorId = adicionalesPorItem(filasAdicionales)
  const adicionalesDe = (i: ItemRow) => {
    const lista = i.id ? adicionalesPorId.get(i.id) ?? [] : []
    if (lista.length === 0) return { adicionales: undefined, valorAdicionales: undefined }
    return {
      adicionales: lista.map(ad =>
        ad.cantidad > 1 ? `${etiquetaDeAdicional(ad)} ×${ad.cantidad}` : etiquetaDeAdicional(ad),
      ),
      valorAdicionales: totalesDeAdicionales(lista).precio,
    }
  }
  /**
   * Precios CON el IVA incluido, línea por línea (regla de Felipe, punto 4: «el documento
   * muestra el total final con IVA incluido»).
   *
   * Solo con la base `ingreso_propio` encendida y con una plantilla que lo sepa imprimir
   * (`plantillaImprimePreciosConIva`). Con `linea_incluida` la plantilla dice además cuánto
   * IVA lleva; con `oculto` no lo dice, y los números son los mismos.
   *
   * Cómo llega el IVA a cada precio depende de `precio`:
   *  · `iva_aparte`: a cada línea se le SUMA su IVA —el mismo que suma el total—, así que la
   *    columna, las tarifas, la tabla por pasajero y el TOTAL cuadran sin una cifra aparte.
   *  · `iva_incluido`: el precio de la cascada YA lo trae. No se le suma nada a ninguna cifra;
   *    lo único que cambia es la nota, que dice cuánto IVA va adentro.
   *
   * Sin la base encendida, `ivaDe` no devuelve nada y cada cifra es la de siempre.
   */
  const preciosConIva = ivaCot !== null && plantillaImprimePreciosConIva(templateSlug)
  const sumaIvaAlPrecio = preciosConIva && !ivaIncluidoEnElPrecio(configIva)
  const ivaDe = (i: ItemRow) => (preciosConIva && i.id ? ivaCot!.porItem.get(i.id) ?? null : null)
  const conIva = (i: ItemRow): ItemRow => {
    if (!sumaIvaAlPrecio) return i
    const iva = ivaDe(i)
    if (!iva || iva.ivaBase === 0) return i
    const cantidad = Number(i.cantidad) || 1
    return { ...i, precio_venta: (Number(i.precio_venta) || 0) + iva.ivaBase / cantidad }
  }

  // ⚠️ Con itinerarios, la lista PLANA de items que alimenta el resumen fiscal se
  // reemplaza por la del PRINCIPAL. Si no, el «Subtotal» sumaria AVIANCA **y** WINGO
  // —los dos vuelos estan en `items`— y quedaria por encima del TOTAL, que sale de
  // `valor_total` y es el del principal (R5). Dos cifras del mismo dinero que no
  // cuadran, en el documento que ve el cliente.
  //
  // De paso resuelve el caso de UN solo itinerario en propuesta: la plantilla imprime
  // su tabla plana, y es la del principal.
  //
  // ⚠️ R-A1 · cuando NO hay principal, la lista plana tampoco puede ser «todos los
  // ítems»: una cotización con dos vuelos en la misma ranura imprimía las dos líneas
  // al cliente y sumaba las dos en el Subtotal. `itemsQueAportanAlTotal` deja un
  // candidato por ranura —el mismo que toma `recalcularTotales` para `valor_total`—
  // así que el documento cuadra consigo mismo y con la pantalla.
  //
  // Sin ranuras con alternativas devuelve todos los ítems: el PDF de Termotech, Arca
  // y WMC no cambia una línea.
  const paraPlantilla = (original: ItemRow) => {
    const i = conIva(original)
    const adicionales = adicionalesDe(original)
    const ivaAdicionales = sumaIvaAlPrecio ? ivaDe(original)?.ivaAdicionales ?? 0 : 0
    // R8 · la llave solo aparece en una opción de hotel cobrada por habitación: las demás
    // líneas (y las otras plantillas) llegan idénticas.
    const porHabitacion = precioPorHabitacionDeItem(i, composicionViaje)
    return {
      nombre: i.nombre ?? '',
      descripcion: i.descripcion ?? null,
      precio_venta: Number(i.precio_venta) || 0,
      descuento_porcentaje: descuentoVisible(i),
      cantidad: Number(i.cantidad) || 1,
      unidad: i.unidad ?? null,
      precioPorPasajero: precioPorPasajeroDeItem(i, composicionViaje),
      ...(porHabitacion
        ? { precioPorHabitacion: porHabitacion.map(h => ({ numero: h.numero, ocupacion: h.ocupacionTexto, precio: h.precio })) }
        : {}),
      ...adicionales,
      ...(adicionales.valorAdicionales !== undefined && ivaAdicionales > 0
        ? { valorAdicionales: adicionales.valorAdicionales + ivaAdicionales }
        : {}),
    }
  }

  /**
   * El IVA de una tarifa: la suma del de sus líneas. Con el IVA encima es lo que se le suma a
   * su precio; con el IVA adentro es lo que su precio ya trae, y solo va a la nota.
   */
  const ivaDeLasLineas = (ids: string[]) =>
    ids.reduce((a, id) => {
      const item = itemPorId.get(id)
      return a + (item ? ivaDe(item)?.iva ?? 0 : 0)
    }, 0)
  const ivaPorBloque = (bloques ?? []).map(b => ivaDeLasLineas(b.itemIds))

  const itinerariosPDF = bloques
    ? bloques.map((b, idx) => ({
        nombre: b.nombre,
        esPrincipal: b.esPrincipal,
        precio: b.precio + (sumaIvaAlPrecio ? ivaPorBloque[idx] : 0),
        items: b.itemIds
          .map(id => itemPorId.get(id))
          .filter((i): i is ItemRow => i !== undefined)
          .map(paraPlantilla),
      }))
    : null

  const itemsDelPrincipal = itinerariosPDF?.find(b => b.esPrincipal)?.items ?? null
  const itemsParaResumen = itemsDelPrincipal ?? items.filter(aporta).map(paraPlantilla)

  /**
   * El itinerario DÍA POR DÍA y el paquete de sugeridos.
   *
   * ⚠️ `dias` + `itemsSinDia` son una PARTICIÓN de lo que ya aporta al total, no algo
   * nuevo: el Subtotal, el IVA y el TOTAL salen de `itemsParaResumen` y no cambian un
   * peso por asignar o quitar un día. El día es presentación.
   *
   * ⚠️ Los sugeridos NO entran en esa partición. Una sugerencia FUERA DEL PRECIO
   * tampoco aporta al total (`itemsQueAportanAlTotal` la saca), así que el documento
   * cuadra. Una que SÍ entra al precio sigue sumando mientras se imprime como «no
   * incluida»: esa es la contradicción que el editor avisa en rojo antes de generar
   * el PDF. Descontarla aquí le cambiaría el precio a una cotización ya revisada, y
   * hacerlo en silencio es justo lo que no se puede: el precio lo decide el
   * interruptor, no el PDF.
   *
   * ⚠️ Con itinerarios en propuesta (bloques de alternativas) esto queda en `null`: el
   * documento ya está organizado por opciones y meterle días encima daría dos
   * organizaciones del mismo contenido en la misma página.
   */
  const itemsConDia = items
    .filter(i => i.id)
    .map(i => ({
      id: i.id as string,
      grupo: i.grupo ?? null,
      dia_relativo: i.dia_relativo ?? null,
      mostrar_en_sugeridos: i.mostrar_en_sugeridos ?? null,
      entra_al_precio: i.entra_al_precio ?? null,
      es_ajuste: i.es_ajuste ?? false,
      orden: i.orden ?? 0,
    }))
  const porId = new Map(items.filter(i => i.id).map(i => [i.id as string, i]))
  const bloquesDeDia = itinerariosPDF ? [] : diasDelItinerario(itemsConDia)
  const idsConDia = new Set(bloquesDeDia.flatMap(d => d.itemIds))

  const diasPDF = bloquesDeDia.length > 0
    ? bloquesDeDia.map(d => ({
        dia: d.dia,
        items: d.itemIds
          .map(id => porId.get(id))
          .filter((i): i is ItemRow => i !== undefined && aporta(i))
          .map(paraPlantilla),
      }))
    : null

  const idsSugeridos = new Set(itinerariosPDF ? [] : itemsSugeridos(itemsConDia))

  /**
   * ⚠️ Las sugerencias NO entran aquí, y el defecto se vio en el documento renderizado,
   * no razonándolo: sin este filtro el traslado se imprimía DOS veces, una en «Incluye
   * también» y otra en «actividades adicionales no incluidas» — el mismo documento
   * diciendo que una línea está incluida y que no lo está.
   *
   * Consecuencia asumida y declarada: cuando una sugerencia trae precio Y entra al
   * precio, la columna impresa ya no suma el Subtotal, porque esa línea sigue
   * aportando al total. Es la cara visible de la contradicción que el editor avisa en
   * rojo, y las salidas son sacarla del precio, ponerla en cero o darle un día. Fuera
   * del precio o en cero —sus dos estados sanos— la columna cuadra sola.
   */
  const itemsSinDiaPDF = diasPDF
    ? items
        .filter(i => aporta(i) && !(i.id && (idsConDia.has(i.id) || idsSugeridos.has(i.id))))
        .map(paraPlantilla)
    : null

  /**
   * Con itinerarios en propuesta el documento no se reparte por días, pero una
   * sugerencia FUERA DEL PRECIO sí se imprime: no está en ningún bloque de opción
   * (no aporta a ninguno), y sin esta sección desaparecería del documento sin que
   * nadie lo haya pedido. Las que sí entran al precio siguen dentro de sus bloques.
   */
  const conDiaPorId = new Map(itemsConDia.map(i => [i.id, i]))
  const idsSugeridosVisibles = sugeridosVisibles(itemsConDia).filter(id => {
    if (!itinerariosPDF) return true
    const item = conDiaPorId.get(id)
    return item !== undefined && fueraDelPrecio(item)
  })
  const sugeridosPDF = idsSugeridosVisibles.length === 0
    ? null
    : idsSugeridosVisibles
        .map(id => porId.get(id))
        .filter((i): i is ItemRow => i !== undefined)
        // Con IVA incluido como el resto del documento: el precio de una actividad
        // opcional es lo que el cliente pagaría si la toma.
        .map(conIva)
        .map(i => ({
          nombre: i.nombre ?? '',
          descripcion: i.descripcion ?? null,
          precio_venta: Number(i.precio_venta) || 0,
          cantidad: Number(i.cantidad) || 1,
          unidad: i.unidad ?? null,
        }))

  /**
   * El VIAJE que describe el documento del cliente (Entrega B del brief del 17-sep).
   *
   * Se arma con lo que YA está guardado: la lectura del pantallazo de cada línea
   * (aerolínea, ruta en IATA, número de vuelo, escala, hotel, habitación, régimen,
   * impuestos en destino) y el bloque «Condiciones del viaje» del negocio (quiénes
   * viajan, a dónde, entre qué fechas). No hay tabla nueva.
   *
   * ⚠️ Solo se arma para un workspace con plantilla propia y negocio: es el único que
   * puede imprimirlo, y así ningún otro paga la consulta de los bloques. Si al final no
   * hay NADA que describir, viaja `null` y la plantilla imprime la lista plana — el mismo
   * contrato de `dias` e `itinerarios`.
   *
   * ⚠️ Se describe lo que se IMPRIME: con itinerario principal, sus líneas; sin él, las
   * que aportan al total. Describir una alternativa descartada pondría en el documento un
   * vuelo que el cliente no está comprando.
   */
  const idsDelPrincipal = bloques?.find(b => b.esPrincipal)?.itemIds ?? null
  const itemsImpresos = lineasQueDescribeElDocumento(items, idsDelPrincipal, aporta)

  let viajePDF: CotizacionPDFProps['viaje'] = null
  // Un borrador de ONE sin revisar no sale en el PDF; se avisa, sin bloquear la descarga.
  let avisoTexto: string | null = null
  if (plantillaPropia && negocioInfo) {
    // Ya leído arriba cuando alguna línea tiene tarifa por pasajero: no se paga dos veces.
    const delNegocio = viajeDelNegocio ?? (await leerViajeDelNegocio(supabase, negocioInfo.id)).viaje
    const paraLecturaDe = (i: ItemRow) => ({
      nombre: i.nombre ?? '',
      grupo: i.grupo ?? null,
      tarifa_pax: i.tarifa_pax,
      // §1.2 · el adicional se ve DENTRO del vuelo. Es la misma lista que va en
      // «Inversión»: escrita dos veces, la ficha y el precio dirían cosas distintas.
      adicionales: adicionalesDe(i).adicionales ?? [],
      // B2/B3 · los campos propios de la opción mandan sobre la lectura cuando existen.
      cargo_destino_valor: i.cargo_destino_valor ?? null,
      cargo_destino_moneda: i.cargo_destino_moneda ?? null,
      tramos: i.tramos ?? null,
      // P2 · la nota que escribió una persona sale debajo de la tarjeta del vuelo o del hotel.
      descripcion: i.descripcion ?? null,
    })
    const paraLectura = itemsImpresos.map(paraLecturaDe)
    const vuelos = vuelosDeItems(paraLectura)
    const hoteles = hotelesDeItems(paraLectura)

    /**
     * Con VARIAS tarifas en la propuesta, los vuelos y hoteles del documento son los de las
     * tres, cada uno marcado con las tarifas a las que pertenece (índices de
     * `itinerariosPDF`, mismo orden de `bloques`). Es lo que deja al documento pintar cada
     * opción con su color de punta a punta (§3 del sistema visual).
     *
     * ⚠️ Solo cambia lo que se DESCRIBE. El destino y las fotos siguen saliendo de la
     * principal: son del viaje que el documento recomienda, y una alternativa no puede
     * cambiar la portada. El dinero no se toca.
     *
     * Los cargos en destino SÍ son de cada tarifa (B2 del brief del 2026-09-23): cada una
     * duerme en su hotel y paga su tasa. Con solo los de la principal, el cliente que escogía
     * Sunscape o Hyatt no veía el cargo del suyo (hallazgo 29 del ensayo).
     *
     * Con una sola tarifa, o sin itinerarios, no se marca nada y el documento describe lo
     * que imprime, como hasta hoy.
     */
    let vuelosDelDocumento = vuelos
    let hotelesDelDocumento = hoteles
    let cargosEnDestino = cargosEnDestinoDeItems(paraLectura)
    if (bloques && bloques.length > 1) {
      const tarifasDe = new Map<string, number[]>()
      bloques.forEach((b, idx) => {
        for (const id of b.itemIds) tarifasDe.set(id, [...(tarifasDe.get(id) ?? []), idx])
      })
      const itemsDeLaPropuesta = [...tarifasDe.keys()]
        .map(id => itemPorId.get(id))
        .filter((i): i is ItemRow => i !== undefined)
      const marcar = <T,>(lista: T[], i: ItemRow) => lista.map(x => ({ ...x, tarifas: tarifasDe.get(i.id as string) ?? [] }))
      vuelosDelDocumento = itemsDeLaPropuesta.flatMap(i => marcar(vuelosDeItems([paraLecturaDe(i)]), i))
      hotelesDelDocumento = itemsDeLaPropuesta.flatMap(i => marcar(hotelesDeItems([paraLecturaDe(i)]), i))
      cargosEnDestino = itemsDeLaPropuesta.flatMap(i => marcar(cargosEnDestinoDeItems([paraLecturaDe(i)]), i))
    }
    const config = leerConfigDocumentoViaje(ws?.config_extra)
    const destino = delNegocio.destino ?? destinoDeItinerario(vuelos, hoteles)
    const fotos = plantillaUsaFotosDeCiudad(templateSlug)
      ? fotosDelViaje({ destino, vuelos, hoteles }, fotosDeCiudad)
      : null
    /**
     * El texto para el cliente (titular, intro, «Incluido en el plan», «Antes de viajar»).
     * Solo lo lee la plantilla que lo imprime, y solo sale lo que una persona REVISÓ
     * (`textoImprimible`). Sin texto revisado las claves ni se agregan: el documento sale
     * idéntico al de antes.
     */
    const documentoCliente = plantillaUsaTextoDelCliente(templateSlug)
      ? leerDocumentoCliente((cot as unknown as Record<string, unknown>).documento_cliente)
      : null
    const textoCliente = textoParaElViaje(documentoCliente)
    avisoTexto = avisoDelTextoEnPdf(documentoCliente)
    const viaje = {
      ...textoCliente,
      viajeros: delNegocio.composicion ? describirOcupacion(delNegocio.composicion, 'y') : null,
      destino,
      fechas: rangoDeFechas(delNegocio.fechas.inicio, delNegocio.fechas.fin),
      duracion: duracionDelViaje(delNegocio.fechas.inicio, delNegocio.fechas.fin),
      presentacion: delNegocio.presentacion,
      // Las fotos salen del banco PROVISIONAL (`fotos-ciudad.ts`) y solo para la plantilla
      // que las imprime. `fotosDeCiudad` es la única puerta al banco: cuando llegue el real
      // (async, en la base), se cambia allá y esta línea sigue igual.
      foto: fotos?.portada ?? null,
      fotosCiudades: fotos?.ciudades ?? [],
      fechaInicio: delNegocio.fechas.inicio,
      vuelos: vuelosDelDocumento,
      hoteles: hotelesDelDocumento,
      cargosEnDestino,
      nivelDetalle: delNegocio.nivelDetalle,
      pie: config.pie,
      firma: config.firma,
    }
    const hayAlgoQueDescribir =
      viaje.viajeros !== null
      || viaje.destino !== null
      || viaje.fechas !== null
      || viaje.presentacion !== null
      || vuelos.length > 0
      || hoteles.length > 0
      || cargosEnDestino.length > 0
      || Object.keys(textoCliente).length > 0
    viajePDF = hayAlgoQueDescribir ? viaje : null
  }

  const element = createElement(plantillaPropia ?? CotizacionPDF, {
    cotizacion: {
      consecutivo: cot.consecutivo,
      descripcion: cot.descripcion,
      valor_total: cot.valor_total,
      modo: cot.modo,
      fecha_envio: cot.fecha_envio,
      fecha_validez: cot.fecha_validez,
      condiciones_pago: cot.condiciones_pago,
      notas: cot.notas,
      descuento_porcentaje: cot.descuento_porcentaje ?? 0,
      descuento_valor: cot.descuento_valor ?? 0,
      terminos_condiciones: (cot as unknown as CotizacionNuevosCampos).terminos_condiciones,
    },
    empresa: {
      nombre: empresa.nombre ?? '',
      nit: empresa.numero_documento,
      contacto_nombre: empresa.contacto_nombre,
      contacto_email: empresa.contacto_email,
      telefono: empresa.telefono ?? null,
      direccion: empresa.direccion_fiscal ?? null,
      ciudad: [empresa.municipio, empresa.departamento].filter(Boolean).join(', ') || null,
    },
    vendedor: {
      nombre: ws?.name ?? 'Mi Empresa',
      razon_social: vendorFiscal?.razon_social ?? null,
      nit: vendorFiscal?.nit ?? null,
      logo_url: ws?.logo_url ?? null,
      color_primario: ws?.color_primario ?? 'var(--acento)',
      telefono: vendorFiscal?.telefono ?? null,
      email: vendorFiscal?.email_fiscal ?? null,
      direccion: vendorFiscal?.direccion_fiscal ?? null,
      ciudad: [vendorFiscal?.municipio, vendorFiscal?.departamento].filter(Boolean).join(', ') || null,
    },
    items: itemsParaResumen,
    itinerarios: itinerariosPDF,
    dias: diasPDF,
    itemsSinDia: itemsSinDiaPDF,
    sugeridos: sugeridosPDF && sugeridosPDF.length > 0 ? sugeridosPDF : null,
    // Sobre lo que SUMA el total impreso: el principal si hay itinerarios, si no la lista
    // plana. Mismo arreglo que alimenta el Subtotal, así que no puede contar otra cosa.
    // ⚠️ Los adicionales viajan a propósito: su plata NO está en el reparto por pasajero
    // (`precio_venta` es el precio BASE de la variante) y sin nombrarlos la tabla por
    // pasajero quedaría por debajo del TOTAL sin que el documento lo explique.
    preciosPorPasajero: preciosPorPasajeroDelViaje(itemsParaResumen),
    fiscal,
    // Los precios ya traen el IVA adentro (ver `preciosConIva`): sumado aquí con `iva_aparte`,
    // o de fábrica con `iva_incluido`. `null` en todo lo demás: la plantilla imprime
    // Subtotal, IVA y TOTAL como siempre.
    ivaEnPrecios: preciosConIva
      ? {
          iva: fiscal.iva,
          nota: configIva.enDocumento === 'linea_incluida',
          porBloque: ivaPorBloque,
        }
      : null,
    negocio: negocioInfo ? { nombre: negocioInfo.nombre } : null,
    emisor,
    viaje: viajePDF,
  })

  // renderToBuffer espera DocumentElement; nuestro createElement lo produce correctamente en runtime
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await renderToBuffer(element as any)

  // Borrador: marca de agua y fuera, sin guardar ni registrar (ver `esBorrador`).
  if (esBorrador) {
    const conMarca = await ponerMarcaDeBorrador(Buffer.from(buffer), motivosBorrador)
    return {
      success: true,
      pdf: conMarca.toString('base64'),
      filename: `${cot.consecutivo}-BORRADOR.pdf`,
      fiscal,
      borrador: true as const,
      aviso: avisoBorrador,
      avisosCobertura,
      // Mismo criterio que en el camino del servicio externo: el borrador no calla el aviso.
      avisosCaptura,
      avisoTexto,
      renderedVia: 'react-pdf' as const,
    }
  }

  const base64 = Buffer.from(buffer).toString('base64')
  const filename = `${cot.consecutivo}.pdf`

  // Este camino nunca guardó el PDF en ningún lado (solo lo devuelve para descargar), y
  // en un workspace en Drive sigue igual. Con almacenamiento externo queda además en el
  // proyecto del cliente.
  const externo = await guardarPdfEnAlmacenamientoExterno(
    workspaceId,
    negocioInfo?.id ?? null,
    filename,
    Buffer.from(buffer),
  )

  // El documento ya existe: desde aquí, lo que salió al cliente salió. Ver el
  // encabezado del helper para por qué éste es el momento de «sale al cliente».
  await registrarDecisionesDeLaSalida(supabase, {
    workspaceId,
    cotizacionId,
    negocioId: negocioInfo?.id ?? null,
    staffId: staffId ?? null,
  })

  return {
    success: true,
    pdf: base64,
    filename,
    fiscal,
    archivoReferencia: externo.referencia,
    aviso: externo.aviso,
    avisosCobertura,
    avisosCaptura,
    avisoTexto,
    renderedVia: 'react-pdf' as const,
  }
}
