import { Document, Page, Text, View, StyleSheet, Image as PdfImage } from '@react-pdf/renderer'

import type { CotizacionPDFProps, PrecioPorPasajeroPDF } from './cotizacion-props'
import { PALETA } from '@/lib/marca/paleta'
import { tituloDeBloquePDF } from '@/lib/cotizaciones/itinerarios'
import { NOMBRE_TIPO } from '@/lib/cotizaciones/tarifa-pasajero'

// Color lightener (react-pdf no soporta rgba)
function lighten(hex: string, amount: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const nr = Math.round(r + (255 - r) * (1 - amount))
  const ng = Math.round(g + (255 - g) * (1 - amount))
  const nb = Math.round(b + (255 - b) * (1 - amount))
  return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`
}

// Fecha profesional
function formatFecha(dateStr: string): string {
  const d = new Date(dateStr)
  const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
  return `${d.getUTCDate()} de ${meses[d.getUTCMonth()]} de ${d.getUTCFullYear()}`
}

const fmt = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

/** Un item ya con su total de linea calculado. */
type ItemPDF = CotizacionPDFProps['items'][number]

/**
 * «Por pasajero: Adulto $1.907.063 · Niño $1.771.063» debajo de la descripción de la línea
 * (tarifa por pasajero, diseño §4). Sin reparto no imprime nada: la línea se cobra por el
 * grupo, como siempre.
 */
function PorPasajero({ precios, color }: { precios?: PrecioPorPasajeroPDF; color: string }) {
  if (!precios || precios.length === 0) return null
  return (
    <Text style={{ fontSize: 8, color, marginTop: 2 }}>
      {'Por pasajero: ' + precios.map(p => `${NOMBRE_TIPO[p.tipo]} ${fmt(p.precioUnitario)}`).join(' · ')}
    </Text>
  )
}

/**
 * La tabla de un BLOQUE de itinerario (R7).
 *
 * Es deliberadamente mas simple que la tabla plana de abajo: dentro de un itinerario
 * el cliente compara COMPONENTES, no descuentos de linea. Meterle las mismas seis
 * columnas a tres tablas seguidas hace ilegible justo la comparacion que el
 * documento existe para permitir.
 */
function TablaDeItems({ items, pc, pcLight }: { items: ItemPDF[]; pc: string; pcLight: string }) {
  return (
    <View>
      {items.map((item, i) => {
        const cant = item.cantidad ?? 1
        // Ver la nota de `valorAdicionales`: ausente vale 0 y nada cambia.
        const neto = Math.round(item.precio_venta * cant) + (item.valorAdicionales ?? 0)
        // La unidad se imprime solo cuando la linea la declara: «3 noches» dice mas
        // que «3», y un «3 und» inventado dice menos que nada.
        const unidad = (item.unidad ?? '').trim()
        return (
          <View
            key={i}
            style={{
              flexDirection: 'row',
              paddingVertical: 6,
              borderBottomWidth: 0.5,
              borderBottomColor: '#E5E7EB',
              backgroundColor: i % 2 === 1 ? pcLight : undefined,
              alignItems: 'flex-start',
            }}
          >
            <View style={{ width: '70%', paddingLeft: 4 }}>
              <Text style={{ fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: '#111827' }}>
                {item.nombre}
              </Text>
              {item.descripcion && (
                <Text style={{ fontSize: 8, color: PALETA.tintaSuave, marginTop: 2 }}>
                  {item.descripcion}
                </Text>
              )}
              <PorPasajero precios={item.precioPorPasajero} color="#374151" />
            </View>
            <Text style={{ width: '12%', fontSize: 9, color: '#374151', textAlign: 'right' }}>
              {cant > 1 ? (unidad ? `${cant} ${unidad}` : String(cant)) : (unidad || '')}
            </Text>
            <Text style={{ width: '18%', fontSize: 9, fontFamily: 'Helvetica-Bold', color: pc, textAlign: 'right', paddingRight: 4 }}>
              {fmt(neto)}
            </Text>
          </View>
        )
      })}
    </View>
  )
}

export default function CotizacionPDF({ cotizacion, empresa, vendedor, items, fiscal, itinerarios, dias, sugeridos, itemsSinDia, preciosPorPasajero }: CotizacionPDFProps) {
  const pc = vendedor.color_primario || PALETA.acento
  const pcLight = lighten(pc, 0.08)

  /**
   * ¿El documento se organiza por días?
   *
   * El interruptor es que LLEGUEN días, no un flag. Sin un solo día asignado esto es
   * `false` y todo lo de abajo se comporta exactamente como antes de este frente —que
   * es la regla 1 de la reunión del 2026-09-14, y lo que deja intactos a Termotech,
   * Arca y WMC.
   */
  const bloquesDia = (dias ?? []).filter(d => d.items.length > 0)
  const porDias = bloquesDia.length > 0
  const restoSinDia = porDias ? (itemsSinDia ?? []) : []
  const sugeridosVisibles = sugeridos ?? []

  // R7 · los bloques que el documento imprime. Con UNO solo (o ninguno) se cae al
  // camino de siempre: un cliente con una sola opcion no necesita que se la
  // presenten como una eleccion entre varias.
  const bloques = (itinerarios ?? []).map((it, i) => ({
    titulo: tituloDeBloquePDF(it.nombre, it.esPrincipal, i + 1),
    total: it.precio,
    items: it.items,
  }))

  // Pre-calculate item totals
  const hasQuantity = items.some(i => (i.cantidad ?? 1) > 1)
  const itemsWithTotals = items.map(item => {
    const cant = item.cantidad ?? 1
    // Ver la nota de `valorAdicionales`: ausente vale 0 y nada cambia.
    const lineTotal = Math.round(item.precio_venta * cant) + (item.valorAdicionales ?? 0)
    const descVal = Math.round(lineTotal * (item.descuento_porcentaje / 100))
    return { ...item, lineTotal, descuento_valor: descVal, neto: lineTotal - descVal }
  })

  const hasItemDiscounts = itemsWithTotals.some(i => i.descuento_porcentaje > 0)
  const subtotalItems = itemsWithTotals.reduce((sum, i) => sum + i.lineTotal, 0)
  const totalDescuentoItems = itemsWithTotals.reduce((sum, i) => sum + i.descuento_valor, 0)
  // Lo que suma la columna que ve el cliente. Es también el subtotal ANTES del
  // descuento comercial de cabecera, y cuadra con la plataforma porque
  // `recalcularTotales` redondea el precio de cada línea al peso por unidad.
  const subtotalImpreso = itemsWithTotals.reduce((sum, i) => sum + i.neto, 0)
  // `valor_total` YA trae el descuento comercial aplicado: `recalcularTotales` guarda
  // ahí el precio final de la cascada y `descuento_valor` al lado como el monto.
  // Restarlo otra vez enseñaba una base más baja que la del sistema y liquidaba el
  // IVA sobre ella. Sin descuento no se notaba, por eso llevaba tiempo ahí.
  const baseGravable = cotizacion.valor_total
  const ivaAmount = fiscal?.iva ?? 0
  const totalFinal = fiscal?.totalBruto ?? (baseGravable + ivaAmount)

  const vendorContactLine = [vendedor.telefono, vendedor.email].filter(Boolean).join(' | ')
  const vendorAddressLine = [vendedor.direccion, vendedor.ciudad].filter(Boolean).join(', ')
  const showRazonSocial = vendedor.razon_social && vendedor.razon_social !== vendedor.nombre

  const s = StyleSheet.create({
    page: {
      paddingTop: 48,
      paddingBottom: 60,
      paddingHorizontal: 48,
      fontSize: 10,
      fontFamily: 'Helvetica',
      color: '#111827',
    },
  })

  return (
    <Document>
      <Page size="LETTER" style={s.page}>

        {/* ── S1. HEADER BAND ── */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          {/* Left: vendor info */}
          <View style={{ maxWidth: '55%' }}>
            {vendedor.logo_url && (
              <PdfImage
                src={vendedor.logo_url}
                style={{ width: 100, height: 50, objectFit: 'contain', marginBottom: 4 }}
              />
            )}
            <Text style={{ fontSize: 14, fontFamily: 'Helvetica-Bold', color: '#111827' }}>
              {vendedor.nombre}
            </Text>
            {showRazonSocial && (
              <Text style={{ fontSize: 9, color: PALETA.tintaSuave, marginTop: 1 }}>
                {vendedor.razon_social}
              </Text>
            )}
            {vendedor.nit && (
              <Text style={{ fontSize: 8, color: PALETA.tintaSuave, marginTop: 1 }}>
                NIT: {vendedor.nit}
              </Text>
            )}
            {vendorContactLine && (
              <Text style={{ fontSize: 8, color: PALETA.tintaSuave, marginTop: 1 }}>
                {vendorContactLine}
              </Text>
            )}
            {vendorAddressLine && (
              <Text style={{ fontSize: 8, color: PALETA.tintaSuave, marginTop: 1 }}>
                {vendorAddressLine}
              </Text>
            )}
          </View>

          {/* Right: title block */}
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 11, fontFamily: 'Helvetica-Bold', color: PALETA.tintaSuave, textTransform: 'uppercase', letterSpacing: 3 }}>
              COTIZACION
            </Text>
            <Text style={{ fontSize: 16, fontFamily: 'Helvetica-Bold', color: '#111827', marginTop: 2 }}>
              {cotizacion.consecutivo}
            </Text>
            {cotizacion.fecha_envio && (
              <Text style={{ fontSize: 9, color: '#374151', marginTop: 2 }}>
                Fecha: {formatFecha(cotizacion.fecha_envio)}
              </Text>
            )}
          </View>
        </View>

        {/* Separator */}
        <View style={{ borderBottomWidth: 1, borderBottomColor: pc, marginTop: 12, marginBottom: 28 }} />

        {/* ── S2. PARA (datos del cliente) ── */}
        <Text style={{ fontSize: 7, fontFamily: 'Helvetica-Bold', color: pc, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 6 }}>
          PARA
        </Text>
        <Text style={{ fontSize: 12, fontFamily: 'Helvetica-Bold', color: '#111827' }}>
          {empresa.nombre}
        </Text>
        {empresa.nit && (
          <Text style={{ fontSize: 9, color: '#374151', marginTop: 1 }}>NIT: {empresa.nit}</Text>
        )}
        {empresa.contacto_nombre && (
          <Text style={{ fontSize: 9, color: '#374151', marginTop: 1 }}>Att: {empresa.contacto_nombre}</Text>
        )}
        {empresa.contacto_email && (
          <Text style={{ fontSize: 9, color: '#374151', marginTop: 1 }}>{empresa.contacto_email}</Text>
        )}
        {empresa.telefono && (
          <Text style={{ fontSize: 9, color: '#374151', marginTop: 1 }}>{empresa.telefono}</Text>
        )}
        {(empresa.direccion || empresa.ciudad) && (
          <Text style={{ fontSize: 9, color: '#374151', marginTop: 1 }}>
            {[empresa.direccion, empresa.ciudad].filter(Boolean).join(', ')}
          </Text>
        )}

        {/* ── S3. PRESENTACION (condicional) ── */}
        {cotizacion.descripcion && (
          <Text style={{ fontSize: 9.5, color: '#374151', lineHeight: 1.7, marginTop: 20 }}>
            {cotizacion.descripcion}
          </Text>
        )}

        {/* ── S4. TABLA DE CONCEPTOS ── */}
        {/* R7 · con itinerarios, un bloque por cada uno que va en la propuesta, el
            principal primero. Sin itinerarios se imprime la lista plana de siempre:
            el corte es que el arreglo no llegue, no un flag. */}
        {bloques.length > 1 && (
          <View style={{ marginTop: 20 }}>
            {bloques.map((bloque, b) => (
              <View key={b} style={{ marginBottom: 14 }} wrap={false}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 4 }}>
                  <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: pc, textTransform: 'uppercase', letterSpacing: 1.2 }}>
                    {bloque.titulo}
                  </Text>
                  <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold', color: '#111827' }}>
                    {fmt(bloque.total)}
                  </Text>
                </View>
                <TablaDeItems items={bloque.items} pc={pc} pcLight={pcLight} />
              </View>
            ))}
            {/* Sin esta linea el cliente ve tres precios y un total, y no sabe cual
                esta aceptando. El total de abajo es el del principal: es el que
                `recalcularTotales` guardo en `valor_total`. */}
            <Text style={{ fontSize: 8, color: PALETA.tintaSuave, marginTop: 2 }}>
              El total y los impuestos de abajo corresponden a la opcion marcada como recomendada.
              Las demas son alternativas con el precio indicado en su encabezado.
            </Text>
          </View>
        )}

        {/* ── El itinerario DÍA POR DÍA ──
            Reemplaza la tabla plana cuando alguien asignó al menos un día. No es una
            sección extra: es la MISMA lista repartida, así que la suma no cambia.
            Los vuelos y hoteles (y lo que no declara grupo) van en su propio bloque
            debajo, porque son parte del viaje aunque no caigan en un día. */}
        {bloques.length <= 1 && porDias && (
          <View style={{ marginTop: 20 }}>
            <Text style={{ fontSize: 7, fontFamily: 'Helvetica-Bold', color: pc, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 6 }}>
              ITINERARIO
            </Text>
            {bloquesDia.map(bloque => (
              <View key={bloque.dia} style={{ marginBottom: 12 }} wrap={false}>
                <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: pc, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 4 }}>
                  {`Día ${bloque.dia}`}
                </Text>
                <TablaDeItems items={bloque.items} pc={pc} pcLight={pcLight} />
              </View>
            ))}
            {restoSinDia.length > 0 && (
              <View style={{ marginBottom: 12 }} wrap={false}>
                <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: pc, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 4 }}>
                  Incluye también
                </Text>
                <TablaDeItems items={restoSinDia} pc={pc} pcLight={pcLight} />
              </View>
            )}
          </View>
        )}

        {bloques.length <= 1 && !porDias && items.length > 0 && (
          <View style={{ marginTop: 20 }}>
            <Text style={{ fontSize: 7, fontFamily: 'Helvetica-Bold', color: pc, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 6 }}>
              DETALLE
            </Text>

            {/* Table header */}
            <View style={{ flexDirection: 'row', borderBottomWidth: 1.5, borderBottomColor: '#E5E7EB', paddingVertical: 6 }}>
              <Text style={{ width: '5%', fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: PALETA.tintaSuave, textTransform: 'uppercase', letterSpacing: 1 }}>
                #
              </Text>
              <Text style={{ width: hasItemDiscounts ? (hasQuantity ? '40%' : '50%') : (hasQuantity ? '47%' : '60%'), fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: PALETA.tintaSuave, textTransform: 'uppercase', letterSpacing: 1 }}>
                Concepto
              </Text>
              {hasQuantity && (
                <Text style={{ width: '8%', fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: PALETA.tintaSuave, textTransform: 'uppercase', letterSpacing: 1, textAlign: 'right' }}>
                  Cant.
                </Text>
              )}
              {hasItemDiscounts && (
                <>
                  <Text style={{ width: hasQuantity ? '17%' : '20%', fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: PALETA.tintaSuave, textTransform: 'uppercase', letterSpacing: 1, textAlign: 'right' }}>
                    Valor
                  </Text>
                  <Text style={{ width: '10%', fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: PALETA.tintaSuave, textTransform: 'uppercase', letterSpacing: 1, textAlign: 'right' }}>
                    Dcto.
                  </Text>
                </>
              )}
              <Text style={{ width: hasItemDiscounts ? (hasQuantity ? '20%' : '15%') : (hasQuantity ? '30%' : '35%'), fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: PALETA.tintaSuave, textTransform: 'uppercase', letterSpacing: 1, textAlign: 'right' }}>
                Subtotal
              </Text>
            </View>

            {/* Table rows */}
            {itemsWithTotals.map((item, i) => (
              <View
                key={i}
                style={{
                  flexDirection: 'row',
                  paddingVertical: 8,
                  borderBottomWidth: 0.5,
                  borderBottomColor: '#E5E7EB',
                  backgroundColor: i % 2 === 1 ? pcLight : undefined,
                  alignItems: 'flex-start',
                }}
              >
                <Text style={{ width: '5%', fontSize: 9, fontFamily: 'Helvetica-Bold', color: pc }}>
                  {i + 1}
                </Text>
                <View style={{ width: hasItemDiscounts ? (hasQuantity ? '40%' : '50%') : (hasQuantity ? '47%' : '60%') }}>
                  <Text style={{ fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: '#111827' }}>
                    {item.nombre}
                  </Text>
                  {item.descripcion && (
                    <Text style={{ fontSize: 8, color: PALETA.tintaSuave, marginTop: 2 }}>
                      {item.descripcion}
                    </Text>
                  )}
                  <PorPasajero precios={item.precioPorPasajero} color="#374151" />
                </View>
                {hasQuantity && (
                  <Text style={{ width: '8%', fontSize: 9, color: '#374151', textAlign: 'right' }}>
                    {(item.cantidad ?? 1) > 1 ? String(item.cantidad ?? 1) : ''}
                  </Text>
                )}
                {hasItemDiscounts && (
                  <>
                    <Text style={{ width: hasQuantity ? '17%' : '20%', fontSize: 9, color: '#374151', textAlign: 'right' }}>
                      {fmt(item.lineTotal)}
                    </Text>
                    <Text style={{ width: '10%', fontSize: 9, color: item.descuento_porcentaje > 0 ? '#DC2626' : '#374151', textAlign: 'right' }}>
                      {item.descuento_porcentaje > 0 ? `-${item.descuento_porcentaje}%` : '\u2014'}
                    </Text>
                  </>
                )}
                <Text style={{ width: hasItemDiscounts ? (hasQuantity ? '20%' : '15%') : (hasQuantity ? '30%' : '35%'), fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#111827', textAlign: 'right' }}>
                  {fmt(item.neto)}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* ── S5. RESUMEN FINANCIERO ── */}
        <View style={{ alignSelf: 'flex-end', width: '45%', marginTop: 16 }}>
          {/* Subtotal items (only if there are item-level discounts) */}
          {items.length > 0 && totalDescuentoItems > 0 && (
            <>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
                <Text style={{ fontSize: 9, color: PALETA.tintaSuave }}>Subtotal items</Text>
                <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#111827' }}>{fmt(subtotalItems)}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
                <Text style={{ fontSize: 9, color: PALETA.tintaSuave }}>Descuento items</Text>
                <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#DC2626' }}>-{fmt(totalDescuentoItems)}</Text>
              </View>
            </>
          )}

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
            <Text style={{ fontSize: 9, color: PALETA.tintaSuave }}>Subtotal</Text>
            <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#111827' }}>{fmt(subtotalImpreso)}</Text>
          </View>

          {(cotizacion.descuento_valor ?? 0) > 0 && (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
              <Text style={{ fontSize: 9, color: PALETA.tintaSuave }}>Descuento ({cotizacion.descuento_porcentaje ?? 0}%)</Text>
              <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#DC2626' }}>-{fmt(cotizacion.descuento_valor ?? 0)}</Text>
            </View>
          )}

          {ivaAmount > 0 && (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
              <Text style={{ fontSize: 9, color: PALETA.tintaSuave }}>IVA (19%)</Text>
              <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#111827' }}>{fmt(ivaAmount)}</Text>
            </View>
          )}

          {/* Total line */}
          <View style={{ borderTopWidth: 2, borderTopColor: pc, paddingTop: 10, marginTop: 4, flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 11, fontFamily: 'Helvetica-Bold', color: '#111827' }}>TOTAL</Text>
            <Text style={{ fontSize: 14, fontFamily: 'Helvetica-Bold', color: pc }}>{fmt(totalFinal)}</Text>
          </View>

          {ivaAmount === 0 && (
            <Text style={{ fontSize: 7.5, color: '#9CA3AF', textAlign: 'right', marginTop: 4 }}>
              * Los valores no incluyen IVA
            </Text>
          )}
        </View>

        {/* ── S5a. PRECIO POR PASAJERO (condicional) ──
            Por cada tipo, la suma del precio de cada componente que lo incluye. Solo existe
            cuando alguna línea trae precio por pasajero: sin eso no llega el arreglo y el
            documento no cambia. Lo que se cobra por el grupo se NOMBRA en el pie: sumar sin
            decirlo daría un precio por pasajero que no cubre el viaje entero. */}
        {preciosPorPasajero && preciosPorPasajero.filas.length > 0 && (
          <View style={{ alignSelf: 'flex-end', width: '45%', marginTop: 14 }} wrap={false}>
            <Text style={{ fontSize: 7, fontFamily: 'Helvetica-Bold', color: pc, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 4 }}>
              PRECIO POR PASAJERO
            </Text>
            {preciosPorPasajero.filas.map(f => (
              <View key={f.tipo} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}>
                <Text style={{ fontSize: 9, color: PALETA.tintaSuave }}>{NOMBRE_TIPO[f.tipo]}</Text>
                <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#111827' }}>{fmt(f.precioUnitario)}</Text>
              </View>
            ))}
            <Text style={{ fontSize: 7.5, color: '#9CA3AF', marginTop: 3 }}>
              {'Suma, por tipo de pasajero, el precio de cada componente que lo incluye'
                + ((cotizacion.descuento_porcentaje ?? 0) > 0 ? `, antes del descuento de ${cotizacion.descuento_porcentaje}%` : '')
                + (ivaAmount > 0 ? ', antes de IVA' : '')
                + '.'}
            </Text>
            {preciosPorPasajero.sinReparto.length > 0 && (
              <Text style={{ fontSize: 7.5, color: '#9CA3AF', marginTop: 2 }}>
                {`No incluye lo que se cobra por el grupo: ${preciosPorPasajero.sinReparto.join(', ')}.`}
              </Text>
            )}
          </View>
        )}

        {/* ── S5b. ACTIVIDADES ADICIONALES NO INCLUIDAS (condicional) ──
            El paquete de sugeridos. Va DESPUES del total a proposito: lo primero que
            el cliente tiene que poder leer es que esta pagando, y estas lineas no
            estan en esa cifra. Existe cuando la cotizacion se organiza por dias, o
            cuando alguien saco una sugerencia del precio a proposito: sin dias y sin
            ninguna linea fuera del precio, este bloque no aparece nunca. */}
        {sugeridosVisibles.length > 0 && (
          <View style={{ marginTop: 20, borderWidth: 0.5, borderColor: '#E5E7EB', borderRadius: 4, padding: 12 }}>
            <Text style={{ fontSize: 7, fontFamily: 'Helvetica-Bold', color: PALETA.tintaSuave, textTransform: 'uppercase', letterSpacing: 1.5 }}>
              ACTIVIDADES ADICIONALES NO INCLUIDAS
            </Text>
            <Text style={{ fontSize: 8, color: PALETA.tintaSuave, marginTop: 3, marginBottom: 8 }}>
              Sugerencias para complementar el viaje. No están incluidas en el valor de arriba.
            </Text>
            {sugeridosVisibles.map((s, i) => {
              // El precio es INFORMATIVO. Se imprime solo si la linea lo declara: un
              // «$0» sobre una actividad que todavia no se ha costeado dice algo falso.
              const cant = s.cantidad ?? 1
              const valor = Math.round((s.precio_venta || 0) * cant)
              const unidad = (s.unidad ?? '').trim()
              return (
                <View
                  key={i}
                  style={{
                    flexDirection: 'row',
                    paddingVertical: 5,
                    borderTopWidth: i === 0 ? 0 : 0.5,
                    borderTopColor: '#E5E7EB',
                    alignItems: 'flex-start',
                  }}
                >
                  <View style={{ width: '72%' }}>
                    <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#111827' }}>
                      {s.nombre}
                    </Text>
                    {s.descripcion && (
                      <Text style={{ fontSize: 8, color: PALETA.tintaSuave, marginTop: 2 }}>
                        {s.descripcion}
                      </Text>
                    )}
                  </View>
                  <Text style={{ width: '28%', fontSize: 9, color: PALETA.tintaSuave, textAlign: 'right' }}>
                    {valor > 0 ? (unidad ? `${fmt(valor)} / ${unidad}` : fmt(valor)) : 'Consultar'}
                  </Text>
                </View>
              )
            })}
          </View>
        )}

        {/* ── S6. VALIDEZ (condicional) ── */}
        {cotizacion.fecha_validez && (
          <View style={{ marginTop: 20, backgroundColor: pcLight, borderRadius: 4, paddingHorizontal: 10, paddingVertical: 8, alignItems: 'center' }}>
            <Text style={{ fontSize: 9 }}>
              <Text style={{ fontFamily: 'Helvetica-Bold', color: '#111827' }}>
                {'Esta cotizacion es valida hasta el '}
              </Text>
              <Text style={{ fontFamily: 'Helvetica-Bold', color: pc }}>
                {formatFecha(cotizacion.fecha_validez)}
              </Text>
            </Text>
          </View>
        )}

        {/* ── S7. CONDICIONES (condicional) ── */}
        {(cotizacion.condiciones_pago || cotizacion.notas) && (
          <View style={{ marginTop: 20, borderLeftWidth: 3, borderLeftColor: pc, paddingLeft: 14, paddingVertical: 2 }}>
            {cotizacion.condiciones_pago && (
              <>
                <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#111827', marginBottom: 4 }}>
                  Forma de pago
                </Text>
                <Text style={{ fontSize: 8.5, color: '#374151', lineHeight: 1.6 }}>
                  {cotizacion.condiciones_pago}
                </Text>
              </>
            )}
            {cotizacion.notas && (
              <>
                <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#111827', marginTop: cotizacion.condiciones_pago ? 8 : 0 }}>
                  Observaciones
                </Text>
                <Text style={{ fontSize: 8.5, color: '#374151', lineHeight: 1.6, marginTop: 4 }}>
                  {cotizacion.notas}
                </Text>
              </>
            )}
          </View>
        )}

        {/* ── S8. CTA (condicional) ── */}
        {(vendedor.telefono || vendedor.email) && (
          <View style={{ marginTop: 16, borderTopWidth: 0.5, borderTopColor: '#E5E7EB', paddingTop: 12 }}>
            <Text style={{ fontSize: 9, color: '#374151' }}>
              Para confirmar esta cotizacion o resolver inquietudes:
            </Text>
            <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#111827', marginTop: 2 }}>
              {[vendedor.telefono, vendedor.email].filter(Boolean).join(' | ')}
            </Text>
          </View>
        )}

        {/* ── S9. FOOTER ── */}
        <View style={{
          position: 'absolute',
          bottom: 24,
          left: 48,
          right: 48,
          borderTopWidth: 0.5,
          borderTopColor: '#E5E7EB',
          paddingTop: 8,
          flexDirection: 'row',
          justifyContent: 'space-between',
        }}>
          <Text style={{ fontSize: 7, color: '#9CA3AF' }}>{vendedor.nombre}</Text>
          <Text style={{ fontSize: 7, color: '#9CA3AF' }}>{cotizacion.consecutivo}</Text>
          <Text style={{ fontSize: 7, color: '#9CA3AF' }}>{new Date().toLocaleDateString('es-CO', { timeZone: 'America/Bogota' })}</Text>
        </View>

      </Page>
    </Document>
  )
}
