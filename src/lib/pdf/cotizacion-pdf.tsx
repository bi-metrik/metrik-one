import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer'

// Styles
const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: 'Helvetica', color: '#1a1a1a' },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 30 },
  logo: { width: 80, height: 40, objectFit: 'contain' },
  title: { fontSize: 20, fontWeight: 'bold', color: '#10B981' },
  subtitle: { fontSize: 10, color: '#666', marginTop: 4 },
  sectionTitle: { fontSize: 12, fontWeight: 'bold', marginTop: 20, marginBottom: 8, borderBottomWidth: 1, borderBottomColor: '#e5e7eb', paddingBottom: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: 0.5, borderBottomColor: '#f3f4f6' },
  rowBold: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#1a1a1a', marginTop: 4 },
  label: { fontSize: 9, color: '#666' },
  value: { fontSize: 10, fontWeight: 'bold' },
  valueGreen: { fontSize: 14, fontWeight: 'bold', color: '#10B981' },
  footer: { position: 'absolute', bottom: 30, left: 40, right: 40, fontSize: 8, color: '#999', textAlign: 'center' },
  conditions: { marginTop: 20, padding: 12, backgroundColor: '#f9fafb', borderRadius: 4 },
  conditionText: { fontSize: 8, color: '#666', lineHeight: 1.6 },
  badge: { backgroundColor: '#10B981', color: '#fff', fontSize: 8, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
})

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
    subtotal: number
    rubros: { tipo: string; descripcion: string; cantidad: number; unidad: string; valor_unitario: number; valor_total: number }[]
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
  const primaryColor = vendedor.color_primario || '#10B981'

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            {vendedor.logo_url && (
              <Image src={vendedor.logo_url} style={styles.logo} />
            )}
            <Text style={{ fontSize: 12, fontWeight: 'bold', marginTop: vendedor.logo_url ? 4 : 0 }}>{vendedor.nombre}</Text>
            {vendedor.nit && <Text style={styles.label}>NIT: {vendedor.nit}</Text>}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.title, { color: primaryColor }]}>COTIZACION</Text>
            <Text style={styles.subtitle}>{cotizacion.consecutivo}</Text>
            {cotizacion.fecha_envio && (
              <Text style={styles.label}>Fecha: {new Date(cotizacion.fecha_envio).toLocaleDateString('es-CO')}</Text>
            )}
            {cotizacion.fecha_validez && (
              <Text style={styles.label}>Validez: {new Date(cotizacion.fecha_validez).toLocaleDateString('es-CO')}</Text>
            )}
          </View>
        </View>

        {/* Client */}
        <Text style={styles.sectionTitle}>Cliente</Text>
        <Text style={{ fontSize: 11, fontWeight: 'bold' }}>{empresa.nombre}</Text>
        {empresa.nit && <Text style={styles.label}>NIT: {empresa.nit}</Text>}
        {empresa.contacto_nombre && <Text style={styles.label}>Contacto: {empresa.contacto_nombre}</Text>}
        {empresa.contacto_email && <Text style={styles.label}>Email: {empresa.contacto_email}</Text>}

        {/* Description */}
        {cotizacion.descripcion && (
          <>
            <Text style={styles.sectionTitle}>Descripcion</Text>
            <Text style={{ fontSize: 9, lineHeight: 1.5 }}>{cotizacion.descripcion}</Text>
          </>
        )}

        {/* Items (detailed mode) */}
        {items.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Detalle</Text>
            {items.map((item, i) => (
              <View key={i} style={{ marginBottom: 8 }}>
                <View style={styles.row}>
                  <Text style={{ fontSize: 10, fontWeight: 'bold' }}>{item.nombre}</Text>
                  <Text style={styles.value}>{fmt(item.subtotal)}</Text>
                </View>
                {item.rubros.map((r, j) => (
                  <View key={j} style={[styles.row, { paddingLeft: 12 }]}>
                    <Text style={styles.label}>{r.descripcion || r.tipo} ({r.cantidad} {r.unidad} x {fmt(r.valor_unitario)})</Text>
                    <Text style={{ fontSize: 9 }}>{fmt(r.valor_total)}</Text>
                  </View>
                ))}
              </View>
            ))}
          </>
        )}

        {/* Totals */}
        <Text style={styles.sectionTitle}>Resumen</Text>
        <View style={styles.row}>
          <Text>Subtotal</Text>
          <Text style={styles.value}>{fmt(fiscal?.subtotal ?? cotizacion.valor_total)}</Text>
        </View>
        {fiscal && fiscal.iva > 0 && (
          <View style={styles.row}>
            <Text>IVA (19%)</Text>
            <Text>{fmt(fiscal.iva)}</Text>
          </View>
        )}
        {fiscal && (
          <View style={[styles.row, { backgroundColor: '#f0fdf4', padding: 6, borderRadius: 4, marginTop: 4 }]}>
            <Text style={{ fontWeight: 'bold', fontSize: 11 }}>Total</Text>
            <Text style={styles.valueGreen}>{fmt(fiscal.totalBruto)}</Text>
          </View>
        )}

        {/* Retenciones (not on client-facing PDF, per spec D58-D59: internal only) */}
        {fiscal && fiscal.totalRetenciones > 0 && (
          <>
            <Text style={[styles.sectionTitle, { fontSize: 9, color: '#999' }]}>Retenciones estimadas (informativo)</Text>
            {fiscal.reteFuente > 0 && (
              <View style={styles.row}>
                <Text style={styles.label}>Retencion en la fuente</Text>
                <Text style={{ fontSize: 9, color: '#ef4444' }}>-{fmt(fiscal.reteFuente)}</Text>
              </View>
            )}
            {fiscal.reteICA > 0 && (
              <View style={styles.row}>
                <Text style={styles.label}>ReteICA</Text>
                <Text style={{ fontSize: 9, color: '#ef4444' }}>-{fmt(fiscal.reteICA)}</Text>
              </View>
            )}
            {fiscal.reteIVA > 0 && (
              <View style={styles.row}>
                <Text style={styles.label}>ReteIVA</Text>
                <Text style={{ fontSize: 9, color: '#ef4444' }}>-{fmt(fiscal.reteIVA)}</Text>
              </View>
            )}
            <View style={styles.rowBold}>
              <Text style={{ fontWeight: 'bold' }}>TE QUEDA</Text>
              <Text style={{ fontSize: 12, fontWeight: 'bold', color: primaryColor }}>{fmt(fiscal.teQueda)}</Text>
            </View>
            <Text style={{ fontSize: 7, color: '#999', marginTop: 2 }}>
              * Retenciones estimadas segun perfil fiscal. No constituyen asesoria tributaria.
            </Text>
          </>
        )}

        {/* Conditions */}
        {(cotizacion.condiciones_pago || cotizacion.notas) && (
          <View style={styles.conditions}>
            {cotizacion.condiciones_pago && (
              <>
                <Text style={{ fontSize: 9, fontWeight: 'bold', marginBottom: 4 }}>Condiciones de pago</Text>
                <Text style={styles.conditionText}>{cotizacion.condiciones_pago}</Text>
              </>
            )}
            {cotizacion.notas && (
              <>
                <Text style={{ fontSize: 9, fontWeight: 'bold', marginTop: 8, marginBottom: 4 }}>Notas</Text>
                <Text style={styles.conditionText}>{cotizacion.notas}</Text>
              </>
            )}
          </View>
        )}

        {/* Footer */}
        <Text style={styles.footer}>
          Generado por MeTRIK ONE · {cotizacion.consecutivo} · {new Date().toLocaleDateString('es-CO')}
        </Text>
      </Page>
    </Document>
  )
}
