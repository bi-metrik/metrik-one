import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'

interface RelacionFacturasProps {
  datos: {
    numero_factura: string | null
    nit_proveedor: string | null
    nombre_proveedor: string | null
    marca: string | null
    linea: string | null
    tipo_vehiculo: string | null
    valor_unitario_sin_iva: string | null
    valor_iva: string | null
    nombre_solicitante: string | null
    numero_identificacion: string | null
    municipio: string | null
    email: string | null
    telefono: string | null
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
  page: { paddingTop: 50, paddingBottom: 60, paddingHorizontal: 50, fontSize: 10, fontFamily: 'Helvetica', color: '#111827', lineHeight: 1.5 },
  // Letter header
  ciudad: { fontSize: 10, marginBottom: 14 },
  destinatario: { marginBottom: 4 },
  destLine: { fontSize: 10 },
  destBold: { fontFamily: 'Helvetica-Bold', fontSize: 10 },
  asunto: { marginBottom: 16, marginTop: 14 },
  asuntoBold: { fontFamily: 'Helvetica-Bold', fontSize: 10 },
  // Body
  intro: { marginBottom: 14, textAlign: 'justify' },
  // Table
  table: { borderTop: '1 solid #374151', borderLeft: '1 solid #374151', marginBottom: 10 },
  headerRow: { flexDirection: 'row', backgroundColor: '#374151' },
  headerCell: { padding: '4 4', borderRight: '1 solid #374151', borderBottom: '1 solid #374151', justifyContent: 'center' },
  headerText: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: '#FFFFFF', textAlign: 'center' },
  dataRow: { flexDirection: 'row' },
  dataCell: { padding: '5 4', borderRight: '1 solid #374151', borderBottom: '1 solid #374151', justifyContent: 'center' },
  dataText: { fontSize: 8, color: '#111827', textAlign: 'center' },
  totalRow: { flexDirection: 'row' },
  totalLabelCell: { padding: '5 4', borderRight: '1 solid #374151', borderBottom: '1 solid #374151', justifyContent: 'center' },
  totalValueCell: { padding: '5 4', borderRight: '1 solid #374151', borderBottom: '1 solid #374151', justifyContent: 'center' },
  totalLabel: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: '#111827', textAlign: 'right' },
  totalValue: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: '#111827', textAlign: 'center' },
  // Totales fuera de tabla
  totalesBlock: { marginBottom: 14 },
  totalLine: { fontSize: 10 },
  // Closing
  closing: { marginBottom: 14, textAlign: 'justify' },
  constancia: { marginBottom: 20, textAlign: 'justify' },
  // Signature
  signatureBlock: { marginTop: 10, width: '65%' },
  signatureLine: { borderTop: '1 solid #111827', marginTop: 50, paddingTop: 6 },
  signatureName: { fontSize: 10, fontFamily: 'Helvetica-Bold' },
  signatureDetail: { fontSize: 9, color: '#374151', marginTop: 2 },
})

const COL = {
  no: '6%',
  factura: '16%',
  nitProv: '14%',
  nombreProv: '20%',
  descripcion: '18%',
  valor: '13%',
  iva: '13%',
}

export default function RelacionFacturasPDF({ datos, fechaGeneracion }: RelacionFacturasProps) {
  const nombre = datos.nombre_solicitante ?? '[NOMBRE SOLICITANTE]'
  const cedula = datos.numero_identificacion ?? '[Número de Cédula]'
  const ciudad = datos.municipio ?? '[Ciudad]'
  const email = datos.email ?? '[DIRECCIÓN DE CORREO]'
  const telefono = datos.telefono ?? '[NÚMERO DE CELULAR]'
  const tipoVehiculo = datos.tipo_vehiculo?.toLowerCase() ?? 'híbrido / eléctrico'
  const descripcion = [datos.marca, datos.linea].filter(Boolean).join(' ') || '—'

  const d = new Date(fechaGeneracion)
  const dia = d.getUTCDate()
  const mes = MESES[d.getUTCMonth()] ?? ''
  const anio = d.getUTCFullYear()

  return (
    <Document>
      <Page size="LETTER" style={s.page}>

        {/* Ciudad y fecha */}
        <Text style={s.ciudad}>{ciudad}, {dia} de {mes} de {anio}</Text>

        {/* Destinatario */}
        <View style={s.destinatario}>
          <Text style={s.destLine}>Señores</Text>
          <Text style={s.destBold}>DIRECCIÓN DE IMPUESTOS Y ADUANAS NACIONALES – DIAN</Text>
          <Text style={s.destLine}>Ciudad</Text>
        </View>

        {/* Asunto */}
        <View style={s.asunto}>
          <Text>
            <Text style={s.asuntoBold}>ASUNTO: RELACIÓN DETALLADA DE FACTURAS ELECTRÓNICAS{'\n'}</Text>
            <Text style={{ fontSize: 10 }}>(Solicitud de devolución de IVA – Adquisición de vehículo híbrido / eléctrico)</Text>
          </Text>
        </View>

        {/* Introducción */}
        <Text style={s.intro}>
          Yo, <Text style={{ fontFamily: 'Helvetica-Bold' }}>{nombre}</Text>, identificado(a) con cédula de ciudadanía No. <Text style={{ fontFamily: 'Helvetica-Bold' }}>{cedula}</Text>, en calidad de solicitante, presento la siguiente relación detallada de las facturas electrónicas correspondientes a la adquisición del vehículo <Text style={{ fontFamily: 'Helvetica-Bold' }}>{tipoVehiculo}</Text>, certificado por la UPME:
        </Text>

        {/* Tabla */}
        <View style={s.table}>
          <View style={s.headerRow}>
            <View style={[s.headerCell, { width: COL.no }]}><Text style={s.headerText}>No.</Text></View>
            <View style={[s.headerCell, { width: COL.factura }]}><Text style={s.headerText}>Número de factura{'\n'}(incluye prefijo)</Text></View>
            <View style={[s.headerCell, { width: COL.nitProv }]}><Text style={s.headerText}>Identificación del proveedor{'\n'}(NIT / C.C.)</Text></View>
            <View style={[s.headerCell, { width: COL.nombreProv }]}><Text style={s.headerText}>Nombre del{'\n'}proveedor</Text></View>
            <View style={[s.headerCell, { width: COL.descripcion }]}><Text style={s.headerText}>Descripción del{'\n'}vehículo</Text></View>
            <View style={[s.headerCell, { width: COL.valor }]}><Text style={s.headerText}>Valor{'\n'}(COP)</Text></View>
            <View style={[s.headerCell, { width: COL.iva }]}><Text style={s.headerText}>IVA pagado{'\n'}(COP)</Text></View>
          </View>
          <View style={s.dataRow}>
            <View style={[s.dataCell, { width: COL.no }]}><Text style={s.dataText}>1</Text></View>
            <View style={[s.dataCell, { width: COL.factura }]}><Text style={s.dataText}>{datos.numero_factura ?? '—'}</Text></View>
            <View style={[s.dataCell, { width: COL.nitProv }]}><Text style={s.dataText}>{datos.nit_proveedor ?? '—'}</Text></View>
            <View style={[s.dataCell, { width: COL.nombreProv }]}><Text style={[s.dataText, { textAlign: 'left' }]}>{datos.nombre_proveedor ?? '—'}</Text></View>
            <View style={[s.dataCell, { width: COL.descripcion }]}><Text style={[s.dataText, { textAlign: 'left' }]}>{descripcion}</Text></View>
            <View style={[s.dataCell, { width: COL.valor }]}><Text style={s.dataText}>{fmtCurrency(datos.valor_unitario_sin_iva)}</Text></View>
            <View style={[s.dataCell, { width: COL.iva }]}><Text style={s.dataText}>{fmtCurrency(datos.valor_iva)}</Text></View>
          </View>
          <View style={s.totalRow}>
            <View style={[s.totalLabelCell, { width: '74%' }]}>
              <Text style={s.totalLabel}>TOTAL</Text>
            </View>
            <View style={[s.totalValueCell, { width: COL.valor }]}>
              <Text style={s.totalValue}>{fmtCurrency(datos.valor_unitario_sin_iva)}</Text>
            </View>
            <View style={[s.totalValueCell, { width: COL.iva }]}>
              <Text style={s.totalValue}>{fmtCurrency(datos.valor_iva)}</Text>
            </View>
          </View>
        </View>

        {/* Totales textuales */}
        <View style={s.totalesBlock}>
          <Text style={s.totalLine}>TOTAL VALOR BIENES: {fmtCurrency(datos.valor_unitario_sin_iva)}</Text>
          <Text style={s.totalLine}>TOTAL IVA PAGADO: {fmtCurrency(datos.valor_iva)}</Text>
        </View>

        {/* Declaración de veracidad */}
        <Text style={s.closing}>
          Declaro que la información contenida en la presente relación corresponde fielmente a las facturas electrónicas aportadas como soporte de la solicitud de devolución.
        </Text>

        {/* Para constancia */}
        <Text style={s.constancia}>
          Para constancia, se firma en la ciudad de <Text style={{ fontFamily: 'Helvetica-Bold' }}>{ciudad}</Text>, a los {dia} días del mes de {mes} de {anio}.
        </Text>

        {/* Firma */}
        <View style={s.signatureBlock}>
          <View style={s.signatureLine}>
            <Text style={s.signatureName}>{nombre}</Text>
            <Text style={s.signatureDetail}>C.C. No. {cedula}</Text>
            <Text style={s.signatureDetail}>Correo electrónico: {email}</Text>
            <Text style={s.signatureDetail}>Celular: {telefono}</Text>
          </View>
        </View>

      </Page>
    </Document>
  )
}
