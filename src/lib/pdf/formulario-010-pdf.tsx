import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'

interface Formulario010Props {
  datos: Record<string, string | null>
  constantes: {
    concepto: string
    concepto_label: string
    tipo_obligacion: string
    tipo_solicitud: string
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

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

function parseFecha(iso: string | null): { anio: string; mes: string; dia: string; mesNum: string } {
  if (!iso) return { anio: '—', mes: '—', dia: '—', mesNum: '—' }
  const d = new Date(iso)
  return {
    anio: String(d.getUTCFullYear()),
    mes: MESES[d.getUTCMonth()] ?? '—',
    dia: String(d.getUTCDate()),
    mesNum: String(d.getUTCMonth() + 1).padStart(2, '0'),
  }
}

const s = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 50, paddingHorizontal: 44, fontSize: 9, fontFamily: 'Helvetica', color: '#111827' },
  header: { marginBottom: 16, borderBottom: '2 solid #10B981', paddingBottom: 8 },
  title: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: '#111827' },
  subtitle: { fontSize: 9, color: '#6B7280', marginTop: 2 },
  sectionTitle: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: '#FFFFFF', backgroundColor: '#10B981', padding: '4 8', marginTop: 12, marginBottom: 6 },
  row: { flexDirection: 'row', borderBottom: '0.5 solid #E5E7EB', minHeight: 20 },
  labelCell: { width: '35%', backgroundColor: '#F9FAFB', padding: '4 8', justifyContent: 'center' },
  valueCell: { width: '65%', padding: '4 8', justifyContent: 'center' },
  label: { fontSize: 8, color: '#6B7280' },
  casilla: { fontSize: 7, color: '#9CA3AF' },
  value: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#111827' },
  halfRow: { flexDirection: 'row', borderBottom: '0.5 solid #E5E7EB', minHeight: 20 },
  halfLabelCell: { width: '35%', backgroundColor: '#F9FAFB', padding: '4 8', justifyContent: 'center' },
  halfValueCell: { width: '15%', padding: '4 8', justifyContent: 'center' },
  footer: { marginTop: 20, padding: '8 0', borderTop: '0.5 solid #E5E7EB' },
  footerText: { fontSize: 7, color: '#9CA3AF', fontStyle: 'italic' },
  signatureBlock: { marginTop: 30, width: '50%' },
  signatureLine: { borderTop: '1 solid #111827', marginTop: 40, paddingTop: 4 },
})

function Field({ label, casilla, value }: { label: string; casilla?: string; value: string | null }) {
  return (
    <View style={s.row}>
      <View style={s.labelCell}>
        <Text style={s.label}>{label}</Text>
        {casilla && <Text style={s.casilla}>{casilla}</Text>}
      </View>
      <View style={s.valueCell}>
        <Text style={s.value}>{value ?? '—'}</Text>
      </View>
    </View>
  )
}

export default function Formulario010PDF({ datos, constantes, fechaGeneracion, codigoNegocio }: Formulario010Props) {
  const fechaGen = parseFecha(fechaGeneracion)
  const fechaFact = parseFecha(datos.fecha_factura)

  return (
    <Document>
      <Page size="LETTER" style={s.page}>
        {/* Header */}
        <View style={s.header}>
          <Text style={s.title}>FORMULARIO 010</Text>
          <Text style={{ fontSize: 10, color: '#374151', marginTop: 2 }}>
            Solicitud de Devolución y/o Compensación
          </Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
            <Text style={s.subtitle}>Negocio: {codigoNegocio}</Text>
            <Text style={s.subtitle}>Generado: {fechaGen.dia} {fechaGen.mes} {fechaGen.anio}</Text>
          </View>
        </View>

        {/* S1: Identificación del solicitante */}
        <Text style={s.sectionTitle}>1. IDENTIFICACIÓN DEL SOLICITANTE</Text>
        <View style={s.halfRow}>
          <View style={[s.halfLabelCell, { width: '20%' }]}>
            <Text style={s.label}>NIT</Text>
            <Text style={s.casilla}>Casilla 5</Text>
          </View>
          <View style={[s.halfValueCell, { width: '25%' }]}>
            <Text style={s.value}>{datos.nit ?? '—'}</Text>
          </View>
          <View style={[s.halfLabelCell, { width: '15%' }]}>
            <Text style={s.label}>DV</Text>
            <Text style={s.casilla}>Casilla 6</Text>
          </View>
          <View style={[s.halfValueCell, { width: '10%' }]}>
            <Text style={s.value}>{datos.dv ?? '—'}</Text>
          </View>
          <View style={[s.halfLabelCell, { width: '15%' }]}>
            <Text style={s.label}>Tipo</Text>
          </View>
          <View style={[s.halfValueCell, { width: '15%' }]}>
            <Text style={s.value}>NIT</Text>
          </View>
        </View>
        <Field label="Razón social / Nombres" casilla="Casillas 31-35" value={datos.razon_social} />
        <Field label="Dirección seccional" casilla="Casilla 12" value={datos.direccion_seccional} />
        <Field label="Dirección" casilla="Casilla 41" value={datos.direccion} />
        <Field label="Teléfono" casilla="Casilla 44" value={datos.telefono} />
        <Field label="Correo electrónico" casilla="Casilla 42" value={datos.email} />
        <View style={s.halfRow}>
          <View style={[s.halfLabelCell, { width: '15%' }]}>
            <Text style={s.label}>País</Text>
          </View>
          <View style={[s.halfValueCell, { width: '18%' }]}>
            <Text style={s.value}>{datos.pais ?? 'Colombia'}</Text>
          </View>
          <View style={[s.halfLabelCell, { width: '15%' }]}>
            <Text style={s.label}>Depto.</Text>
          </View>
          <View style={[s.halfValueCell, { width: '18%' }]}>
            <Text style={s.value}>{datos.departamento ?? '—'}</Text>
          </View>
          <View style={[s.halfLabelCell, { width: '15%' }]}>
            <Text style={s.label}>Municipio</Text>
          </View>
          <View style={[s.halfValueCell, { width: '19%' }]}>
            <Text style={s.value}>{datos.municipio ?? '—'}</Text>
          </View>
        </View>

        {/* S2: Solicitud */}
        <Text style={s.sectionTitle}>2. SOLICITUD</Text>
        <Field label="Concepto" value={`${constantes.concepto} — ${constantes.concepto_label}`} />
        <Field label="Tipo de obligación" value={constantes.tipo_obligacion} />
        <Field label="Tipo de solicitud" value={constantes.tipo_solicitud} />

        {/* S3: Datos del saldo */}
        <Text style={s.sectionTitle}>3. DATOS DEL SALDO A FAVOR</Text>
        <View style={s.halfRow}>
          <View style={[s.halfLabelCell, { width: '20%' }]}>
            <Text style={s.label}>Año gravable</Text>
            <Text style={s.casilla}>Casilla 52</Text>
          </View>
          <View style={[s.halfValueCell, { width: '15%' }]}>
            <Text style={s.value}>{fechaFact.anio}</Text>
          </View>
          <View style={[s.halfLabelCell, { width: '20%' }]}>
            <Text style={s.label}>Periodo</Text>
            <Text style={s.casilla}>Casilla 53</Text>
          </View>
          <View style={[s.halfValueCell, { width: '15%' }]}>
            <Text style={s.value}>{fechaFact.mesNum}</Text>
          </View>
          <View style={{ width: '30%' }} />
        </View>
        <Field label="No. documento" casilla="Casilla 55" value={datos.numero_factura} />
        <Field label="Fecha documento" casilla="Casilla 58" value={datos.fecha_factura} />
        <Field label="Valor solicitado" casilla="Casillas 49 / 59" value={fmtCurrency(datos.valor_solicitado)} />

        {/* S4: Información bancaria */}
        <Text style={s.sectionTitle}>4. INFORMACIÓN PARA DESEMBOLSO</Text>
        <Field label="Entidad financiera" casilla="Casilla 41" value={datos.entidad_financiera} />
        <Field label="Número de cuenta" casilla="Casilla 42" value={datos.numero_cuenta} />
        <Field label="Tipo de cuenta" casilla="Casilla 43" value={datos.tipo_cuenta} />

        {/* S5: Firma */}
        <Text style={s.sectionTitle}>5. FIRMA DE QUIEN SUSCRIBE</Text>
        <View style={s.signatureBlock}>
          <View style={s.signatureLine}>
            <Text style={s.value}>{datos.razon_social ?? '—'}</Text>
            <Text style={[s.label, { marginTop: 2 }]}>NIT: {datos.nit ?? '—'}-{datos.dv ?? '—'}</Text>
          </View>
        </View>

        {/* Footer */}
        <View style={s.footer}>
          <Text style={s.footerText}>
            Items dejados en blanco: Código de Representación (1005), Organización (1006)
          </Text>
          <Text style={[s.footerText, { marginTop: 2 }]}>
            Documento generado por MéTRIK ONE — {fechaGen.dia}/{fechaGen.mesNum}/{fechaGen.anio}
          </Text>
        </View>
      </Page>
    </Document>
  )
}
