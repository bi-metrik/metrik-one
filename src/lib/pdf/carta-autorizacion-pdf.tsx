import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import { PALETA } from '@/lib/marca/paleta'

/**
 * Carta de autorización para devolución de IVA con DOS solicitantes.
 *
 * La DIAN no permite repartir una devolución 50/50: cuando la factura está a nombre
 * de dos personas, una sola la solicita y la recibe, y la otra la autoriza por
 * escrito ante notaría. Regla comunicada por la DIAN el 2026-07-23.
 *
 * Texto calcado de la proforma que entregó Deisy (archivada en
 * `proyectos/soena/ve/docs/entrada/2026-07-27_proforma-carta-autorizacion-notariada.docx`).
 * No lleva marca MéTRIK: es una comunicación del cliente a la DIAN, igual que la
 * Declaración Juramentada.
 *
 * QUIÉN AUTORIZA A QUIÉN: el beneficiario es el solicitante PRINCIPAL (bloque `rut`)
 * y el segundo solicitante (`rut_solicitante_2`) es quien cede. Confirmado por
 * Mauricio el 2026-07-28: "el primer RUT es el del beneficiario". Coincide con los
 * formularios DIAN del mismo expediente, que nombran al principal como titular;
 * invertirlo dejaría la carta contradiciendo al 010.
 *
 * GÉNERO GRAMATICAL: el sistema no captura el género de los solicitantes, así que se
 * usan formas dobles ("identificado(a)", "domiciliado(a)"). La proforma original venía
 * en masculino y femenino según el caso concreto que traía diligenciado.
 */

interface CartaAutorizacionProps {
  datos: {
    /** Quien cede el derecho: segundo solicitante de la factura. */
    autorizante_nombre: string | null
    autorizante_identificacion: string | null
    autorizante_domicilio: string | null
    /** Quien solicita y recibe: solicitante principal del expediente. */
    beneficiario_nombre: string | null
    beneficiario_identificacion: string | null
    beneficiario_domicilio: string | null
    numero_factura: string | null
    /** Ciudad de encabezado de la carta. */
    municipio: string | null
  }
  fechaGeneracion: string
  codigoNegocio: string
}

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']

const s = StyleSheet.create({
  // Espaciado y márgenes ajustados (fuente intacta en 10) para que la carta,
  // con sus dos firmas, quepa en UNA hoja carta.
  page: { paddingTop: 40, paddingBottom: 40, paddingHorizontal: 50, fontSize: 10, fontFamily: 'Helvetica', color: '#111827', lineHeight: 1.5 },
  ciudad: { fontSize: 10, marginBottom: 10 },
  destinatario: { marginBottom: 4 },
  destLine: { fontSize: 10 },
  destBold: { fontFamily: 'Helvetica-Bold', fontSize: 10 },
  asunto: { marginBottom: 12, marginTop: 10, textAlign: 'justify' },
  asuntoBold: { fontFamily: 'Helvetica-Bold', fontSize: 10 },
  intro: { marginBottom: 8, textAlign: 'justify' },
  comparec: { marginBottom: 6, marginLeft: 14, textAlign: 'justify' },
  clause: { marginBottom: 8, textAlign: 'justify' },
  facultad: { marginBottom: 4, marginLeft: 20, textAlign: 'justify' },
  bold: { fontFamily: 'Helvetica-Bold' },
  cierre: { marginTop: 10, marginBottom: 10, textAlign: 'justify' },
  // Espacio en blanco para firmar, y las dos firmas en UNA fila (pedido de Deisy,
  // 2026-09-24): apiladas alargaban la carta y la partían en dos páginas.
  firmasRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 54 },
  signatureBlock: { width: '44%' },
  signatureLine: { borderTop: '1 solid #111827', paddingTop: 6 },
  signatureName: { fontSize: 10, fontFamily: 'Helvetica-Bold' },
  signatureDetail: { fontSize: 9, color: '#374151', marginTop: 2 },
  codigo: { marginTop: 18, fontSize: 8, color: PALETA.tintaSuave },
})

export default function CartaAutorizacionPDF({ datos, fechaGeneracion, codigoNegocio }: CartaAutorizacionProps) {
  const autorizante = datos.autorizante_nombre?.trim() || '[NOMBRE DEL SEGUNDO SOLICITANTE]'
  const autorizanteCC = datos.autorizante_identificacion?.trim() || '__________________'
  const autorizanteDom = datos.autorizante_domicilio?.trim() || '__________________'
  const beneficiario = datos.beneficiario_nombre?.trim() || '[NOMBRE DEL SOLICITANTE PRINCIPAL]'
  const beneficiarioCC = datos.beneficiario_identificacion?.trim() || '__________________'
  const beneficiarioDom = datos.beneficiario_domicilio?.trim() || '__________________'
  const factura = datos.numero_factura?.trim() || '[NÚMERO DE FACTURA]'
  const ciudad = datos.municipio?.trim() || '[Ciudad]'

  const d = new Date(fechaGeneracion)
  const dia = d.getUTCDate()
  const mes = MESES[d.getUTCMonth()] ?? ''
  const anio = d.getUTCFullYear()

  return (
    <Document>
      <Page size="LETTER" style={s.page}>
        <Text style={s.ciudad}>{ciudad}, {dia} de {mes} de {anio}</Text>

        <View style={s.destinatario}>
          <Text style={s.destLine}>Señores</Text>
          <Text style={s.destBold}>DIRECCIÓN DE IMPUESTOS Y ADUANAS NACIONALES – DIAN</Text>
          <Text style={s.destLine}>Ciudad</Text>
        </View>

        <Text style={s.asunto}>
          <Text style={s.asuntoBold}>Asunto: </Text>
          Autorización para que la devolución del IVA sea solicitada y recibida por {beneficiario}
        </Text>

        <Text style={s.intro}>Nosotros, los suscritos:</Text>

        <Text style={s.comparec}>
          1. <Text style={s.bold}>{autorizante}</Text>, mayor de edad, identificado(a) con cédula de
          ciudadanía No. {autorizanteCC}, domiciliado(a) en {autorizanteDom}.
        </Text>
        <Text style={s.comparec}>
          2. <Text style={s.bold}>{beneficiario}</Text>, mayor de edad, identificado(a) con cédula de
          ciudadanía No. {beneficiarioCC}, domiciliado(a) en {beneficiarioDom}.
        </Text>

        <Text style={s.clause}>
          Por medio de la presente manifestamos a la DIRECCIÓN DE IMPUESTOS Y ADUANAS NACIONALES – DIAN
          que la factura de compra No. {factura}, relacionada con la solicitud de devolución del Impuesto
          sobre las Ventas (IVA), se encuentra expedida a nombre de ambos comparecientes.
        </Text>

        <Text style={s.clause}>
          En consecuencia, <Text style={s.bold}>{autorizante}</Text>, de manera libre, voluntaria, expresa
          e irrevocable, <Text style={s.bold}>AUTORIZA</Text> a <Text style={s.bold}>{beneficiario}</Text> para
          que sea la única persona facultada para:
        </Text>

        <Text style={s.facultad}>
          • Presentar ante la DIAN la solicitud de devolución del IVA correspondiente a la factura No. {factura}.
        </Text>
        <Text style={s.facultad}>
          • Adelantar todos los trámites administrativos relacionados con dicha devolución.
        </Text>
        <Text style={s.facultad}>
          • Recibir, cobrar y disponer del valor que la DIAN reconozca y otorgue por concepto de devolución del IVA.
        </Text>

        <Text style={[s.clause, { marginTop: 10 }]}>
          Así mismo, <Text style={s.bold}>{beneficiario}</Text> manifiesta que acepta acogerse a dicha
          devolución y asume la calidad de beneficiario(a) y receptor(a) de la misma ante la DIAN.
        </Text>

        <Text style={s.clause}>
          <Text style={s.bold}>{autorizante}</Text> declara que no presentará solicitud independiente ni
          reclamación posterior respecto de la devolución del IVA derivada de la factura No. {factura} antes
          mencionada, y que renuncia a cualquier derecho de cobro individual sobre dicho valor frente a la DIAN.
        </Text>

        <Text style={s.clause}>
          La presente autorización se otorga para todos los efectos legales pertinentes y con destino
          exclusivo a la DIRECCIÓN DE IMPUESTOS Y ADUANAS NACIONALES – DIAN.
        </Text>

        <Text style={s.cierre}>
          Solicitamos respetuosamente que esta comunicación sea tenida en cuenta dentro del trámite correspondiente.
        </Text>

        <Text style={s.intro}>Atentamente,</Text>

        <View style={s.firmasRow} wrap={false}>
          <View style={s.signatureBlock}>
            <View style={s.signatureLine}>
              <Text style={s.signatureName}>{autorizante}</Text>
              <Text style={s.signatureDetail}>C.C. No. {autorizanteCC}</Text>
              <Text style={s.signatureDetail}>Firma</Text>
            </View>
          </View>

          <View style={s.signatureBlock}>
            <View style={s.signatureLine}>
              <Text style={s.signatureName}>{beneficiario}</Text>
              <Text style={s.signatureDetail}>C.C. No. {beneficiarioCC}</Text>
              <Text style={s.signatureDetail}>Firma</Text>
            </View>
          </View>
        </View>

        <Text style={s.codigo}>{codigoNegocio}</Text>
      </Page>
    </Document>
  )
}
