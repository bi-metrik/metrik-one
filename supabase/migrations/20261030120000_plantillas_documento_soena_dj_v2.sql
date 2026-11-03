-- Plantillas editables de SOENA: versión 2 de la Declaración juramentada — 2026-10-30.
--
-- TOCA DATOS DE SOENA (workspace 7dea141d-d4da-483d-a78d-b14ef35500c5). Requiere
-- 20261029203000_plantillas_documento.sql y 20261029203100_plantillas_documento_soena_v1.sql
-- aplicadas antes.
--
-- Plantilla v2 de Deisy Ramírez (2026-10-29, SOE-033): la ÚNICA diferencia con la v1 es que
-- CUARTO ya no dice «, (valor aproximado como lo establece el artículo 577 del Estatuto
-- Tributario)». La DIAN rechaza el trámite si el valor aparece como aproximado, y el valor ya
-- es el IVA exacto de la factura desde el PR #1355.
--
-- La versión 1 ya sembrada NO se toca: las versiones son inmutables (insert-only). Se agrega
-- una versión nueva con el texto de `DJ_V1` en `src/lib/plantillas-documento/v1.ts`, copia byte
-- a byte (`plantillas-sql.test.ts` lo compara). La Relación de facturas no cambia.
--
-- NO activa nada: SOENA sigue con el PDF de @react-pdf (que desde este mismo PR imprime el
-- CUARTO corregido) hasta que una de las personas de la lista active una versión desde la app.
--
-- Idempotente: si ya hay una versión de la DJ de SOENA con este texto exacto, no inserta.
-- Numeración: siguiente al máximo actual (será 2 salvo que alguien ya haya guardado otra
-- versión desde la app; la llave única (workspace_id, tipo, version_n) no deja chocar).
-- Verifica al final y ABORTA si el texto no quedó o si la v1 no existía.

do $v2$
declare
  ws constant uuid := '7dea141d-d4da-483d-a78d-b14ef35500c5';
  texto constant text := $plantilla${{#centrado}}
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
$plantilla$;
  siguiente integer;
begin
  if not exists (
    select 1 from public.plantillas_documento_versiones
    where workspace_id = ws and tipo = 'declaracion-juramentada' and version_n = 1
  ) then
    raise exception 'SOENA no tiene la versión 1 de la declaración juramentada: aplicar antes 20261029203100';
  end if;

  if not exists (
    select 1 from public.plantillas_documento_versiones
    where workspace_id = ws and tipo = 'declaracion-juramentada' and contenido = texto
  ) then
    select coalesce(max(version_n), 0) + 1 into siguiente
    from public.plantillas_documento_versiones
    where workspace_id = ws and tipo = 'declaracion-juramentada';

    insert into public.plantillas_documento_versiones
      (workspace_id, tipo, version_n, contenido, nota, creada_por, creada_por_nombre)
    values (ws, 'declaracion-juramentada', siguiente, texto,
      'Plantilla v2 de Deisy 2026-10-29: sin "valor aproximado" (la DIAN rechaza valores aproximados).',
      null, 'MéTRIK');
  end if;

  if not exists (
    select 1 from public.plantillas_documento_versiones
    where workspace_id = ws and tipo = 'declaracion-juramentada' and contenido = texto
      and position('aproximado' in contenido) = 0 and position('577' in contenido) = 0
  ) then
    raise exception 'La versión 2 de la declaración juramentada de SOENA no quedó';
  end if;
end
$v2$;
