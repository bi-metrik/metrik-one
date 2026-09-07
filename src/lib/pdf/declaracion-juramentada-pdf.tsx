import type { ReactNode } from 'react'
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import { titularesDeDatos, concordancia } from './titulares'
import { fmtCurrency, fechaLarga } from './formato'

/**
 * Declaración juramentada — plantilla de SOENA recibida el 2026-09-07.
 *
 * Reemplaza por completo la carta a la DIAN que se emitía hasta hoy (Art. 7 del
 * Decreto 1165 de 2019, sin ningún dato del vehículo). La plantilla nueva se funda
 * en el Art. 12 de la Ley 1715 de 2014 y en el Concepto DIAN 000673-int-0063 del
 * 16 de enero de 2026, y sí describe la compra: marca, referencia, fecha, vendedor,
 * factura, valor sin IVA e IVA.
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
 * 2. La identificación va SIN dígito de verificación. La plantilla identifica al
 *    firmante con CÉDULA DE CIUDADANÍA, no con NIT: `nitConDv()` sale de este
 *    documento (sigue vigente en el Formato 010 y en la Relación de facturas, que
 *    sí hablan de NIT).
 *
 * 3. Los datos del certificado UPME son OPCIONALES en `campos_fuente`, pero eso es
 *    una RED DE SEGURIDAD DEL RENDER, no el camino esperado. Desde el 2026-09-07 la
 *    regla del proceso es que en la rama «solo IVA» el cliente entrega el certificado
 *    en la etapa de Anexos, así que el radicado siempre existe: o viene de
 *    `concepto_upme` (Certificación) o de `concepto_upme_anexos`, que es su
 *    alternativa. La degradación de la cláusula SEGUNDO cubre el expediente
 *    incompleto, no una rama del negocio — ver `clausulaSegundo`.
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

const MARCADOR = {
  cedula: '[NÚMERO DE CÉDULA]',
  direccion: '[DIRECCIÓN DE DOMICILIO]',
  ciudad: '[CIUDAD]',
  marca: '[MARCA]',
  linea: '[REFERENCIA / MODELO]',
  fecha: '[FECHA DE ADQUISICIÓN]',
  vendedor: '[VENDEDOR]',
  factura: '[NÚMERO DE FACTURA]',
  valor: '[VALOR ANTES DE IVA]',
  iva: '[VALOR DEL IVA]',
}

const s = StyleSheet.create({
  page: { paddingTop: 50, paddingBottom: 60, paddingHorizontal: 55, fontSize: 10, fontFamily: 'Helvetica', color: '#111827', lineHeight: 1.6 },
  // Encabezado: título + norma. La plantilla nueva NO es una carta (no lleva
  // ciudad, ni "Señores DIAN", ni asunto).
  titulo: { fontSize: 13, fontFamily: 'Helvetica-Bold', textAlign: 'center' },
  subtitulo: { fontSize: 10, fontFamily: 'Helvetica-Bold', textAlign: 'center' },
  norma: { fontSize: 10, textAlign: 'center' },
  encabezado: { marginBottom: 22 },
  // Cuerpo
  intro: { marginBottom: 14, textAlign: 'justify' },
  clause: { marginBottom: 10, textAlign: 'justify' },
  cierre: { marginTop: 10, marginBottom: 18, textAlign: 'justify' },
  bold: { fontFamily: 'Helvetica-Bold' },
  // Firmas
  firmaRol: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#374151', marginBottom: 6 },
  firmaBloque: { marginTop: 20 },
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
 * dos hijos: dos hijos vuelven a ser dos corridas.
 */
function B({ children }: { children: ReactNode }) {
  return <Text style={s.bold} hyphenationCallback={sinCortes}>{children}</Text>
}

export default function DeclaracionJuramentadaPDF({ datos }: DeclaracionJuramentadaProps) {
  const titulares = titularesDeDatos(datos)
  const c = concordancia(titulares.length)
  const dos = titulares.length > 1

  // La plantilla dice "vehículo eléctrico", pero la línea de SOENA cubre también
  // híbridos y PHEV: afirmar bajo juramento que un híbrido es eléctrico contradice
  // la factura y la Relación de facturas del mismo expediente. Se usa el tipo
  // extraído de la factura, con el mismo respaldo que ya usa la Relación.
  const tipoVehiculo = datos.tipo_vehiculo?.trim().toLowerCase() || 'híbrido / eléctrico'
  const marca = datos.marca?.trim() || MARCADOR.marca
  const linea = datos.linea?.trim() || MARCADOR.linea
  const valorSinIva = fmtCurrency(datos.valor_unitario_sin_iva, MARCADOR.valor)
  const valorIva = fmtCurrency(datos.valor_iva, MARCADOR.iva)

  const radicadoUpme = datos.numero_caso_upme?.trim() || null
  const fechaUpme = datos.fecha_certificado?.trim() ? fechaLarga(datos.fecha_certificado) : null

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

        {/* PRIMERO — la compra. Sin "valor total": ver la nota 1 del encabezado. */}
        <Text style={s.clause} hyphenationCallback={sinCortes}>
          <B>PRIMERO. </B>
          Que {c.soy} {c.adquirente} del vehículo {tipoVehiculo} marca{' '}
          <B>{`${marca},`}</B> <B>{`${linea},`}</B> adquirido el{' '}
          {fechaLarga(datos.fecha_factura, MARCADOR.fecha)} a {datos.proveedor?.trim() || MARCADOR.vendedor},
          según factura electrónica <B>{`${datos.numero_factura?.trim() || MARCADOR.factura},`}</B>
          {expedidaANombre} por valor de {valorSinIva}, más IVA de {valorIva}.
        </Text>

        {/* SEGUNDO — factura ⟷ certificado UPME, con degradación por niveles */}
        <Text style={s.clause} hyphenationCallback={sinCortes}>
          <B>SEGUNDO. </B>
          {clausulaSegundo(radicadoUpme, fechaUpme)}
        </Text>

        <Text style={s.clause} hyphenationCallback={sinCortes}>
          <B>TERCERO. </B>
          Que no se ha efectuado devolución ni compensación, parcial ni total, del IVA pagado en la
          adquisición del vehículo descrito, ante ninguna entidad pública ni privada
          {dos ? ', a ninguno de los dos propietarios' : ''}.
        </Text>

        <Text style={s.clause} hyphenationCallback={sinCortes}>
          <B>CUARTO. </B>
          Que el IVA cuya devolución se solicita por valor de {valorIva}, (valor aproximado como lo
          establece el artículo 577 del Estatuto Tributario), no ha sido tratado
          {dos ? ' por ninguno de los propietarios' : ''} como mayor valor del costo del bien, ni como
          deducción en renta, ni como impuesto descontable en IVA, en ninguna declaración tributaria.
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

        {/* Firmas — una por titular.
            `wrap={false}` es obligatorio: con dos firmantes el bloque se partía
            entre páginas y el nombre quedaba en una hoja y su cédula en la
            siguiente (PR #277). Una firma partida en un documento que va a la DIAN
            no sirve; así el bloque completo salta de página si no cabe. */}
        {titulares.map((t, i) => (
          <View key={i} style={s.firmaBloque} wrap={false}>
            {dos && (
              <Text style={s.firmaRol}>
                {i === 0 ? 'PRIMER PROPIETARIO – SOLICITANTE' : 'SEGUNDO PROPIETARIO'}
              </Text>
            )}
            <Text style={s.firmaLinea} hyphenationCallback={sinCortes}>Firma: ________________</Text>
            <Text style={s.firmaLinea} hyphenationCallback={sinCortes}>Nombre: {t.nombre}</Text>
            <Text style={s.firmaLinea} hyphenationCallback={sinCortes}>C.C.: {t.identificacion ?? MARCADOR.cedula}</Text>
          </View>
        ))}

      </Page>
    </Document>
  )
}

/**
 * Cláusula SEGUNDO, degradada por niveles según lo que haya del certificado UPME.
 *
 * ⚠️ Esto es una RED DE SEGURIDAD, no el camino esperado. La regla del proceso
 * (Mauricio, 2026-09-07) es que en la rama «solo IVA» el cliente entrega el
 * certificado en Anexos, así que el radicado existe siempre: `campos_fuente` lo lee
 * de `concepto_upme` (Certificación, etapa 9) y, si esa etapa no se recorrió, de
 * `concepto_upme_anexos` (Anexos, etapa 18) como alternativa. El tercer nivel de
 * abajo no describe una rama del negocio: describe un expediente al que le falta el
 * documento, y con esta configuración eso deja de ser lo normal.
 *
 * La degradación es la CONSERVADORA: se retira lo que no se puede respaldar, en vez
 * de imprimir un marcador, un "null" o una frase vacía. Este documento se firma bajo
 * juramento; afirmar que existe un certificado UPME cuyo radicado el expediente no
 * tiene es exactamente lo que no puede pasar.
 *
 *  - radicado + fecha → texto íntegro de la plantilla.
 *  - radicado sin fecha → íntegro menos ", de fecha …". Sigue siendo frecuente:
 *    `fecha_certificado` no es obligatoria en la extracción y falta en la mayoría de
 *    los certificados ya cargados.
 *  - sin radicado → solo lo que la factura prueba: que corresponde al vehículo
 *    descrito. Se cae la mención a la UPME y a la Ley 1715 completa.
 *
 * ⚠️ PENDIENTE con Deisy Ramírez (SOENA): confirmar el texto del tercer nivel. Es una
 * decisión de MéTRIK, no un texto que el cliente haya aprobado. Ya no urge tanto como
 * cuando se escribió —dejó de ser el caso de toda una rama— pero sigue abierto.
 */
function clausulaSegundo(radicado: string | null, fecha: string | null): string {
  if (!radicado) {
    return 'Que la factura relacionada en la Relación de Factura adjunta corresponde a la adquisición del vehículo descrito en la cláusula anterior.'
  }
  const conFecha = fecha ? `, de fecha ${fecha}` : ''
  return `Que la factura relacionada en la Relación de Factura adjunta corresponde a la adquisición del vehículo descrito, certificado por la UPME mediante Certificado Radicado No. ${radicado}${conFecha}, habilitando los incentivos de la Ley 1715 de 2014.`
}

export { clausulaSegundo }
