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
  page: { paddingTop: 50, paddingBottom: 60, paddingHorizontal: 50, fontSize: 10, fontFamily: 'Helvetica', color: '#111827', lineHeight: 1.6 },
  // Letter header
  ciudad: { fontSize: 10, marginBottom: 14 },
  destinatario: { marginBottom: 4 },
  destLine: { fontSize: 10 },
  destBold: { fontFamily: 'Helvetica-Bold', fontSize: 10 },
  asunto: { marginBottom: 16, marginTop: 14 },
  asuntoBold: { fontFamily: 'Helvetica-Bold', fontSize: 10 },
  // Body
  intro: { marginBottom: 14, textAlign: 'justify' },
  clause: { marginBottom: 12, textAlign: 'justify' },
  constancia: { marginTop: 14, marginBottom: 20, textAlign: 'justify' },
  nota: { marginTop: 20, fontSize: 9, fontFamily: 'Helvetica-Oblique', color: '#374151', textAlign: 'justify' },
  // Signature
  signatureBlock: { width: '65%' },
  signatureLine: { borderTop: '1 solid #111827', marginTop: 50, paddingTop: 6 },
  signatureName: { fontSize: 10, fontFamily: 'Helvetica-Bold' },
  signatureDetail: { fontSize: 9, color: '#374151', marginTop: 2 },
})

export default function DeclaracionJuramentadaPDF({ datos, fechaGeneracion }: DeclaracionJuramentadaProps) {
  const nombre = datos.nombre_solicitante ?? '[NOMBRE SOLICITANTE]'
  const cedula = datos.numero_identificacion ?? '[Número de Cédula]'
  const ciudad = datos.municipio ?? '[Ciudad]'
  const email = datos.email ?? '[DIRECCIÓN DE CORREO]'
  const telefono = datos.telefono ?? '[NÚMERO DE CELULAR]'
  const tipoVehiculo = datos.tipo_vehiculo?.toLowerCase() ?? 'híbrido / eléctrico'

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
          <Text style={s.asuntoBold}>ASUNTO: DECLARACIÓN JURAMENTADA</Text>
        </View>

        {/* Introducción */}
        <Text style={s.intro}>
          Yo, <Text style={{ fontFamily: 'Helvetica-Bold' }}>{nombre}</Text>, identificado(a) con cédula de ciudadanía No. <Text style={{ fontFamily: 'Helvetica-Bold' }}>{cedula}</Text>, actuando en nombre propio, en mi calidad de contribuyente, por medio del presente documento manifiesto bajo la gravedad de juramento, de conformidad con lo establecido en el artículo 7 del Decreto 1165 de 2019 y demás normas concordantes, lo siguiente:
        </Text>

        {/* Cláusulas — texto exacto de la plantilla oficial */}
        <Text style={s.clause}>
          <Text style={{ fontFamily: 'Helvetica-Bold' }}>PRIMERO. </Text>
          Que las facturas relacionadas en la solicitud de devolución corresponden efectivamente a la adquisición de un vehículo <Text style={{ fontFamily: 'Helvetica-Bold' }}>{tipoVehiculo}</Text>, el cual cuenta con la certificación expedida por la Unidad de Planeación Minero Energética (UPME), en los términos establecidos por la normativa vigente.
        </Text>

        <Text style={s.clause}>
          <Text style={{ fontFamily: 'Helvetica-Bold' }}>SEGUNDO. </Text>
          Que sobre el valor del impuesto sobre las ventas (IVA) pagado en la adquisición del mencionado vehículo, no se ha efectuado solicitud de devolución ni compensación ante la Dirección de Impuestos y Aduanas Nacionales (DIAN) u otra autoridad competente.
        </Text>

        <Text style={s.clause}>
          <Text style={{ fontFamily: 'Helvetica-Bold' }}>TERCERO. </Text>
          Que el IVA cuya devolución se solicita no ha sido tratado como mayor valor del costo o gasto, ni ha sido llevado como deducción en el impuesto sobre la renta, ni como impuesto descontable en declaraciones del impuesto sobre las ventas (IVA).
        </Text>

        <Text style={s.clause}>
          <Text style={{ fontFamily: 'Helvetica-Bold' }}>CUARTO. </Text>
          Que la información suministrada en la solicitud de devolución es veraz, completa y verificable, y que los documentos aportados corresponden fielmente a la realidad de la operación económica realizada.
        </Text>

        {/* Para constancia */}
        <Text style={s.constancia}>
          Para constancia se firma en la ciudad de <Text style={{ fontFamily: 'Helvetica-Bold' }}>{ciudad}</Text>, a los {dia} días del mes de {mes} de {anio}.
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

        {/* Nota legal */}
        <Text style={s.nota}>
          NOTA: El presente documento se suscribe bajo la gravedad de juramento, con los efectos legales previstos en el artículo 442 del Código Penal Colombiano.
        </Text>

      </Page>
    </Document>
  )
}
