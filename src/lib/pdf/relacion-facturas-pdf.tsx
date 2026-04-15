import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'

interface RelacionFacturasProps {
  datos: {
    numero_factura: string | null
    nit_proveedor: string | null
    nombre_proveedor: string | null
    marca: string | null
    linea: string | null
    valor_unitario_sin_iva: string | null
    valor_iva: string | null
    nombre_solicitante: string | null
    numero_identificacion: string | null
  }
  fechaGeneracion: string
  codigoNegocio: string
}

const fmtCurrency = (v: string | null) => {
  if (!v) return '—'
  const n = Number(v)
  if (isNaN(n)) return v
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n)
}

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']

const s = StyleSheet.create({
  page: { paddingTop: 50, paddingBottom: 60, paddingHorizontal: 40, fontSize: 9, fontFamily: 'Helvetica', color: '#111827' },
  title: { fontSize: 14, fontFamily: 'Helvetica-Bold', textAlign: 'center', marginBottom: 4 },
  subtitle: { fontSize: 10, color: '#6B7280', textAlign: 'center', marginBottom: 20 },
  // Table
  table: { borderTop: '1 solid #374151', borderLeft: '1 solid #374151' },
  headerRow: { flexDirection: 'row', backgroundColor: '#10B981' },
  headerCell: { padding: '5 4', borderRight: '1 solid #374151', borderBottom: '1 solid #374151', justifyContent: 'center' },
  headerText: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: '#FFFFFF', textAlign: 'center' },
  dataRow: { flexDirection: 'row' },
  dataCell: { padding: '5 4', borderRight: '1 solid #374151', borderBottom: '1 solid #374151', justifyContent: 'center' },
  dataText: { fontSize: 8, color: '#111827', textAlign: 'center' },
  totalRow: { flexDirection: 'row', backgroundColor: '#F3F4F6' },
  totalLabel: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: '#111827', textAlign: 'right' },
  totalValue: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: '#111827', textAlign: 'center' },
  // Signature
  signatureBlock: { marginTop: 40, width: '55%' },
  signatureLine: { borderTop: '1 solid #111827', marginTop: 50, paddingTop: 6 },
  signatureName: { fontSize: 10, fontFamily: 'Helvetica-Bold' },
  signatureDetail: { fontSize: 8, color: '#374151', marginTop: 2 },
  // Footer
  footer: { position: 'absolute', bottom: 30, left: 40, right: 40 },
  footerText: { fontSize: 7, color: '#9CA3AF', textAlign: 'center' },
})

// Column widths (total = 100%)
const COL = {
  no: '6%',
  factura: '14%',
  nitProv: '14%',
  nombreProv: '18%',
  descripcion: '18%',
  valor: '15%',
  iva: '15%',
}

export default function RelacionFacturasPDF({ datos, fechaGeneracion, codigoNegocio }: RelacionFacturasProps) {
  const nombre = datos.nombre_solicitante ?? '[NOMBRE]'
  const cedula = datos.numero_identificacion ?? '[No. ID]'
  const descripcion = [datos.marca, datos.linea].filter(Boolean).join(' ') || '—'

  const valorNum = Number(datos.valor_unitario_sin_iva) || 0
  const ivaNum = Number(datos.valor_iva) || 0
  const valorTotal = valorNum + ivaNum

  const d = new Date(fechaGeneracion)
  const dia = d.getUTCDate()
  const mes = MESES[d.getUTCMonth()] ?? ''
  const anio = d.getUTCFullYear()

  return (
    <Document>
      <Page size="LETTER" style={s.page}>
        <Text style={s.title}>RELACIÓN DE FACTURAS</Text>
        <Text style={s.subtitle}>Soporte de la solicitud de devolución del IVA</Text>

        {/* Table */}
        <View style={s.table}>
          {/* Header */}
          <View style={s.headerRow}>
            <View style={[s.headerCell, { width: COL.no }]}><Text style={s.headerText}>No.</Text></View>
            <View style={[s.headerCell, { width: COL.factura }]}><Text style={s.headerText}>No. Factura</Text></View>
            <View style={[s.headerCell, { width: COL.nitProv }]}><Text style={s.headerText}>NIT Proveedor</Text></View>
            <View style={[s.headerCell, { width: COL.nombreProv }]}><Text style={s.headerText}>Nombre Proveedor</Text></View>
            <View style={[s.headerCell, { width: COL.descripcion }]}><Text style={s.headerText}>Descripción Vehículo</Text></View>
            <View style={[s.headerCell, { width: COL.valor }]}><Text style={s.headerText}>Valor (COP)</Text></View>
            <View style={[s.headerCell, { width: COL.iva }]}><Text style={s.headerText}>IVA Pagado (COP)</Text></View>
          </View>

          {/* Data row */}
          <View style={s.dataRow}>
            <View style={[s.dataCell, { width: COL.no }]}><Text style={s.dataText}>1</Text></View>
            <View style={[s.dataCell, { width: COL.factura }]}><Text style={s.dataText}>{datos.numero_factura ?? '—'}</Text></View>
            <View style={[s.dataCell, { width: COL.nitProv }]}><Text style={s.dataText}>{datos.nit_proveedor ?? '—'}</Text></View>
            <View style={[s.dataCell, { width: COL.nombreProv }]}><Text style={[s.dataText, { textAlign: 'left' }]}>{datos.nombre_proveedor ?? '—'}</Text></View>
            <View style={[s.dataCell, { width: COL.descripcion }]}><Text style={[s.dataText, { textAlign: 'left' }]}>{descripcion}</Text></View>
            <View style={[s.dataCell, { width: COL.valor }]}><Text style={s.dataText}>{fmtCurrency(String(valorTotal))}</Text></View>
            <View style={[s.dataCell, { width: COL.iva }]}><Text style={s.dataText}>{fmtCurrency(datos.valor_iva)}</Text></View>
          </View>

          {/* Totals */}
          <View style={s.totalRow}>
            <View style={[s.dataCell, { width: '70%' }]}>
              <Text style={s.totalLabel}>TOTAL VALOR BIENES / TOTAL IVA PAGADO</Text>
            </View>
            <View style={[s.dataCell, { width: COL.valor }]}>
              <Text style={s.totalValue}>{fmtCurrency(String(valorTotal))}</Text>
            </View>
            <View style={[s.dataCell, { width: COL.iva }]}>
              <Text style={s.totalValue}>{fmtCurrency(datos.valor_iva)}</Text>
            </View>
          </View>
        </View>

        {/* Signature */}
        <View style={s.signatureBlock}>
          <View style={s.signatureLine}>
            <Text style={s.signatureName}>{nombre}</Text>
            <Text style={s.signatureDetail}>C.C. No. {cedula}</Text>
          </View>
        </View>

        {/* Date */}
        <Text style={{ fontSize: 9, color: '#6B7280', marginTop: 20 }}>
          Colombia, {dia} de {mes} de {anio}
        </Text>

        <View style={s.footer}>
          <Text style={s.footerText}>
            Documento generado por MéTRIK ONE — Negocio {codigoNegocio}
          </Text>
        </View>
      </Page>
    </Document>
  )
}
