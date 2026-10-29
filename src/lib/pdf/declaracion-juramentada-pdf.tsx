import type { ReactNode } from 'react'
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import { titularesDeDatos, concordancia } from './titulares'
import { fmtCurrency, fechaLarga, fechaDeGeneracion } from './formato'

/**
 * Declaración juramentada — plantilla de SOENA recibida el 2026-10-28 (SOE-033),
 * aprobada por Mauricio para usarse TAL CUAL. Sustituye a la del 2026-09-07.
 *
 * Lo que cambió el 2026-10-28 respecto a la de septiembre: cada cláusula ata la
 * factura con su certificado UPME por NÚMERO («factura No. Y», «Certificado UPME
 * No. X») —PRIMERO gana una segunda frase, TERCERO y CUARTO nombran los dos
 * documentos—; el valor de CUARTO es el «IVA solicitado»; y antes de la firma
 * va «Ciudad y fecha» con el día de generación. La «Nota interna (borrar antes de
 * enviar)» de la plantilla es una instrucción para quien la llena a mano: NO se
 * imprime. Esa nota pide repetir los números por factura cuando hay varias; hoy el
 * expediente tiene una sola factura.
 *
 * La plantilla de septiembre se fundó en el Art. 12 de la Ley 1715 de 2014 y en el
 * Concepto DIAN 000673-int-0063 del 16 de enero de 2026 —reemplazó la carta del
 * Art. 7 del Decreto 1165 de 2019— y la de octubre conserva esa base.
 *
 * Tres decisiones que NO se deben "arreglar" sin hablar con SOENA:
 *
 * 1. NO se imprime el valor total de la factura, aunque la plantilla del cliente lo
 *    traiga. Pedido textual de Deisy Ramírez (directora operativa) el 2026-09-04:
 *    «deja solo el valor del vehículo y el valor del IVA porque dice valor total
 *    pero a veces hay otros impuestos que quedan en el valor entonces para que no
 *    haya conflicto con eso». Es decir: el total de la factura puede incluir
 *    impuesto al consumo, accesorios o matrícula, y afirmarlo bajo juramento como
 *    valor del vehículo abre una contradicción con la Relación de facturas. Solo
 *    salen `valor_unitario_sin_iva` y `valor_iva`.
 *
 * 1b. El «IVA solicitado» de CUARTO es el IVA EXACTO de la factura, sin redondear:
 *    decisión de Mauricio del 2026-10-29 (hasta ese día salía aproximado al mil). El
 *    texto «(valor aproximado como lo establece el artículo 577 del Estatuto
 *    Tributario)» de CUARTO es de la plantilla del cliente y NO se toca aquí: lo
 *    decide Mauricio.
 *
 * 2. La identificación va SIN dígito de verificación. La plantilla identifica al
 *    firmante con CÉDULA DE CIUDADANÍA, no con NIT.
 *
 * 3. Los datos del certificado UPME son OPCIONALES en `campos_fuente`, pero eso es
 *    una RED DE SEGURIDAD DEL RENDER, no el camino esperado. Desde el 2026-09-07 la
 *    regla del proceso es que en la rama «solo IVA» el cliente entrega el certificado
 *    en la etapa de Anexos, así que el radicado siempre existe: o viene de
 *    `concepto_upme` (Certificación) o de `concepto_upme_anexos`, que es su
 *    alternativa. Si aun así falta, el documento NO afirma un certificado que el
 *    expediente no tiene: se caen la segunda frase de PRIMERO, la mención UPME de
 *    SEGUNDO y el «y del Certificado UPME No.» de TERCERO y CUARTO — ver `upme`
 *    dentro del componente. Nunca se imprime un marcador en su lugar.
 *    ⚠️ PENDIENTE con Deisy Ramírez (SOENA): el texto degradado («…corresponde a la
 *    adquisición del vehículo descrito en la cláusula anterior.») es decisión de
 *    MéTRIK; ninguna de las dos plantillas lo trae.
 */
interface DeclaracionJuramentadaProps {
  datos: {
    // ── Titular 1 (RUT del solicitante) ──────────────────────────────────────
    nombre_solicitante: string | null
    /** Cédula de ciudadanía, SIN dígito de verificación. */
    numero_identificacion: string | null
    direccion: string | null
    municipio: string | null
    // ── Vehículo y factura ───────────────────────────────────────────────────
    marca: string | null
    linea: string | null
    tipo_vehiculo: string | null
    fecha_factura: string | null
    proveedor: string | null
    numero_factura: string | null
    /** Base gravable del vehículo, con el descuento ya restado. */
    valor_unitario_sin_iva: string | null
    valor_iva: string | null
    // ── Certificado UPME. Opcionales por si el expediente viene incompleto, no
    //    porque haya una rama sin certificado: en «solo IVA» se entrega en Anexos.
    numero_caso_upme?: string | null
    fecha_certificado?: string | null
    // ── Titular 2 (copropiedad). OPCIONALES: sin ellos sale la variante de un
    //    solo titular, que es la mayoría de los casos. ─────────────────────────
    nombre_solicitante_2?: string | null
    numero_identificacion_2?: string | null
    direccion_2?: string | null
    municipio_2?: string | null
  }
  fechaGeneracion: string
  codigoNegocio: string
}

/**
 * Sin separación silábica.
 *
 * `@react-pdf` trae reglas de inglés y parte palabras españolas donde no
 * corresponde: se midió «Envi-gado» y «jura-mento» en este mismo documento.
 *
 * Va como PROP de cada `<Text>` a propósito: `Font.registerHyphenationCallback`
 * es global del proceso y cambiaría todos los demás PDF de la aplicación.
 *
 * Un token larguísimo sí se deja partir: apagar el corte del todo hace que se
 * salga de la caja, que es peor que un guion.
 *
 * ⚠️ Esto NO cubre el guion que aparece entre dos corridas de texto — ese es otro
 * mecanismo y se evita con la regla de puntuación que documenta `B`.
 */
const sinCortes = (palabra: string) =>
  palabra.length > 40 ? (palabra.match(/.{1,40}/g) ?? [palabra]) : [palabra]

/**
 * Marcadores de lo que falta: el texto de los corchetes de la plantilla del
 * 2026-10-28, para que el operador reconozca la casilla. Los del certificado UPME
 * NO están aquí a propósito: sin radicado la frase entera se retira (nota 3).
 */
const MARCADOR = {
  cedula: '[N.° DE CÉDULA]',
  direccion: '[DIRECCIÓN COMPLETA]',
  ciudad: '[CIUDAD]',
  marca: '[MARCA]',
  linea: '[LÍNEA Y MODELO]',
  fecha: '[FECHA DE LA FACTURA]',
  vendedor: '[PROVEEDOR]',
  factura: '[N.° DE FACTURA]',
  valor: '[VALOR]',
  iva: '[IVA PAGADO]',
  ivaSolicitado: '[IVA SOLICITADO]',
}

const s = StyleSheet.create({
  page: { paddingTop: 50, paddingBottom: 50, paddingHorizontal: 55, fontSize: 10, fontFamily: 'Helvetica', color: '#111827', lineHeight: 1.5 },
  // Encabezado: título + norma. La plantilla NO es una carta (no lleva "Señores
  // DIAN" ni asunto); la ciudad y la fecha van al final, antes de la firma.
  titulo: { fontSize: 13, fontFamily: 'Helvetica-Bold', textAlign: 'center' },
  subtitulo: { fontSize: 10, fontFamily: 'Helvetica-Bold', textAlign: 'center' },
  norma: { fontSize: 10, textAlign: 'center' },
  encabezado: { marginBottom: 18 },
  // Cuerpo
  intro: { marginBottom: 10, textAlign: 'justify' },
  clause: { marginBottom: 8, textAlign: 'justify' },
  cierre: { marginTop: 6, marginBottom: 8, textAlign: 'justify' },
  ciudadFecha: { marginBottom: 6 },
  bold: { fontFamily: 'Helvetica-Bold' },
  // Firmas: línea, «Firma» en gris pequeño, nombre y cédula (como la plantilla).
  firmaRol: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#374151', marginBottom: 2 },
  firmas: { flexDirection: 'row', justifyContent: 'space-between' },
  firmaBloque: { marginTop: 18, width: '50%' },
  firmaBloqueDoble: { marginTop: 14, width: '47%' },
  firmaRaya: { borderTop: '1 solid #111827', marginTop: 28, paddingTop: 2 },
  firmaEtiqueta: { fontSize: 8, color: '#7A7A7A' },
  firmaLinea: { fontSize: 10 },
})

/**
 * Negrita del cuerpo.
 *
 * ⚠️⚠️ REGLA AL EDITAR ESTE DOCUMENTO: **una `<B>` nunca puede ir seguida de
 * puntuación pegada.** La coma (o el punto) va DENTRO de la negrita.
 *
 * No es estética: `@react-pdf` arma las sílabas **por corrida de texto**
 * (`wordHyphenation` en `@react-pdf/textkit`) y después marca como punto de
 * separación silábica todo límite cuya sílaba siguiente no sea un espacio
 * (`hyphenated = syllables[index + 1] !== ' '`). Con una negrita que cierra en
 * «2027» y una corrida siguiente que abre en «, adquirido»,
 * el motor considera que «2027» y «,» son la misma palabra partida, y si el
 * renglón corta ahí **imprime un guion que no existe**: se midió `S05 MAX 2027-`
 * seguido de `, adquirido` en el texto del PDF, no solo en el dibujo. Sobre una
 * cédula eso se leería como un error de transcripción en un documento juramentado.
 *
 * `hyphenationCallback` **no lo evita** —ese guion no sale de partir una palabra,
 * sale del límite entre corridas—, así que el único arreglo es no crear el límite.
 * Por eso además el texto se pasa como UNA sola plantilla (`{`${x},`}`) y no como
 * dos hijos: dos hijos vuelven a ser dos corridas. Lo mismo vale para una expresión
 * `{...}` que siga a una `</B>`: su texto tiene que empezar con espacio.
 */
function B({ children }: { children: ReactNode }) {
  return <Text style={s.bold} hyphenationCallback={sinCortes}>{children}</Text>
}

export default function DeclaracionJuramentadaPDF({ datos, fechaGeneracion }: DeclaracionJuramentadaProps) {
  const titulares = titularesDeDatos(datos, '[NOMBRE COMPLETO DEL SOLICITANTE]')
  const c = concordancia(titulares.length)
  const dos = titulares.length > 1

  // La plantilla dice "[híbrido / eléctrico]": se usa el tipo extraído de la
  // factura, porque afirmar bajo juramento que un híbrido es eléctrico contradice la
  // factura y la Relación de facturas del mismo expediente.
  const tipoVehiculo = datos.tipo_vehiculo?.trim().toLowerCase() || 'híbrido / eléctrico'
  const marca = datos.marca?.trim() || MARCADOR.marca
  const linea = datos.linea?.trim() || MARCADOR.linea
  const factura = datos.numero_factura?.trim() || MARCADOR.factura
  const valorSinIva = fmtCurrency(datos.valor_unitario_sin_iva, MARCADOR.valor)
  const valorIva = fmtCurrency(datos.valor_iva, MARCADOR.iva)
  // IVA exacto de la factura, sin redondear (decisión de Mauricio, 2026-10-29).
  const ivaSolicitado = fmtCurrency(datos.valor_iva, MARCADOR.ivaSolicitado)

  // Red de seguridad UPME (nota 3): sin radicado, `upme` es null y ninguna cláusula
  // menciona el certificado. Sin fecha, solo se cae «, de fecha …».
  const radicadoUpme = datos.numero_caso_upme?.trim() || null
  const fechaUpme = datos.fecha_certificado?.trim() ? fechaLarga(datos.fecha_certificado) : null
  const upme = radicadoUpme ? { radicado: radicadoUpme, fecha: fechaUpme } : null

  const ciudadFirma = titulares[0].municipio?.trim() || MARCADOR.ciudad
  const hoy = fechaDeGeneracion(fechaGeneracion)

  // Ordinal de la cláusula de requisitos legales: corre a SEXTO cuando la variante
  // de copropiedad inserta la autorización como QUINTO.
  const ordinalRequisitos = dos ? 'SEXTO' : 'QUINTO'

  // Va como TEXTO, no como un `<Text>` anidado: cada `<Text>` abre una corrida y
  // una corrida que empieza con puntuación imprime un guion inventado (ver `B`).
  const expedidaANombre = dos
    ? ` expedida a nombre de ${titulares[0].nombre} y ${titulares[1].nombre},`
    : ''

  return (
    <Document>
      <Page size="LETTER" style={s.page}>

        {/* Encabezado */}
        <View style={s.encabezado}>
          <Text style={s.titulo}>DECLARACIÓN JURAMENTADA</Text>
          <Text style={s.subtitulo}>Solicitud de Devolución de IVA – Pago de lo No Debido</Text>
          <Text style={s.norma}>Artículo 12, Ley 1715 de 2014</Text>
          <Text style={s.norma}>Concepto DIAN No. 000673-int-0063 del 16 de enero de 2026</Text>
        </View>

        {/* Comparecientes — cada persona con su cédula y su propio domicilio */}
        <Text style={s.intro} hyphenationCallback={sinCortes}>
          {c.yo},
          {titulares.map((t, i) => (
            <Text key={i} hyphenationCallback={sinCortes}>
              {i > 0 ? ' y ' : ' '}
              <B>{`${t.nombre},`}</B> {c.identificado} con cédula de ciudadanía No.{' '}
              <B>{`${t.identificacion ?? MARCADOR.cedula},`}</B> {c.domiciliado} en{' '}
              {t.direccion?.trim() || MARCADOR.direccion}, ciudad de {t.municipio?.trim() || MARCADOR.ciudad}
            </Text>
          ))}
          , {c.personaNatural}, actuando en nombre propio, {c.manifiesto}{' '}
          <B>BAJO LA GRAVEDAD DE JURAMENTO</B> lo siguiente:
        </Text>

        {/* PRIMERO — la compra y, si hay radicado, el certificado que la ampara.
            Sin "valor total": ver la nota 1 del encabezado. */}
        <Text style={s.clause} hyphenationCallback={sinCortes}>
          <B>PRIMERO. </B>
          Que {c.soy} {c.adquirente} del vehículo {tipoVehiculo} marca{' '}
          <B>{`${marca},`}</B> <B>{`${linea},`}</B> adquirido el{' '}
          {fechaLarga(datos.fecha_factura, MARCADOR.fecha)} a {datos.proveedor?.trim() || MARCADOR.vendedor},
          según factura electrónica <B>{`${factura},`}</B>
          {expedidaANombre} por valor de {valorSinIva}, más IVA de {valorIva}.
          {upme && ` Que la factura relacionada corresponde a la adquisición del vehículo ${tipoVehiculo} certificado por la UPME mediante Certificado Radicado `}
          {upme && <B>{`No. ${upme.radicado}`}</B>}
          {upme && ' (factura '}
          {upme && <B>{`No. ${factura}).`}</B>}
        </Text>

        {/* SEGUNDO — factura ⟷ certificado UPME, con degradación por niveles */}
        <Text style={s.clause} hyphenationCallback={sinCortes}>
          <B>SEGUNDO. </B>
          Que la factura <B>{`No. ${factura}`}</B>
          {` relacionada en la Relación de Factura adjunta corresponde a la adquisición del vehículo descrito${upme
            ? `, certificado por la UPME mediante Certificado Radicado No. ${upme.radicado}${upme.fecha ? `, de fecha ${upme.fecha}` : ''}, habilitando los incentivos de la Ley 1715 de 2014.`
            : ' en la cláusula anterior.'}`}
        </Text>

        <Text style={s.clause} hyphenationCallback={sinCortes}>
          <B>TERCERO. </B>
          {`Que no se ha efectuado devolución ni compensación, parcial ni total, del IVA pagado en la adquisición del vehículo descrito, ante ninguna entidad pública ni privada${dos ? ', a ninguno de los dos propietarios' : ''}, respecto de la factura `}
          {upme
            ? <><B>{`No. ${factura}`}</B> y del Certificado UPME <B>{`No. ${upme.radicado}.`}</B></>
            : <B>{`No. ${factura}.`}</B>}
        </Text>

        <Text style={s.clause} hyphenationCallback={sinCortes}>
          <B>CUARTO. </B>
          {`Que el IVA cuya devolución se solicita por valor de ${ivaSolicitado}, (valor aproximado como lo establece el artículo 577 del Estatuto Tributario), correspondiente a la factura `}
          {upme
            ? <><B>{`No. ${factura}`}</B> y al Certificado UPME <B>{`No. ${upme.radicado},`}</B></>
            : <B>{`No. ${factura},`}</B>}
          {' '}no ha sido tratado{dos ? ' por ninguno de los propietarios' : ''} como mayor valor del
          costo del bien, ni como deducción en renta, ni como impuesto descontable en IVA, en ninguna
          declaración tributaria.
        </Text>

        {/* QUINTO — solo en copropiedad: el segundo propietario autoriza al primero
            a adelantar la solicitud. Corre la cláusula de requisitos a SEXTO. */}
        {dos && (
          <Text style={s.clause} hyphenationCallback={sinCortes}>
            <B>QUINTO. </B>
            Que <B>{`${titulares[1].nombre},`}</B> {c.identificado} con cédula de ciudadanía
            No. <B>{`${titulares[1].identificacion ?? MARCADOR.cedula},`}</B> autoriza
            expresamente a <B>{`${titulares[0].nombre},`}</B> {c.identificado} con cédula de
            ciudadanía No. <B>{`${titulares[0].identificacion ?? MARCADOR.cedula},`}</B> para
            presentar y adelantar ante la DIAN la solicitud de devolución del IVA pagado en la adquisición
            del vehículo descrito en la presente declaración, de conformidad con la autorización suscrita
            por ambos propietarios que se adjunta a la solicitud.
          </Text>
        )}

        <Text style={s.clause} hyphenationCallback={sinCortes}>
          <B>{ordinalRequisitos}. </B>
          Que se cumplen todos los requisitos legales para la devolución por pago de lo no debido,
          conforme al parágrafo 3° del artículo 1.3.1.12.24 del Decreto 1625 de 2016, en concordancia con
          el artículo 12 de la Ley 1715 de 2014 y el Concepto DIAN No. 000673-int-0063 del 16 de enero de 2026.
        </Text>

        <Text style={s.cierre} hyphenationCallback={sinCortes}>
          {dos ? 'Suscribimos la presente declaración con' : 'Suscrita con'} plena conciencia de las
          responsabilidades civiles y penales por falsedad en declaraciones bajo juramento (artículos 442
          y 443 del Código Penal colombiano).
        </Text>

        {/* Ciudad y fecha + firmas, en UN bloque `wrap={false}`.
            · Ciudad y fecha: la del domicilio del solicitante y el día en que se
              genera el documento (en Bogotá, no en UTC). Va pegada a las firmas para
              que no quede sola al pie de una hoja con las firmas en la siguiente.
            · Una firma por titular. `wrap={false}` es obligatorio: con dos firmantes
              el bloque se partía entre páginas y el nombre quedaba en una hoja y su
              cédula en la siguiente (PR #277). Una firma partida en un documento que
              va a la DIAN no sirve; así el bloque completo salta de página si no cabe.
            · En copropiedad las dos firmas van lado a lado: apiladas, el texto más
              largo de la plantilla del 2026-10-28 las mandaba siempre a una segunda
              hoja. */}
        <View wrap={false}>
          <Text style={s.ciudadFecha} hyphenationCallback={sinCortes}>
            {`Ciudad y fecha: ${ciudadFirma}, ${hoy.dia} de ${hoy.mes} de ${hoy.anio}`}
          </Text>
          <View style={s.firmas}>
            {titulares.map((t, i) => (
              <View key={i} style={dos ? s.firmaBloqueDoble : s.firmaBloque}>
                {dos && (
                  <Text style={s.firmaRol}>
                    {i === 0 ? 'PRIMER PROPIETARIO – SOLICITANTE' : 'SEGUNDO PROPIETARIO'}
                  </Text>
                )}
                <View style={s.firmaRaya}>
                  <Text style={s.firmaEtiqueta}>Firma</Text>
                </View>
                <Text style={s.firmaLinea} hyphenationCallback={sinCortes}>{`Nombre: ${t.nombre}`}</Text>
                <Text style={s.firmaLinea} hyphenationCallback={sinCortes}>{`C.C.: ${t.identificacion ?? MARCADOR.cedula}`}</Text>
              </View>
            ))}
          </View>
        </View>

      </Page>
    </Document>
  )
}
