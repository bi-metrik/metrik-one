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
  }
  vendedor: {
    nombre: string
    nit: string | null
    logo_url: string | null
    color_primario: string
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

const fmt = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

export default function CotizacionPDF({ cotizacion, empresa, vendedor, items, fiscal }: CotizacionPDFProps) {
  const pc = vendedor.color_primario || '#10B981'

  // Pre-calculate item totals
  const itemsWithTotals = items.map(item => {
    const descVal = Math.round(item.precio_venta * (item.descuento_porcentaje / 100))
    return { ...item, descuento_valor: descVal, neto: item.precio_venta - descVal }
  })

  const subtotalItems = itemsWithTotals.reduce((sum, i) => sum + i.precio_venta, 0)
  const totalDescuentoItems = itemsWithTotals.reduce((sum, i) => sum + i.descuento_valor, 0)
  const baseGravable = cotizacion.valor_total - (cotizacion.descuento_valor ?? 0)
  const ivaAmount = fiscal?.iva ?? 0
  const totalFinal = fiscal?.totalBruto ?? (baseGravable + ivaAmount)

  const s = StyleSheet.create({
    page: { padding: 40, fontSize: 10, fontFamily: 'Helvetica', color: '#1a1a1a' },
    // Header band
    headerBand: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24, paddingBottom: 16, borderBottomWidth: 2, borderBottomColor: pc },
    logo: { width: 90, height: 45, objectFit: 'contain' },
    vendorName: { fontSize: 13, fontWeight: 'bold', color: '#1a1a1a' },
    vendorDetail: { fontSize: 8, color: '#666', marginTop: 2 },
    titleBlock: { alignItems: 'flex-end' },
    title: { fontSize: 22, fontWeight: 'bold', color: pc, letterSpacing: 2 },
    consecutivo: { fontSize: 10, color: '#666', marginTop: 2 },
    metaLabel: { fontSize: 8, color: '#999', marginTop: 2 },
    // Client section
    sectionLabel: { fontSize: 8, fontWeight: 'bold', color: pc, textTransform: 'uppercase', letterSpacing: 1, marginTop: 20, marginBottom: 6 },
    clientName: { fontSize: 11, fontWeight: 'bold' },
    clientDetail: { fontSize: 9, color: '#666', marginTop: 1 },
    // Description
    descText: { fontSize: 9, color: '#444', lineHeight: 1.6, marginTop: 4 },
    // Table
    tableHeader: { flexDirection: 'row', backgroundColor: pc, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 3 },
    thText: { fontSize: 8, fontWeight: 'bold', color: '#ffffff', textTransform: 'uppercase' },
    tableRow: { flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 10, borderBottomWidth: 0.5, borderBottomColor: '#e5e7eb' },
    tableRowAlt: { backgroundColor: '#fafafa' },
    cellName: { width: '50%' },
    cellPrice: { width: '20%', textAlign: 'right' },
    cellDiscount: { width: '15%', textAlign: 'right' },
    cellTotal: { width: '15%', textAlign: 'right' },
    itemName: { fontSize: 10, fontWeight: 'bold' },
    itemDesc: { fontSize: 8, color: '#666', marginTop: 2 },
    itemValue: { fontSize: 9 },
    itemDiscount: { fontSize: 9, color: '#ef4444' },
    itemTotal: { fontSize: 9, fontWeight: 'bold' },
    // Totals
    totalsBox: { marginTop: 12, alignSelf: 'flex-end', width: '50%' },
    totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
    totalLabel: { fontSize: 9, color: '#666' },
    totalValue: { fontSize: 9, fontWeight: 'bold' },
    totalFinalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, marginTop: 4, borderTopWidth: 2, borderTopColor: pc },
    totalFinalLabel: { fontSize: 12, fontWeight: 'bold', color: '#1a1a1a' },
    totalFinalValue: { fontSize: 14, fontWeight: 'bold', color: pc },
    // IVA note
    ivaNote: { fontSize: 8, color: '#999', textAlign: 'right', marginTop: 4 },
    // Conditions
    condBox: { marginTop: 24, padding: 12, backgroundColor: '#f9fafb', borderRadius: 4, borderLeftWidth: 3, borderLeftColor: pc },
    condTitle: { fontSize: 9, fontWeight: 'bold', color: '#333', marginBottom: 4 },
    condText: { fontSize: 8, color: '#666', lineHeight: 1.6 },
    // Footer
    footer: { position: 'absolute', bottom: 24, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 0.5, borderTopColor: '#e5e7eb', paddingTop: 8 },
    footerText: { fontSize: 7, color: '#999' },
  })

  const hasItemDiscounts = itemsWithTotals.some(i => i.descuento_porcentaje > 0)

  return (
    <Document>
      <Page size="LETTER" style={s.page}>
        {/* ── Header ── */}
        <View style={s.headerBand}>
          <View>
            {vendedor.logo_url && <Image src={vendedor.logo_url} style={s.logo} />}
            <Text style={[s.vendorName, { marginTop: vendedor.logo_url ? 4 : 0 }]}>{vendedor.nombre}</Text>
            {vendedor.nit && <Text style={s.vendorDetail}>NIT: {vendedor.nit}</Text>}
          </View>
          <View style={s.titleBlock}>
            <Text style={s.title}>COTIZACIÓN</Text>
            <Text style={s.consecutivo}>{cotizacion.consecutivo}</Text>
            {cotizacion.fecha_envio && (
              <Text style={s.metaLabel}>Fecha: {new Date(cotizacion.fecha_envio).toLocaleDateString('es-CO')}</Text>
            )}
            {cotizacion.fecha_validez && (
              <Text style={s.metaLabel}>Válida hasta: {new Date(cotizacion.fecha_validez).toLocaleDateString('es-CO')}</Text>
            )}
          </View>
        </View>

        {/* ── Cliente ── */}
        <Text style={s.sectionLabel}>Cliente</Text>
        <Text style={s.clientName}>{empresa.nombre}</Text>
        {empresa.nit && <Text style={s.clientDetail}>NIT: {empresa.nit}</Text>}
        {empresa.contacto_nombre && <Text style={s.clientDetail}>Contacto: {empresa.contacto_nombre}</Text>}
        {empresa.contacto_email && <Text style={s.clientDetail}>{empresa.contacto_email}</Text>}

        {/* ── Descripción general ── */}
        {cotizacion.descripcion && (
          <>
            <Text style={s.sectionLabel}>Descripción</Text>
            <Text style={s.descText}>{cotizacion.descripcion}</Text>
          </>
        )}

        {/* ── Tabla de items ── */}
        {items.length > 0 && (
          <>
            <Text style={s.sectionLabel}>Detalle</Text>
            {/* Table header */}
            <View style={s.tableHeader}>
              <View style={s.cellName}><Text style={s.thText}>Concepto</Text></View>
              <View style={s.cellPrice}><Text style={[s.thText, { textAlign: 'right' }]}>Valor</Text></View>
              {hasItemDiscounts && (
                <View style={s.cellDiscount}><Text style={[s.thText, { textAlign: 'right' }]}>Dto.</Text></View>
              )}
              <View style={hasItemDiscounts ? s.cellTotal : { width: '15%', textAlign: 'right' }}>
                <Text style={[s.thText, { textAlign: 'right' }]}>Neto</Text>
              </View>
            </View>
            {/* Table rows */}
            {itemsWithTotals.map((item, i) => (
              <View key={i} style={[s.tableRow, i % 2 === 1 ? s.tableRowAlt : {}]}>
                <View style={s.cellName}>
                  <Text style={s.itemName}>{item.nombre}</Text>
                  {item.descripcion && <Text style={s.itemDesc}>{item.descripcion}</Text>}
                </View>
                <View style={s.cellPrice}>
                  <Text style={s.itemValue}>{fmt(item.precio_venta)}</Text>
                </View>
                {hasItemDiscounts && (
                  <View style={s.cellDiscount}>
                    {item.descuento_porcentaje > 0 ? (
                      <Text style={s.itemDiscount}>-{item.descuento_porcentaje}%</Text>
                    ) : (
                      <Text style={s.itemValue}>—</Text>
                    )}
                  </View>
                )}
                <View style={hasItemDiscounts ? s.cellTotal : { width: '15%', textAlign: 'right' }}>
                  <Text style={s.itemTotal}>{fmt(item.neto)}</Text>
                </View>
              </View>
            ))}
          </>
        )}

        {/* ── Totales ── */}
        <View style={s.totalsBox}>
          {items.length > 0 && totalDescuentoItems > 0 && (
            <>
              <View style={s.totalRow}>
                <Text style={s.totalLabel}>Subtotal items</Text>
                <Text style={s.totalValue}>{fmt(subtotalItems)}</Text>
              </View>
              <View style={s.totalRow}>
                <Text style={s.totalLabel}>Descuento items</Text>
                <Text style={[s.totalValue, { color: '#ef4444' }]}>-{fmt(totalDescuentoItems)}</Text>
              </View>
            </>
          )}

          <View style={s.totalRow}>
            <Text style={s.totalLabel}>Subtotal</Text>
            <Text style={s.totalValue}>{fmt(cotizacion.valor_total)}</Text>
          </View>

          {(cotizacion.descuento_valor ?? 0) > 0 && (
            <View style={s.totalRow}>
              <Text style={s.totalLabel}>Descuento general ({cotizacion.descuento_porcentaje ?? 0}%)</Text>
              <Text style={[s.totalValue, { color: '#ef4444' }]}>-{fmt(cotizacion.descuento_valor ?? 0)}</Text>
            </View>
          )}

          {ivaAmount > 0 && (
            <View style={s.totalRow}>
              <Text style={s.totalLabel}>IVA (19%)</Text>
              <Text style={s.totalValue}>{fmt(ivaAmount)}</Text>
            </View>
          )}

          <View style={s.totalFinalRow}>
            <Text style={s.totalFinalLabel}>Total</Text>
            <Text style={s.totalFinalValue}>{fmt(totalFinal)}</Text>
          </View>

          {ivaAmount === 0 && (
            <Text style={s.ivaNote}>* Precios no incluyen IVA</Text>
          )}
        </View>

        {/* ── Condiciones y notas ── */}
        {(cotizacion.condiciones_pago || cotizacion.notas) && (
          <View style={s.condBox}>
            {cotizacion.condiciones_pago && (
              <>
                <Text style={s.condTitle}>Condiciones de pago</Text>
                <Text style={s.condText}>{cotizacion.condiciones_pago}</Text>
              </>
            )}
            {cotizacion.notas && (
              <>
                <Text style={[s.condTitle, { marginTop: cotizacion.condiciones_pago ? 8 : 0 }]}>Observaciones</Text>
                <Text style={s.condText}>{cotizacion.notas}</Text>
              </>
            )}
          </View>
        )}

        {/* ── Footer ── */}
        <View style={s.footer}>
          <Text style={s.footerText}>{vendedor.nombre}</Text>
          <Text style={s.footerText}>{cotizacion.consecutivo} · {new Date().toLocaleDateString('es-CO')}</Text>
          <Text style={s.footerText}>Generado con MéTRIK one</Text>
        </View>
      </Page>
    </Document>
  )
}
