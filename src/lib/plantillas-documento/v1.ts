/**
 * Versión 1 de las plantillas editables: la traducción a la sintaxis de `sintaxis.ts` de
 * lo que imprimen hoy `declaracion-juramentada-pdf.tsx` y `relacion-facturas-pdf.tsx`
 * (plantillas de Deisy Ramírez del 2026-10-28, SOE-033, aprobadas tal cual).
 *
 * 2026-10-29, plantilla v2 de Deisy: el CUARTO de la DJ ya no dice «(valor aproximado como
 * lo establece el artículo 577 del Estatuto Tributario)»; la DIAN rechaza el trámite si el
 * valor aparece aproximado. `DJ_V1` lleva el texto CORREGIDO: la versión 1 sembrada en
 * SOENA (`20261029203100_*`, inmutable) conserva la frase y la versión 2
 * (`20261030120000_plantillas_documento_soena_dj_v2.sql`) lleva ESTE texto byte a byte.
 * La Relación no cambió. `plantillas-sql.test.ts` compara las dos semillas y `v1.test.ts`
 * compara el texto del PDF de cada caso contra el del componente @react-pdf.
 *
 * Diferencias deliberadas con el componente, ninguna de texto:
 * - «Firma» bajo la raya sale en el tamaño del cuerpo (el componente lo ponía en 8 pt gris).
 * - La ficha de la Relación conserva las 4 columnas y el orden de lectura.
 */

export const DJ_V1 = `{{#centrado}}
# DECLARACIÓN JURAMENTADA
## Solicitud de Devolución de IVA – Pago de lo No Debido
Artículo 12, Ley 1715 de 2014
Concepto DIAN No. 000673-int-0063 del 16 de enero de 2026
{{/centrado}}

{{#justificado}}
{{frase_yo}},{{#cada titular}}{{#si titular.es_primero}} {{sino}} y {{/si}}**{{titular.nombre}},** {{frase_identificado}} con cédula de ciudadanía No. **{{titular.cedula}},** {{frase_domiciliado}} en {{titular.direccion}}, ciudad de {{titular.municipio}}{{/cada}}, {{frase_persona_natural}}, actuando en nombre propio, {{frase_manifiesto}} **BAJO LA GRAVEDAD DE JURAMENTO** lo siguiente:

**PRIMERO.** Que {{frase_soy}} {{frase_adquirente}} del vehículo {{tipo_vehiculo}} marca **{{marca}},** **{{linea}},** adquirido el {{fecha_factura_larga}} a {{proveedor}}, según factura electrónica **{{numero_factura}},**{{#si dos_titulares}} expedida a nombre de {{nombre_solicitante}} y {{nombre_solicitante_2}},{{/si}} por valor de {{valor_sin_iva}}, más IVA de {{valor_iva}}.{{#si hay_radicado_upme}} Que la factura relacionada corresponde a la adquisición del vehículo {{tipo_vehiculo}} certificado por la UPME mediante Certificado Radicado **No. {{numero_caso_upme}}** (factura **No. {{numero_factura}}).**{{/si}}

**SEGUNDO.** Que la factura **No. {{numero_factura}}** relacionada en la Relación de Factura adjunta corresponde a la adquisición del vehículo descrito{{#si hay_radicado_upme}}, certificado por la UPME mediante Certificado Radicado No. {{numero_caso_upme}}{{#si hay_fecha_certificado}}, de fecha {{fecha_certificado_larga}}{{/si}}, habilitando los incentivos de la Ley 1715 de 2014.{{sino}} en la cláusula anterior.{{/si}}

**TERCERO.** Que no se ha efectuado devolución ni compensación, parcial ni total, del IVA pagado en la adquisición del vehículo descrito, ante ninguna entidad pública ni privada{{#si dos_titulares}}, a ninguno de los dos propietarios{{/si}}, respecto de la factura {{#si hay_radicado_upme}}**No. {{numero_factura}}** y del Certificado UPME **No. {{numero_caso_upme}}.**{{sino}}**No. {{numero_factura}}.**{{/si}}

**CUARTO.** Que el IVA cuya devolución se solicita por valor de {{iva_solicitado}}, correspondiente a la factura {{#si hay_radicado_upme}}**No. {{numero_factura}}** y al Certificado UPME **No. {{numero_caso_upme}},**{{sino}}**No. {{numero_factura}},**{{/si}} no ha sido tratado{{#si dos_titulares}} por ninguno de los propietarios{{/si}} como mayor valor del costo del bien, ni como deducción en renta, ni como impuesto descontable en IVA, en ninguna declaración tributaria.

{{#si dos_titulares}}
**QUINTO.** Que **{{nombre_solicitante_2}},** {{frase_identificado}} con cédula de ciudadanía No. **{{numero_identificacion_2}},** autoriza expresamente a **{{nombre_solicitante}},** {{frase_identificado}} con cédula de ciudadanía No. **{{numero_identificacion}},** para presentar y adelantar ante la DIAN la solicitud de devolución del IVA pagado en la adquisición del vehículo descrito en la presente declaración, de conformidad con la autorización suscrita por ambos propietarios que se adjunta a la solicitud.
{{/si}}

**{{#si dos_titulares}}SEXTO.{{sino}}QUINTO.{{/si}}** Que se cumplen todos los requisitos legales para la devolución por pago de lo no debido, conforme al parágrafo 3° del artículo 1.3.1.12.24 del Decreto 1625 de 2016, en concordancia con el artículo 12 de la Ley 1715 de 2014 y el Concepto DIAN No. 000673-int-0063 del 16 de enero de 2026.

{{#si dos_titulares}}Suscribimos la presente declaración con{{sino}}Suscrita con{{/si}} plena conciencia de las responsabilidades civiles y penales por falsedad en declaraciones bajo juramento (artículos 442 y 443 del Código Penal colombiano).
{{/justificado}}

{{#junto}}
Ciudad y fecha: {{municipio}}, {{fecha_generacion_larga}}
{{#firmas}}
{{#si dos_titulares}}
**{{#si titular.es_primero}}PRIMER PROPIETARIO – SOLICITANTE{{sino}}SEGUNDO PROPIETARIO{{/si}}**
{{/si}}
---
Firma
Nombre: {{titular.nombre}}
C.C.: {{titular.cedula}}
{{/firmas}}
{{/junto}}
`

export const RELACION_V1 = `{{municipio}}, {{fecha_generacion_larga}}

Señores
**DIRECCIÓN DE IMPUESTOS Y ADUANAS NACIONALES – DIAN**
Ciudad

**ASUNTO: RELACIÓN DETALLADA DE FACTURAS ELECTRÓNICAS**
(Solicitud de devolución de IVA – Adquisición de vehículo {{tipo_vehiculo}})

{{#justificado}}
{{frase_yo}},{{#cada titular}}{{#si titular.es_primero}} {{sino}} y {{/si}}**{{titular.nombre}},** {{frase_identificado}} con cédula de ciudadanía No. **{{titular.cedula}}{{#si titular.es_ultimo}},{{/si}}**{{/cada}} en calidad de {{frase_solicitante}}, {{frase_presento}} la siguiente relación detallada de las facturas electrónicas correspondientes a la adquisición del vehículo {{#si hay_radicado_upme}}**{{tipo_vehiculo}},** certificado por la UPME:{{sino}}**{{tipo_vehiculo}}:**{{/si}}
{{/justificado}}

|# FACTURA ELECTRÓNICA No. 1 |
|! Tipo de documento | Factura electrónica de venta |! N.° de factura (incluye prefijo) | {{numero_factura}} |
|! Fecha de expedición | {{fecha_factura_corta}} |! Tarifa de IVA pagada | {{tarifa_iva}} |
|! NIT del proveedor | {{nit_proveedor_base}} |! Dígito de verificación (DV) | {{nit_proveedor_dv}} |
|! Nombre o razón social | {{nombre_proveedor}} |
|! Descripción del bien | {{descripcion_bien}} |
|! Valor antes de IVA (COP) | {{valor_sin_iva}} |! IVA pagado (COP) | {{valor_iva}} |
|! Valor IVA solicitado (COP) | **{{iva_solicitado}}** |! N.° certificado UPME | {{numero_caso_upme}} |
|! Fecha certificado UPME | {{fecha_certificado_corta}} |

{{#centrado}}
|! TOTAL VALOR BIENES |! TOTAL IVA PAGADO |! TOTAL IVA SOLICITADO |
| {{valor_sin_iva}} | {{valor_iva}} | **{{iva_solicitado}}** |
{{/centrado}}

{{#justificado}}
{{frase_declaro}} que la información contenida en la presente relación corresponde fielmente a las facturas electrónicas aportadas como soporte de la solicitud de devolución.

Para constancia, se firma en la ciudad de **{{municipio}},** a los {{fecha_generacion_dia}} días del mes de {{fecha_generacion_mes}} de {{fecha_generacion_anio}}.
{{/justificado}}

{{#firmas}}
---
**{{titular.nombre}}**
C.C. No. {{titular.cedula}}
Correo electrónico: {{titular.correo}}
Celular: {{titular.celular}}
{{/firmas}}
`

export const PLANTILLAS_V1 = {
  'declaracion-juramentada': DJ_V1,
  'relacion-facturas': RELACION_V1,
} as const
