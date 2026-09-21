'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { renderToBuffer } from '@react-pdf/renderer'
import CotizacionPDF from '@/lib/pdf/cotizacion-pdf'
import type { CotizacionPDFProps } from '@/lib/pdf/cotizacion-props'
import { bloquesParaPDF } from '@/lib/cotizaciones/itinerarios-datos'
import { itemsQueAportanAlTotal } from '@/lib/cotizaciones/itinerarios'
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
import {
  PLANTILLA_POR_DEFECTO,
  plantillaCotizacionPropia,
} from '@/lib/pdf/plantillas-cotizacion'
import { vigenciaEnDias } from '@/lib/cotizaciones/condiciones-comerciales'
import { precioPorPasajeroDeItem, preciosPorPasajeroDelViaje } from '@/lib/cotizaciones/precio-pasajero-pdf'
import { calcularFiscal, type FiscalProfile } from '@/lib/fiscal/calculos'
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
   */
  const aportanAlTotal = new Set(
    itemsQueAportanAlTotal(
      items.filter(i => i.id).map(i => ({
        id: i.id as string,
        grupo: i.grupo ?? null,
        opcion_de: i.opcion_de ?? null,
        es_ajuste: i.es_ajuste ?? false,
        orden: i.orden ?? 0,
        dia_relativo: i.dia_relativo ?? null,
        entra_al_precio: i.entra_al_precio ?? null,
      })),
    ),
  )
  /** El ítem de cuadre entra siempre: su rama vive fuera de las ranuras. */
  const aporta = (i: ItemRow) => !i.id || aportanAlTotal.has(i.id) || i.es_ajuste === true

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
  const fiscal = calcularFiscal(valorNeto, vendorProfile, buyerProfile)

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
      const buffer = await renderViaService(templateSlug, payload)
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
  const itinerariosPDF = bloques
    ? bloques.map(b => ({
        nombre: b.nombre,
        esPrincipal: b.esPrincipal,
        precio: b.precio,
        items: b.itemIds
          .map(id => itemPorId.get(id))
          .filter((i): i is ItemRow => i !== undefined)
          .map(i => ({
            nombre: i.nombre ?? '',
            descripcion: i.descripcion ?? null,
            precio_venta: Number(i.precio_venta) || 0,
            descuento_porcentaje: descuentoVisible(i),
            cantidad: Number(i.cantidad) || 1,
            unidad: i.unidad ?? null,
            precioPorPasajero: precioPorPasajeroDeItem(i),
          })),
      }))
    : null

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
  const paraPlantilla = (i: ItemRow) => ({
    nombre: i.nombre ?? '',
    descripcion: i.descripcion ?? null,
    precio_venta: Number(i.precio_venta) || 0,
    descuento_porcentaje: descuentoVisible(i),
    cantidad: Number(i.cantidad) || 1,
    unidad: i.unidad ?? null,
    precioPorPasajero: precioPorPasajeroDeItem(i),
  })

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
  const itemsImpresos = idsDelPrincipal
    ? idsDelPrincipal.map(id => itemPorId.get(id)).filter((i): i is ItemRow => i !== undefined)
    : items.filter(aporta)

  let viajePDF: CotizacionPDFProps['viaje'] = null
  if (plantillaPropia && negocioInfo) {
    const { viaje: delNegocio } = await leerViajeDelNegocio(supabase, negocioInfo.id)
    const paraLectura = itemsImpresos.map(i => ({
      nombre: i.nombre ?? '',
      grupo: i.grupo ?? null,
      tarifa_pax: i.tarifa_pax,
    }))
    const vuelos = vuelosDeItems(paraLectura)
    const hoteles = hotelesDeItems(paraLectura)
    const cargosEnDestino = cargosEnDestinoDeItems(paraLectura)
    const config = leerConfigDocumentoViaje(ws?.config_extra)
    const viaje = {
      viajeros: delNegocio.composicion ? describirOcupacion(delNegocio.composicion, 'y') : null,
      destino: delNegocio.destino ?? destinoDeItinerario(vuelos, hoteles),
      fechas: rangoDeFechas(delNegocio.fechas.inicio, delNegocio.fechas.fin),
      duracion: duracionDelViaje(delNegocio.fechas.inicio, delNegocio.fechas.fin),
      presentacion: delNegocio.presentacion,
      // ⚠️ El banco de fotos por ciudad no existe todavía: aquí va `null` SIEMPRE, y la
      // plantilla está hecha para verse bien así. El día que exista, es esta línea.
      foto: null,
      vuelos,
      hoteles,
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
    preciosPorPasajero: preciosPorPasajeroDelViaje(itemsParaResumen),
    fiscal,
    negocio: negocioInfo ? { nombre: negocioInfo.nombre } : null,
    emisor,
    viaje: viajePDF,
  })

  // renderToBuffer espera DocumentElement; nuestro createElement lo produce correctamente en runtime
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await renderToBuffer(element as any)
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

  return {
    success: true,
    pdf: base64,
    filename,
    fiscal,
    archivoReferencia: externo.referencia,
    aviso: externo.aviso,
    avisosCobertura,
    renderedVia: 'react-pdf' as const,
  }
}
