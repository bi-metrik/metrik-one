import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import { calcularDvNit } from '@/lib/dian/nit'

interface DeclaracionJuramentadaProps {
  datos: {
    nombre_solicitante: string | null
    // Base LIMPIA del NIT (sin DV), desde el campo rut.numero_identificacion.
    numero_identificacion: string | null
    // DV del RUT (rut.dv). Puede faltar → se calcula en código.
    dv: string | null
    // Se conserva en la interfaz para no romper el caller (formulario-actions),
    // pero el nuevo formato ya no lo usa: la cláusula PRIMERO es genérica.
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
  clause: { marginBottom: 10, textAlign: 'justify' },
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
  // NIT SIEMPRE con dígito de verificación. Base limpia desde rut.numero_identificacion;
  // DV del RUT (rut.dv) si lo tenemos, se calcula (módulo 11) solo como fallback.
  const nitBase = (datos.numero_identificacion ?? '').trim() || null
  const dvRut = (datos.dv ?? '').trim() || null
  const dvFinal = dvRut || (nitBase ? calcularDvNit(nitBase) : null)
  const nitConDv = nitBase ? (dvFinal ? `${nitBase}-${dvFinal}` : nitBase) : '[NIT]'
  const ciudad = datos.municipio ?? '[Ciudad]'
  const email = datos.email ?? '[DIRECCIÓN DE CORREO]'
  const telefono = datos.telefono ?? '[NÚMERO DE CELULAR]'

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
          Yo, <Text style={{ fontFamily: 'Helvetica-Bold' }}>{nombre}</Text>, identificado(a) con NIT No. <Text style={{ fontFamily: 'Helvetica-Bold' }}>{nitConDv}</Text>, actuando en nombre propio, manifiesto bajo la gravedad de juramento, de conformidad con el artículo 7 del Decreto 1165 de 2019:
        </Text>

        {/* Cláusulas */}
        <Text style={s.clause}>
          <Text style={{ fontFamily: 'Helvetica-Bold' }}>PRIMERO. </Text>
          Las facturas relacionadas corresponden a la adquisición del vehículo híbrido o eléctrico certificado por la UPME.
        </Text>

        <Text style={s.clause}>
          <Text style={{ fontFamily: 'Helvetica-Bold' }}>SEGUNDO: </Text>
          No se ha efectuado devolución ni compensación del IVA pagado.
        </Text>

        <Text style={s.clause}>
          <Text style={{ fontFamily: 'Helvetica-Bold' }}>TERCERO: </Text>
          El IVA solicitado no ha sido tratado como mayor valor del costo, deducción en renta ni como impuesto descontable en IVA.
        </Text>

        <Text style={s.clause}>
          <Text style={{ fontFamily: 'Helvetica-Bold' }}>CUARTO. </Text>
          Que la información suministrada es veraz, completa y verificable.
        </Text>

        {/* Para constancia */}
        <Text style={s.constancia}>
          Para constancia, se firma en {ciudad}, a los {dia} días del mes de {mes} de {anio}.
        </Text>

        {/* Firma */}
        <View style={s.signatureBlock}>
          <View style={s.signatureLine}>
            <Text style={s.signatureName}>{nombre}</Text>
            <Text style={s.signatureDetail}>NIT: {nitConDv}</Text>
            <Text style={s.signatureDetail}>Correo: {email}</Text>
            <Text style={s.signatureDetail}>Tel: {telefono}</Text>
          </View>
        </View>

        {/* Nota legal */}
        <Text style={s.nota}>
          <Text style={{ fontFamily: 'Helvetica-Bold' }}>NOTA: Art. 442 Código Penal Colombiano</Text>
        </Text>

      </Page>
    </Document>
  )
}
