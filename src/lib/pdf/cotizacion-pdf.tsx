import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer'

interface CotizacionPDFProps {
  cotizacion: {
    consecutivo: string
    descripcion: string | null
    valor_total: number
    modo: string
    fecha_envio: string | null
    fecha_validez: string | null
    condiciones_pago: string | null
    notas: string | null
    descuento_porcentaje: number | null
    descuento_valor: number | null
  }
  empresa: {
    nombre: string
    nit: string | null
    contacto_nombre: string | null
    contacto_email: string | null
    telefono: string | null
    direccion: string | null
    ciudad: string | null
  }
  vendedor: {
    nombre: string
    razon_social: string | null
    nit: string | null
    logo_url: string | null
    color_primario: string
    telefono: string | null
    email: string | null
    direccion: string | null
    ciudad: string | null
  }
  items: {
    nombre: string
    descripcion: string | null
    precio_venta: number
    descuento_porcentaje: number
  }[]
  fiscal: {
    subtotal: number
    iva: number
    reteFuente: number
    reteICA: number
    reteIVA: number
    totalBruto: number
    totalRetenciones: number
    teQueda: number
  } | null
}

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

export default function CotizacionPDF({ cotizacion, empresa, vendedor, items, fiscal }: CotizacionPDFProps) {
  const pc = vendedor.color_primario || '#10B981'
  const pcLight = lighten(pc, 0.08)

  // Pre-calculate item totals
  const itemsWithTotals = items.map(item => {
    const descVal = Math.round(item.precio_venta * (item.descuento_porcentaje / 100))
    return { ...item, descuento_valor: descVal, neto: item.precio_venta - descVal }
  })

  const hasItemDiscounts = itemsWithTotals.some(i => i.descuento_porcentaje > 0)
  const subtotalItems = itemsWithTotals.reduce((sum, i) => sum + i.precio_venta, 0)
  const totalDescuentoItems = itemsWithTotals.reduce((sum, i) => sum + i.descuento_valor, 0)
  const baseGravable = cotizacion.valor_total - (cotizacion.descuento_valor ?? 0)
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
              <Image
                src={vendedor.logo_url}
                style={{ width: 100, height: 50, objectFit: 'contain', marginBottom: 4 }}
              />
            )}
            <Text style={{ fontSize: 14, fontFamily: 'Helvetica-Bold', color: '#111827' }}>
              {vendedor.nombre}
            </Text>
            {showRazonSocial && (
              <Text style={{ fontSize: 9, color: '#6B7280', marginTop: 1 }}>
                {vendedor.razon_social}
              </Text>
            )}
            {vendedor.nit && (
              <Text style={{ fontSize: 8, color: '#6B7280', marginTop: 1 }}>
                NIT: {vendedor.nit}
              </Text>
            )}
            {vendorContactLine && (
              <Text style={{ fontSize: 8, color: '#6B7280', marginTop: 1 }}>
                {vendorContactLine}
              </Text>
            )}
            {vendorAddressLine && (
              <Text style={{ fontSize: 8, color: '#6B7280', marginTop: 1 }}>
                {vendorAddressLine}
              </Text>
            )}
          </View>

          {/* Right: title block */}
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 11, fontFamily: 'Helvetica-Bold', color: '#6B7280', textTransform: 'uppercase', letterSpacing: 3 }}>
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
        {items.length > 0 && (
          <View style={{ marginTop: 20 }}>
            <Text style={{ fontSize: 7, fontFamily: 'Helvetica-Bold', color: pc, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 6 }}>
              DETALLE
            </Text>

            {/* Table header */}
            <View style={{ flexDirection: 'row', borderBottomWidth: 1.5, borderBottomColor: '#E5E7EB', paddingVertical: 6 }}>
              <Text style={{ width: '5%', fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: '#6B7280', textTransform: 'uppercase', letterSpacing: 1 }}>
                #
              </Text>
              <Text style={{ width: hasItemDiscounts ? '50%' : '60%', fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: '#6B7280', textTransform: 'uppercase', letterSpacing: 1 }}>
                Concepto
              </Text>
              {hasItemDiscounts && (
                <>
                  <Text style={{ width: '20%', fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: '#6B7280', textTransform: 'uppercase', letterSpacing: 1, textAlign: 'right' }}>
                    Valor
                  </Text>
                  <Text style={{ width: '10%', fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: '#6B7280', textTransform: 'uppercase', letterSpacing: 1, textAlign: 'right' }}>
                    Dcto.
                  </Text>
                </>
              )}
              <Text style={{ width: hasItemDiscounts ? '15%' : '35%', fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: '#6B7280', textTransform: 'uppercase', letterSpacing: 1, textAlign: 'right' }}>
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
                <View style={{ width: hasItemDiscounts ? '50%' : '60%' }}>
                  <Text style={{ fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: '#111827' }}>
                    {item.nombre}
                  </Text>
                  {item.descripcion && (
                    <Text style={{ fontSize: 8, color: '#6B7280', marginTop: 2 }}>
                      {item.descripcion}
                    </Text>
                  )}
                </View>
                {hasItemDiscounts && (
                  <>
                    <Text style={{ width: '20%', fontSize: 9, color: '#374151', textAlign: 'right' }}>
                      {fmt(item.precio_venta)}
                    </Text>
                    <Text style={{ width: '10%', fontSize: 9, color: item.descuento_porcentaje > 0 ? '#DC2626' : '#374151', textAlign: 'right' }}>
                      {item.descuento_porcentaje > 0 ? `-${item.descuento_porcentaje}%` : '\u2014'}
                    </Text>
                  </>
                )}
                <Text style={{ width: hasItemDiscounts ? '15%' : '35%', fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#111827', textAlign: 'right' }}>
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
                <Text style={{ fontSize: 9, color: '#6B7280' }}>Subtotal items</Text>
                <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#111827' }}>{fmt(subtotalItems)}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
                <Text style={{ fontSize: 9, color: '#6B7280' }}>Descuento items</Text>
                <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#DC2626' }}>-{fmt(totalDescuentoItems)}</Text>
              </View>
            </>
          )}

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
            <Text style={{ fontSize: 9, color: '#6B7280' }}>Subtotal</Text>
            <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#111827' }}>{fmt(cotizacion.valor_total)}</Text>
          </View>

          {(cotizacion.descuento_valor ?? 0) > 0 && (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
              <Text style={{ fontSize: 9, color: '#6B7280' }}>Descuento ({cotizacion.descuento_porcentaje ?? 0}%)</Text>
              <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#DC2626' }}>-{fmt(cotizacion.descuento_valor ?? 0)}</Text>
            </View>
          )}

          {ivaAmount > 0 && (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
              <Text style={{ fontSize: 9, color: '#6B7280' }}>IVA (19%)</Text>
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
          <Text style={{ fontSize: 7, color: '#9CA3AF' }}>{new Date().toLocaleDateString('es-CO')}</Text>
        </View>

      </Page>
    </Document>
  )
}
