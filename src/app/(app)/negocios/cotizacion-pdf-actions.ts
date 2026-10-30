'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { createServiceClient } from '@/lib/supabase/server'
import { firmaConLaAsesora, pieConLaAsesora, type AsesoraDeLaCotizacion } from '@/lib/cotizaciones/propuesta/asesora'
import { bogotaParts, todayBogotaISO } from '@/lib/dates/bogota'
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
import { leerAdicionalesDeItems, reglasDelDocumentoVigente } from '@/lib/cotizaciones/itinerarios-datos'
import { leerReglasDeCotizacion, type ReglasDelDocumento } from '@/lib/cotizaciones/reglas-margen'
import {
  adicionalesPorItem,
  adicionalEnLaFicha,
  totalesDeAdicionales,
} from '@/lib/cotizaciones/adicionales'
import { aportaAlTotal, lineasQueDescribeElDocumento } from '@/lib/cotizaciones/lineas-del-documento'
import { ranurasCombinables } from '@/lib/cotizaciones/itinerarios'
import { avisosDeCobertura } from '@/lib/cotizaciones/cobertura-opciones'
import { diasDelItinerario, fueraDelPrecio, itemsSugeridos, sugeridosVisibles } from '@/lib/cotizaciones/dia-relativo'
import {
  cargosEnDestinoDeItems,
  ciudadDeActividad,
  destinoDeItinerario,
  duracionDelViaje,
  hotelesDeItems,
  leerConfigDocumentoViaje,
  rangoDeFechas,
  vuelosDeItems,
} from '@/lib/cotizaciones/detalle-viaje'
import { leerViajeDelNegocio } from '@/lib/cotizaciones/viaje-negocio'
import { hotelesConFechasDelViaje, rangoDelViajeCotizado } from '@/lib/cotizaciones/fechas-del-viaje'
import { entradaAsiPuedesPagar } from '@/lib/viaje/asi-puedes-pagar'
import { terminosConCondicionVisa } from '@/lib/viaje/condicion-visa'
import { terminosConTasaDeCambio } from '@/lib/cotizaciones/nota-tasa-pdf'
import { describirOcupacion } from '@/lib/cotizaciones/tarifa-pasajero'
import { hayTarifaPorPasajero, lineasDesactualizadas, motivoParaNoEnviar } from '@/lib/cotizaciones/captura-desactualizada'
import { MENSAJE_SIN_PASAJEROS } from '@/lib/cotizaciones/captura-desactualizada-datos'
import {
  PLANTILLA_POR_DEFECTO,
  compositorDePlantilla,
  plantillaCotizacionPropia,
  plantillaImprimePreciosConIva,
  plantillaUsaFotosDeCiudad,
  plantillaUsaTextoDelCliente,
  tienePropuestaHtml,
  usaMotorHtml,
} from '@/lib/pdf/plantillas-cotizacion'
import type { ServicioDelDocumento } from '@/lib/cotizaciones/propuesta/modelo-documento'
import { lugaresDeOpcionales, serviciosDelDocumento, type LugarDeOpcional } from '@/lib/cotizaciones/propuesta/servicios-del-documento'
import type { ClienteDelNegocio } from '@/lib/cotizaciones/propuesta/destinatario'
import { leerAnticipo } from '@/lib/cotizaciones/propuesta/anticipo'
import { whatsappDesdeTelefono } from '@/lib/contactos/telefono'
import { avisoDelTextoEnPdf, avisoDelTextoViejoEnPdf, leerDocumentoCliente, textoParaElViaje } from '@/lib/cotizaciones/documento-cliente'
import { incluyeDeOne } from '@/lib/cotizaciones/incluye-por-one'
import { leerContextoTextoCliente } from '@/lib/cotizaciones/documento-cliente-datos'
import { vigenciaEnDias } from '@/lib/cotizaciones/condiciones-comerciales'
import { fotosDeCiudad } from '@/lib/pdf/fotos-ciudad'
import { fotosDelViaje } from '@/lib/pdf/fotos-del-viaje'
import { descripcionVisibleDeLinea, nombreVisibleDeLinea } from '@/lib/cotizaciones/nombre-visible'
import { hotelesDePaquetes, noIncluyeDePaquetes, vuelosDePaquetes } from '@/lib/cotizaciones/bloqueo-documento'
import { esLineaDePaquete } from '@/lib/cotizaciones/bloqueo-incompleto'
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
import { frenosDePaqueteYPasajero } from '@/lib/cotizaciones/frenos-de-paquete-y-pasajero'
import { autorizacionDelNegocioLeido, MENSAJE_ENVIO, type NegocioParaEnvio } from '@/lib/autorizacion-datos/envio'
import { imagenComoDataUrl } from '@/lib/cotizaciones/imagen-captura'
import { claveDeHotel, fotosDeHotelesDelDocumento } from '@/lib/fotos/foto-hotel-documento'
import type { OpcionalDelDocumento } from '@/lib/fotos/catalogo-propuesta'

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

export async function generateCotizacionPDF(
  cotizacionId: string,
  /**
   * H4 (verificación D, D7) · `vistaPrevia`: el mismo documento, con las mismas props y el mismo
   * motor, para MOSTRARLO en «Revisar y enviar». No escribe nada: ni la pérdida de la autorización
   * del dueño, ni el almacenamiento, ni Drive, ni el registro de la salida. Sin la opción, todo como
   * siempre.
   */
  opciones?: {
    vistaPrevia?: boolean
    /**
     * Quien llama dice si la cotización se trabaja por pasos (el PDF no mira el interruptor, criterio
     * N4). Con él, el precio por pasajero que falta (P12) también deja el PDF como borrador, porque
     * así frena `enviarPorPasos`. Solo AGREGA la marca: sin la opción, como siempre.
     */
    porPasos?: boolean
    /**
     * La pieza `incluye_por_one` de la forma por pasos (QA del #1342): «Incluye» lo arma ONE con lo
     * que se cobra aunque el texto para el cliente no esté revisado ni tenga la marca. Solo lo pasa
     * quien sabe que la pieza está encendida (el PDF no mira el interruptor, N4).
     */
    incluyePorOne?: boolean
  },
) {
  const vistaPrevia = opciones?.vistaPrevia === true
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
    registrarPerdida: !vistaPrevia,
  })
  // El borrador se decide más abajo, cuando se sabe si el IVA se pudo calcular.
  const salidaBloquea = salida?.aplica === true && salida.bloquea

  /**
   * La Recomendada manda el documento (decisión del 2026-09-22): con tarifas, el TOTAL y
   * la leyenda «corresponde a la opción recomendada» salen de ella. Sin la Recomendada en
   * la propuesta el total sería un supuesto, así que el PDF sale como borrador, igual que
   * bajo el margen mínimo. Sin tarifas (`[]`, R6) no dice nada y todo sigue como antes.
   */
  const tarifasDelPdf = (await leerItinerarios(supabase, cotizacionId)) ?? []
  const sinRecomendada = motivoSinRecomendada(tarifasDelPdf)

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
  type NegocioInfo = { id: string; nombre: string | null; carpeta_url: string | null; linea_id: string | null; configLinea: unknown; responsableId: string | null }
  let negocioInfo: NegocioInfo | null = null
  let contactoDelNegocio: string | null = null
  // El negocio con las etapas de su línea, para la autorización de datos (la regla de «Enviar»).
  let negocioParaEnvio: NegocioParaEnvio | null = null

  if (cot.negocio_id) {
    const { data: negocio } = await supabase
      .from('negocios')
      // La línea viaja en la MISMA ida (embed): «Así puedes pagar» lee su `config_extra` y una
      // consulta aparte le sumaba una ida a todo PDF de negocio (presupuesto V5 de C0).
      // El contacto también (2026-10-27): la propuesta de viaje dice a quién va dirigida.
      .select('id, nombre, carpeta_url, linea_id, empresa_id, contacto_id, responsable_id, lineas_negocio(config_extra, etapas_negocio(config_extra)), empresas(nombre, numero_documento, contacto_nombre, contacto_email, tipo_persona, regimen_tributario, gran_contribuyente, agente_retenedor, telefono, direccion_fiscal, municipio, departamento), contactos(nombre)')
      .eq('id', cot.negocio_id)
      .single()
    if (negocio) {
      const lineaEmbebida = (negocio as { lineas_negocio?: unknown }).lineas_negocio
      const filaLinea = Array.isArray(lineaEmbebida) ? lineaEmbebida[0] : lineaEmbebida
      negocioInfo = {
        id: negocio.id,
        nombre: negocio.nombre,
        carpeta_url: negocio.carpeta_url,
        linea_id: (negocio as { linea_id?: string | null }).linea_id ?? null,
        configLinea: (filaLinea as { config_extra?: unknown } | null | undefined)?.config_extra ?? null,
        responsableId: (negocio as { responsable_id?: string | null }).responsable_id ?? null,
      }
      negocioParaEnvio = {
        linea_id: negocioInfo.linea_id,
        contacto_id: (negocio as { contacto_id?: string | null }).contacto_id ?? null,
        lineas_negocio: (filaLinea as NegocioParaEnvio['lineas_negocio']) ?? null,
      }
      if (!empresa) {
        empresa = (negocio.empresas as EmpresaRow | null) ?? null
      }
      const contactoEmbebido = (negocio as { contactos?: unknown }).contactos
      const filaContacto = (Array.isArray(contactoEmbebido) ? contactoEmbebido[0] : contactoEmbebido) as { nombre?: string | null } | null | undefined
      contactoDelNegocio = filaContacto?.nombre ?? null
    }
  }

  // A quién va dirigida la propuesta de viaje: el contacto del negocio y su empresa real (la de
  // relleno de abajo no cuenta).
  const clienteDelNegocio = { contacto: contactoDelNegocio, empresa: empresa?.nombre ?? null, tipoPersona: empresa?.tipo_persona ?? null }

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
    // La ficha FIJADA en la línea (`items.proveedor_id`) viaja con ella, en la MISMA ida: es la
    // llave de las fotos del hotel que muestra y guarda su tarjeta (reunión del 2026-10-22, punto
    // 3). Si el embebido falla (relación ausente), la lectura de siempre: el PDF no se queda sin
    // líneas por una foto.
    // `items.proveedor_id` → `fotos_perfiles` no está en los tipos generados: sin tipar.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sinTipos = supabase as any
    const conFicha = await sinTipos
      .from('items')
      .select('*, rubros(*), ficha:fotos_perfiles(tipo, clave)')
      .eq('cotizacion_id', cotizacionId)
      .order('orden')
    const itemsData = conFicha.error
      ? (await supabase.from('items').select('*, rubros(*)').eq('cotizacion_id', cotizacionId).order('orden')).data
      : conFicha.data
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
   * pasajero o es un paquete de bloqueo: una cotización que no es de viaje no paga la consulta (R6). Si esa lectura
   * falla, borrador: sin los pasajeros no se puede saber si el precio es el de hoy, y un
   * PDF limpio lo afirmaría.
   */
  const conTarifaPorPasajero = hayTarifaPorPasajero(items)
  // Un bloqueo de solo paquetes no trae tarifa por pasajero (`tarifa_pax.bloqueo`), pero su freno
  // necesita los pasajeros y las edades de la Solicitud, como `enviarPorPasos` (Vera sobre el #1326).
  const conPaquete = items.some(i => esLineaDePaquete({ grupo: i.grupo ?? null, es_ajuste: i.es_ajuste ?? null })
    || !!(i.tarifa_pax && typeof i.tarifa_pax === 'object' && (i.tarifa_pax as { bloqueo?: unknown }).bloqueo))
  const lecturaDelViaje = negocioInfo && (conTarifaPorPasajero || conPaquete)
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

  /**
   * Lo que frena «Enviar» antes del margen (prueba real del bloqueo de Trappvel, 2026-10-29): la
   * autorización de datos del cliente (la regla de `enviarCotizacion`, con el negocio ya leído), el
   * paquete de bloqueo incompleto y, por pasos, el precio por pasajero (P12). Las mismas funciones
   * que el envío: si «Enviar» frena, el PDF sale con la marca. La Neta con margen sano y la
   * autorización pendiente salía limpia (heredado de #1257, 2026-10-25).
   */
  const motivoDatos = negocioInfo
    ? await (async () => {
        const v = await autorizacionDelNegocioLeido(supabase, { workspaceId, negocioId: negocioInfo!.id, negocio: negocioParaEnvio })
        return v.falta ? MENSAJE_ENVIO[v.falta] : null
      })()
    : null
  const frenos = frenosDePaqueteYPasajero({
    items: items.filter(i => i.id).map(i => ({ ...i, id: i.id as string })),
    tarifas: tarifasDelPdf,
    composicion: composicionViaje,
    edadesMenores: lecturaDelViaje && !lecturaDelViaje.error ? lecturaDelViaje.edadesMenores ?? null : null,
    conPrecioPorPasajero: opciones?.porPasos === true,
  })

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
    autorizacionDatos: motivoDatos !== null,
    precioPorPasajero: frenos.precioPorPasajero !== null,
    paqueteIncompleto: frenos.paquete !== null,
    comisionPublica: frenos.comision !== null,
    pantallazos: motivoPantallazos !== null,
    sinRecomendada: sinRecomendada !== null,
    faltaCosto: salida?.aplica === true && salida.faltaCosto !== null,
    faltaTasa: salida?.aplica === true && salida.faltaTasa === true,
    // Con un paquete incompleto su costo no está en la cuenta: «margen bajo el mínimo» señalaría la
    // causa equivocada (la misma regla que la lista única de Revisar).
    // Lo mismo con una Pública sin comisión (D3): el margen no se puede medir; la causa es la comisión.
    margen: salidaBloquea && frenos.paquete === null && frenos.comision === null,
    ivaSinCalcular,
    ivaIncluidoSinPlantilla,
  })
  const esBorrador = motivosBorrador.length > 0
  const avisoBorrador = esBorrador
    ? avisoDeBorrador(motivosBorrador, {
        autorizacion_datos: motivoDatos,
        precio_por_pasajero: frenos.precioPorPasajero,
        paquete_incompleto: frenos.paquete,
        comision_publica: frenos.comision,
        pantallazos: motivoPantallazos,
        recomendada: sinRecomendada,
        incompleto: salida?.aplica === true ? salida.faltaCosto : null,
        incompleto_tasa: salida?.aplica === true ? salida.faltaCosto : null,
        margen: salidaBloquea && frenos.paquete === null && frenos.comision === null ? salida!.mensaje : null,
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
  // Motor `html` (propuesta de viaje con Chromium, 2026-10-14): solo con la plantilla propia y
  // encendido por workspace. Apagado no se calcula nada nuevo y el PDF es el de siempre.
  const motorHtml = plantillaPropia !== null && usaMotorHtml(templateSlug, ws?.config_extra)
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
    // `fecha_envio` es timestamptz: el dia que ve el cliente es el de Bogota, no el de
    // la zona del servidor (UTC), que a partir de las 19:00 ya va en el dia siguiente.
    const envioBogota = bogotaParts(fechaEnvio)
    const fechaStr = `${envioBogota.day}/${envioBogota.month}/${envioBogota.year}`

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
      // Vista previa: el documento, sin guardarlo ni registrarlo.
      if (vistaPrevia) return { success: true, pdf: buffer.toString('base64'), filename, fiscal, vistaPrevia: true as const, renderedVia: 'weasyprint' as const }

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
        // H33: descargar ya no registra el envío (lo pregunta el editor). La clave se queda en
        // `false` porque la salida del servidor está congelada por el fixture de igualdad (C0).
        envioRegistrado: false,
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
  // OJO con lo que este dato significa: `cotizaciones` no guarda quien la creo. Desde el
  // 2026-10-29 es la responsable comercial del negocio y, si el negocio no tiene, el staff que
  // APRETO GENERAR. Sin ficha de staff queda null y la plantilla omite la firma.
  let emisor: { nombre: string; cargo: string | null } | null = null
  // Brief del 2026-10-29, punto 5 · la asesora de la cotización: la responsable comercial del
  // negocio o, sin ella, quien genera. La MISMA lectura de la ficha sirve a la firma de siempre y
  // a los datos de la asesora en el pie (sin una ida más a la base).
  let asesoraDoc: AsesoraDeLaCotizacion | null = null
  const staffDeLaAsesora = negocioInfo?.responsableId ?? staffId ?? null
  if (plantillaPropia && staffDeLaAsesora) {
    asesoraDoc = await leerAsesoraDeLaCotizacion(supabase, staffDeLaAsesora)
    if (asesoraDoc) emisor = { nombre: asesoraDoc.nombre, cargo: asesoraDoc.cargo }
  }

  // R7 · los bloques de la propuesta. `null` cuando la cotizacion no tiene
  // itinerarios o ninguno va en la propuesta: ahi el PDF imprime la lista plana de
  // siempre. El corte vive en `bloquesParaPDF` y no en la plantilla porque hay mas
  // de una plantilla, y una regla repetida es una regla que se desincroniza.
  const bloquesLeidos = await bloquesParaPDF(supabase, cotizacionId)
  /**
   * P9 (decisión Max 4, 2026-10-12) · UNA SOLA MANERA DE HACER EL VIAJE: una sola tarifa en la
   * propuesta (la Recomendada) y ningún vuelo ni hotel con opciones —las únicas opciones son de
   * traslados o actividades—. Ahí no hay tarifas que comparar: el documento conserva el «Día a
   * día» y lo arma con lo que la Recomendada escogió, no con el supuesto. El dinero no cambia:
   * `valor_total` ya es el de la Recomendada (`totalDelPrincipal`).
   *
   * Depende del DATO, no del interruptor: es lectura, encendido o apagado igual. Con vuelos u
   * hoteles con opciones, o con más de una tarifa en la propuesta, todo queda como antes.
   */
  const unaSolaManera = bloquesLeidos !== null
    && bloquesLeidos.length === 1
    && bloquesLeidos[0].esPrincipal
    && ranurasCombinables(items.filter(i => i.id).map(i => ({
      id: i.id as string,
      grupo: i.grupo ?? null,
      opcion_de: i.opcion_de ?? null,
      es_ajuste: i.es_ajuste ?? false,
      orden: i.orden ?? 0,
      dia_relativo: i.dia_relativo ?? null,
      entra_al_precio: i.entra_al_precio ?? null,
      // El traslado que va con un hotel (2026-10-22, `va-con-hotel.ts`).
      tarifa_pax: i.tarifa_pax,
    }))).length === 0
  const bloques = unaSolaManera ? null : bloquesLeidos
  const idsDeLaUnica = unaSolaManera ? new Set(bloquesLeidos![0].itemIds) : null
  /** Lo que aporta al documento: con una sola manera, lo que escogió la Recomendada. */
  const aportaDoc = idsDeLaUnica
    ? (i: ItemRow) => !i.id || idsDeLaUnica.has(i.id) || i.es_ajuste === true
    : aporta
  const itemPorId = new Map(items.filter(i => i.id).map(i => [i.id as string, i]))
  // Reglas de margen (2026-10-27): sin tarifas en la propuesta, el documento sale de la cascada
  // vigente (la de `valor_total`). Solo se lee si la cotización tiene reglas.
  const conReglasDeMargen = leerReglasDeCotizacion((cot as unknown as { reglas_margen?: unknown }).reglas_margen) !== null
  const reglasVigente = conReglasDeMargen && !bloques ? await reglasDelDocumentoVigente(supabase, cotizacionId) : null

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
      adicionales: lista.map(adicionalEnLaFicha),
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
  /**
   * Reglas de margen (2026-10-27, `reglas-margen.ts`): el precio de la línea en ESTE documento
   * (con su parte de los puntos extra, que no salen como renglón) y la nota del descuento por
   * hotel. Sin reglas, la línea tal cual.
   */
  const conReglas = (reglasDoc: ReglasDelDocumento | null, i: ItemRow): ItemRow => {
    const precio = reglasDoc && i.id ? reglasDoc.precioPorItem.get(i.id) : undefined
    if (precio === undefined) return i
    return { ...i, precio_venta: precio / (Number(i.cantidad) || 1) }
  }
  const paraPlantillaDe = (reglasDoc: ReglasDelDocumento | null) => (original: ItemRow) => ({
    ...paraPlantillaBase(conReglas(reglasDoc, original), original),
    ...(reglasDoc && original.id && reglasDoc.notas.has(original.id) ? { nota: reglasDoc.notas.get(original.id) } : {}),
  })
  const paraPlantillaBase = (ajustado: ItemRow, original: ItemRow) => {
    const i = conIva(ajustado)
    const adicionales = adicionalesDe(original)
    const ivaAdicionales = sumaIvaAlPrecio ? ivaDe(original)?.ivaAdicionales ?? 0 : 0
    // R8 · la llave solo aparece en una opción de hotel cobrada por habitación: las demás
    // líneas (y las otras plantillas) llegan idénticas.
    const porHabitacion = precioPorHabitacionDeItem(i, composicionViaje)
    return {
      // Hotel y traslado con el nombre de su lectura, no en MAYÚSCULAS (`nombre-visible.ts`).
      nombre: nombreVisibleDeLinea(i),
      // Y la descripción igual (prueba del #1229, punto 2: lo que incluye la tarifa no en MAYÚSCULAS).
      descripcion: descripcionVisibleDeLinea(i),
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

  const paraPlantilla = paraPlantillaDe(reglasVigente)

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
          .map(paraPlantillaDe(b.reglas ?? null)),
        ...(b.reglas && b.reglas.descuentos.length > 0 ? { descuentos: b.reglas.descuentos } : {}),
      }))
    : null

  const itemsDelPrincipal = itinerariosPDF?.find(b => b.esPrincipal)?.items ?? null
  const itemsParaResumen = itemsDelPrincipal ?? items.filter(aportaDoc).map(paraPlantilla)

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
      // El traslado que va con un hotel (2026-10-22, `va-con-hotel.ts`).
      tarifa_pax: i.tarifa_pax,
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
          .filter((i): i is ItemRow => i !== undefined && aportaDoc(i))
          // El id deja al día a día de la propuesta nueva reconocer la línea que ya es un servicio.
          .map(i => ({ ...paraPlantilla(i), ...(i.id ? { id: i.id as string } : {}) })),
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
        .filter(i => aportaDoc(i) && !(i.id && (idsConDia.has(i.id) || idsSugeridos.has(i.id))))
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
  // Las líneas de los sugeridos, en el orden en que salen: el motor `html` les busca la ciudad.
  const itemsSugeridosPDF = idsSugeridosVisibles
    .map(id => porId.get(id))
    .filter((i): i is ItemRow => i !== undefined)
  const sugeridosPDF: CotizacionPDFProps['sugeridos'] = idsSugeridosVisibles.length === 0
    ? null
    : itemsSugeridosPDF
        // Con IVA incluido como el resto del documento: el precio de una actividad
        // opcional es lo que el cliente pagaría si la toma.
        .map(conIva)
        .map(i => ({
          // Como en «Inversión»: el nombre y el detalle de la lectura, no en MAYÚSCULAS (brief del
          // 2026-10-05, «actividades tras la limpieza», punto 4). Sin ranura llegan idénticos.
          nombre: nombreVisibleDeLinea(i),
          descripcion: descripcionVisibleDeLinea(i),
          precio_venta: Number(i.precio_venta) || 0,
          cantidad: Number(i.cantidad) || 1,
          unidad: i.unidad ?? null,
        }))
  // Cada plan opcional con la ciudad de su línea: la misma llave que su tarjeta en el editor, para
  // encontrar su foto en la biblioteca (`catalogo-propuesta.ts`).
  const opcionalesDoc: OpcionalDelDocumento[] = itemsSugeridosPDF.map(i => ({
    nombre: nombreVisibleDeLinea(i),
    ciudad: ciudadDeActividad({ nombre: i.nombre ?? '', grupo: i.grupo ?? null, tarifa_pax: i.tarifa_pax }),
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
  const itemsImpresos = lineasQueDescribeElDocumento(items, idsDelPrincipal, aportaDoc)

  let viajePDF: CotizacionPDFProps['viaje'] = null
  // Motor `html`: los traslados, trenes y actividades que @react-pdf no recibe (pendiente del PR 1).
  let serviciosDoc: ServicioDelDocumento[] = []
  /** Llave del hotel en el documento → llave de la ficha fijada en su línea (`catalogo-propuesta.ts`). */
  const fichasDeHotel = new Map<string, string>()
  // Motor `html`: la ciudad y el día de cada plan opcional, para ponerlo en los días libres.
  let lugaresOpcionalesDoc: LugarDeOpcional[] = []
  // S3 (QA del 2026-10-29): cuántos viajan, para que la propuesta le hable a uno (usted) o a varios
  // (ustedes). Va aparte de las props a propósito: las de @react-pdf no cambian.
  let numeroDeViajerosDoc: number | null = null
  // «Así puedes pagar» (F2, PR 7): solo con `plan_pagos.activo` en la línea del negocio.
  let entradaPlan: CotizacionPDFProps['asiPuedesPagar'] = null
  // Un borrador de ONE sin revisar no sale en el PDF; se avisa, sin bloquear la descarga.
  let avisoTexto: string | null = null
  // Visa en trámite en la Solicitud (Mauricio 2026-10-29): la condición va en los términos.
  let conVisaEnTramite = false
  if (plantillaPropia && negocioInfo) {
    // Ya leído arriba cuando alguna línea tiene tarifa por pasajero: no se paga dos veces.
    const lectura = lecturaDelViaje && !lecturaDelViaje.error ? lecturaDelViaje : await leerViajeDelNegocio(supabase, negocioInfo.id)
    const delNegocio = lectura.viaje
    conVisaEnTramite = lectura.visaEnTramite ?? false
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
    // Viaje en bloqueo (QA del 2026-10-29): el hotel y los vuelos del paquete viven en
    // `tarifa_pax.bloqueo`, no en las casillas del pantallazo. Solo se DESCRIBEN aquí: no entran a
    // `vuelosDeItems`, que también usan el margen y el recargo.
    const vuelosDoc = (xs: ReturnType<typeof paraLecturaDe>[]) => [...vuelosDeItems(xs), ...vuelosDePaquetes(xs)]
    // D6 (2026-10-29): un paquete sin vuelo ni salida manual toma las fechas del viaje del negocio.
    const hotelesDoc = (xs: ReturnType<typeof paraLecturaDe>[]) => [...hotelesDeItems(xs), ...hotelesDePaquetes(xs, delNegocio.fechas)]
    const vuelos = vuelosDoc(paraLectura)
    // Las fechas del viaje COTIZADO (brief del 2026-10-29, punto 1): las de los servicios; el
    // rango de la solicitud solo si ninguno tiene fecha. El hotel sin fechas en su captura toma
    // la llegada y el regreso del vuelo.
    const hotelesLeidos = hotelesDoc(paraLectura)
    const rango = rangoDelViajeCotizado({ vuelos, hoteles: hotelesLeidos }, delNegocio.fechas)
    const hoteles = hotelesConFechasDelViaje(hotelesLeidos, rango)
    if (negocioInfo.linea_id) {
      // Sin poder leer la línea, apagado: el documento sale como hoy. El «día del viaje» es el
      // inicio del viaje COTIZADO, el mismo de la portada (segunda vuelta de la COT-2026-0008,
      // punto 2): con el de la solicitud el plan decía «21 de junio» en un documento del 26.
      entradaPlan = entradaAsiPuedesPagar(
        negocioInfo.configLinea,
        { fechaSalida: rango.inicio, hoy: todayBogotaISO() },
      )
    }

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
      vuelosDelDocumento = itemsDeLaPropuesta.flatMap(i => marcar(vuelosDoc([paraLecturaDe(i)]), i))
      hotelesDelDocumento = hotelesConFechasDelViaje(itemsDeLaPropuesta.flatMap(i => marcar(hotelesDoc([paraLecturaDe(i)]), i)), rango)
      cargosEnDestino = itemsDeLaPropuesta.flatMap(i => marcar(cargosEnDestinoDeItems([paraLecturaDe(i)]), i))
    }
    // La ficha fijada en cada línea de hotel: sus fotos son las que la tarjeta muestra y guarda.
    for (const i of itemPorId.values()) {
      const ficha = (i as { ficha?: { tipo?: unknown; clave?: unknown } | null }).ficha
      if (!ficha || ficha.tipo !== 'hotel' || typeof ficha.clave !== 'string' || !ficha.clave) continue
      for (const h of hotelesDeItems([paraLecturaDe(i)])) {
        const k = claveDeHotel(h)
        if (k && !fichasDeHotel.has(k)) fichasDeHotel.set(k, ficha.clave)
      }
    }
    // Las fotos de la biblioteca (`foto-hotel-documento.ts`): la del perfil del hotel manda; la vieja
    // de la opción solo si el perfil no tiene una imprimible. Con @react-pdf, además, cada plan
    // opcional con foto en su perfil la lleva (el motor html las pone él mismo, con sus extras).
    // Solo en la plantilla que imprime fotos; si no se puede leer, el documento sale como antes.
    const opcionalesConFoto = motorHtml ? [] : opcionalesDoc
    if (plantillaUsaFotosDeCiudad(templateSlug) && (hotelesDelDocumento.length > 0 || opcionalesConFoto.length > 0)) {
      const enBiblioteca = tienePropuestaHtml(templateSlug) && workspaceId
        ? await (await import('@/lib/fotos/catalogo-propuesta')).fotosDeBibliotecaDelDocumento(supabase, workspaceId, hotelesDelDocumento, opcionalesConFoto, fichasDeHotel).catch(() => null)
        : null
      if (hotelesDelDocumento.length > 0) {
        hotelesDelDocumento = await fotosDeHotelesDelDocumento(hotelesDelDocumento, {
          biblioteca: enBiblioteca?.hoteles ?? new Map(),
          motorHtml,
          leerDeBiblioteca: clave => enBiblioteca?.leerHotel(clave) ?? Promise.resolve(null),
          leerDeOpcion: ref => imagenComoDataUrl(workspaceId, ref),
        })
      }
      if (enBiblioteca && sugeridosPDF) {
        for (const sug of sugeridosPDF) {
          const f = await enBiblioteca.opcional(sug.nombre).catch(() => null)
          if (f) sug.foto = { url: f.url, rotulo: null, credito: f.credito, proporcion: f.proporcion ?? undefined }
        }
      }
    }
    if (motorHtml) {
      // Con varias tarifas, cada servicio lleva las tarifas a las que pertenece (los mismos
      // índices que marcan vuelos y hoteles); con una, los que describe el documento.
      const marcas = new Map<string, number[]>()
      if (bloques && bloques.length > 1) {
        bloques.forEach((b, idx) => {
          for (const id of b.itemIds) marcas.set(id, [...(marcas.get(id) ?? []), idx])
        })
      }
      const fuente = marcas.size > 0
        ? [...marcas.keys()].map(id => itemPorId.get(id)).filter((i): i is ItemRow => i !== undefined)
        : itemsImpresos
      serviciosDoc = serviciosDelDocumento(
        fuente.map(i => ({
          ...paraLecturaDe(i),
          id: i.id ?? null,
          dia_relativo: i.dia_relativo ?? null,
          ...(i.id && marcas.has(i.id) ? { tarifas: marcas.get(i.id) } : {}),
        })),
        delNegocio.fechas.inicio,
      )
      lugaresOpcionalesDoc = lugaresDeOpcionales(
        itemsSugeridosPDF.map(i => ({ ...paraLecturaDe(i), dia_relativo: i.dia_relativo ?? null })),
        delNegocio.fechas.inicio,
      )
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
    // C6 · con la marca `incluye_origen = 'one'`, «Incluye» lo arma ONE con lo que se cobra en
    // lo que el documento describe. Sin la marca no se calcula nada: el documento de siempre.
    // QA del #1342 · con la pieza `incluye_por_one` (lo dice quien llama, N4) «Incluye» lo arma ONE
    // aunque el texto no tenga la marca ni esté revisado: es lo que promete la pantalla.
    const incluyePorOne = documentoCliente?.incluye_origen === 'one' || (opciones?.incluyePorOne === true && plantillaUsaTextoDelCliente(templateSlug))
    const textoCliente = textoParaElViaje(
      documentoCliente,
      incluyePorOne
        ? incluyeDeOne(itemsImpresos.filter(i => i.entra_al_precio !== false).map(paraLecturaDe), delNegocio.nivelDetalle)
        : null,
      { incluyeSinRevisar: incluyePorOne },
    )
    avisoTexto = avisoDelTextoEnPdf(documentoCliente)
    // El texto revisado que quedó viejo (brief del 2026-10-08): la misma huella que el panel del
    // editor, sobre las mismas líneas. Solo se calcula con un texto revisado que se imprime.
    if (!avisoTexto && Object.keys(textoCliente).length > 0 && documentoCliente?.fuente_hash) {
      const ctxTexto = await leerContextoTextoCliente(supabase, cotizacionId)
      avisoTexto = avisoDelTextoViejoEnPdf(documentoCliente, ctxTexto?.huella ?? null)
    }
    if (delNegocio.composicion) {
      numeroDeViajerosDoc = delNegocio.composicion.adultos + delNegocio.composicion.ninos + delNegocio.composicion.infantes
    }
    const viaje = {
      ...textoCliente,
      viajeros: delNegocio.composicion ? describirOcupacion(delNegocio.composicion, 'y') : null,
      destino,
      fechas: rangoDeFechas(rango.inicio, rango.fin),
      duracion: duracionDelViaje(rango.inicio, rango.fin),
      presentacion: delNegocio.presentacion,
      // Las fotos salen del banco PROVISIONAL (`fotos-ciudad.ts`) y solo para la plantilla
      // que las imprime. `fotosDeCiudad` es la única puerta al banco: cuando llegue el real
      // (async, en la base), se cambia allá y esta línea sigue igual.
      foto: fotos?.portada ?? null,
      fotosCiudades: fotos?.ciudades ?? [],
      fechaInicio: rango.inicio,
      // Los días asignados («día 3») cuentan desde la solicitud, como en la pantalla.
      ...(rango.inicio !== delNegocio.fechas.inicio ? { inicioDeLosDias: delNegocio.fechas.inicio } : {}),
      vuelos: vuelosDelDocumento,
      hoteles: hotelesDelDocumento,
      cargosEnDestino,
      // V5 (QA del 2026-10-29): lo que el paquete de bloqueo no incluye, si se leyó o se escribió.
      ...(() => { const n = noIncluyeDePaquetes(paraLectura); return n.length > 0 ? { noIncluye: n } : {} })(),
      nivelDetalle: delNegocio.nivelDetalle,
      // Brief del 2026-10-29, punto 5 · el pie y la firma con los datos de la asesora (la
      // responsable del negocio, o quien genera). Sin su ficha, los configurados de siempre.
      pie: pieConLaAsesora(config.pie, asesoraDoc),
      firma: firmaConLaAsesora(config.firma, asesoraDoc),
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

  const propsPDF: CotizacionPDFProps = {
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
      // H8 (QA 2026-10-29): si alguna línea se costeó en otra moneda, la tarjeta «Tasa de cambio».
      terminos_condiciones: terminosConCondicionVisa(terminosConTasaDeCambio((cot as unknown as CotizacionNuevosCampos).terminos_condiciones, items), conVisaEnTramite),
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
    // Reglas de margen (2026-10-27): los descuentos sobre el total, con su descripción. Los del
    // TOTAL: los de la Recomendada con tarifas, los de la cascada vigente sin ellas.
    // Sin reglas la llave no aparece: las props son las de siempre (igualdad C0).
    ...((bloques?.find(b => b.esPrincipal)?.reglas ?? reglasVigente)?.descuentos.length
      ? { descuentosTotal: (bloques?.find(b => b.esPrincipal)?.reglas ?? reglasVigente)!.descuentos }
      : {}),
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
    ...(entradaPlan ? { asiPuedesPagar: entradaPlan } : {}),
  }

  // Una plantilla que se COMPONE (Trappvel: renderiza, mide el PDF y recompone para que la
  // última hoja trabaje) se entrega por su compositor; las demás se renderizan una vez.
  const compositor = compositorDePlantilla(templateSlug)
  let buffer: Buffer | null = null
  let renderedVia: 'react-pdf' | 'chromium' = 'react-pdf'
  let avisoFormato: string | null = null
  // Regla de fotos (2026-10-29): los hoteles cuya ficha sale con menos de 3 fotos. No bloquea.
  let avisosFotos: string[] = []
  if (motorHtml) {
    // Si el motor nuevo falla (Chromium, tiempo, una foto rota), el cliente no se queda sin
    // cotización: sale la de @react-pdf y quien descarga lo sabe.
    try {
      const hecho = await propuestaConMotorHtml(supabase, {
        props: propsPDF,
        servicios: serviciosDoc,
        lugaresDeOpcionales: lugaresOpcionalesDoc,
        opcionales: opcionalesDoc,
        fichasDeHotel,
        documentoCliente: (cot as unknown as Record<string, unknown>).documento_cliente,
        cliente: clienteDelNegocio,
        numeroDeViajeros: numeroDeViajerosDoc,
        // El botón de apartar abre el WhatsApp de la MISMA asesora que firma (punto 5).
        staffId: staffDeLaAsesora,
        workspaceId,
        marca: ws?.name ?? 'Mi Empresa',
        logoUrl: ws?.logo_url ?? null,
      })
      buffer = hecho.pdf
      avisosFotos = hecho.avisosFotos
      renderedVia = 'chromium'
    } catch (e) {
      console.error('[cotizacion-pdf] el motor html falló; sale el formato anterior:', e instanceof Error ? e.message : e)
      avisoFormato = AVISO_FORMATO_ANTERIOR
    }
  }
  if (!buffer) {
    buffer = compositor
      ? await compositor(propsPDF)
      // renderToBuffer espera DocumentElement; nuestro createElement lo produce correctamente en runtime
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : await renderToBuffer(createElement(plantillaPropia ?? CotizacionPDF, propsPDF) as any)
  }
  // La clave solo existe con el motor encendido: apagado, la respuesta es la de siempre.
  const conFotos = avisosFotos.length > 0 ? { avisosFotos } : {}
  const conMotor = motorHtml ? { avisoFormato, ...conFotos } : {}

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
      ...conMotor,
      renderedVia,
    }
  }

  const base64 = Buffer.from(buffer).toString('base64')
  const filename = `${cot.consecutivo}.pdf`
  // Vista previa: el documento, sin guardarlo ni registrarlo.
  if (vistaPrevia) return { success: true, pdf: base64, filename, fiscal, vistaPrevia: true as const, renderedVia, ...conFotos }

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
    // H33: ver el comentario del camino externo.
    envioRegistrado: false,
    ...conMotor,
    renderedVia,
  }
}

const AVISO_FORMATO_ANTERIOR =
  'La propuesta salió con el formato anterior: el formato nuevo no se pudo generar esta vez. Si se repite, avísale a MéTRIK.'

/**
 * El PDF con el motor `html` (`src/lib/pdf/html/propuesta-html.ts`). Se carga a demanda: sharp,
 * puppeteer y las fuentes solo los paga el workspace que lo tiene encendido.
 *
 * Lo que el modelo recibe además de las props de @react-pdf:
 *  · los servicios (traslados, trenes, actividades);
 *  · el anticipo que la asesora asignó (`documento_cliente.anticipo`); sin él, ninguna cifra;
 *  · quien genera, con su WhatsApp (`staff.phone_whatsapp`), para el botón de apartar.
 * Los nombres de los viajeros no van: ONE no los guarda todavía (decisión 1, queda la guarda).
 */
async function propuestaConMotorHtml(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  e: {
    props: CotizacionPDFProps
    servicios: ServicioDelDocumento[]
    lugaresDeOpcionales: LugarDeOpcional[]
    /** Cada plan opcional con su ciudad: la llave de su foto en la biblioteca. */
    opcionales: OpcionalDelDocumento[]
    /** La ficha fijada en la línea de cada hotel (`catalogo-propuesta.ts`). */
    fichasDeHotel?: ReadonlyMap<string, string>
    documentoCliente: unknown
    /** El contacto y la empresa del negocio: a quién va dirigida la propuesta. */
    cliente: ClienteDelNegocio
    /** S3 · cuántos viajan; `null` = no se sabe (ustedes). */
    numeroDeViajeros?: number | null
    staffId: string | null
    workspaceId: string
    marca: string
    logoUrl: string | null
  },
): Promise<{ pdf: Buffer; avisosFotos: string[] }> {
  let asesora: { nombre: string | null; whatsapp: string | null } | null = null
  if (e.staffId) {
    const { data } = await supabase
      .from('staff')
      .select('full_name, phone_whatsapp')
      .eq('id', e.staffId)
      .maybeSingle()
    const fila = data as { full_name?: string | null; phone_whatsapp?: string | null } | null
    if (fila) asesora = { nombre: fila.full_name?.trim() || null, whatsapp: whatsappDesdeTelefono(fila.phone_whatsapp) }
  }
  // La biblioteca de fotos del espacio: ciudades sin foto en el banco, el perfil de cada hotel y
  // de cada plan opcional (por su llave o un alias). Sin filas o sin la migración, `null`: como antes.
  const { catalogoParaLaPropuesta } = await import('@/lib/fotos/catalogo-propuesta')
  const catalogo = await catalogoParaLaPropuesta(supabase, e.workspaceId, e.props, e.opcionales, e.fichasDeHotel ?? new Map()).catch(() => null)
  const { pdfDePropuestaHtml } = await import('@/lib/pdf/html/propuesta-html')
  const { pdf, medidas, avisosFotos } = await pdfDePropuestaHtml(
    {
      props: e.props,
      servicios: e.servicios,
      lugaresDeOpcionales: e.lugaresDeOpcionales,
      anticipo: leerAnticipo(e.documentoCliente),
      asesora,
      cliente: e.cliente,
      numeroDeViajeros: e.numeroDeViajeros ?? null,
    },
    {
      marca: e.marca,
      logoUrl: e.logoUrl,
      fotoDeCiudad: ciudad => fotosDeCiudad(ciudad).map(f => ({ url: f.ruta, rotulo: f.rotulo, credito: f.credito, foco: f.foco, proporcion: f.proporcion })),
      catalogo,
    },
  )
  console.info('[pdf-html] propuesta', JSON.stringify({ totalMs: medidas.totalMs, pdfBytes: medidas.pdfBytes, bloqueadas: medidas.peticionesBloqueadas.length }))
  return { pdf, avisosFotos: (avisosFotos ?? []).map(a => a.texto) }
}

/**
 * La asesora de la cotización (brief del 2026-10-29, punto 5): su ficha de staff y el correo de su
 * usuario. `null` sin ficha o sin nombre. El correo vive en Auth: si no se puede leer, va sin él.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function leerAsesoraDeLaCotizacion(supabase: any, staffIdAsesora: string | null): Promise<AsesoraDeLaCotizacion | null> {
  if (!staffIdAsesora) return null
  const { data } = await supabase
    .from('staff')
    .select('full_name, position, phone_whatsapp, profile_id')
    .eq('id', staffIdAsesora)
    .maybeSingle()
  const fila = data as { full_name?: string | null; position?: string | null; phone_whatsapp?: string | null; profile_id?: string | null } | null
  const nombre = fila?.full_name?.trim()
  if (!fila || !nombre) return null
  let correo: string | null = null
  if (fila.profile_id) {
    try {
      const { data: u } = await createServiceClient().auth.admin.getUserById(fila.profile_id)
      correo = u?.user?.email?.trim() || null
    } catch {
      correo = null
    }
  }
  return { nombre, cargo: fila.position?.trim() || null, correo, celular: fila.phone_whatsapp?.trim() || null }
}
