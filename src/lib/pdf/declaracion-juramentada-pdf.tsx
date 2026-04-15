import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'

interface DeclaracionJuramentadaProps {
  datos: {
    nombre_solicitante: string | null
    numero_identificacion: string | null
    tipo_vehiculo: string | null
    email: string | null
    telefono: string | null
    municipio: string | null
  }
  fechaGeneracion: string
  codigoNegocio: string
}

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']

const s = StyleSheet.create({
  page: { paddingTop: 60, paddingBottom: 60, paddingHorizontal: 60, fontSize: 11, fontFamily: 'Helvetica', color: '#111827', lineHeight: 1.6 },
  title: { fontSize: 16, fontFamily: 'Helvetica-Bold', textAlign: 'center', marginBottom: 30 },
  intro: { marginBottom: 20, textAlign: 'justify' },
  paragraph: { marginBottom: 14, textAlign: 'justify' },
  bold: { fontFamily: 'Helvetica-Bold' },
  date: { marginTop: 30, marginBottom: 40 },
  signatureBlock: { marginTop: 10, width: '60%' },
  signatureLine: { borderTop: '1 solid #111827', marginTop: 50, paddingTop: 6 },
  signatureName: { fontSize: 11, fontFamily: 'Helvetica-Bold' },
  signatureDetail: { fontSize: 9, color: '#374151', marginTop: 2 },
  footer: { position: 'absolute', bottom: 30, left: 60, right: 60 },
  footerText: { fontSize: 7, color: '#9CA3AF', textAlign: 'center' },
})

export default function DeclaracionJuramentadaPDF({ datos, fechaGeneracion, codigoNegocio }: DeclaracionJuramentadaProps) {
  const nombre = datos.nombre_solicitante ?? '[NOMBRE]'
  const cedula = datos.numero_identificacion ?? '[No. IDENTIFICACIÓN]'
  const tipo = datos.tipo_vehiculo?.toLowerCase() ?? '[tipo]'
  const ciudad = datos.municipio ?? '[CIUDAD]'
  const email = datos.email ?? '[EMAIL]'
  const telefono = datos.telefono ?? '[TELÉFONO]'

  const d = new Date(fechaGeneracion)
  const dia = d.getUTCDate()
  const mes = MESES[d.getUTCMonth()] ?? '[mes]'
  const anio = d.getUTCFullYear()

  return (
    <Document>
      <Page size="LETTER" style={s.page}>
        <Text style={s.title}>DECLARACIÓN JURAMENTADA</Text>

        <Text style={s.intro}>
          Yo, <Text style={s.bold}>{nombre}</Text>, identificado(a) con cédula de ciudadanía
          No. <Text style={s.bold}>{cedula}</Text>, declaro bajo la gravedad de juramento que:
        </Text>

        <Text style={s.paragraph}>
          <Text style={s.bold}>PRIMERO: </Text>
          Que el vehículo objeto de la solicitud de devolución del IVA es un vehículo{' '}
          <Text style={s.bold}>{tipo}</Text> que cumple con los requisitos establecidos en el
          artículo 850 del Estatuto Tributario y sus decretos reglamentarios.
        </Text>

        <Text style={s.paragraph}>
          <Text style={s.bold}>SEGUNDO: </Text>
          Que el vehículo fue adquirido con recursos propios y no ha sido objeto de devolución
          del IVA anteriormente.
        </Text>

        <Text style={s.paragraph}>
          <Text style={s.bold}>TERCERO: </Text>
          Que la información suministrada en la solicitud de devolución del IVA es veraz y
          completa, y que asumo las consecuencias legales en caso de que se compruebe lo contrario.
        </Text>

        <Text style={s.paragraph}>
          <Text style={s.bold}>CUARTO: </Text>
          Que conozco las sanciones previstas en el artículo 442 del Código Penal para quienes
          obtengan devoluciones o compensaciones utilizando documentos falsos o mediante fraude.
        </Text>

        <Text style={s.date}>
          Dada en {ciudad}, a los {dia} días del mes de {mes} de {anio}.
        </Text>

        <View style={s.signatureBlock}>
          <View style={s.signatureLine}>
            <Text style={s.signatureName}>{nombre}</Text>
            <Text style={s.signatureDetail}>C.C. No. {cedula}</Text>
            <Text style={s.signatureDetail}>Correo: {email}</Text>
            <Text style={s.signatureDetail}>Celular: {telefono}</Text>
          </View>
        </View>

        <View style={s.footer}>
          <Text style={s.footerText}>
            Documento generado por MéTRIK ONE — Negocio {codigoNegocio}
          </Text>
        </View>
      </Page>
    </Document>
  )
}
