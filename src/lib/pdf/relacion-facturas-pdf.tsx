import type { ReactNode } from 'react'
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import { nitBaseYDv } from '@/lib/dian/nit'
import { titularesDeDatos, concordancia } from './titulares'
import { fmtCurrency, fechaCorta, tarifaIva, fechaDeGeneracion } from './formato'

/**
 * Relación de facturas — plantilla de SOENA recibida el 2026-10-28 (SOE-033),
 * aprobada por Mauricio para usarse TAL CUAL.
 *
 * Lo que cambió respecto a la versión anterior: la tabla horizontal de siete
 * columnas pasa a ser una FICHA por factura («FACTURA ELECTRÓNICA No. 1», filas
 * etiqueta/valor en dos columnas), con datos que antes no salían: fecha de
 * expedición, tarifa de IVA, el NIT del proveedor SIN DV con el DV en su propia
 * casilla, el «IVA solicitado» y el número y la
 * fecha del certificado UPME. Los totales pasan a tres (bienes, IVA pagado, IVA
 * solicitado) y el asunto lleva el tipo de vehículo. La «Nota interna (borrar antes
 * de enviar)» de la plantilla no se imprime: el expediente tiene una sola factura.
 *
 * Decisiones que NO salen de la plantilla:
 *
 * 0. El «IVA solicitado» (ficha y TOTAL IVA SOLICITADO) es el IVA EXACTO de la
 *    factura, sin redondear: decisión de Mauricio del 2026-10-29. Hasta ese día salía
 *    aproximado al mil (art. 577 ET); ya no se redondea en ningún documento.
 *
 * 1. El certificado UPME (`numero_caso_upme`, `fecha_certificado`) es OPCIONAL en
 *    `campos_fuente`, igual que en la declaración juramentada. Si falta, la ficha
 *    muestra «—» y el párrafo inicial NO dice «certificado por la UPME»: el
 *    documento no afirma un certificado que el expediente no tiene.
 * 2. La tarifa de IVA no es un dato extraído: se DERIVA de `valor_iva /
 *    valor_unitario_sin_iva` (`tarifaIva`). Si no se puede calcular queda un
 *    marcador, nunca una tarifa supuesta.
 * 3. El NIT del proveedor ya llega sin DV de la extracción, así que se separa con
 *    `nitBaseYDv`, que NO adivina (ver su comentario: `separarNitDv` mutila NIT
 *    limpios). El DV se calcula.
 * 4. El firmante se identifica con CÉDULA, no con NIT. Cada documento conserva su
 *    convención.
 */
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
    // Desde SOE-033 (2026-10-28). Opcionales en el tipo porque una config que aún no
    // los declare tiene que seguir generando: la ficha muestra «—».
    fecha_factura?: string | null
    numero_caso_upme?: string | null
    fecha_certificado?: string | null
    // Segundo titular (copropiedad). OPCIONAL: sin estos campos el documento sale
    // con un solo firmante. La DIAN exige que en copropiedad firmen los dos.
    nombre_solicitante_2?: string | null
    numero_identificacion_2?: string | null
    email_2?: string | null
    telefono_2?: string | null
  }
  fechaGeneracion: string
  codigoNegocio: string
}

const VACIO = '—'

/** Ver `sinCortes` en la declaración juramentada: sin separación silábica inglesa. */
const sinCortes = (palabra: string) =>
  palabra.length > 40 ? (palabra.match(/.{1,40}/g) ?? [palabra]) : [palabra]

const BORDE = '1 solid #C9CFD6'

const s = StyleSheet.create({
  page: { paddingTop: 45, paddingBottom: 45, paddingHorizontal: 50, fontSize: 10, fontFamily: 'Helvetica', color: '#111827', lineHeight: 1.4 },
  // Encabezado de carta
  ciudad: { fontSize: 10, marginBottom: 14 },
  destinatario: { marginBottom: 4 },
  destLine: { fontSize: 10 },
  destBold: { fontFamily: 'Helvetica-Bold', fontSize: 10 },
  asunto: { marginBottom: 12, marginTop: 12 },
  asuntoBold: { fontFamily: 'Helvetica-Bold', fontSize: 10 },
  bold: { fontFamily: 'Helvetica-Bold' },
  // Cuerpo
  intro: { marginBottom: 10, textAlign: 'justify' },
  // Ficha de la factura: 4 columnas etiqueta/valor/etiqueta/valor, con la proporción
  // de la plantilla (1900/2900/1900/3140 twips).
  ficha: { borderTop: BORDE, borderLeft: BORDE, marginBottom: 12 },
  fichaTitulo: { backgroundColor: '#2D3B4A', padding: '4 6', borderRight: BORDE, borderBottom: BORDE },
  fichaTituloTexto: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#FFFFFF' },
  fila: { flexDirection: 'row' },
  etiqueta: { backgroundColor: '#EEF1F4', padding: '4 5', borderRight: BORDE, borderBottom: BORDE, justifyContent: 'center' },
  etiquetaTexto: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: '#111827', lineHeight: 1.2 },
  valor: { padding: '4 5', borderRight: BORDE, borderBottom: BORDE, justifyContent: 'center' },
  valorTexto: { fontSize: 9, lineHeight: 1.2 },
  // Totales: tabla de tres columnas
  totales: { borderTop: BORDE, borderLeft: BORDE, marginBottom: 12 },
  totalCelda: { width: '33.333%', padding: '4 5', borderRight: BORDE, borderBottom: BORDE, alignItems: 'center' },
  totalEtiqueta: { fontSize: 8, fontFamily: 'Helvetica-Bold' },
  totalValor: { fontSize: 9 },
  // Cierre
  closing: { marginBottom: 8, textAlign: 'justify' },
  constancia: { marginBottom: 6, textAlign: 'justify' },
  // Firma
  firmas: { flexDirection: 'row', justifyContent: 'space-between' },
  signatureBlock: { marginTop: 8, width: '50%' },
  signatureBlockDoble: { marginTop: 8, width: '47%' },
  signatureLine: { borderTop: '1 solid #111827', marginTop: 36, paddingTop: 3 },
  signatureName: { fontSize: 10, fontFamily: 'Helvetica-Bold' },
  signatureDetail: { fontSize: 9, color: '#444444', marginTop: 1 },
})

const COL = { e1: '19.3%', v1: '29.5%', e2: '19.3%', v2: '31.9%', vAncho: '80.7%' }

/**
 * Negrita del cuerpo. Misma regla que en la declaración juramentada: **una `<B>`
 * nunca va seguida de puntuación pegada** —la coma va DENTRO—, porque `@react-pdf`
 * imprime un guion inexistente si el renglón corta entre una corrida que termina y
 * otra que empieza con puntuación.
 */
function B({ children }: { children: ReactNode }) {
  return <Text style={s.bold} hyphenationCallback={sinCortes}>{children}</Text>
}

function Etiqueta({ ancho, children }: { ancho: string; children: string }) {
  return (
    <View style={[s.etiqueta, { width: ancho }]}>
      <Text style={s.etiquetaTexto} hyphenationCallback={sinCortes}>{children}</Text>
    </View>
  )
}

function Valor({ ancho, children, negrita }: { ancho: string; children: string; negrita?: boolean }) {
  return (
    <View style={[s.valor, { width: ancho }]}>
      <Text style={negrita ? [s.valorTexto, s.bold] : s.valorTexto} hyphenationCallback={sinCortes}>{children}</Text>
    </View>
  )
}

export default function RelacionFacturasPDF({ datos, fechaGeneracion }: RelacionFacturasProps) {
  const titulares = titularesDeDatos(datos, '[NOMBRE COMPLETO DEL SOLICITANTE]')
  const c = concordancia(titulares.length)
  const ciudad = datos.municipio?.trim() || '[CIUDAD]'
  const tipoVehiculo = datos.tipo_vehiculo?.trim().toLowerCase() || 'híbrido / eléctrico'
  const descripcion = [datos.marca, datos.linea].map((v) => v?.trim()).filter(Boolean).join(' ') || VACIO
  const nit = nitBaseYDv(datos.nit_proveedor)
  const radicadoUpme = datos.numero_caso_upme?.trim() || null

  const valorSinIva = fmtCurrency(datos.valor_unitario_sin_iva)
  const ivaPagado = fmtCurrency(datos.valor_iva)
  // IVA exacto de la factura, sin redondear (decisión de Mauricio, 2026-10-29).
  const ivaSolicitado = fmtCurrency(datos.valor_iva)

  const { dia, mes, anio } = fechaDeGeneracion(fechaGeneracion)

  return (
    <Document>
      <Page size="LETTER" style={s.page}>

        {/* Ciudad y fecha */}
        <Text style={s.ciudad}>{`${ciudad}, ${dia} de ${mes} de ${anio}`}</Text>

        {/* Destinatario */}
        <View style={s.destinatario}>
          <Text style={s.destLine}>Señores</Text>
          <Text style={s.destBold}>DIRECCIÓN DE IMPUESTOS Y ADUANAS NACIONALES – DIAN</Text>
          <Text style={s.destLine}>Ciudad</Text>
        </View>

        {/* Asunto */}
        <View style={s.asunto}>
          <Text style={s.asuntoBold}>ASUNTO: RELACIÓN DETALLADA DE FACTURAS ELECTRÓNICAS</Text>
          <Text>{`(Solicitud de devolución de IVA – Adquisición de vehículo ${tipoVehiculo})`}</Text>
        </View>

        {/* Introducción */}
        <Text style={s.intro} hyphenationCallback={sinCortes}>
          {c.yo},
          {titulares.map((t, i) => (
            <Text key={i} hyphenationCallback={sinCortes}>
              {i > 0 ? ' y ' : ' '}
              <B>{`${t.nombre},`}</B> {c.identificado} con cédula de ciudadanía No.{' '}
              {/* La coma solo tras el último: «No. X y LUIS …, identificado …, No. Y, en calidad». */}
              <B>{`${t.identificacion ?? '[N.° DE CÉDULA]'}${i === titulares.length - 1 ? ',' : ''}`}</B>
            </Text>
          ))}
          {` en calidad de ${c.solicitante}, ${c.presento} la siguiente relación detallada de las facturas electrónicas correspondientes a la adquisición del vehículo `}
          {/* Sin radicado no se afirma el certificado (nota 1 del encabezado). */}
          {radicadoUpme
            ? <B>{`${tipoVehiculo},`}</B>
            : <B>{`${tipoVehiculo}:`}</B>}
          {radicadoUpme ? ' certificado por la UPME:' : ''}
        </Text>

        {/* Ficha de la factura */}
        <View style={s.ficha} wrap={false}>
          <View style={s.fichaTitulo}>
            <Text style={s.fichaTituloTexto}>FACTURA ELECTRÓNICA No. 1</Text>
          </View>
          <View style={s.fila}>
            <Etiqueta ancho={COL.e1}>Tipo de documento</Etiqueta>
            <Valor ancho={COL.v1}>Factura electrónica de venta</Valor>
            <Etiqueta ancho={COL.e2}>N.° de factura (incluye prefijo)</Etiqueta>
            <Valor ancho={COL.v2}>{datos.numero_factura?.trim() || VACIO}</Valor>
          </View>
          <View style={s.fila}>
            <Etiqueta ancho={COL.e1}>Fecha de expedición</Etiqueta>
            <Valor ancho={COL.v1}>{fechaCorta(datos.fecha_factura)}</Valor>
            <Etiqueta ancho={COL.e2}>Tarifa de IVA pagada</Etiqueta>
            <Valor ancho={COL.v2}>{tarifaIva(datos.valor_iva, datos.valor_unitario_sin_iva, '[TARIFA DE IVA]')}</Valor>
          </View>
          <View style={s.fila}>
            <Etiqueta ancho={COL.e1}>NIT del proveedor</Etiqueta>
            <Valor ancho={COL.v1}>{nit?.base ?? VACIO}</Valor>
            <Etiqueta ancho={COL.e2}>Dígito de verificación (DV)</Etiqueta>
            <Valor ancho={COL.v2}>{nit?.dv ?? VACIO}</Valor>
          </View>
          <View style={s.fila}>
            <Etiqueta ancho={COL.e1}>Nombre o razón social</Etiqueta>
            <Valor ancho={COL.vAncho}>{datos.nombre_proveedor?.trim() || VACIO}</Valor>
          </View>
          <View style={s.fila}>
            <Etiqueta ancho={COL.e1}>Descripción del bien</Etiqueta>
            <Valor ancho={COL.vAncho}>{descripcion}</Valor>
          </View>
          <View style={s.fila}>
            <Etiqueta ancho={COL.e1}>Valor antes de IVA (COP)</Etiqueta>
            <Valor ancho={COL.v1}>{valorSinIva}</Valor>
            <Etiqueta ancho={COL.e2}>IVA pagado (COP)</Etiqueta>
            <Valor ancho={COL.v2}>{ivaPagado}</Valor>
          </View>
          <View style={s.fila}>
            <Etiqueta ancho={COL.e1}>Valor IVA solicitado (COP)</Etiqueta>
            <Valor ancho={COL.v1} negrita>{ivaSolicitado}</Valor>
            <Etiqueta ancho={COL.e2}>N.° certificado UPME</Etiqueta>
            <Valor ancho={COL.v2}>{radicadoUpme ?? VACIO}</Valor>
          </View>
          <View style={s.fila}>
            <Etiqueta ancho={COL.e1}>Fecha certificado UPME</Etiqueta>
            {/* Sin radicado tampoco se imprime una fecha de certificado suelta. */}
            <Valor ancho={COL.vAncho}>{radicadoUpme ? fechaCorta(datos.fecha_certificado) : VACIO}</Valor>
          </View>
        </View>

        {/* Totales */}
        <View style={s.totales} wrap={false}>
          <View style={s.fila}>
            <View style={[s.totalCelda, { backgroundColor: '#EEF1F4' }]}><Text style={s.totalEtiqueta}>TOTAL VALOR BIENES</Text></View>
            <View style={[s.totalCelda, { backgroundColor: '#EEF1F4' }]}><Text style={s.totalEtiqueta}>TOTAL IVA PAGADO</Text></View>
            <View style={[s.totalCelda, { backgroundColor: '#EEF1F4' }]}><Text style={s.totalEtiqueta}>TOTAL IVA SOLICITADO</Text></View>
          </View>
          <View style={s.fila}>
            <View style={s.totalCelda}><Text style={s.totalValor}>{valorSinIva}</Text></View>
            <View style={s.totalCelda}><Text style={s.totalValor}>{ivaPagado}</Text></View>
            <View style={s.totalCelda}><Text style={[s.totalValor, s.bold]}>{ivaSolicitado}</Text></View>
          </View>
        </View>

        {/* Declaración de veracidad */}
        <Text style={s.closing} hyphenationCallback={sinCortes}>
          {`${c.declaro} que la información contenida en la presente relación corresponde fielmente a las facturas electrónicas aportadas como soporte de la solicitud de devolución.`}
        </Text>

        {/* Para constancia */}
        <Text style={s.constancia} hyphenationCallback={sinCortes}>
          Para constancia, se firma en la ciudad de <B>{`${ciudad},`}</B>
          {` a los ${dia} días del mes de ${mes} de ${anio}.`}
        </Text>

        {/* Firmas — una por titular, en un bloque `wrap={false}` (ver la nota en la
            declaración juramentada: se vio el corte al mirar el PDF con dos
            firmantes). En copropiedad van lado a lado para no saltar de hoja. */}
        <View style={s.firmas} wrap={false}>
          {titulares.map((t, i) => (
            <View key={i} style={titulares.length > 1 ? s.signatureBlockDoble : s.signatureBlock}>
              <View style={s.signatureLine}>
                <Text style={s.signatureName}>{t.nombre}</Text>
                <Text style={s.signatureDetail}>{`C.C. No. ${t.identificacion ?? '[N.° DE CÉDULA]'}`}</Text>
                <Text style={s.signatureDetail}>{`Correo electrónico: ${t.email ?? '[CORREO]'}`}</Text>
                <Text style={s.signatureDetail}>{`Celular: ${t.telefono ?? '[CELULAR]'}`}</Text>
              </View>
            </View>
          ))}
        </View>

      </Page>
    </Document>
  )
}
