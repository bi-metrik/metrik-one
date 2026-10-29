-- ============================================================================
-- Valida · los Términos de los 4 CDA pasan de la v1.4 a la v1.5 POR AVISO (cláusula 13.1 de la v1.4)
-- Preparado el 2026-10-29 (decisión de Mauricio, redacción de Emilio, gate de Vera). Lo corre la sesión
-- principal con el OK de Mauricio sobre el texto final.
--
-- La v1.5: suscripción de fecha a fecha, 5 días de gracia, Suspendido por pago (días 6 a 30), Cancelado
-- (desde el 31); al día al 30-nov-2026 sin condonar cuotas (11.7); aceptación en la app (16.4). Se avisa
-- POR LA PLATAFORMA: desde `publicada_at`, todos los usuarios del CDA ven al entrar a /valida la pantalla de
-- aceptación (anexo A de la fuente), y la persona designada puede aceptarla con el mismo mecanismo y la
-- misma constancia de la v1.3/v1.4. No aceptarla no pausa ni restringe nada (la exigencia de la 16.4,
-- desde el 22-dic Maxitec y el 16-ene los otros tres, NO está construida).
--
-- Por cada CDA, en UNA transacción: la v1.4 queda vigente hasta el 2026-11-30 (`vigente_hasta`, lo único
-- que la inmutabilidad deja mover) y se registra la v1.5 con `rige_por_aviso = true`,
-- `reemplaza_version_id` = la v1.4, `vigente_desde = 2026-12-01` (publicación + 30 días calendario; la
-- base lo vuelve a exigir en `documentos_versiones_por_aviso()`) y `publicada_at`:
--   · corrido ANTES del domingo 1-nov 00:00 Bogotá (p. ej. el viernes 30-oct): `publicada_at` = 2026-11-01
--     00:00 Bogotá. Exige la migración 20261029190000 (la guarda admite programar el aviso hasta 7 días
--     antes). La plataforma no lo muestra, ni deja aceptarlo, antes de esa hora;
--   · corrido el domingo 1-nov (Bogotá): `publicada_at` = el momento de correrlo. No exige la migración;
--   · otro día: no corre (los textos dicen «publicado el 1 de noviembre de 2026» y «desde el 1 de
--     diciembre de 2026»).
--
-- ⚠️ ESTO NO ESTÁ APLICADO. Escribe datos de producción.
--
-- ── Orden (sesión principal) ────────────────────────────────────────────────
--   0. (Solo para registrar antes del domingo) la migración
--      `supabase/migrations/20261029190000_terminos_aviso_publicacion_programada.sql` aplicada. DDL: parcha
--      una condición de una función de trigger sobre su definición viva. El código de hoy no depende de ella.
--   1. El PR mergeado y DESPLEGADO. ⚠️ Sin el código nuevo: (a) la app vieja mostraría la v1.5 desde que se
--      registra, aunque `publicada_at` sea el domingo (no filtra avisos futuros); (b) mostraría el aviso de
--      la v1.4 Y el de la v1.5 a Caquetá y Maxitec; (c) no aplicaría la transición de la 11.7: Caquetá,
--      Puertotest y Maxitec quedarían con consultas restringidas desde el 6-nov y Valida pausada desde el
--      27-nov, contra lo que promete el texto.
--   2. Subir los 4 PDF al bucket `aceptaciones-documentos`, cada uno en
--      `<espacio>/terminos-suscripcion-valida-cda-v1.5.pdf`, SIN upsert (si ya hay un objeto con ese
--      nombre, parar y avisar: no se pisa evidencia). Los archivos son los de
--      `proyectos/metrik/valida/docs/entrega/legal/terminos-cda-v1.5/<espacio>/`, y antes de subirlos
--      `sha256sum` tiene que dar exactamente la huella de `c_pdf_sha256` de su bloque (tabla de abajo).
--      WeasyPrint no genera bytes idénticos dos veces: regenerar los PDF obliga a regenerar este archivo.
--        curl -X POST "$URL/storage/v1/object/aceptaciones-documentos/<espacio>/terminos-suscripcion-valida-cda-v1.5.pdf" \
--          -H "Authorization: Bearer $SERVICE_ROLE" -H "Content-Type: application/pdf" \
--          --data-binary @<ruta del PDF>
--   3. Por cada CDA, el bloque tal cual (ENSAYO): tiene que terminar en «ENSAYO OK <espacio>: …
--      Nada quedó escrito». Es UN statement: el ensayo deshace todo aunque pase por el pooler.
--   4. Cambiar `c_ensayo` a false en ese bloque y correrlo de nuevo: «PUBLICADO <espacio>: … visible desde
--      2026-11-01 00:00 …» (o la hora en que se corrió, si es el domingo).
--   5. El correo del aviso (anexo C): primero en ensayo y después de verdad, desde la raíz de metrik-one:
--        RESEND_API_KEY=… npx tsx scripts/valida-cda/aviso-terminos-v1-5.ts            # ensayo
--        RESEND_API_KEY=… npx tsx scripts/valida-cda/aviso-terminos-v1-5.ts --enviar   # programa y registra
--      Programa en Resend (`scheduled_at`) un correo por correo registrado del CDA, con el PDF adjunto, para
--      el domingo 1-nov a las 08:00 Bogotá (`--hora` lo cambia), y deja su fila en `avisos_cliente` (el
--      webhook de Resend escribe ahí la entrega o el rebote). Sin la v1.5 registrada no manda nada. Un
--      correo programado se cancela con POST https://api.resend.com/emails/<id>/cancel.
--   6. (Opcional) El bloque de QA del final, para CDA Pruebas, y el correo con `--qa`.
--
-- Correr un bloque dos veces es seguro: la segunda corrida se detiene en «la v1.5 de esta empresa ya
-- está registrada. Nada que hacer.» y no escribe.
--
-- ── Qué NO hace ─────────────────────────────────────────────────────────────
--   · No sube los PDF (paso 2) ni manda correos (paso 5).
--   · No registra ninguna aceptación: la hace (si quiere) la persona designada en /valida.
--   · No toca contratos, cuotas ni módulos. La transición de la mora (11.7) la aplica el código al ver la
--     v1.5 registrada y publicada.
--
-- ── Después de publicar (solo lectura) ──────────────────────────────────────
--   select w.slug, d.version, d.publicada_at at time zone 'America/Bogota' as publicada, d.vigente_desde, d.vigente_hasta
--     from public.documentos_contractuales_versiones d
--     join public.servicios_contratados sc on sc.empresa_id = d.empresa_id and sc.estado = 'activo'
--     join public.workspaces w on w.id = sc.workspace_pagador_id
--    where d.slug = 'terminos-suscripcion-valida-cda' and d.version in ('v1.4', 'v1.5')
--    order by w.slug, d.version;
--   -- Quién vio la pantalla y cuándo por primera vez (constancia del preaviso):
--   select w.slug, p.full_name, v.visto_at at time zone 'America/Bogota', v.ip
--     from public.avisos_modificacion_vistos v
--     join public.documentos_contractuales_versiones d on d.id = v.documento_version_id and d.version = 'v1.5'
--     join public.workspaces w on w.id = v.workspace_id
--     join public.profiles p on p.id = v.usuario_id
--    order by w.slug, v.visto_at;
--   -- El correo y su acuse:
--   select a.destino, a.estado, a.motivo, a.proveedor_id, a.entregado_at, a.created_at
--     from public.avisos_cliente a
--    where a.titulo = 'Nuevos Términos de tu suscripción a Valida (versión 1.5)'
--    order by a.created_at;
--   -- Quién aceptó la v1.5:
--   select a.workspace_cliente_id, a.nombre_aceptante, a.cedula_aceptante, a.respondido_at, a.ip, a.documento_sha256
--     from public.aceptaciones_terminos a
--    where a.documento_version = 'v1.5' and a.estado = 'aceptado';
--
-- Huellas de la v1.5 (generador en proyectos/metrik/valida/docs/entrega/legal/terminos-cda-v1.5/_generador/,
-- `verificar.py` al lado comprueba que frente a la v1.4 solo cambian las cláusulas del frontmatter `cambian`):
--   cda-caqueta     texto d040e47f7d6abeacfb6be8375b99c1852aef9a9f09462c3f35b2e4ba0df91cd0
--                   PDF   0abb4ff0450e242cc3c2c1eb1c09aa78de4ad666486ebf6f67b679ffcafafde5
--                   12.1 hasta 2027-01-15 · aceptación exigible desde 2027-01-16 (o más tarde, si hay un período pagado)
--   cda-elcarmen    texto 4002351f419b7f90fa802abe08285e3469b24831b9d23362de3fdc435b3265b3
--                   PDF   5ae456f05d8ff8dc4fd63ce0204f499d67bb89eab01362f5254cc1b9741c0b7a
--                   12.1 hasta 2027-01-15 · aceptación exigible desde 2027-01-16 (o más tarde, si hay un período pagado)
--   cda-puertotest  texto 854a30c5f0f42a73f5d3cb710fb2f01eb2367951a723b02a0c9c35e7039dda2f
--                   PDF   c3179b2ce2e70d61f674dcd0521ffd91ecd93c7fffce4548f7a3f5baf34dc597
--                   12.1 hasta 2027-01-15 · aceptación exigible desde 2027-01-16 (o más tarde, si hay un período pagado)
--   maxitec         texto 23f8ad94a689e877dad8a24b8b6c79e56b051f0af02d50fb61dd2a627dad6e10
--                   PDF   eb8a5018a32afea8f0826932d58a65f286a8404f6f7d143584b3ea85f2760032
--                   12.1 hasta 2026-12-21 · aceptación exigible desde 2026-12-22 (o más tarde, si hay un período pagado)
--   cda-pruebas QA  texto 36d7d51fbebe0ea0e738894708a84a54bc0cae6980c8a4d11360f33980a6eb8c
--                   PDF   b12923d3e733d2b1641300004a1b3d46166adccf1aa58d1935da92cdd5c9ce67
--                   12.1 hasta 2027-01-23 · aceptación exigible desde 2027-01-24 (o más tarde, si hay un período pagado)
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- C1 26 1 · espacio `cda-caqueta` · aceptó la v1.3 el 2026-10-02; la v1.4 (por aviso) no
-- La v1.4 (a0bf69e7-5c89-48a7-a6a8-e27e68301438) queda vigente hasta el 30-nov; la v1.5 por aviso rige desde el 1-dic.
-- 12.1 hasta el 2027-01-15; aceptación exigible desde el 2027-01-16 (o el día siguiente
-- al fin del último período pagado, si es posterior).
-- ────────────────────────────────────────────────────────────────────────────
do $bloque$
declare
  -- ⚠️ true = ENSAYO: escribe, comprueba y deshace todo con RAISE EXCEPTION 'ENSAYO OK …'.
  c_ensayo constant boolean := true;
  -- El día (Bogotá) en que se publica el aviso, el que dicen los textos, y la hora (Bogotá) desde la que
  -- se muestra. Corrido ANTES de esa hora (con la migración 20261029190000), la fila queda registrada con
  -- `publicada_at` = esa hora y la plataforma la muestra desde ahí. Corrido ese mismo día después de esa
  -- hora, `publicada_at` = el momento de correrlo. Otro día, no corre: el texto diría una fecha falsa.
  c_publicacion       constant date := date '2026-11-01';
  c_hora_publicacion  constant time := time '00:00';
  c_vigencia          constant date := date '2026-12-01';

  c_ws_metrik      constant uuid := 'a21bfc88-1a60-48c3-afcd-144226aa2392';
  c_registrado_por constant uuid := 'cc6f6100-4eb7-4eed-9a7c-096729f5cedf';  -- Mauricio (platform admin)
  c_slug_doc       constant text := 'terminos-suscripcion-valida-cda';
  c_titulo         constant text := 'Términos de Suscripción al Servicio VALIDA · Plan CDA';
  c_version        constant text := 'v1.5';
  c_ws_cda         constant uuid := 'b58e4b68-8bed-48b6-85f8-01995f64ffe6';
  c_slug_ws        constant text := 'cda-caqueta';
  c_empresa        constant uuid := 'e47db571-029c-45ab-a0e0-860c9d5c62dc';
  c_negocio        constant uuid := '8db0ced7-2ef9-4b18-9e57-de8db0d3fb58';
  c_previa         constant uuid := 'a0bf69e7-5c89-48a7-a6a8-e27e68301438';
  c_previa_version constant text := 'v1.4';
  c_previa_pdf     constant text := 'a59d45b84babebff0910394ea1d8265e2270966df24d280b17d741da885fd268';
  -- La versión que la previa reemplazó (si la previa es por aviso): su aceptación también cubre la v1.5.
  c_anterior_pdf   constant text := 'f876ed626457ac998e25c0e9e710112f9907799e746827d36dd6e990d1cfacd2';
  c_texto_sha256   constant text := 'd040e47f7d6abeacfb6be8375b99c1852aef9a9f09462c3f35b2e4ba0df91cd0';
  c_pdf_sha256     constant text := '0abb4ff0450e242cc3c2c1eb1c09aa78de4ad666486ebf6f67b679ffcafafde5';
  c_pdf_path       constant text := 'cda-caqueta/terminos-suscripcion-valida-cda-v1.5.pdf';
  c_texto constant text := $texto$# TÉRMINOS DE SUSCRIPCIÓN AL SERVICIO VALIDA · PLAN CDA v1.5

**METRIK**: METRIK IA S.A.S., NIT 902.079.601-9, domiciliada en la Calle 24A Bis 100-71, Bogotá D.C., representada legalmente por Brallan Mauricio Moreno Guzmán. Correo: mauricio.moreno@metrik.com.co.

**EL CLIENTE**: CENTRO DE DIAGNOSTICO AUTOMOTOR DEL CAQUETA LIMITADA, NIT 900.156.521-0, domiciliada en CR 17 14 63 67 71 75 BRR LA VEGA, Florencia (Caquetá), representada legalmente por Alba Yurany Rosas Escandón.

Estos Términos rigen desde su aceptación en la forma prevista en la cláusula 16 y constituyen el acuerdo completo entre las Partes sobre el Servicio.

## 0. Antecedente y continuidad

0.1. El Cliente venía accediendo a VALIDA en virtud del Contrato de Prestación de Servicios Tecnológicos de Validación en Listas Vinculantes y Restrictivas suscrito el 16 de julio de 2026 con AFI INTERNATIONAL GROUP S.A.S., terminado de mutuo acuerdo con efectos al 15 de septiembre de 2026.

0.2. VALIDA es de propiedad de METRIK. Estos Términos sustituyen ese contrato **sin interrumpir el servicio** y **respetando el plazo pactado en él**, en los términos de la cláusula 12.1.

0.3. **Versión 1.5.** Esta versión reemplaza la versión 1.4 de estos Términos. Conserva el precio, el alcance de la cláusula 1.2, los usuarios de la cláusula 2.3 y el plazo de la cláusula 12.1. Cambia la forma de pago y lo que ocurre cuando un período no se paga (cláusulas 2.4, 2.5, 2.6, 9.3, 11, 12 y 16.4).

## 1. Objeto y alcance

1.1. METRIK concede al Cliente acceso a **VALIDA**, servicio de computación en la nube para la consulta automatizada de personas naturales y jurídicas contra listas restrictivas y vinculantes utilizadas en la gestión del riesgo de LA/FT/FP (el "Servicio"), a través de su espacio de trabajo en cda-caqueta.metrikone.co.

1.2. El Servicio comprende: acceso a la plataforma, **un (1) usuario administrador y dos (2) usuarios operativos habilitados**, **consultas individuales ilimitadas**, **consultas masivas ilimitadas**, generación de reportes de validación, consulta de listas nacionales e internacionales aplicables al marco normativo colombiano, actualización permanente de las fuentes disponibles y soporte funcional básico.

1.3. El alcance es la consulta de listas del marco SARLAFT según el catálogo vigente publicado en la plataforma. No incluye asesoría jurídica, normativa ni tributaria, ni el diseño u operación del sistema SARLAFT/SAGRILAFT/SIPLAFT del Cliente. Tampoco incluye el acceso por interfaz de programación (API) ni integraciones con otros sistemas, que son otro producto y se contratan aparte, con sus propios términos.

1.4. El Cliente declara que contrata como empresa, para su actividad económica, y no como consumidor final (Ley 1480 de 2011).

## 2. Condiciones comerciales

2.1. **Precio.** La suscripción tiene un valor de **CIENTO CINCUENTA MIL PESOS ($150.000) mensuales**.

2.2. **Tributos.** El Servicio se factura como servicio de computación en la nube (cloud computing) **excluido del impuesto sobre las ventas**, conforme al **numeral 21 del artículo 476 del Estatuto Tributario**. El precio señalado en la cláusula 2.1 es el valor total a cargo del Cliente y no lleva IVA que sumar ni que discriminar. El soporte funcional previsto en la cláusula 1.2 es inherente al acceso al Servicio y no constituye un servicio facturado por separado. Si la autoridad tributaria determina que el Servicio se encuentra gravado, METRIK no trasladará al Cliente el impuesto correspondiente a los períodos ya facturados; para los períodos siguientes, las Partes ajustarán el precio para incorporar el tributo.

2.3. **Usuarios adicionales.** La suscripción incluye un (1) usuario administrador sin costo, que es la persona designada por el Cliente para aceptar estos Términos y gestionar la suscripción, y dos (2) usuarios operativos. Cada usuario operativo adicional tiene un valor de **CINCUENTA MIL PESOS ($50.000) mensuales**, bajo el mismo tratamiento tributario de la cláusula 2.2, y requiere solicitud expresa del Cliente.

2.4. **Pago y período.** La suscripción es mensual y se paga por anticipado. Cada período va desde la fecha de renovación hasta el día anterior a esa misma fecha del mes siguiente. Si ese día no existe en el mes, la renovación es el último día del mes, y al mes siguiente vuelve al día original. La fecha de renovación del Cliente es el día 23 de cada mes, que es el día en que empiezan los períodos que venía pagando, y solo cambia en el caso de la cláusula 11.4. Antes de cada fecha de renovación, METRIK envía al correo registrado y muestra en la plataforma un enlace de pago con el período, el valor y la fecha desde la cual la suscripción quedará Suspendida por pago si no se paga. Cuando la plataforma lo permita, el Cliente puede registrar una tarjeta para que el cobro se haga de forma automática en la fecha de renovación; en ese caso, METRIK solo intenta el cobro automático dentro de los cinco (5) días de gracia de la cláusula 11.1. Un pago hecho antes de la fecha de renovación paga el período que empieza en esa fecha. METRIK expide factura electrónica de venta por cada pago aprobado, por el período que ese pago cubre.

2.5. **Falta de pago.** No pagar un período no genera intereses ni penalidad, y METRIK no cobra los períodos que empiezan desde el **1 de diciembre de 2026** y el Cliente no pagó: su efecto es el de la cláusula 11. Los períodos que empiezan antes de esa fecha se rigen por la cláusula 11.7.

2.6. **Plan Anual.** Si el Cliente compró un Plan Anual conforme a su Anexo, ese Anexo prevalece para los períodos que cubre, que están pagados y a los que no se aplica la cláusula 11.

## 3. Credenciales

3.1. Las credenciales de acceso son personales de cada usuario habilitado, confidenciales e intransferibles.

3.2. El Cliente responde por el uso que se haga con sus credenciales y avisará a METRIK, sin demora, de cualquier uso no autorizado.

3.3. METRIK podrá rotar, suspender o revocar credenciales ante indicios de compromiso, uso indebido o incumplimiento de estos Términos.

## 4. Acceso al servicio, uso permitido y prohibido

4.1. **Exclusividad del acceso.** La suscripción y el acceso al servicio son exclusivos para CENTRO DE DIAGNOSTICO AUTOMOTOR DEL CAQUETA LIMITADA y no se extienden a empresas vinculadas, filiales, subordinadas, matrices, aliados ni terceros. Los usuarios habilitados deben pertenecer al Cliente.

4.2. **Uso permitido.** El Servicio se usa exclusivamente para la prevención y gestión del riesgo de LA/FT/FP en la operación propia del Cliente.

4.3. **Uso prohibido.** El Cliente no podrá ceder, transferir, compartir, sublicenciar ni revender el acceso; prestar con él servicios de consulta a terceros; extraer, copiar o reconstruir las bases de datos; ni usar medios automatizados no autorizados para acceder al Servicio.

4.4. El incumplimiento de esta cláusula faculta a METRIK para suspender el Servicio de inmediato y para terminar estos Términos sin indemnización.

## 5. Naturaleza del resultado

5.1. **Herramienta de apoyo.** VALIDA es una herramienta tecnológica de consulta automatizada. No constituye concepto jurídico ni decisión de vinculación.

5.2. **Responsabilidad del sujeto obligado.** El Cliente, como sujeto obligado, conserva íntegramente sus deberes de debida diligencia y la decisión final sobre cada caso.

5.3. **Clasificación de listas.** Cada resultado indica la naturaleza de la lista consultada.

5.4. **Fuentes.** El contenido corresponde a sus emisores oficiales. METRIK no garantiza la ausencia absoluta de errores, omisiones o modificaciones realizadas por dichos emisores.

## 6. Disponibilidad y soporte

6.1. METRIK realizará esfuerzos razonables para mantener disponible el Servicio y podrá programar mantenimientos, actualizaciones e interrupciones por fuerza mayor.

6.2. El soporte funcional básico se presta por los canales publicados en la plataforma.

## 7. Confidencialidad

7.1. Es Información Confidencial toda información no pública que una Parte reciba de la otra con ocasión de estos Términos.

7.2. La Parte receptora la usará solo para ejecutarlos y la protegerá con al menos el mismo cuidado que aplica a la propia.

7.3. La obligación rige durante la vigencia y **cinco (5) años** después de su terminación.

## 8. Propiedad intelectual

8.1. La plataforma, sus desarrollos, interfaces, bases de datos, metodologías, reportes, algoritmos y marcas son de propiedad exclusiva de METRIK o de sus licenciantes.

8.2. Estos Términos no transfieren derecho de propiedad intelectual alguno al Cliente.

## 9. Tratamiento de datos personales

9.1. Las Partes cumplirán la Ley 1581 de 2012 y las normas que la modifiquen o complementen.

9.2. Respecto de los datos personales que el Cliente consulte en la plataforma, el Cliente actúa como Responsable y METRIK como Encargado, y los trata únicamente conforme a las instrucciones del Cliente y para prestar el Servicio.

9.3. **Conservación y exportación.** Por instrucción del Cliente y para que este pueda cumplir su deber de conservación, METRIK conserva la bitácora de consultas del Cliente y la evidencia asociada (datos consultados, resultado, versión de las listas y reporte con su huella) durante **diez (10) años**, plazo de la Ley 962 de 2005, artículo 28, al que remite la Resolución 2328 de 2025 de la Superintendencia de Transporte (artículo 5.6.11.4). Durante ese plazo esos registros no se suprimen, ni siquiera a solicitud del Cliente o del titular. En cualquier estado de la suscripción, incluida la Cancelada, y aun después de terminados estos Términos, durante ese plazo, el Cliente puede pedir por escrito a mauricio.moreno@metrik.com.co, desde un correo registrado, la **exportación de la bitácora de sus consultas** en formato legible por máquina y de los reportes generados. METRIK la entrega sin costo dentro de los cinco (5) días hábiles siguientes al recibo de la solicitud, o dentro del plazo menor que fije una autoridad si el Cliente lo informa en la solicitud. Los reportes entregados conservan su código de verificación y su huella. METRIK traslada al Cliente, dentro de los dos (2) días hábiles siguientes, toda consulta o reclamo de un titular que reciba.

9.4. **Transmisión internacional.** El Cliente autoriza a METRIK a transmitir los datos personales necesarios para prestar el Servicio a los proveedores de infraestructura en la nube y de fuentes de información que METRIK utilice, incluidos los ubicados fuera de Colombia, conforme al **artículo 26 de la Ley 1581 de 2012** y al **artículo 25 del Decreto 1377 de 2013**. METRIK mantiene publicada en la plataforma la relación de dichos proveedores y exige de ellos garantías de seguridad no inferiores a las propias.

9.5. **Incidentes de seguridad.** METRIK notificará al Cliente cualquier incidente de seguridad que afecte sus datos **dentro de las setenta y dos (72) horas** siguientes a su conocimiento, con la información disponible sobre naturaleza, alcance y medidas adoptadas.

## 10. Responsabilidad

10.1. Las decisiones adoptadas por el Cliente con base en los resultados son de su exclusiva responsabilidad.

10.2. La responsabilidad total de METRIK por cualquier concepto se limita al valor pagado por el Cliente en los tres (3) meses anteriores al hecho que la origine.

## 11. Gracia, suspensión por pago y cancelación

11.1. **Días de gracia.** Si en la fecha de renovación el período no queda pagado, el Cliente sigue consultando con normalidad durante los cinco (5) días calendario siguientes. Desde el día siguiente a la fecha de renovación, la plataforma muestra a los usuarios del Cliente la fecha desde la cual la suscripción quedará Suspendida por pago.

11.2. **Suspendida por pago.** Si el período no se paga dentro de los días de gracia, la suscripción queda **Suspendida por pago** desde el sexto (6.º) día calendario siguiente a la fecha de renovación y hasta el trigésimo (30.º). Mientras está Suspendida por pago, el Cliente no puede hacer consultas nuevas, individuales ni masivas, pero conserva el acceso a la plataforma, sus usuarios siguen habilitados, y puede ver y descargar su historial y los reportes ya generados y exportar la bitácora. Si paga en este estado, las consultas se reactivan y el período pagado corre desde la fecha de renovación original, que no cambia: los días de suspensión hacen parte de ese período.

11.3. **Cancelada.** Si pasan más de treinta (30) días calendario desde la fecha de renovación sin que el período se pague, desde el trigésimo primer (31.º) día la suscripción queda **Cancelada**. Mientras está Cancelada, los usuarios del Cliente pueden entrar a la plataforma, que les muestra que la suscripción está cancelada y que su información está guardada, pero no pueden hacer consultas ni ver el historial ni los reportes en la plataforma. La información del Cliente se conserva íntegra y se puede obtener como dice la cláusula 9.3. Si el Cliente registró una tarjeta, METRIK pide a la pasarela eliminarla y lo informa al correo registrado. La cancelación se debe a la falta de pago del Cliente y no es terminación sin causa por parte de METRIK.

11.4. **Reactivación después de la cancelación.** El Cliente reactiva la suscripción Cancelada pagando un período con el enlace que le envíe METRIK. El nuevo período corre desde el día del pago aprobado, que pasa a ser la nueva fecha de renovación. Con el pago, el Cliente recupera las consultas y el acceso a su historial y a sus reportes. La fecha del pago es la de su registro conforme a la cláusula 11.5.

11.5. **Registro del pago.** El pago hecho por el enlace se registra al ser aprobado. El hecho por otro medio, a más tardar el día hábil siguiente a su acreditación en la cuenta de METRIK.

11.6. **Suspensión por otras causas.** METRIK podrá suspender el Servicio de inmediato ante uso indebido de credenciales, cesión de accesos a terceros, orden de autoridad o actividades que comprometan la seguridad de la plataforma o de la información, y lo informará a los correos registrados.

11.7. **Transición.** Los períodos que empiezan antes del **1 de diciembre de 2026** y no están pagados, sea bajo esta versión o bajo las anteriores, se deben y no se condonan. Para estar al día, el Cliente los paga a más tardar el **30 de noviembre de 2026**. Para efectos de las cláusulas 11.1 a 11.3, esa es su fecha de renovación: si no se pagan, la suscripción queda Suspendida por pago desde el 6 de diciembre de 2026 y Cancelada desde el 31 de diciembre de 2026, y antes de esas fechas METRIK no restringe, suspende ni pausa las consultas por esos períodos. Al pagarlos, el Cliente queda al día y su fecha de renovación es la de la cláusula 2.4. No se aplican la restricción ni la suspensión por mora de las cláusulas 11.1 y 11.3 de la versión 1.4.

## 12. Vigencia, renovación y terminación

12.1. **Plazo de los compromisos de METRIK.** Estos Términos rigen desde su aceptación y mientras el Cliente no se retire. Hasta el **15 de enero de 2027**, fecha en que vencía el contrato terminado con AFI, METRIK mantiene los compromisos de las cláusulas 12.3 y 13, de modo que el Cliente conserva íntegro el plazo que había contratado.

12.2. **Renovación y retiro.** La suscripción se renueva cada mes con el pago del período. El Cliente puede dejar de renovarla en cualquier momento, sin aviso previo y sin penalidad: basta con no pagar el período siguiente o, si registró tarjeta, retirarse desde la plataforma o escribiendo a mauricio.moreno@metrik.com.co. El Cliente conserva las consultas hasta el fin del período pagado; después, la suscripción sigue la cláusula 11.

12.3. **Terminación por METRIK.** Durante el plazo de la cláusula 12.1, METRIK no podrá terminar estos Términos sin causa imputable al Cliente. Después, podrá terminarlos con aviso escrito de treinta (30) días. Podrá terminarlos de inmediato, en cualquier tiempo, por incumplimiento de las cláusulas 3, 4 o 9.

12.4. **Saldo.** Si el Cliente se retira o deja de pagar, no hay reembolso del período ya pagado. Si METRIK termina sin causa imputable al Cliente, reembolsa a prorrata los días no prestados.

12.5. Sobreviven a la terminación las cláusulas 5, 7, 8, 9, 10, 12.4 y 14.

## 13. Modificaciones

13.1. METRIK podrá modificar estos Términos avisando al Cliente con treinta (30) días de anticipación. **Durante el plazo de la cláusula 12.1 ninguna modificación podrá aumentar el precio, reducir el alcance descrito en la cláusula 1.2 ni acortar ese plazo.** Si el Cliente no acepta una modificación, podrá terminar sin penalidad antes de que entre en vigor, con reembolso a prorrata de los días no prestados.

13.2. El precio no se modifica durante el plazo de la cláusula 12.1.

## 14. Ley aplicable, domicilio y controversias

14.1. Estos Términos se rigen por la ley colombiana. Las Partes fijan como domicilio contractual la ciudad de Bogotá D.C. y someterán sus diferencias a la jurisdicción ordinaria colombiana, previo intento de arreglo directo.

## 15. Notificaciones

15.1. Las notificaciones se surten a los correos registrados por cada Parte en la plataforma.

## 16. Aceptación

16.1. Estos Términos se aceptan **en la plataforma**, por el representante legal del Cliente o por quien tenga poder suficiente, mediante la confirmación expresa habilitada para ello. Quien acepta **declara bajo juramento, que se entiende prestado con la aceptación, que cuenta con facultades suficientes para obligar al Cliente**, y responde personalmente en los términos del **artículo 841 del Código de Comercio** si obra sin ellas o las excede.

16.2. La aceptación deja registro de la fecha y hora, el usuario que la realiza, la dirección IP, el dispositivo, la versión aceptada y la huella digital (SHA-256) del documento, y ese registro es la prueba de la aceptación.

16.3. El acceso al Servicio queda habilitado una vez registrada la aceptación.

16.4. **Paso desde la versión 1.4.** Para el Cliente que venía con la versión 1.4, esta versión rige desde que la acepta en la plataforma o, si no la acepta, desde el **1 de diciembre de 2026**, por la cláusula 13.1 de la versión 1.4, que permite modificarla con aviso de treinta (30) días. Antes de esa fecha el Cliente puede terminar sin penalidad, con reembolso a prorrata de los días no prestados del período pagado. El aviso publicado el 1 de noviembre de 2026 es también el aviso de no renovación de la cláusula 12.2 de la versión 1.4: vencido el plazo de la cláusula 12.1, la suscripción continúa solo si el Cliente aceptó esta versión. Desde el **16 de enero de 2027**, o desde el día siguiente al fin del último período pagado si es posterior, sin esa aceptación no se pueden hacer consultas, y el Cliente conserva la exportación de la cláusula 9.3.$texto$;

  v_ahora timestamptz := now();
  v_publicar_en timestamptz := (c_publicacion + c_hora_publicacion) at time zone 'America/Bogota';
  v_publicada_at timestamptz;
  v_previa record;
  v_id uuid;
  v_vigentes int;
begin
  -- ── Lo que tiene que existir antes ─────────────────────────────────────────
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'documentos_contractuales_versiones' and column_name = 'rige_por_aviso'
  ) or to_regclass('public.avisos_modificacion_vistos') is null then
    raise exception 'Falta la migración 20261007150000_terminos_modificacion_por_aviso.sql';
  end if;

  if c_vigencia <> c_publicacion + 30 then
    raise exception 'la vigencia (%) no es la publicación (%) + 30 días calendario (cláusula 13.1 de la v1.4)', c_vigencia, c_publicacion;
  end if;

  -- Cuándo queda publicada: a la hora fijada, o ahora si ya pasó. Siempre el día que dice el texto.
  v_publicada_at := greatest(v_ahora, v_publicar_en);
  if (v_publicada_at at time zone 'America/Bogota')::date <> c_publicacion then
    raise exception '%: hoy es % en Bogotá y el texto dice que el aviso se publica el % (rige el %). Publicar otro día cambia la vigencia: regenerar el texto, el PDF y este archivo con la fecha nueva.',
      c_slug_ws, (v_ahora at time zone 'America/Bogota')::date, c_publicacion, c_vigencia;
  end if;
  if v_publicada_at > v_ahora and not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'documentos_versiones_por_aviso'
       and position('publicacion_programada' in p.prosrc) > 0
  ) then
    raise exception '%: para registrar el aviso antes de publicarlo (%) falta la migración 20261029190000_terminos_aviso_publicacion_programada.sql. Sin ella, este bloque se corre el % (Bogotá).',
      c_slug_ws, v_publicar_en, c_publicacion;
  end if;

  -- Idempotencia: con la v1.5 ya registrada, nada que hacer.
  if exists (
    select 1 from public.documentos_contractuales_versiones d
     where d.empresa_id = c_empresa and d.slug = c_slug_doc and d.version = c_version
  ) then
    raise exception '%: la v1.5 de esta empresa ya está registrada. Nada que hacer.', c_slug_ws;
  end if;

  -- La versión que se modifica: la esperada, de esta empresa, con su huella y sin fecha de retiro.
  select d.id, d.workspace_id, d.linea_id, d.titulo, d.alcance, d.vigente_desde, d.vigente_hasta, d.reemplaza_version_id
    into v_previa
    from public.documentos_contractuales_versiones d
   where d.id = c_previa and d.empresa_id = c_empresa and d.slug = c_slug_doc
     and d.version = c_previa_version and d.pdf_sha256 = c_previa_pdf;
  if not found then
    raise exception '%: la % esperada (%) no está registrada para esta empresa con su huella', c_slug_ws, c_previa_version, c_previa;
  end if;
  if v_previa.workspace_id <> c_ws_metrik or v_previa.alcance <> 'cliente' then
    raise exception '%: la % no es un documento cliente del workspace metrik', c_slug_ws, c_previa_version;
  end if;
  if v_previa.vigente_hasta is not null then
    raise exception '%: la % ya tiene vigente_hasta (%): revisar antes de publicar', c_slug_ws, c_previa_version, v_previa.vigente_hasta;
  end if;
  if v_previa.vigente_desde >= c_vigencia then
    raise exception '%: la % rige desde el %, no antes de la v1.5 (%)', c_slug_ws, c_previa_version, v_previa.vigente_desde, c_vigencia;
  end if;
  -- Ninguna OTRA versión de estos términos vigente hoy o después, salvo la que la previa reemplazó (la
  -- v1.3, vigente hasta el 5-nov) y que ya tiene su fecha de retiro.
  select count(*) into v_vigentes
    from public.documentos_contractuales_versiones d
   where d.empresa_id = c_empresa and d.slug = c_slug_doc and d.id <> c_previa
     and d.id is distinct from v_previa.reemplaza_version_id
     and (d.vigente_hasta is null or d.vigente_hasta >= (v_ahora at time zone 'America/Bogota')::date);
  if v_vigentes > 0 then
    raise exception '%: hay otra versión vigente de los términos de esta empresa además de la %', c_slug_ws, c_previa_version;
  end if;
  if v_previa.reemplaza_version_id is not null and not exists (
    select 1 from public.documentos_contractuales_versiones d
     where d.id = v_previa.reemplaza_version_id and d.vigente_hasta is not null and d.vigente_hasta < c_vigencia
  ) then
    raise exception '%: la versión que la % reemplazó sigue sin fecha de retiro anterior al %', c_slug_ws, c_previa_version, c_vigencia;
  end if;

  -- Un contrato vivo de esta empresa que paga este espacio, con lo que la v1.5 modifica ACEPTADO (la
  -- previa, o la que la previa reemplazó por aviso): sin aceptación no hay qué modificar por aviso.
  if not exists (
    select 1 from public.servicios_contratados sc
     where sc.negocio_id = c_negocio and sc.empresa_id = c_empresa and sc.workspace_pagador_id = c_ws_cda
       and sc.estado not in ('cancelado', 'terminado')
  ) then
    raise exception '%: no hay contrato vivo de esta empresa pagado por el espacio', c_slug_ws;
  end if;
  if not exists (
    select 1 from public.aceptaciones_terminos a
     where a.estado = 'aceptado' and a.documento_sha256 in (c_previa_pdf, c_anterior_pdf) and a.negocio_id = c_negocio
  ) then
    raise exception '%: ni la % ni la versión que reemplazó tienen aceptación registrada en el contrato: la v1.5 no se publica por aviso', c_slug_ws, c_previa_version;
  end if;

  -- El PDF del aviso tiene que estar subido: la pantalla, el aviso y el correo enlazan a él.
  if not exists (select 1 from storage.objects o where o.bucket_id = 'aceptaciones-documentos' and o.name = c_pdf_path) then
    raise exception '%: falta subir el PDF a aceptaciones-documentos/% (paso 2 de la cabecera)', c_slug_ws, c_pdf_path;
  end if;

  -- El texto que se publica es exactamente el generado, con sus fechas.
  if encode(sha256(convert_to(c_texto, 'UTF8')), 'hex') is distinct from c_texto_sha256 then
    raise exception '%: el texto no es el generado (huella distinta). No se edita a mano: se regenera.', c_slug_ws;
  end if;
  if position('# TÉRMINOS DE SUSCRIPCIÓN AL SERVICIO VALIDA · PLAN CDA v1.5' in c_texto) <> 1
     or position('desde el **1 de diciembre de 2026**' in c_texto) = 0
     or position('publicado el 1 de noviembre de 2026' in c_texto) = 0 then
    raise exception '%: el texto no es la v1.5 con publicación el 1-nov y vigencia el 1-dic de 2026', c_slug_ws;
  end if;

  -- ── 1. La previa rige hasta el día anterior a la vigencia de la v1.5 ───────
  update public.documentos_contractuales_versiones
     set vigente_hasta = c_vigencia - 1
   where id = c_previa and vigente_hasta is null;

  -- ── 2. La v1.5 por aviso: se muestra desde `publicada_at` ──────────────────
  insert into public.documentos_contractuales_versiones
    (workspace_id, linea_id, slug, alcance, empresa_id, titulo, version, texto_md, texto_sha256,
     pdf_bucket, pdf_path, pdf_sha256, vigente_desde, rige_por_aviso, reemplaza_version_id, publicada_at,
     registrado_por)
  values
    (v_previa.workspace_id, v_previa.linea_id, c_slug_doc, 'cliente', c_empresa, c_titulo, c_version, c_texto,
     c_texto_sha256, 'aceptaciones-documentos', c_pdf_path, c_pdf_sha256, c_vigencia, true, c_previa, v_publicada_at,
     c_registrado_por)
  returning id into v_id;

  -- ── Comprobación ──────────────────────────────────────────────────────────
  if not exists (
    select 1 from public.documentos_contractuales_versiones d
     where d.id = v_id and d.rige_por_aviso and d.reemplaza_version_id = c_previa
       and d.vigente_desde = c_vigencia and d.publicada_at = v_publicada_at
       and (d.publicada_at at time zone 'America/Bogota')::date = c_publicacion
  ) or not exists (
    select 1 from public.documentos_contractuales_versiones d where d.id = c_previa and d.vigente_hasta = c_vigencia - 1
  ) then
    raise exception '%: la publicación no quedó como se esperaba', c_slug_ws;
  end if;

  if c_ensayo then
    raise exception 'ENSAYO OK %: v1.5 % por aviso, publicada %, rige el %; % vigente hasta el %. Nada quedó escrito.',
      c_slug_ws, v_id, v_publicada_at at time zone 'America/Bogota', c_vigencia, c_previa_version, c_vigencia - 1;
  end if;
  raise notice 'PUBLICADO %: v1.5 % por aviso, visible desde % (Bogotá), rige el %',
    c_slug_ws, v_id, v_publicada_at at time zone 'America/Bogota', c_vigencia;
end;
$bloque$;

-- ────────────────────────────────────────────────────────────────────────────
-- C2 26 1 · espacio `cda-elcarmen` · aceptó la v1.3 el 2026-09-28 y la v1.4 el 2026-10-16
-- La v1.4 (dff0d4e4-0d45-4de7-b8a8-65c3088d9305) queda vigente hasta el 30-nov; la v1.5 por aviso rige desde el 1-dic.
-- 12.1 hasta el 2027-01-15; aceptación exigible desde el 2027-01-16 (o el día siguiente
-- al fin del último período pagado, si es posterior).
-- ────────────────────────────────────────────────────────────────────────────
do $bloque$
declare
  -- ⚠️ true = ENSAYO: escribe, comprueba y deshace todo con RAISE EXCEPTION 'ENSAYO OK …'.
  c_ensayo constant boolean := true;
  -- El día (Bogotá) en que se publica el aviso, el que dicen los textos, y la hora (Bogotá) desde la que
  -- se muestra. Corrido ANTES de esa hora (con la migración 20261029190000), la fila queda registrada con
  -- `publicada_at` = esa hora y la plataforma la muestra desde ahí. Corrido ese mismo día después de esa
  -- hora, `publicada_at` = el momento de correrlo. Otro día, no corre: el texto diría una fecha falsa.
  c_publicacion       constant date := date '2026-11-01';
  c_hora_publicacion  constant time := time '00:00';
  c_vigencia          constant date := date '2026-12-01';

  c_ws_metrik      constant uuid := 'a21bfc88-1a60-48c3-afcd-144226aa2392';
  c_registrado_por constant uuid := 'cc6f6100-4eb7-4eed-9a7c-096729f5cedf';  -- Mauricio (platform admin)
  c_slug_doc       constant text := 'terminos-suscripcion-valida-cda';
  c_titulo         constant text := 'Términos de Suscripción al Servicio VALIDA · Plan CDA';
  c_version        constant text := 'v1.5';
  c_ws_cda         constant uuid := 'e86ab950-961c-481b-9498-79c7d8b18e5e';
  c_slug_ws        constant text := 'cda-elcarmen';
  c_empresa        constant uuid := '382818cb-831b-40f2-8a8d-e54aa7e9e526';
  c_negocio        constant uuid := '72e182e9-4864-41ff-b77b-2b79edbfd81d';
  c_previa         constant uuid := 'dff0d4e4-0d45-4de7-b8a8-65c3088d9305';
  c_previa_version constant text := 'v1.4';
  c_previa_pdf     constant text := '36c794148b3912db0ddec7bd3f089c9a5e185e5e5e2f330d5c06f63b5aafa88f';
  -- La versión que la previa reemplazó (si la previa es por aviso): su aceptación también cubre la v1.5.
  c_anterior_pdf   constant text := 'bb03d0c2c37903e0168d045d9d6055f8e8bb8007b758a39e15d25ba7b1c6ad44';
  c_texto_sha256   constant text := '4002351f419b7f90fa802abe08285e3469b24831b9d23362de3fdc435b3265b3';
  c_pdf_sha256     constant text := '5ae456f05d8ff8dc4fd63ce0204f499d67bb89eab01362f5254cc1b9741c0b7a';
  c_pdf_path       constant text := 'cda-elcarmen/terminos-suscripcion-valida-cda-v1.5.pdf';
  c_texto constant text := $texto$# TÉRMINOS DE SUSCRIPCIÓN AL SERVICIO VALIDA · PLAN CDA v1.5

**METRIK**: METRIK IA S.A.S., NIT 902.079.601-9, domiciliada en la Calle 24A Bis 100-71, Bogotá D.C., representada legalmente por Brallan Mauricio Moreno Guzmán. Correo: mauricio.moreno@metrik.com.co.

**EL CLIENTE**: CENTRO DE DIAGNOSTICO AUTOMOTOR EL CARMEN SAS, NIT 901.079.937-4, domiciliada en CR 11 11 161 BRR VTE, El Cerrito (Valle del Cauca), representada legalmente por Carlos Arnulfo Castro Quintero.

Estos Términos rigen desde su aceptación en la forma prevista en la cláusula 16 y constituyen el acuerdo completo entre las Partes sobre el Servicio.

## 0. Antecedente y continuidad

0.1. El Cliente venía accediendo a VALIDA en virtud del Contrato de Prestación de Servicios Tecnológicos de Validación en Listas Vinculantes y Restrictivas suscrito el 16 de julio de 2026 con AFI INTERNATIONAL GROUP S.A.S., terminado de mutuo acuerdo con efectos al 15 de septiembre de 2026.

0.2. VALIDA es de propiedad de METRIK. Estos Términos sustituyen ese contrato **sin interrumpir el servicio** y **respetando el plazo pactado en él**, en los términos de la cláusula 12.1.

0.3. **Versión 1.5.** Esta versión reemplaza la versión 1.4 de estos Términos. Conserva el precio, el alcance de la cláusula 1.2, los usuarios de la cláusula 2.3 y el plazo de la cláusula 12.1. Cambia la forma de pago y lo que ocurre cuando un período no se paga (cláusulas 2.4, 2.5, 2.6, 9.3, 11, 12 y 16.4).

## 1. Objeto y alcance

1.1. METRIK concede al Cliente acceso a **VALIDA**, servicio de computación en la nube para la consulta automatizada de personas naturales y jurídicas contra listas restrictivas y vinculantes utilizadas en la gestión del riesgo de LA/FT/FP (el "Servicio"), a través de su espacio de trabajo en cda-elcarmen.metrikone.co.

1.2. El Servicio comprende: acceso a la plataforma, **un (1) usuario administrador y dos (2) usuarios operativos habilitados**, **consultas individuales ilimitadas**, **consultas masivas ilimitadas**, generación de reportes de validación, consulta de listas nacionales e internacionales aplicables al marco normativo colombiano, actualización permanente de las fuentes disponibles y soporte funcional básico.

1.3. El alcance es la consulta de listas del marco SARLAFT según el catálogo vigente publicado en la plataforma. No incluye asesoría jurídica, normativa ni tributaria, ni el diseño u operación del sistema SARLAFT/SAGRILAFT/SIPLAFT del Cliente. Tampoco incluye el acceso por interfaz de programación (API) ni integraciones con otros sistemas, que son otro producto y se contratan aparte, con sus propios términos.

1.4. El Cliente declara que contrata como empresa, para su actividad económica, y no como consumidor final (Ley 1480 de 2011).

## 2. Condiciones comerciales

2.1. **Precio.** La suscripción tiene un valor de **CIENTO CINCUENTA MIL PESOS ($150.000) mensuales**.

2.2. **Tributos.** El Servicio se factura como servicio de computación en la nube (cloud computing) **excluido del impuesto sobre las ventas**, conforme al **numeral 21 del artículo 476 del Estatuto Tributario**. El precio señalado en la cláusula 2.1 es el valor total a cargo del Cliente y no lleva IVA que sumar ni que discriminar. El soporte funcional previsto en la cláusula 1.2 es inherente al acceso al Servicio y no constituye un servicio facturado por separado. Si la autoridad tributaria determina que el Servicio se encuentra gravado, METRIK no trasladará al Cliente el impuesto correspondiente a los períodos ya facturados; para los períodos siguientes, las Partes ajustarán el precio para incorporar el tributo.

2.3. **Usuarios adicionales.** La suscripción incluye un (1) usuario administrador sin costo, que es la persona designada por el Cliente para aceptar estos Términos y gestionar la suscripción, y dos (2) usuarios operativos. Cada usuario operativo adicional tiene un valor de **CINCUENTA MIL PESOS ($50.000) mensuales**, bajo el mismo tratamiento tributario de la cláusula 2.2, y requiere solicitud expresa del Cliente.

2.4. **Pago y período.** La suscripción es mensual y se paga por anticipado. Cada período va desde la fecha de renovación hasta el día anterior a esa misma fecha del mes siguiente. Si ese día no existe en el mes, la renovación es el último día del mes, y al mes siguiente vuelve al día original. La fecha de renovación del Cliente es el día 23 de cada mes, que es el día en que empiezan los períodos que venía pagando, y solo cambia en el caso de la cláusula 11.4. Antes de cada fecha de renovación, METRIK envía al correo registrado y muestra en la plataforma un enlace de pago con el período, el valor y la fecha desde la cual la suscripción quedará Suspendida por pago si no se paga. Cuando la plataforma lo permita, el Cliente puede registrar una tarjeta para que el cobro se haga de forma automática en la fecha de renovación; en ese caso, METRIK solo intenta el cobro automático dentro de los cinco (5) días de gracia de la cláusula 11.1. Un pago hecho antes de la fecha de renovación paga el período que empieza en esa fecha. METRIK expide factura electrónica de venta por cada pago aprobado, por el período que ese pago cubre.

2.5. **Falta de pago.** No pagar un período no genera intereses ni penalidad, y METRIK no cobra los períodos que empiezan desde el **1 de diciembre de 2026** y el Cliente no pagó: su efecto es el de la cláusula 11. Los períodos que empiezan antes de esa fecha se rigen por la cláusula 11.7.

2.6. **Plan Anual.** Si el Cliente compró un Plan Anual conforme a su Anexo, ese Anexo prevalece para los períodos que cubre, que están pagados y a los que no se aplica la cláusula 11.

## 3. Credenciales

3.1. Las credenciales de acceso son personales de cada usuario habilitado, confidenciales e intransferibles.

3.2. El Cliente responde por el uso que se haga con sus credenciales y avisará a METRIK, sin demora, de cualquier uso no autorizado.

3.3. METRIK podrá rotar, suspender o revocar credenciales ante indicios de compromiso, uso indebido o incumplimiento de estos Términos.

## 4. Acceso al servicio, uso permitido y prohibido

4.1. **Exclusividad del acceso.** La suscripción y el acceso al servicio son exclusivos para CENTRO DE DIAGNOSTICO AUTOMOTOR EL CARMEN SAS y no se extienden a empresas vinculadas, filiales, subordinadas, matrices, aliados ni terceros. Los usuarios habilitados deben pertenecer al Cliente.

4.2. **Uso permitido.** El Servicio se usa exclusivamente para la prevención y gestión del riesgo de LA/FT/FP en la operación propia del Cliente.

4.3. **Uso prohibido.** El Cliente no podrá ceder, transferir, compartir, sublicenciar ni revender el acceso; prestar con él servicios de consulta a terceros; extraer, copiar o reconstruir las bases de datos; ni usar medios automatizados no autorizados para acceder al Servicio.

4.4. El incumplimiento de esta cláusula faculta a METRIK para suspender el Servicio de inmediato y para terminar estos Términos sin indemnización.

## 5. Naturaleza del resultado

5.1. **Herramienta de apoyo.** VALIDA es una herramienta tecnológica de consulta automatizada. No constituye concepto jurídico ni decisión de vinculación.

5.2. **Responsabilidad del sujeto obligado.** El Cliente, como sujeto obligado, conserva íntegramente sus deberes de debida diligencia y la decisión final sobre cada caso.

5.3. **Clasificación de listas.** Cada resultado indica la naturaleza de la lista consultada.

5.4. **Fuentes.** El contenido corresponde a sus emisores oficiales. METRIK no garantiza la ausencia absoluta de errores, omisiones o modificaciones realizadas por dichos emisores.

## 6. Disponibilidad y soporte

6.1. METRIK realizará esfuerzos razonables para mantener disponible el Servicio y podrá programar mantenimientos, actualizaciones e interrupciones por fuerza mayor.

6.2. El soporte funcional básico se presta por los canales publicados en la plataforma.

## 7. Confidencialidad

7.1. Es Información Confidencial toda información no pública que una Parte reciba de la otra con ocasión de estos Términos.

7.2. La Parte receptora la usará solo para ejecutarlos y la protegerá con al menos el mismo cuidado que aplica a la propia.

7.3. La obligación rige durante la vigencia y **cinco (5) años** después de su terminación.

## 8. Propiedad intelectual

8.1. La plataforma, sus desarrollos, interfaces, bases de datos, metodologías, reportes, algoritmos y marcas son de propiedad exclusiva de METRIK o de sus licenciantes.

8.2. Estos Términos no transfieren derecho de propiedad intelectual alguno al Cliente.

## 9. Tratamiento de datos personales

9.1. Las Partes cumplirán la Ley 1581 de 2012 y las normas que la modifiquen o complementen.

9.2. Respecto de los datos personales que el Cliente consulte en la plataforma, el Cliente actúa como Responsable y METRIK como Encargado, y los trata únicamente conforme a las instrucciones del Cliente y para prestar el Servicio.

9.3. **Conservación y exportación.** Por instrucción del Cliente y para que este pueda cumplir su deber de conservación, METRIK conserva la bitácora de consultas del Cliente y la evidencia asociada (datos consultados, resultado, versión de las listas y reporte con su huella) durante **diez (10) años**, plazo de la Ley 962 de 2005, artículo 28, al que remite la Resolución 2328 de 2025 de la Superintendencia de Transporte (artículo 5.6.11.4). Durante ese plazo esos registros no se suprimen, ni siquiera a solicitud del Cliente o del titular. En cualquier estado de la suscripción, incluida la Cancelada, y aun después de terminados estos Términos, durante ese plazo, el Cliente puede pedir por escrito a mauricio.moreno@metrik.com.co, desde un correo registrado, la **exportación de la bitácora de sus consultas** en formato legible por máquina y de los reportes generados. METRIK la entrega sin costo dentro de los cinco (5) días hábiles siguientes al recibo de la solicitud, o dentro del plazo menor que fije una autoridad si el Cliente lo informa en la solicitud. Los reportes entregados conservan su código de verificación y su huella. METRIK traslada al Cliente, dentro de los dos (2) días hábiles siguientes, toda consulta o reclamo de un titular que reciba.

9.4. **Transmisión internacional.** El Cliente autoriza a METRIK a transmitir los datos personales necesarios para prestar el Servicio a los proveedores de infraestructura en la nube y de fuentes de información que METRIK utilice, incluidos los ubicados fuera de Colombia, conforme al **artículo 26 de la Ley 1581 de 2012** y al **artículo 25 del Decreto 1377 de 2013**. METRIK mantiene publicada en la plataforma la relación de dichos proveedores y exige de ellos garantías de seguridad no inferiores a las propias.

9.5. **Incidentes de seguridad.** METRIK notificará al Cliente cualquier incidente de seguridad que afecte sus datos **dentro de las setenta y dos (72) horas** siguientes a su conocimiento, con la información disponible sobre naturaleza, alcance y medidas adoptadas.

## 10. Responsabilidad

10.1. Las decisiones adoptadas por el Cliente con base en los resultados son de su exclusiva responsabilidad.

10.2. La responsabilidad total de METRIK por cualquier concepto se limita al valor pagado por el Cliente en los tres (3) meses anteriores al hecho que la origine.

## 11. Gracia, suspensión por pago y cancelación

11.1. **Días de gracia.** Si en la fecha de renovación el período no queda pagado, el Cliente sigue consultando con normalidad durante los cinco (5) días calendario siguientes. Desde el día siguiente a la fecha de renovación, la plataforma muestra a los usuarios del Cliente la fecha desde la cual la suscripción quedará Suspendida por pago.

11.2. **Suspendida por pago.** Si el período no se paga dentro de los días de gracia, la suscripción queda **Suspendida por pago** desde el sexto (6.º) día calendario siguiente a la fecha de renovación y hasta el trigésimo (30.º). Mientras está Suspendida por pago, el Cliente no puede hacer consultas nuevas, individuales ni masivas, pero conserva el acceso a la plataforma, sus usuarios siguen habilitados, y puede ver y descargar su historial y los reportes ya generados y exportar la bitácora. Si paga en este estado, las consultas se reactivan y el período pagado corre desde la fecha de renovación original, que no cambia: los días de suspensión hacen parte de ese período.

11.3. **Cancelada.** Si pasan más de treinta (30) días calendario desde la fecha de renovación sin que el período se pague, desde el trigésimo primer (31.º) día la suscripción queda **Cancelada**. Mientras está Cancelada, los usuarios del Cliente pueden entrar a la plataforma, que les muestra que la suscripción está cancelada y que su información está guardada, pero no pueden hacer consultas ni ver el historial ni los reportes en la plataforma. La información del Cliente se conserva íntegra y se puede obtener como dice la cláusula 9.3. Si el Cliente registró una tarjeta, METRIK pide a la pasarela eliminarla y lo informa al correo registrado. La cancelación se debe a la falta de pago del Cliente y no es terminación sin causa por parte de METRIK.

11.4. **Reactivación después de la cancelación.** El Cliente reactiva la suscripción Cancelada pagando un período con el enlace que le envíe METRIK. El nuevo período corre desde el día del pago aprobado, que pasa a ser la nueva fecha de renovación. Con el pago, el Cliente recupera las consultas y el acceso a su historial y a sus reportes. La fecha del pago es la de su registro conforme a la cláusula 11.5.

11.5. **Registro del pago.** El pago hecho por el enlace se registra al ser aprobado. El hecho por otro medio, a más tardar el día hábil siguiente a su acreditación en la cuenta de METRIK.

11.6. **Suspensión por otras causas.** METRIK podrá suspender el Servicio de inmediato ante uso indebido de credenciales, cesión de accesos a terceros, orden de autoridad o actividades que comprometan la seguridad de la plataforma o de la información, y lo informará a los correos registrados.

11.7. **Transición.** Los períodos que empiezan antes del **1 de diciembre de 2026** y no están pagados, sea bajo esta versión o bajo las anteriores, se deben y no se condonan. Para estar al día, el Cliente los paga a más tardar el **30 de noviembre de 2026**. Para efectos de las cláusulas 11.1 a 11.3, esa es su fecha de renovación: si no se pagan, la suscripción queda Suspendida por pago desde el 6 de diciembre de 2026 y Cancelada desde el 31 de diciembre de 2026, y antes de esas fechas METRIK no restringe, suspende ni pausa las consultas por esos períodos. Al pagarlos, el Cliente queda al día y su fecha de renovación es la de la cláusula 2.4. No se aplican la restricción ni la suspensión por mora de las cláusulas 11.1 y 11.3 de la versión 1.4.

## 12. Vigencia, renovación y terminación

12.1. **Plazo de los compromisos de METRIK.** Estos Términos rigen desde su aceptación y mientras el Cliente no se retire. Hasta el **15 de enero de 2027**, fecha en que vencía el contrato terminado con AFI, METRIK mantiene los compromisos de las cláusulas 12.3 y 13, de modo que el Cliente conserva íntegro el plazo que había contratado.

12.2. **Renovación y retiro.** La suscripción se renueva cada mes con el pago del período. El Cliente puede dejar de renovarla en cualquier momento, sin aviso previo y sin penalidad: basta con no pagar el período siguiente o, si registró tarjeta, retirarse desde la plataforma o escribiendo a mauricio.moreno@metrik.com.co. El Cliente conserva las consultas hasta el fin del período pagado; después, la suscripción sigue la cláusula 11.

12.3. **Terminación por METRIK.** Durante el plazo de la cláusula 12.1, METRIK no podrá terminar estos Términos sin causa imputable al Cliente. Después, podrá terminarlos con aviso escrito de treinta (30) días. Podrá terminarlos de inmediato, en cualquier tiempo, por incumplimiento de las cláusulas 3, 4 o 9.

12.4. **Saldo.** Si el Cliente se retira o deja de pagar, no hay reembolso del período ya pagado. Si METRIK termina sin causa imputable al Cliente, reembolsa a prorrata los días no prestados.

12.5. Sobreviven a la terminación las cláusulas 5, 7, 8, 9, 10, 12.4 y 14.

## 13. Modificaciones

13.1. METRIK podrá modificar estos Términos avisando al Cliente con treinta (30) días de anticipación. **Durante el plazo de la cláusula 12.1 ninguna modificación podrá aumentar el precio, reducir el alcance descrito en la cláusula 1.2 ni acortar ese plazo.** Si el Cliente no acepta una modificación, podrá terminar sin penalidad antes de que entre en vigor, con reembolso a prorrata de los días no prestados.

13.2. El precio no se modifica durante el plazo de la cláusula 12.1.

## 14. Ley aplicable, domicilio y controversias

14.1. Estos Términos se rigen por la ley colombiana. Las Partes fijan como domicilio contractual la ciudad de Bogotá D.C. y someterán sus diferencias a la jurisdicción ordinaria colombiana, previo intento de arreglo directo.

## 15. Notificaciones

15.1. Las notificaciones se surten a los correos registrados por cada Parte en la plataforma.

## 16. Aceptación

16.1. Estos Términos se aceptan **en la plataforma**, por el representante legal del Cliente o por quien tenga poder suficiente, mediante la confirmación expresa habilitada para ello. Quien acepta **declara bajo juramento, que se entiende prestado con la aceptación, que cuenta con facultades suficientes para obligar al Cliente**, y responde personalmente en los términos del **artículo 841 del Código de Comercio** si obra sin ellas o las excede.

16.2. La aceptación deja registro de la fecha y hora, el usuario que la realiza, la dirección IP, el dispositivo, la versión aceptada y la huella digital (SHA-256) del documento, y ese registro es la prueba de la aceptación.

16.3. El acceso al Servicio queda habilitado una vez registrada la aceptación.

16.4. **Paso desde la versión 1.4.** Para el Cliente que venía con la versión 1.4, esta versión rige desde que la acepta en la plataforma o, si no la acepta, desde el **1 de diciembre de 2026**, por la cláusula 13.1 de la versión 1.4, que permite modificarla con aviso de treinta (30) días. Antes de esa fecha el Cliente puede terminar sin penalidad, con reembolso a prorrata de los días no prestados del período pagado. El aviso publicado el 1 de noviembre de 2026 es también el aviso de no renovación de la cláusula 12.2 de la versión 1.4: vencido el plazo de la cláusula 12.1, la suscripción continúa solo si el Cliente aceptó esta versión. Desde el **16 de enero de 2027**, o desde el día siguiente al fin del último período pagado si es posterior, sin esa aceptación no se pueden hacer consultas, y el Cliente conserva la exportación de la cláusula 9.3.$texto$;

  v_ahora timestamptz := now();
  v_publicar_en timestamptz := (c_publicacion + c_hora_publicacion) at time zone 'America/Bogota';
  v_publicada_at timestamptz;
  v_previa record;
  v_id uuid;
  v_vigentes int;
begin
  -- ── Lo que tiene que existir antes ─────────────────────────────────────────
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'documentos_contractuales_versiones' and column_name = 'rige_por_aviso'
  ) or to_regclass('public.avisos_modificacion_vistos') is null then
    raise exception 'Falta la migración 20261007150000_terminos_modificacion_por_aviso.sql';
  end if;

  if c_vigencia <> c_publicacion + 30 then
    raise exception 'la vigencia (%) no es la publicación (%) + 30 días calendario (cláusula 13.1 de la v1.4)', c_vigencia, c_publicacion;
  end if;

  -- Cuándo queda publicada: a la hora fijada, o ahora si ya pasó. Siempre el día que dice el texto.
  v_publicada_at := greatest(v_ahora, v_publicar_en);
  if (v_publicada_at at time zone 'America/Bogota')::date <> c_publicacion then
    raise exception '%: hoy es % en Bogotá y el texto dice que el aviso se publica el % (rige el %). Publicar otro día cambia la vigencia: regenerar el texto, el PDF y este archivo con la fecha nueva.',
      c_slug_ws, (v_ahora at time zone 'America/Bogota')::date, c_publicacion, c_vigencia;
  end if;
  if v_publicada_at > v_ahora and not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'documentos_versiones_por_aviso'
       and position('publicacion_programada' in p.prosrc) > 0
  ) then
    raise exception '%: para registrar el aviso antes de publicarlo (%) falta la migración 20261029190000_terminos_aviso_publicacion_programada.sql. Sin ella, este bloque se corre el % (Bogotá).',
      c_slug_ws, v_publicar_en, c_publicacion;
  end if;

  -- Idempotencia: con la v1.5 ya registrada, nada que hacer.
  if exists (
    select 1 from public.documentos_contractuales_versiones d
     where d.empresa_id = c_empresa and d.slug = c_slug_doc and d.version = c_version
  ) then
    raise exception '%: la v1.5 de esta empresa ya está registrada. Nada que hacer.', c_slug_ws;
  end if;

  -- La versión que se modifica: la esperada, de esta empresa, con su huella y sin fecha de retiro.
  select d.id, d.workspace_id, d.linea_id, d.titulo, d.alcance, d.vigente_desde, d.vigente_hasta, d.reemplaza_version_id
    into v_previa
    from public.documentos_contractuales_versiones d
   where d.id = c_previa and d.empresa_id = c_empresa and d.slug = c_slug_doc
     and d.version = c_previa_version and d.pdf_sha256 = c_previa_pdf;
  if not found then
    raise exception '%: la % esperada (%) no está registrada para esta empresa con su huella', c_slug_ws, c_previa_version, c_previa;
  end if;
  if v_previa.workspace_id <> c_ws_metrik or v_previa.alcance <> 'cliente' then
    raise exception '%: la % no es un documento cliente del workspace metrik', c_slug_ws, c_previa_version;
  end if;
  if v_previa.vigente_hasta is not null then
    raise exception '%: la % ya tiene vigente_hasta (%): revisar antes de publicar', c_slug_ws, c_previa_version, v_previa.vigente_hasta;
  end if;
  if v_previa.vigente_desde >= c_vigencia then
    raise exception '%: la % rige desde el %, no antes de la v1.5 (%)', c_slug_ws, c_previa_version, v_previa.vigente_desde, c_vigencia;
  end if;
  -- Ninguna OTRA versión de estos términos vigente hoy o después, salvo la que la previa reemplazó (la
  -- v1.3, vigente hasta el 5-nov) y que ya tiene su fecha de retiro.
  select count(*) into v_vigentes
    from public.documentos_contractuales_versiones d
   where d.empresa_id = c_empresa and d.slug = c_slug_doc and d.id <> c_previa
     and d.id is distinct from v_previa.reemplaza_version_id
     and (d.vigente_hasta is null or d.vigente_hasta >= (v_ahora at time zone 'America/Bogota')::date);
  if v_vigentes > 0 then
    raise exception '%: hay otra versión vigente de los términos de esta empresa además de la %', c_slug_ws, c_previa_version;
  end if;
  if v_previa.reemplaza_version_id is not null and not exists (
    select 1 from public.documentos_contractuales_versiones d
     where d.id = v_previa.reemplaza_version_id and d.vigente_hasta is not null and d.vigente_hasta < c_vigencia
  ) then
    raise exception '%: la versión que la % reemplazó sigue sin fecha de retiro anterior al %', c_slug_ws, c_previa_version, c_vigencia;
  end if;

  -- Un contrato vivo de esta empresa que paga este espacio, con lo que la v1.5 modifica ACEPTADO (la
  -- previa, o la que la previa reemplazó por aviso): sin aceptación no hay qué modificar por aviso.
  if not exists (
    select 1 from public.servicios_contratados sc
     where sc.negocio_id = c_negocio and sc.empresa_id = c_empresa and sc.workspace_pagador_id = c_ws_cda
       and sc.estado not in ('cancelado', 'terminado')
  ) then
    raise exception '%: no hay contrato vivo de esta empresa pagado por el espacio', c_slug_ws;
  end if;
  if not exists (
    select 1 from public.aceptaciones_terminos a
     where a.estado = 'aceptado' and a.documento_sha256 in (c_previa_pdf, c_anterior_pdf) and a.negocio_id = c_negocio
  ) then
    raise exception '%: ni la % ni la versión que reemplazó tienen aceptación registrada en el contrato: la v1.5 no se publica por aviso', c_slug_ws, c_previa_version;
  end if;

  -- El PDF del aviso tiene que estar subido: la pantalla, el aviso y el correo enlazan a él.
  if not exists (select 1 from storage.objects o where o.bucket_id = 'aceptaciones-documentos' and o.name = c_pdf_path) then
    raise exception '%: falta subir el PDF a aceptaciones-documentos/% (paso 2 de la cabecera)', c_slug_ws, c_pdf_path;
  end if;

  -- El texto que se publica es exactamente el generado, con sus fechas.
  if encode(sha256(convert_to(c_texto, 'UTF8')), 'hex') is distinct from c_texto_sha256 then
    raise exception '%: el texto no es el generado (huella distinta). No se edita a mano: se regenera.', c_slug_ws;
  end if;
  if position('# TÉRMINOS DE SUSCRIPCIÓN AL SERVICIO VALIDA · PLAN CDA v1.5' in c_texto) <> 1
     or position('desde el **1 de diciembre de 2026**' in c_texto) = 0
     or position('publicado el 1 de noviembre de 2026' in c_texto) = 0 then
    raise exception '%: el texto no es la v1.5 con publicación el 1-nov y vigencia el 1-dic de 2026', c_slug_ws;
  end if;

  -- ── 1. La previa rige hasta el día anterior a la vigencia de la v1.5 ───────
  update public.documentos_contractuales_versiones
     set vigente_hasta = c_vigencia - 1
   where id = c_previa and vigente_hasta is null;

  -- ── 2. La v1.5 por aviso: se muestra desde `publicada_at` ──────────────────
  insert into public.documentos_contractuales_versiones
    (workspace_id, linea_id, slug, alcance, empresa_id, titulo, version, texto_md, texto_sha256,
     pdf_bucket, pdf_path, pdf_sha256, vigente_desde, rige_por_aviso, reemplaza_version_id, publicada_at,
     registrado_por)
  values
    (v_previa.workspace_id, v_previa.linea_id, c_slug_doc, 'cliente', c_empresa, c_titulo, c_version, c_texto,
     c_texto_sha256, 'aceptaciones-documentos', c_pdf_path, c_pdf_sha256, c_vigencia, true, c_previa, v_publicada_at,
     c_registrado_por)
  returning id into v_id;

  -- ── Comprobación ──────────────────────────────────────────────────────────
  if not exists (
    select 1 from public.documentos_contractuales_versiones d
     where d.id = v_id and d.rige_por_aviso and d.reemplaza_version_id = c_previa
       and d.vigente_desde = c_vigencia and d.publicada_at = v_publicada_at
       and (d.publicada_at at time zone 'America/Bogota')::date = c_publicacion
  ) or not exists (
    select 1 from public.documentos_contractuales_versiones d where d.id = c_previa and d.vigente_hasta = c_vigencia - 1
  ) then
    raise exception '%: la publicación no quedó como se esperaba', c_slug_ws;
  end if;

  if c_ensayo then
    raise exception 'ENSAYO OK %: v1.5 % por aviso, publicada %, rige el %; % vigente hasta el %. Nada quedó escrito.',
      c_slug_ws, v_id, v_publicada_at at time zone 'America/Bogota', c_vigencia, c_previa_version, c_vigencia - 1;
  end if;
  raise notice 'PUBLICADO %: v1.5 % por aviso, visible desde % (Bogotá), rige el %',
    c_slug_ws, v_id, v_publicada_at at time zone 'America/Bogota', c_vigencia;
end;
$bloque$;

-- ────────────────────────────────────────────────────────────────────────────
-- C3 26 1 · espacio `cda-puertotest` · aceptó la v1.3 el 2026-09-25 y la v1.4 el 2026-10-15
-- La v1.4 (c081b60d-7821-4138-a112-5c13b85f748c) queda vigente hasta el 30-nov; la v1.5 por aviso rige desde el 1-dic.
-- 12.1 hasta el 2027-01-15; aceptación exigible desde el 2027-01-16 (o el día siguiente
-- al fin del último período pagado, si es posterior).
-- ────────────────────────────────────────────────────────────────────────────
do $bloque$
declare
  -- ⚠️ true = ENSAYO: escribe, comprueba y deshace todo con RAISE EXCEPTION 'ENSAYO OK …'.
  c_ensayo constant boolean := true;
  -- El día (Bogotá) en que se publica el aviso, el que dicen los textos, y la hora (Bogotá) desde la que
  -- se muestra. Corrido ANTES de esa hora (con la migración 20261029190000), la fila queda registrada con
  -- `publicada_at` = esa hora y la plataforma la muestra desde ahí. Corrido ese mismo día después de esa
  -- hora, `publicada_at` = el momento de correrlo. Otro día, no corre: el texto diría una fecha falsa.
  c_publicacion       constant date := date '2026-11-01';
  c_hora_publicacion  constant time := time '00:00';
  c_vigencia          constant date := date '2026-12-01';

  c_ws_metrik      constant uuid := 'a21bfc88-1a60-48c3-afcd-144226aa2392';
  c_registrado_por constant uuid := 'cc6f6100-4eb7-4eed-9a7c-096729f5cedf';  -- Mauricio (platform admin)
  c_slug_doc       constant text := 'terminos-suscripcion-valida-cda';
  c_titulo         constant text := 'Términos de Suscripción al Servicio VALIDA · Plan CDA';
  c_version        constant text := 'v1.5';
  c_ws_cda         constant uuid := '3f180b67-0f6b-442d-99f9-4ee1efe2410e';
  c_slug_ws        constant text := 'cda-puertotest';
  c_empresa        constant uuid := '2bc36ea7-8740-41e5-8b03-d6c644e14d32';
  c_negocio        constant uuid := '72d35ffc-cd38-47f1-8a8d-f23488052d39';
  c_previa         constant uuid := 'c081b60d-7821-4138-a112-5c13b85f748c';
  c_previa_version constant text := 'v1.4';
  c_previa_pdf     constant text := '491efebd0075db2d7a78a8aa470f07611c25da0cf976bb1adc77dc9b6b0afc0d';
  -- La versión que la previa reemplazó (si la previa es por aviso): su aceptación también cubre la v1.5.
  c_anterior_pdf   constant text := 'd43e1162b304adc3ea955b97bf55ed9b1e49636344ba9468b0ab479f1a5c50be';
  c_texto_sha256   constant text := '854a30c5f0f42a73f5d3cb710fb2f01eb2367951a723b02a0c9c35e7039dda2f';
  c_pdf_sha256     constant text := 'c3179b2ce2e70d61f674dcd0521ffd91ecd93c7fffce4548f7a3f5baf34dc597';
  c_pdf_path       constant text := 'cda-puertotest/terminos-suscripcion-valida-cda-v1.5.pdf';
  c_texto constant text := $texto$# TÉRMINOS DE SUSCRIPCIÓN AL SERVICIO VALIDA · PLAN CDA v1.5

**METRIK**: METRIK IA S.A.S., NIT 902.079.601-9, domiciliada en la Calle 24A Bis 100-71, Bogotá D.C., representada legalmente por Brallan Mauricio Moreno Guzmán. Correo: mauricio.moreno@metrik.com.co.

**EL CLIENTE**: CENTRO DE DIAGNOSTICO AUTOMOTOR PUERTOTEST S.A.S ZOMAC, NIT 901.149.905-1, domiciliada en VDA LA DANTA CARR CENTRAL PTO ASIS PASTO, Puerto Asís (Putumayo), representada legalmente por Carlos Arnulfo Castro Quintero.

Estos Términos rigen desde su aceptación en la forma prevista en la cláusula 16 y constituyen el acuerdo completo entre las Partes sobre el Servicio.

## 0. Antecedente y continuidad

0.1. El Cliente venía accediendo a VALIDA en virtud del Contrato de Prestación de Servicios Tecnológicos de Validación en Listas Vinculantes y Restrictivas suscrito el 16 de julio de 2026 con AFI INTERNATIONAL GROUP S.A.S., terminado de mutuo acuerdo con efectos al 15 de septiembre de 2026.

0.2. VALIDA es de propiedad de METRIK. Estos Términos sustituyen ese contrato **sin interrumpir el servicio** y **respetando el plazo pactado en él**, en los términos de la cláusula 12.1.

0.3. **Versión 1.5.** Esta versión reemplaza la versión 1.4 de estos Términos. Conserva el precio, el alcance de la cláusula 1.2, los usuarios de la cláusula 2.3 y el plazo de la cláusula 12.1. Cambia la forma de pago y lo que ocurre cuando un período no se paga (cláusulas 2.4, 2.5, 2.6, 9.3, 11, 12 y 16.4).

## 1. Objeto y alcance

1.1. METRIK concede al Cliente acceso a **VALIDA**, servicio de computación en la nube para la consulta automatizada de personas naturales y jurídicas contra listas restrictivas y vinculantes utilizadas en la gestión del riesgo de LA/FT/FP (el "Servicio"), a través de su espacio de trabajo en cda-puertotest.metrikone.co.

1.2. El Servicio comprende: acceso a la plataforma, **un (1) usuario administrador y dos (2) usuarios operativos habilitados**, **consultas individuales ilimitadas**, **consultas masivas ilimitadas**, generación de reportes de validación, consulta de listas nacionales e internacionales aplicables al marco normativo colombiano, actualización permanente de las fuentes disponibles y soporte funcional básico.

1.3. El alcance es la consulta de listas del marco SARLAFT según el catálogo vigente publicado en la plataforma. No incluye asesoría jurídica, normativa ni tributaria, ni el diseño u operación del sistema SARLAFT/SAGRILAFT/SIPLAFT del Cliente. Tampoco incluye el acceso por interfaz de programación (API) ni integraciones con otros sistemas, que son otro producto y se contratan aparte, con sus propios términos.

1.4. El Cliente declara que contrata como empresa, para su actividad económica, y no como consumidor final (Ley 1480 de 2011).

## 2. Condiciones comerciales

2.1. **Precio.** La suscripción tiene un valor de **CIENTO CINCUENTA MIL PESOS ($150.000) mensuales**.

2.2. **Tributos.** El Servicio se factura como servicio de computación en la nube (cloud computing) **excluido del impuesto sobre las ventas**, conforme al **numeral 21 del artículo 476 del Estatuto Tributario**. El precio señalado en la cláusula 2.1 es el valor total a cargo del Cliente y no lleva IVA que sumar ni que discriminar. El soporte funcional previsto en la cláusula 1.2 es inherente al acceso al Servicio y no constituye un servicio facturado por separado. Si la autoridad tributaria determina que el Servicio se encuentra gravado, METRIK no trasladará al Cliente el impuesto correspondiente a los períodos ya facturados; para los períodos siguientes, las Partes ajustarán el precio para incorporar el tributo.

2.3. **Usuarios adicionales.** La suscripción incluye un (1) usuario administrador sin costo, que es la persona designada por el Cliente para aceptar estos Términos y gestionar la suscripción, y dos (2) usuarios operativos. Cada usuario operativo adicional tiene un valor de **CINCUENTA MIL PESOS ($50.000) mensuales**, bajo el mismo tratamiento tributario de la cláusula 2.2, y requiere solicitud expresa del Cliente.

2.4. **Pago y período.** La suscripción es mensual y se paga por anticipado. Cada período va desde la fecha de renovación hasta el día anterior a esa misma fecha del mes siguiente. Si ese día no existe en el mes, la renovación es el último día del mes, y al mes siguiente vuelve al día original. La fecha de renovación del Cliente es el día 23 de cada mes, que es el día en que empiezan los períodos que venía pagando, y solo cambia en el caso de la cláusula 11.4. Antes de cada fecha de renovación, METRIK envía al correo registrado y muestra en la plataforma un enlace de pago con el período, el valor y la fecha desde la cual la suscripción quedará Suspendida por pago si no se paga. Cuando la plataforma lo permita, el Cliente puede registrar una tarjeta para que el cobro se haga de forma automática en la fecha de renovación; en ese caso, METRIK solo intenta el cobro automático dentro de los cinco (5) días de gracia de la cláusula 11.1. Un pago hecho antes de la fecha de renovación paga el período que empieza en esa fecha. METRIK expide factura electrónica de venta por cada pago aprobado, por el período que ese pago cubre.

2.5. **Falta de pago.** No pagar un período no genera intereses ni penalidad, y METRIK no cobra los períodos que empiezan desde el **1 de diciembre de 2026** y el Cliente no pagó: su efecto es el de la cláusula 11. Los períodos que empiezan antes de esa fecha se rigen por la cláusula 11.7.

2.6. **Plan Anual.** Si el Cliente compró un Plan Anual conforme a su Anexo, ese Anexo prevalece para los períodos que cubre, que están pagados y a los que no se aplica la cláusula 11.

## 3. Credenciales

3.1. Las credenciales de acceso son personales de cada usuario habilitado, confidenciales e intransferibles.

3.2. El Cliente responde por el uso que se haga con sus credenciales y avisará a METRIK, sin demora, de cualquier uso no autorizado.

3.3. METRIK podrá rotar, suspender o revocar credenciales ante indicios de compromiso, uso indebido o incumplimiento de estos Términos.

## 4. Acceso al servicio, uso permitido y prohibido

4.1. **Exclusividad del acceso.** La suscripción y el acceso al servicio son exclusivos para CENTRO DE DIAGNOSTICO AUTOMOTOR PUERTOTEST S.A.S ZOMAC y no se extienden a empresas vinculadas, filiales, subordinadas, matrices, aliados ni terceros. Los usuarios habilitados deben pertenecer al Cliente.

4.2. **Uso permitido.** El Servicio se usa exclusivamente para la prevención y gestión del riesgo de LA/FT/FP en la operación propia del Cliente.

4.3. **Uso prohibido.** El Cliente no podrá ceder, transferir, compartir, sublicenciar ni revender el acceso; prestar con él servicios de consulta a terceros; extraer, copiar o reconstruir las bases de datos; ni usar medios automatizados no autorizados para acceder al Servicio.

4.4. El incumplimiento de esta cláusula faculta a METRIK para suspender el Servicio de inmediato y para terminar estos Términos sin indemnización.

## 5. Naturaleza del resultado

5.1. **Herramienta de apoyo.** VALIDA es una herramienta tecnológica de consulta automatizada. No constituye concepto jurídico ni decisión de vinculación.

5.2. **Responsabilidad del sujeto obligado.** El Cliente, como sujeto obligado, conserva íntegramente sus deberes de debida diligencia y la decisión final sobre cada caso.

5.3. **Clasificación de listas.** Cada resultado indica la naturaleza de la lista consultada.

5.4. **Fuentes.** El contenido corresponde a sus emisores oficiales. METRIK no garantiza la ausencia absoluta de errores, omisiones o modificaciones realizadas por dichos emisores.

## 6. Disponibilidad y soporte

6.1. METRIK realizará esfuerzos razonables para mantener disponible el Servicio y podrá programar mantenimientos, actualizaciones e interrupciones por fuerza mayor.

6.2. El soporte funcional básico se presta por los canales publicados en la plataforma.

## 7. Confidencialidad

7.1. Es Información Confidencial toda información no pública que una Parte reciba de la otra con ocasión de estos Términos.

7.2. La Parte receptora la usará solo para ejecutarlos y la protegerá con al menos el mismo cuidado que aplica a la propia.

7.3. La obligación rige durante la vigencia y **cinco (5) años** después de su terminación.

## 8. Propiedad intelectual

8.1. La plataforma, sus desarrollos, interfaces, bases de datos, metodologías, reportes, algoritmos y marcas son de propiedad exclusiva de METRIK o de sus licenciantes.

8.2. Estos Términos no transfieren derecho de propiedad intelectual alguno al Cliente.

## 9. Tratamiento de datos personales

9.1. Las Partes cumplirán la Ley 1581 de 2012 y las normas que la modifiquen o complementen.

9.2. Respecto de los datos personales que el Cliente consulte en la plataforma, el Cliente actúa como Responsable y METRIK como Encargado, y los trata únicamente conforme a las instrucciones del Cliente y para prestar el Servicio.

9.3. **Conservación y exportación.** Por instrucción del Cliente y para que este pueda cumplir su deber de conservación, METRIK conserva la bitácora de consultas del Cliente y la evidencia asociada (datos consultados, resultado, versión de las listas y reporte con su huella) durante **diez (10) años**, plazo de la Ley 962 de 2005, artículo 28, al que remite la Resolución 2328 de 2025 de la Superintendencia de Transporte (artículo 5.6.11.4). Durante ese plazo esos registros no se suprimen, ni siquiera a solicitud del Cliente o del titular. En cualquier estado de la suscripción, incluida la Cancelada, y aun después de terminados estos Términos, durante ese plazo, el Cliente puede pedir por escrito a mauricio.moreno@metrik.com.co, desde un correo registrado, la **exportación de la bitácora de sus consultas** en formato legible por máquina y de los reportes generados. METRIK la entrega sin costo dentro de los cinco (5) días hábiles siguientes al recibo de la solicitud, o dentro del plazo menor que fije una autoridad si el Cliente lo informa en la solicitud. Los reportes entregados conservan su código de verificación y su huella. METRIK traslada al Cliente, dentro de los dos (2) días hábiles siguientes, toda consulta o reclamo de un titular que reciba.

9.4. **Transmisión internacional.** El Cliente autoriza a METRIK a transmitir los datos personales necesarios para prestar el Servicio a los proveedores de infraestructura en la nube y de fuentes de información que METRIK utilice, incluidos los ubicados fuera de Colombia, conforme al **artículo 26 de la Ley 1581 de 2012** y al **artículo 25 del Decreto 1377 de 2013**. METRIK mantiene publicada en la plataforma la relación de dichos proveedores y exige de ellos garantías de seguridad no inferiores a las propias.

9.5. **Incidentes de seguridad.** METRIK notificará al Cliente cualquier incidente de seguridad que afecte sus datos **dentro de las setenta y dos (72) horas** siguientes a su conocimiento, con la información disponible sobre naturaleza, alcance y medidas adoptadas.

## 10. Responsabilidad

10.1. Las decisiones adoptadas por el Cliente con base en los resultados son de su exclusiva responsabilidad.

10.2. La responsabilidad total de METRIK por cualquier concepto se limita al valor pagado por el Cliente en los tres (3) meses anteriores al hecho que la origine.

## 11. Gracia, suspensión por pago y cancelación

11.1. **Días de gracia.** Si en la fecha de renovación el período no queda pagado, el Cliente sigue consultando con normalidad durante los cinco (5) días calendario siguientes. Desde el día siguiente a la fecha de renovación, la plataforma muestra a los usuarios del Cliente la fecha desde la cual la suscripción quedará Suspendida por pago.

11.2. **Suspendida por pago.** Si el período no se paga dentro de los días de gracia, la suscripción queda **Suspendida por pago** desde el sexto (6.º) día calendario siguiente a la fecha de renovación y hasta el trigésimo (30.º). Mientras está Suspendida por pago, el Cliente no puede hacer consultas nuevas, individuales ni masivas, pero conserva el acceso a la plataforma, sus usuarios siguen habilitados, y puede ver y descargar su historial y los reportes ya generados y exportar la bitácora. Si paga en este estado, las consultas se reactivan y el período pagado corre desde la fecha de renovación original, que no cambia: los días de suspensión hacen parte de ese período.

11.3. **Cancelada.** Si pasan más de treinta (30) días calendario desde la fecha de renovación sin que el período se pague, desde el trigésimo primer (31.º) día la suscripción queda **Cancelada**. Mientras está Cancelada, los usuarios del Cliente pueden entrar a la plataforma, que les muestra que la suscripción está cancelada y que su información está guardada, pero no pueden hacer consultas ni ver el historial ni los reportes en la plataforma. La información del Cliente se conserva íntegra y se puede obtener como dice la cláusula 9.3. Si el Cliente registró una tarjeta, METRIK pide a la pasarela eliminarla y lo informa al correo registrado. La cancelación se debe a la falta de pago del Cliente y no es terminación sin causa por parte de METRIK.

11.4. **Reactivación después de la cancelación.** El Cliente reactiva la suscripción Cancelada pagando un período con el enlace que le envíe METRIK. El nuevo período corre desde el día del pago aprobado, que pasa a ser la nueva fecha de renovación. Con el pago, el Cliente recupera las consultas y el acceso a su historial y a sus reportes. La fecha del pago es la de su registro conforme a la cláusula 11.5.

11.5. **Registro del pago.** El pago hecho por el enlace se registra al ser aprobado. El hecho por otro medio, a más tardar el día hábil siguiente a su acreditación en la cuenta de METRIK.

11.6. **Suspensión por otras causas.** METRIK podrá suspender el Servicio de inmediato ante uso indebido de credenciales, cesión de accesos a terceros, orden de autoridad o actividades que comprometan la seguridad de la plataforma o de la información, y lo informará a los correos registrados.

11.7. **Transición.** Los períodos que empiezan antes del **1 de diciembre de 2026** y no están pagados, sea bajo esta versión o bajo las anteriores, se deben y no se condonan. Para estar al día, el Cliente los paga a más tardar el **30 de noviembre de 2026**. Para efectos de las cláusulas 11.1 a 11.3, esa es su fecha de renovación: si no se pagan, la suscripción queda Suspendida por pago desde el 6 de diciembre de 2026 y Cancelada desde el 31 de diciembre de 2026, y antes de esas fechas METRIK no restringe, suspende ni pausa las consultas por esos períodos. Al pagarlos, el Cliente queda al día y su fecha de renovación es la de la cláusula 2.4. No se aplican la restricción ni la suspensión por mora de las cláusulas 11.1 y 11.3 de la versión 1.4.

## 12. Vigencia, renovación y terminación

12.1. **Plazo de los compromisos de METRIK.** Estos Términos rigen desde su aceptación y mientras el Cliente no se retire. Hasta el **15 de enero de 2027**, fecha en que vencía el contrato terminado con AFI, METRIK mantiene los compromisos de las cláusulas 12.3 y 13, de modo que el Cliente conserva íntegro el plazo que había contratado.

12.2. **Renovación y retiro.** La suscripción se renueva cada mes con el pago del período. El Cliente puede dejar de renovarla en cualquier momento, sin aviso previo y sin penalidad: basta con no pagar el período siguiente o, si registró tarjeta, retirarse desde la plataforma o escribiendo a mauricio.moreno@metrik.com.co. El Cliente conserva las consultas hasta el fin del período pagado; después, la suscripción sigue la cláusula 11.

12.3. **Terminación por METRIK.** Durante el plazo de la cláusula 12.1, METRIK no podrá terminar estos Términos sin causa imputable al Cliente. Después, podrá terminarlos con aviso escrito de treinta (30) días. Podrá terminarlos de inmediato, en cualquier tiempo, por incumplimiento de las cláusulas 3, 4 o 9.

12.4. **Saldo.** Si el Cliente se retira o deja de pagar, no hay reembolso del período ya pagado. Si METRIK termina sin causa imputable al Cliente, reembolsa a prorrata los días no prestados.

12.5. Sobreviven a la terminación las cláusulas 5, 7, 8, 9, 10, 12.4 y 14.

## 13. Modificaciones

13.1. METRIK podrá modificar estos Términos avisando al Cliente con treinta (30) días de anticipación. **Durante el plazo de la cláusula 12.1 ninguna modificación podrá aumentar el precio, reducir el alcance descrito en la cláusula 1.2 ni acortar ese plazo.** Si el Cliente no acepta una modificación, podrá terminar sin penalidad antes de que entre en vigor, con reembolso a prorrata de los días no prestados.

13.2. El precio no se modifica durante el plazo de la cláusula 12.1.

## 14. Ley aplicable, domicilio y controversias

14.1. Estos Términos se rigen por la ley colombiana. Las Partes fijan como domicilio contractual la ciudad de Bogotá D.C. y someterán sus diferencias a la jurisdicción ordinaria colombiana, previo intento de arreglo directo.

## 15. Notificaciones

15.1. Las notificaciones se surten a los correos registrados por cada Parte en la plataforma.

## 16. Aceptación

16.1. Estos Términos se aceptan **en la plataforma**, por el representante legal del Cliente o por quien tenga poder suficiente, mediante la confirmación expresa habilitada para ello. Quien acepta **declara bajo juramento, que se entiende prestado con la aceptación, que cuenta con facultades suficientes para obligar al Cliente**, y responde personalmente en los términos del **artículo 841 del Código de Comercio** si obra sin ellas o las excede.

16.2. La aceptación deja registro de la fecha y hora, el usuario que la realiza, la dirección IP, el dispositivo, la versión aceptada y la huella digital (SHA-256) del documento, y ese registro es la prueba de la aceptación.

16.3. El acceso al Servicio queda habilitado una vez registrada la aceptación.

16.4. **Paso desde la versión 1.4.** Para el Cliente que venía con la versión 1.4, esta versión rige desde que la acepta en la plataforma o, si no la acepta, desde el **1 de diciembre de 2026**, por la cláusula 13.1 de la versión 1.4, que permite modificarla con aviso de treinta (30) días. Antes de esa fecha el Cliente puede terminar sin penalidad, con reembolso a prorrata de los días no prestados del período pagado. El aviso publicado el 1 de noviembre de 2026 es también el aviso de no renovación de la cláusula 12.2 de la versión 1.4: vencido el plazo de la cláusula 12.1, la suscripción continúa solo si el Cliente aceptó esta versión. Desde el **16 de enero de 2027**, o desde el día siguiente al fin del último período pagado si es posterior, sin esa aceptación no se pueden hacer consultas, y el Cliente conserva la exportación de la cláusula 9.3.$texto$;

  v_ahora timestamptz := now();
  v_publicar_en timestamptz := (c_publicacion + c_hora_publicacion) at time zone 'America/Bogota';
  v_publicada_at timestamptz;
  v_previa record;
  v_id uuid;
  v_vigentes int;
begin
  -- ── Lo que tiene que existir antes ─────────────────────────────────────────
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'documentos_contractuales_versiones' and column_name = 'rige_por_aviso'
  ) or to_regclass('public.avisos_modificacion_vistos') is null then
    raise exception 'Falta la migración 20261007150000_terminos_modificacion_por_aviso.sql';
  end if;

  if c_vigencia <> c_publicacion + 30 then
    raise exception 'la vigencia (%) no es la publicación (%) + 30 días calendario (cláusula 13.1 de la v1.4)', c_vigencia, c_publicacion;
  end if;

  -- Cuándo queda publicada: a la hora fijada, o ahora si ya pasó. Siempre el día que dice el texto.
  v_publicada_at := greatest(v_ahora, v_publicar_en);
  if (v_publicada_at at time zone 'America/Bogota')::date <> c_publicacion then
    raise exception '%: hoy es % en Bogotá y el texto dice que el aviso se publica el % (rige el %). Publicar otro día cambia la vigencia: regenerar el texto, el PDF y este archivo con la fecha nueva.',
      c_slug_ws, (v_ahora at time zone 'America/Bogota')::date, c_publicacion, c_vigencia;
  end if;
  if v_publicada_at > v_ahora and not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'documentos_versiones_por_aviso'
       and position('publicacion_programada' in p.prosrc) > 0
  ) then
    raise exception '%: para registrar el aviso antes de publicarlo (%) falta la migración 20261029190000_terminos_aviso_publicacion_programada.sql. Sin ella, este bloque se corre el % (Bogotá).',
      c_slug_ws, v_publicar_en, c_publicacion;
  end if;

  -- Idempotencia: con la v1.5 ya registrada, nada que hacer.
  if exists (
    select 1 from public.documentos_contractuales_versiones d
     where d.empresa_id = c_empresa and d.slug = c_slug_doc and d.version = c_version
  ) then
    raise exception '%: la v1.5 de esta empresa ya está registrada. Nada que hacer.', c_slug_ws;
  end if;

  -- La versión que se modifica: la esperada, de esta empresa, con su huella y sin fecha de retiro.
  select d.id, d.workspace_id, d.linea_id, d.titulo, d.alcance, d.vigente_desde, d.vigente_hasta, d.reemplaza_version_id
    into v_previa
    from public.documentos_contractuales_versiones d
   where d.id = c_previa and d.empresa_id = c_empresa and d.slug = c_slug_doc
     and d.version = c_previa_version and d.pdf_sha256 = c_previa_pdf;
  if not found then
    raise exception '%: la % esperada (%) no está registrada para esta empresa con su huella', c_slug_ws, c_previa_version, c_previa;
  end if;
  if v_previa.workspace_id <> c_ws_metrik or v_previa.alcance <> 'cliente' then
    raise exception '%: la % no es un documento cliente del workspace metrik', c_slug_ws, c_previa_version;
  end if;
  if v_previa.vigente_hasta is not null then
    raise exception '%: la % ya tiene vigente_hasta (%): revisar antes de publicar', c_slug_ws, c_previa_version, v_previa.vigente_hasta;
  end if;
  if v_previa.vigente_desde >= c_vigencia then
    raise exception '%: la % rige desde el %, no antes de la v1.5 (%)', c_slug_ws, c_previa_version, v_previa.vigente_desde, c_vigencia;
  end if;
  -- Ninguna OTRA versión de estos términos vigente hoy o después, salvo la que la previa reemplazó (la
  -- v1.3, vigente hasta el 5-nov) y que ya tiene su fecha de retiro.
  select count(*) into v_vigentes
    from public.documentos_contractuales_versiones d
   where d.empresa_id = c_empresa and d.slug = c_slug_doc and d.id <> c_previa
     and d.id is distinct from v_previa.reemplaza_version_id
     and (d.vigente_hasta is null or d.vigente_hasta >= (v_ahora at time zone 'America/Bogota')::date);
  if v_vigentes > 0 then
    raise exception '%: hay otra versión vigente de los términos de esta empresa además de la %', c_slug_ws, c_previa_version;
  end if;
  if v_previa.reemplaza_version_id is not null and not exists (
    select 1 from public.documentos_contractuales_versiones d
     where d.id = v_previa.reemplaza_version_id and d.vigente_hasta is not null and d.vigente_hasta < c_vigencia
  ) then
    raise exception '%: la versión que la % reemplazó sigue sin fecha de retiro anterior al %', c_slug_ws, c_previa_version, c_vigencia;
  end if;

  -- Un contrato vivo de esta empresa que paga este espacio, con lo que la v1.5 modifica ACEPTADO (la
  -- previa, o la que la previa reemplazó por aviso): sin aceptación no hay qué modificar por aviso.
  if not exists (
    select 1 from public.servicios_contratados sc
     where sc.negocio_id = c_negocio and sc.empresa_id = c_empresa and sc.workspace_pagador_id = c_ws_cda
       and sc.estado not in ('cancelado', 'terminado')
  ) then
    raise exception '%: no hay contrato vivo de esta empresa pagado por el espacio', c_slug_ws;
  end if;
  if not exists (
    select 1 from public.aceptaciones_terminos a
     where a.estado = 'aceptado' and a.documento_sha256 in (c_previa_pdf, c_anterior_pdf) and a.negocio_id = c_negocio
  ) then
    raise exception '%: ni la % ni la versión que reemplazó tienen aceptación registrada en el contrato: la v1.5 no se publica por aviso', c_slug_ws, c_previa_version;
  end if;

  -- El PDF del aviso tiene que estar subido: la pantalla, el aviso y el correo enlazan a él.
  if not exists (select 1 from storage.objects o where o.bucket_id = 'aceptaciones-documentos' and o.name = c_pdf_path) then
    raise exception '%: falta subir el PDF a aceptaciones-documentos/% (paso 2 de la cabecera)', c_slug_ws, c_pdf_path;
  end if;

  -- El texto que se publica es exactamente el generado, con sus fechas.
  if encode(sha256(convert_to(c_texto, 'UTF8')), 'hex') is distinct from c_texto_sha256 then
    raise exception '%: el texto no es el generado (huella distinta). No se edita a mano: se regenera.', c_slug_ws;
  end if;
  if position('# TÉRMINOS DE SUSCRIPCIÓN AL SERVICIO VALIDA · PLAN CDA v1.5' in c_texto) <> 1
     or position('desde el **1 de diciembre de 2026**' in c_texto) = 0
     or position('publicado el 1 de noviembre de 2026' in c_texto) = 0 then
    raise exception '%: el texto no es la v1.5 con publicación el 1-nov y vigencia el 1-dic de 2026', c_slug_ws;
  end if;

  -- ── 1. La previa rige hasta el día anterior a la vigencia de la v1.5 ───────
  update public.documentos_contractuales_versiones
     set vigente_hasta = c_vigencia - 1
   where id = c_previa and vigente_hasta is null;

  -- ── 2. La v1.5 por aviso: se muestra desde `publicada_at` ──────────────────
  insert into public.documentos_contractuales_versiones
    (workspace_id, linea_id, slug, alcance, empresa_id, titulo, version, texto_md, texto_sha256,
     pdf_bucket, pdf_path, pdf_sha256, vigente_desde, rige_por_aviso, reemplaza_version_id, publicada_at,
     registrado_por)
  values
    (v_previa.workspace_id, v_previa.linea_id, c_slug_doc, 'cliente', c_empresa, c_titulo, c_version, c_texto,
     c_texto_sha256, 'aceptaciones-documentos', c_pdf_path, c_pdf_sha256, c_vigencia, true, c_previa, v_publicada_at,
     c_registrado_por)
  returning id into v_id;

  -- ── Comprobación ──────────────────────────────────────────────────────────
  if not exists (
    select 1 from public.documentos_contractuales_versiones d
     where d.id = v_id and d.rige_por_aviso and d.reemplaza_version_id = c_previa
       and d.vigente_desde = c_vigencia and d.publicada_at = v_publicada_at
       and (d.publicada_at at time zone 'America/Bogota')::date = c_publicacion
  ) or not exists (
    select 1 from public.documentos_contractuales_versiones d where d.id = c_previa and d.vigente_hasta = c_vigencia - 1
  ) then
    raise exception '%: la publicación no quedó como se esperaba', c_slug_ws;
  end if;

  if c_ensayo then
    raise exception 'ENSAYO OK %: v1.5 % por aviso, publicada %, rige el %; % vigente hasta el %. Nada quedó escrito.',
      c_slug_ws, v_id, v_publicada_at at time zone 'America/Bogota', c_vigencia, c_previa_version, c_vigencia - 1;
  end if;
  raise notice 'PUBLICADO %: v1.5 % por aviso, visible desde % (Bogotá), rige el %',
    c_slug_ws, v_id, v_publicada_at at time zone 'America/Bogota', c_vigencia;
end;
$bloque$;

-- ────────────────────────────────────────────────────────────────────────────
-- M2 26 1 · espacio `maxitec` · aceptó la v1.3 el 2026-10-01; la v1.4 (por aviso) no
-- La v1.4 (b32a54bc-1f83-4254-b5ef-818ec32556f7) queda vigente hasta el 30-nov; la v1.5 por aviso rige desde el 1-dic.
-- 12.1 hasta el 2026-12-21; aceptación exigible desde el 2026-12-22 (o el día siguiente
-- al fin del último período pagado, si es posterior).
-- ────────────────────────────────────────────────────────────────────────────
do $bloque$
declare
  -- ⚠️ true = ENSAYO: escribe, comprueba y deshace todo con RAISE EXCEPTION 'ENSAYO OK …'.
  c_ensayo constant boolean := true;
  -- El día (Bogotá) en que se publica el aviso, el que dicen los textos, y la hora (Bogotá) desde la que
  -- se muestra. Corrido ANTES de esa hora (con la migración 20261029190000), la fila queda registrada con
  -- `publicada_at` = esa hora y la plataforma la muestra desde ahí. Corrido ese mismo día después de esa
  -- hora, `publicada_at` = el momento de correrlo. Otro día, no corre: el texto diría una fecha falsa.
  c_publicacion       constant date := date '2026-11-01';
  c_hora_publicacion  constant time := time '00:00';
  c_vigencia          constant date := date '2026-12-01';

  c_ws_metrik      constant uuid := 'a21bfc88-1a60-48c3-afcd-144226aa2392';
  c_registrado_por constant uuid := 'cc6f6100-4eb7-4eed-9a7c-096729f5cedf';  -- Mauricio (platform admin)
  c_slug_doc       constant text := 'terminos-suscripcion-valida-cda';
  c_titulo         constant text := 'Términos de Suscripción al Servicio VALIDA · Plan CDA';
  c_version        constant text := 'v1.5';
  c_ws_cda         constant uuid := '962df864-4dd8-44ba-aac0-bf994f391931';
  c_slug_ws        constant text := 'maxitec';
  c_empresa        constant uuid := '069cbc29-ed49-4e0c-b803-f2497440a5f2';
  c_negocio        constant uuid := '717b2c2c-c265-4cb3-a483-3383b104a412';
  c_previa         constant uuid := 'b32a54bc-1f83-4254-b5ef-818ec32556f7';
  c_previa_version constant text := 'v1.4';
  c_previa_pdf     constant text := 'd3d1f92a40351c40e8766e03244f5b32bc177664077a9ce337ac95bc80cf5c3d';
  -- La versión que la previa reemplazó (si la previa es por aviso): su aceptación también cubre la v1.5.
  c_anterior_pdf   constant text := '18aedd2c070b9f820e1f08abc825fb0f0098c19c1ff06fdc07bc256dbe5cfda8';
  c_texto_sha256   constant text := '23f8ad94a689e877dad8a24b8b6c79e56b051f0af02d50fb61dd2a627dad6e10';
  c_pdf_sha256     constant text := 'eb8a5018a32afea8f0826932d58a65f286a8404f6f7d143584b3ea85f2760032';
  c_pdf_path       constant text := 'maxitec/terminos-suscripcion-valida-cda-v1.5.pdf';
  c_texto constant text := $texto$# TÉRMINOS DE SUSCRIPCIÓN AL SERVICIO VALIDA · PLAN CDA v1.5

**METRIK**: METRIK IA S.A.S., NIT 902.079.601-9, domiciliada en la Calle 24A Bis 100-71, Bogotá D.C., representada legalmente por Brallan Mauricio Moreno Guzmán. Correo: mauricio.moreno@metrik.com.co.

**EL CLIENTE**: CENTRO DE DIAGNOSTICO AUTOMOTOR MAXITEC S.A.S., NIT 900.158.425-0, domiciliada en CL 5 A 10 06 38 CR 10 5 A 11 31 CR 10 A 5 A 31, Florencia (Caquetá), representada legalmente por Jairo Enrique Peña Bernal.

Estos Términos rigen desde su aceptación en la forma prevista en la cláusula 16 y constituyen el acuerdo completo entre las Partes sobre el Servicio.

## 0. Antecedente y continuidad

0.1. El Cliente venía accediendo a VALIDA en virtud del Contrato de Prestación de Servicios Tecnológicos de Validación en Listas Vinculantes y Restrictivas suscrito el 22 de junio de 2026 con AFI INTERNATIONAL GROUP S.A.S., terminado de mutuo acuerdo con efectos al 21 de septiembre de 2026.

0.2. VALIDA es de propiedad de METRIK. Estos Términos sustituyen ese contrato **sin interrumpir el servicio** y **respetando el plazo pactado en él**, en los términos de la cláusula 12.1.

0.3. **Versión 1.5.** Esta versión reemplaza la versión 1.4 de estos Términos. Conserva el precio, el alcance de la cláusula 1.2, los usuarios de la cláusula 2.3 y el plazo de la cláusula 12.1. Cambia la forma de pago y lo que ocurre cuando un período no se paga (cláusulas 2.4, 2.5, 2.6, 9.3, 11, 12 y 16.4).

## 1. Objeto y alcance

1.1. METRIK concede al Cliente acceso a **VALIDA**, servicio de computación en la nube para la consulta automatizada de personas naturales y jurídicas contra listas restrictivas y vinculantes utilizadas en la gestión del riesgo de LA/FT/FP (el "Servicio"), a través de su espacio de trabajo en maxitec.metrikone.co.

1.2. El Servicio comprende: acceso a la plataforma, **un (1) usuario administrador y dos (2) usuarios operativos habilitados**, **consultas individuales ilimitadas**, **consultas masivas ilimitadas**, generación de reportes de validación, consulta de listas nacionales e internacionales aplicables al marco normativo colombiano, actualización permanente de las fuentes disponibles y soporte funcional básico.

1.3. El alcance es la consulta de listas del marco SARLAFT según el catálogo vigente publicado en la plataforma. No incluye asesoría jurídica, normativa ni tributaria, ni el diseño u operación del sistema SARLAFT/SAGRILAFT/SIPLAFT del Cliente. Tampoco incluye el acceso por interfaz de programación (API) ni integraciones con otros sistemas, que son otro producto y se contratan aparte, con sus propios términos.

1.4. El Cliente declara que contrata como empresa, para su actividad económica, y no como consumidor final (Ley 1480 de 2011).

## 2. Condiciones comerciales

2.1. **Precio.** La suscripción tiene un valor de **CIENTO CINCUENTA MIL PESOS ($150.000) mensuales**.

2.2. **Tributos.** El Servicio se factura como servicio de computación en la nube (cloud computing) **excluido del impuesto sobre las ventas**, conforme al **numeral 21 del artículo 476 del Estatuto Tributario**. El precio señalado en la cláusula 2.1 es el valor total a cargo del Cliente y no lleva IVA que sumar ni que discriminar. El soporte funcional previsto en la cláusula 1.2 es inherente al acceso al Servicio y no constituye un servicio facturado por separado. Si la autoridad tributaria determina que el Servicio se encuentra gravado, METRIK no trasladará al Cliente el impuesto correspondiente a los períodos ya facturados; para los períodos siguientes, las Partes ajustarán el precio para incorporar el tributo.

2.3. **Usuarios adicionales.** La suscripción incluye un (1) usuario administrador sin costo, que es la persona designada por el Cliente para aceptar estos Términos y gestionar la suscripción, y dos (2) usuarios operativos. Cada usuario operativo adicional tiene un valor de **CINCUENTA MIL PESOS ($50.000) mensuales**, bajo el mismo tratamiento tributario de la cláusula 2.2, y requiere solicitud expresa del Cliente.

2.4. **Pago y período.** La suscripción es mensual y se paga por anticipado. Cada período va desde la fecha de renovación hasta el día anterior a esa misma fecha del mes siguiente. Si ese día no existe en el mes, la renovación es el último día del mes, y al mes siguiente vuelve al día original. La fecha de renovación del Cliente es el día 23 de cada mes, que es el día en que empiezan los períodos que venía pagando, y solo cambia en el caso de la cláusula 11.4. Antes de cada fecha de renovación, METRIK envía al correo registrado y muestra en la plataforma un enlace de pago con el período, el valor y la fecha desde la cual la suscripción quedará Suspendida por pago si no se paga. Cuando la plataforma lo permita, el Cliente puede registrar una tarjeta para que el cobro se haga de forma automática en la fecha de renovación; en ese caso, METRIK solo intenta el cobro automático dentro de los cinco (5) días de gracia de la cláusula 11.1. Un pago hecho antes de la fecha de renovación paga el período que empieza en esa fecha. METRIK expide factura electrónica de venta por cada pago aprobado, por el período que ese pago cubre.

2.5. **Falta de pago.** No pagar un período no genera intereses ni penalidad, y METRIK no cobra los períodos que empiezan desde el **1 de diciembre de 2026** y el Cliente no pagó: su efecto es el de la cláusula 11. Los períodos que empiezan antes de esa fecha se rigen por la cláusula 11.7.

2.6. **Plan Anual.** Si el Cliente compró un Plan Anual conforme a su Anexo, ese Anexo prevalece para los períodos que cubre, que están pagados y a los que no se aplica la cláusula 11.

## 3. Credenciales

3.1. Las credenciales de acceso son personales de cada usuario habilitado, confidenciales e intransferibles.

3.2. El Cliente responde por el uso que se haga con sus credenciales y avisará a METRIK, sin demora, de cualquier uso no autorizado.

3.3. METRIK podrá rotar, suspender o revocar credenciales ante indicios de compromiso, uso indebido o incumplimiento de estos Términos.

## 4. Acceso al servicio, uso permitido y prohibido

4.1. **Exclusividad del acceso.** La suscripción y el acceso al servicio son exclusivos para CENTRO DE DIAGNOSTICO AUTOMOTOR MAXITEC S.A.S. y no se extienden a empresas vinculadas, filiales, subordinadas, matrices, aliados ni terceros. Los usuarios habilitados deben pertenecer al Cliente.

4.2. **Uso permitido.** El Servicio se usa exclusivamente para la prevención y gestión del riesgo de LA/FT/FP en la operación propia del Cliente.

4.3. **Uso prohibido.** El Cliente no podrá ceder, transferir, compartir, sublicenciar ni revender el acceso; prestar con él servicios de consulta a terceros; extraer, copiar o reconstruir las bases de datos; ni usar medios automatizados no autorizados para acceder al Servicio.

4.4. El incumplimiento de esta cláusula faculta a METRIK para suspender el Servicio de inmediato y para terminar estos Términos sin indemnización.

## 5. Naturaleza del resultado

5.1. **Herramienta de apoyo.** VALIDA es una herramienta tecnológica de consulta automatizada. No constituye concepto jurídico ni decisión de vinculación.

5.2. **Responsabilidad del sujeto obligado.** El Cliente, como sujeto obligado, conserva íntegramente sus deberes de debida diligencia y la decisión final sobre cada caso.

5.3. **Clasificación de listas.** Cada resultado indica la naturaleza de la lista consultada.

5.4. **Fuentes.** El contenido corresponde a sus emisores oficiales. METRIK no garantiza la ausencia absoluta de errores, omisiones o modificaciones realizadas por dichos emisores.

## 6. Disponibilidad y soporte

6.1. METRIK realizará esfuerzos razonables para mantener disponible el Servicio y podrá programar mantenimientos, actualizaciones e interrupciones por fuerza mayor.

6.2. El soporte funcional básico se presta por los canales publicados en la plataforma.

## 7. Confidencialidad

7.1. Es Información Confidencial toda información no pública que una Parte reciba de la otra con ocasión de estos Términos.

7.2. La Parte receptora la usará solo para ejecutarlos y la protegerá con al menos el mismo cuidado que aplica a la propia.

7.3. La obligación rige durante la vigencia y **cinco (5) años** después de su terminación.

## 8. Propiedad intelectual

8.1. La plataforma, sus desarrollos, interfaces, bases de datos, metodologías, reportes, algoritmos y marcas son de propiedad exclusiva de METRIK o de sus licenciantes.

8.2. Estos Términos no transfieren derecho de propiedad intelectual alguno al Cliente.

## 9. Tratamiento de datos personales

9.1. Las Partes cumplirán la Ley 1581 de 2012 y las normas que la modifiquen o complementen.

9.2. Respecto de los datos personales que el Cliente consulte en la plataforma, el Cliente actúa como Responsable y METRIK como Encargado, y los trata únicamente conforme a las instrucciones del Cliente y para prestar el Servicio.

9.3. **Conservación y exportación.** Por instrucción del Cliente y para que este pueda cumplir su deber de conservación, METRIK conserva la bitácora de consultas del Cliente y la evidencia asociada (datos consultados, resultado, versión de las listas y reporte con su huella) durante **diez (10) años**, plazo de la Ley 962 de 2005, artículo 28, al que remite la Resolución 2328 de 2025 de la Superintendencia de Transporte (artículo 5.6.11.4). Durante ese plazo esos registros no se suprimen, ni siquiera a solicitud del Cliente o del titular. En cualquier estado de la suscripción, incluida la Cancelada, y aun después de terminados estos Términos, durante ese plazo, el Cliente puede pedir por escrito a mauricio.moreno@metrik.com.co, desde un correo registrado, la **exportación de la bitácora de sus consultas** en formato legible por máquina y de los reportes generados. METRIK la entrega sin costo dentro de los cinco (5) días hábiles siguientes al recibo de la solicitud, o dentro del plazo menor que fije una autoridad si el Cliente lo informa en la solicitud. Los reportes entregados conservan su código de verificación y su huella. METRIK traslada al Cliente, dentro de los dos (2) días hábiles siguientes, toda consulta o reclamo de un titular que reciba.

9.4. **Transmisión internacional.** El Cliente autoriza a METRIK a transmitir los datos personales necesarios para prestar el Servicio a los proveedores de infraestructura en la nube y de fuentes de información que METRIK utilice, incluidos los ubicados fuera de Colombia, conforme al **artículo 26 de la Ley 1581 de 2012** y al **artículo 25 del Decreto 1377 de 2013**. METRIK mantiene publicada en la plataforma la relación de dichos proveedores y exige de ellos garantías de seguridad no inferiores a las propias.

9.5. **Incidentes de seguridad.** METRIK notificará al Cliente cualquier incidente de seguridad que afecte sus datos **dentro de las setenta y dos (72) horas** siguientes a su conocimiento, con la información disponible sobre naturaleza, alcance y medidas adoptadas.

## 10. Responsabilidad

10.1. Las decisiones adoptadas por el Cliente con base en los resultados son de su exclusiva responsabilidad.

10.2. La responsabilidad total de METRIK por cualquier concepto se limita al valor pagado por el Cliente en los tres (3) meses anteriores al hecho que la origine.

## 11. Gracia, suspensión por pago y cancelación

11.1. **Días de gracia.** Si en la fecha de renovación el período no queda pagado, el Cliente sigue consultando con normalidad durante los cinco (5) días calendario siguientes. Desde el día siguiente a la fecha de renovación, la plataforma muestra a los usuarios del Cliente la fecha desde la cual la suscripción quedará Suspendida por pago.

11.2. **Suspendida por pago.** Si el período no se paga dentro de los días de gracia, la suscripción queda **Suspendida por pago** desde el sexto (6.º) día calendario siguiente a la fecha de renovación y hasta el trigésimo (30.º). Mientras está Suspendida por pago, el Cliente no puede hacer consultas nuevas, individuales ni masivas, pero conserva el acceso a la plataforma, sus usuarios siguen habilitados, y puede ver y descargar su historial y los reportes ya generados y exportar la bitácora. Si paga en este estado, las consultas se reactivan y el período pagado corre desde la fecha de renovación original, que no cambia: los días de suspensión hacen parte de ese período.

11.3. **Cancelada.** Si pasan más de treinta (30) días calendario desde la fecha de renovación sin que el período se pague, desde el trigésimo primer (31.º) día la suscripción queda **Cancelada**. Mientras está Cancelada, los usuarios del Cliente pueden entrar a la plataforma, que les muestra que la suscripción está cancelada y que su información está guardada, pero no pueden hacer consultas ni ver el historial ni los reportes en la plataforma. La información del Cliente se conserva íntegra y se puede obtener como dice la cláusula 9.3. Si el Cliente registró una tarjeta, METRIK pide a la pasarela eliminarla y lo informa al correo registrado. La cancelación se debe a la falta de pago del Cliente y no es terminación sin causa por parte de METRIK.

11.4. **Reactivación después de la cancelación.** El Cliente reactiva la suscripción Cancelada pagando un período con el enlace que le envíe METRIK. El nuevo período corre desde el día del pago aprobado, que pasa a ser la nueva fecha de renovación. Con el pago, el Cliente recupera las consultas y el acceso a su historial y a sus reportes. La fecha del pago es la de su registro conforme a la cláusula 11.5.

11.5. **Registro del pago.** El pago hecho por el enlace se registra al ser aprobado. El hecho por otro medio, a más tardar el día hábil siguiente a su acreditación en la cuenta de METRIK.

11.6. **Suspensión por otras causas.** METRIK podrá suspender el Servicio de inmediato ante uso indebido de credenciales, cesión de accesos a terceros, orden de autoridad o actividades que comprometan la seguridad de la plataforma o de la información, y lo informará a los correos registrados.

11.7. **Transición.** Los períodos que empiezan antes del **1 de diciembre de 2026** y no están pagados, sea bajo esta versión o bajo las anteriores, se deben y no se condonan. Para estar al día, el Cliente los paga a más tardar el **30 de noviembre de 2026**. Para efectos de las cláusulas 11.1 a 11.3, esa es su fecha de renovación: si no se pagan, la suscripción queda Suspendida por pago desde el 6 de diciembre de 2026 y Cancelada desde el 31 de diciembre de 2026, y antes de esas fechas METRIK no restringe, suspende ni pausa las consultas por esos períodos. Al pagarlos, el Cliente queda al día y su fecha de renovación es la de la cláusula 2.4. No se aplican la restricción ni la suspensión por mora de las cláusulas 11.1 y 11.3 de la versión 1.4.

## 12. Vigencia, renovación y terminación

12.1. **Plazo de los compromisos de METRIK.** Estos Términos rigen desde su aceptación y mientras el Cliente no se retire. Hasta el **21 de diciembre de 2026**, fecha en que vencía el contrato terminado con AFI, METRIK mantiene los compromisos de las cláusulas 12.3 y 13, de modo que el Cliente conserva íntegro el plazo que había contratado.

12.2. **Renovación y retiro.** La suscripción se renueva cada mes con el pago del período. El Cliente puede dejar de renovarla en cualquier momento, sin aviso previo y sin penalidad: basta con no pagar el período siguiente o, si registró tarjeta, retirarse desde la plataforma o escribiendo a mauricio.moreno@metrik.com.co. El Cliente conserva las consultas hasta el fin del período pagado; después, la suscripción sigue la cláusula 11.

12.3. **Terminación por METRIK.** Durante el plazo de la cláusula 12.1, METRIK no podrá terminar estos Términos sin causa imputable al Cliente. Después, podrá terminarlos con aviso escrito de treinta (30) días. Podrá terminarlos de inmediato, en cualquier tiempo, por incumplimiento de las cláusulas 3, 4 o 9.

12.4. **Saldo.** Si el Cliente se retira o deja de pagar, no hay reembolso del período ya pagado. Si METRIK termina sin causa imputable al Cliente, reembolsa a prorrata los días no prestados.

12.5. Sobreviven a la terminación las cláusulas 5, 7, 8, 9, 10, 12.4 y 14.

## 13. Modificaciones

13.1. METRIK podrá modificar estos Términos avisando al Cliente con treinta (30) días de anticipación. **Durante el plazo de la cláusula 12.1 ninguna modificación podrá aumentar el precio, reducir el alcance descrito en la cláusula 1.2 ni acortar ese plazo.** Si el Cliente no acepta una modificación, podrá terminar sin penalidad antes de que entre en vigor, con reembolso a prorrata de los días no prestados.

13.2. El precio no se modifica durante el plazo de la cláusula 12.1.

## 14. Ley aplicable, domicilio y controversias

14.1. Estos Términos se rigen por la ley colombiana. Las Partes fijan como domicilio contractual la ciudad de Bogotá D.C. y someterán sus diferencias a la jurisdicción ordinaria colombiana, previo intento de arreglo directo.

## 15. Notificaciones

15.1. Las notificaciones se surten a los correos registrados por cada Parte en la plataforma.

## 16. Aceptación

16.1. Estos Términos se aceptan **en la plataforma**, por el representante legal del Cliente o por quien tenga poder suficiente, mediante la confirmación expresa habilitada para ello. Quien acepta **declara bajo juramento, que se entiende prestado con la aceptación, que cuenta con facultades suficientes para obligar al Cliente**, y responde personalmente en los términos del **artículo 841 del Código de Comercio** si obra sin ellas o las excede.

16.2. La aceptación deja registro de la fecha y hora, el usuario que la realiza, la dirección IP, el dispositivo, la versión aceptada y la huella digital (SHA-256) del documento, y ese registro es la prueba de la aceptación.

16.3. El acceso al Servicio queda habilitado una vez registrada la aceptación.

16.4. **Paso desde la versión 1.4.** Para el Cliente que venía con la versión 1.4, esta versión rige desde que la acepta en la plataforma o, si no la acepta, desde el **1 de diciembre de 2026**, por la cláusula 13.1 de la versión 1.4, que permite modificarla con aviso de treinta (30) días. Antes de esa fecha el Cliente puede terminar sin penalidad, con reembolso a prorrata de los días no prestados del período pagado. El aviso publicado el 1 de noviembre de 2026 es también el aviso de no renovación de la cláusula 12.2 de la versión 1.4: vencido el plazo de la cláusula 12.1, la suscripción continúa solo si el Cliente aceptó esta versión. Desde el **22 de diciembre de 2026**, o desde el día siguiente al fin del último período pagado si es posterior, sin esa aceptación no se pueden hacer consultas, y el Cliente conserva la exportación de la cláusula 9.3.$texto$;

  v_ahora timestamptz := now();
  v_publicar_en timestamptz := (c_publicacion + c_hora_publicacion) at time zone 'America/Bogota';
  v_publicada_at timestamptz;
  v_previa record;
  v_id uuid;
  v_vigentes int;
begin
  -- ── Lo que tiene que existir antes ─────────────────────────────────────────
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'documentos_contractuales_versiones' and column_name = 'rige_por_aviso'
  ) or to_regclass('public.avisos_modificacion_vistos') is null then
    raise exception 'Falta la migración 20261007150000_terminos_modificacion_por_aviso.sql';
  end if;

  if c_vigencia <> c_publicacion + 30 then
    raise exception 'la vigencia (%) no es la publicación (%) + 30 días calendario (cláusula 13.1 de la v1.4)', c_vigencia, c_publicacion;
  end if;

  -- Cuándo queda publicada: a la hora fijada, o ahora si ya pasó. Siempre el día que dice el texto.
  v_publicada_at := greatest(v_ahora, v_publicar_en);
  if (v_publicada_at at time zone 'America/Bogota')::date <> c_publicacion then
    raise exception '%: hoy es % en Bogotá y el texto dice que el aviso se publica el % (rige el %). Publicar otro día cambia la vigencia: regenerar el texto, el PDF y este archivo con la fecha nueva.',
      c_slug_ws, (v_ahora at time zone 'America/Bogota')::date, c_publicacion, c_vigencia;
  end if;
  if v_publicada_at > v_ahora and not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'documentos_versiones_por_aviso'
       and position('publicacion_programada' in p.prosrc) > 0
  ) then
    raise exception '%: para registrar el aviso antes de publicarlo (%) falta la migración 20261029190000_terminos_aviso_publicacion_programada.sql. Sin ella, este bloque se corre el % (Bogotá).',
      c_slug_ws, v_publicar_en, c_publicacion;
  end if;

  -- Idempotencia: con la v1.5 ya registrada, nada que hacer.
  if exists (
    select 1 from public.documentos_contractuales_versiones d
     where d.empresa_id = c_empresa and d.slug = c_slug_doc and d.version = c_version
  ) then
    raise exception '%: la v1.5 de esta empresa ya está registrada. Nada que hacer.', c_slug_ws;
  end if;

  -- La versión que se modifica: la esperada, de esta empresa, con su huella y sin fecha de retiro.
  select d.id, d.workspace_id, d.linea_id, d.titulo, d.alcance, d.vigente_desde, d.vigente_hasta, d.reemplaza_version_id
    into v_previa
    from public.documentos_contractuales_versiones d
   where d.id = c_previa and d.empresa_id = c_empresa and d.slug = c_slug_doc
     and d.version = c_previa_version and d.pdf_sha256 = c_previa_pdf;
  if not found then
    raise exception '%: la % esperada (%) no está registrada para esta empresa con su huella', c_slug_ws, c_previa_version, c_previa;
  end if;
  if v_previa.workspace_id <> c_ws_metrik or v_previa.alcance <> 'cliente' then
    raise exception '%: la % no es un documento cliente del workspace metrik', c_slug_ws, c_previa_version;
  end if;
  if v_previa.vigente_hasta is not null then
    raise exception '%: la % ya tiene vigente_hasta (%): revisar antes de publicar', c_slug_ws, c_previa_version, v_previa.vigente_hasta;
  end if;
  if v_previa.vigente_desde >= c_vigencia then
    raise exception '%: la % rige desde el %, no antes de la v1.5 (%)', c_slug_ws, c_previa_version, v_previa.vigente_desde, c_vigencia;
  end if;
  -- Ninguna OTRA versión de estos términos vigente hoy o después, salvo la que la previa reemplazó (la
  -- v1.3, vigente hasta el 5-nov) y que ya tiene su fecha de retiro.
  select count(*) into v_vigentes
    from public.documentos_contractuales_versiones d
   where d.empresa_id = c_empresa and d.slug = c_slug_doc and d.id <> c_previa
     and d.id is distinct from v_previa.reemplaza_version_id
     and (d.vigente_hasta is null or d.vigente_hasta >= (v_ahora at time zone 'America/Bogota')::date);
  if v_vigentes > 0 then
    raise exception '%: hay otra versión vigente de los términos de esta empresa además de la %', c_slug_ws, c_previa_version;
  end if;
  if v_previa.reemplaza_version_id is not null and not exists (
    select 1 from public.documentos_contractuales_versiones d
     where d.id = v_previa.reemplaza_version_id and d.vigente_hasta is not null and d.vigente_hasta < c_vigencia
  ) then
    raise exception '%: la versión que la % reemplazó sigue sin fecha de retiro anterior al %', c_slug_ws, c_previa_version, c_vigencia;
  end if;

  -- Un contrato vivo de esta empresa que paga este espacio, con lo que la v1.5 modifica ACEPTADO (la
  -- previa, o la que la previa reemplazó por aviso): sin aceptación no hay qué modificar por aviso.
  if not exists (
    select 1 from public.servicios_contratados sc
     where sc.negocio_id = c_negocio and sc.empresa_id = c_empresa and sc.workspace_pagador_id = c_ws_cda
       and sc.estado not in ('cancelado', 'terminado')
  ) then
    raise exception '%: no hay contrato vivo de esta empresa pagado por el espacio', c_slug_ws;
  end if;
  if not exists (
    select 1 from public.aceptaciones_terminos a
     where a.estado = 'aceptado' and a.documento_sha256 in (c_previa_pdf, c_anterior_pdf) and a.negocio_id = c_negocio
  ) then
    raise exception '%: ni la % ni la versión que reemplazó tienen aceptación registrada en el contrato: la v1.5 no se publica por aviso', c_slug_ws, c_previa_version;
  end if;

  -- El PDF del aviso tiene que estar subido: la pantalla, el aviso y el correo enlazan a él.
  if not exists (select 1 from storage.objects o where o.bucket_id = 'aceptaciones-documentos' and o.name = c_pdf_path) then
    raise exception '%: falta subir el PDF a aceptaciones-documentos/% (paso 2 de la cabecera)', c_slug_ws, c_pdf_path;
  end if;

  -- El texto que se publica es exactamente el generado, con sus fechas.
  if encode(sha256(convert_to(c_texto, 'UTF8')), 'hex') is distinct from c_texto_sha256 then
    raise exception '%: el texto no es el generado (huella distinta). No se edita a mano: se regenera.', c_slug_ws;
  end if;
  if position('# TÉRMINOS DE SUSCRIPCIÓN AL SERVICIO VALIDA · PLAN CDA v1.5' in c_texto) <> 1
     or position('desde el **1 de diciembre de 2026**' in c_texto) = 0
     or position('publicado el 1 de noviembre de 2026' in c_texto) = 0 then
    raise exception '%: el texto no es la v1.5 con publicación el 1-nov y vigencia el 1-dic de 2026', c_slug_ws;
  end if;

  -- ── 1. La previa rige hasta el día anterior a la vigencia de la v1.5 ───────
  update public.documentos_contractuales_versiones
     set vigente_hasta = c_vigencia - 1
   where id = c_previa and vigente_hasta is null;

  -- ── 2. La v1.5 por aviso: se muestra desde `publicada_at` ──────────────────
  insert into public.documentos_contractuales_versiones
    (workspace_id, linea_id, slug, alcance, empresa_id, titulo, version, texto_md, texto_sha256,
     pdf_bucket, pdf_path, pdf_sha256, vigente_desde, rige_por_aviso, reemplaza_version_id, publicada_at,
     registrado_por)
  values
    (v_previa.workspace_id, v_previa.linea_id, c_slug_doc, 'cliente', c_empresa, c_titulo, c_version, c_texto,
     c_texto_sha256, 'aceptaciones-documentos', c_pdf_path, c_pdf_sha256, c_vigencia, true, c_previa, v_publicada_at,
     c_registrado_por)
  returning id into v_id;

  -- ── Comprobación ──────────────────────────────────────────────────────────
  if not exists (
    select 1 from public.documentos_contractuales_versiones d
     where d.id = v_id and d.rige_por_aviso and d.reemplaza_version_id = c_previa
       and d.vigente_desde = c_vigencia and d.publicada_at = v_publicada_at
       and (d.publicada_at at time zone 'America/Bogota')::date = c_publicacion
  ) or not exists (
    select 1 from public.documentos_contractuales_versiones d where d.id = c_previa and d.vigente_hasta = c_vigencia - 1
  ) then
    raise exception '%: la publicación no quedó como se esperaba', c_slug_ws;
  end if;

  if c_ensayo then
    raise exception 'ENSAYO OK %: v1.5 % por aviso, publicada %, rige el %; % vigente hasta el %. Nada quedó escrito.',
      c_slug_ws, v_id, v_publicada_at at time zone 'America/Bogota', c_vigencia, c_previa_version, c_vigencia - 1;
  end if;
  raise notice 'PUBLICADO %: v1.5 % por aviso, visible desde % (Bogotá), rige el %',
    c_slug_ws, v_id, v_publicada_at at time zone 'America/Bogota', c_vigencia;
end;
$bloque$;


-- ════════════════════════════════════════════════════════════════════════════
-- QA OPCIONAL: el espacio de pruebas CDA Pruebas (no es uno de los 4 CDA con contrato real).
-- Sirve para ver la pantalla, el aviso, el documento, el PDF y la aceptación en producción antes que los
-- CDA. Su PDF va en aceptaciones-documentos/cda-pruebas/…, generado con `generar.py --qa`
-- (carpeta terminos-cda-v1.5/_qa/cda-pruebas/). Reemplaza su v1.1 aceptada (nunca recibió la v1.4). Si
-- no se quiere QA en producción, no se corre: los otros cuatro no dependen de él.
-- ════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
-- QA (OPCIONAL) · CP 26 1 · espacio `cda-pruebas` · aceptó la v1.1 el 2026-09-23 (espacio de pruebas)
-- La v1.1 (a515f1bf-1303-4d2e-b3cf-0ac08ec0ea50) queda vigente hasta el 30-nov; la v1.5 por aviso rige desde el 1-dic.
-- 12.1 hasta el 2027-01-23; aceptación exigible desde el 2027-01-24 (o el día siguiente
-- al fin del último período pagado, si es posterior).
-- ────────────────────────────────────────────────────────────────────────────
do $bloque$
declare
  -- ⚠️ true = ENSAYO: escribe, comprueba y deshace todo con RAISE EXCEPTION 'ENSAYO OK …'.
  c_ensayo constant boolean := true;
  -- El día (Bogotá) en que se publica el aviso, el que dicen los textos, y la hora (Bogotá) desde la que
  -- se muestra. Corrido ANTES de esa hora (con la migración 20261029190000), la fila queda registrada con
  -- `publicada_at` = esa hora y la plataforma la muestra desde ahí. Corrido ese mismo día después de esa
  -- hora, `publicada_at` = el momento de correrlo. Otro día, no corre: el texto diría una fecha falsa.
  c_publicacion       constant date := date '2026-11-01';
  c_hora_publicacion  constant time := time '00:00';
  c_vigencia          constant date := date '2026-12-01';

  c_ws_metrik      constant uuid := 'a21bfc88-1a60-48c3-afcd-144226aa2392';
  c_registrado_por constant uuid := 'cc6f6100-4eb7-4eed-9a7c-096729f5cedf';  -- Mauricio (platform admin)
  c_slug_doc       constant text := 'terminos-suscripcion-valida-cda';
  c_titulo         constant text := 'Términos de Suscripción al Servicio VALIDA · Plan CDA';
  c_version        constant text := 'v1.5';
  c_ws_cda         constant uuid := '475da39a-5aa5-4857-a3c2-0d21277d8d53';
  c_slug_ws        constant text := 'cda-pruebas';
  c_empresa        constant uuid := '73c0f5d7-29fb-4b6b-825a-b5c7dbd70ae5';
  c_negocio        constant uuid := 'c4a1ca06-4134-4cef-9376-a10222f81478';
  c_previa         constant uuid := 'a515f1bf-1303-4d2e-b3cf-0ac08ec0ea50';
  c_previa_version constant text := 'v1.1';
  c_previa_pdf     constant text := '87074c2b80496c882649fe1d33581fb14d78bc9887cd9cf75cd77a3cad98f2e1';
  -- La versión que la previa reemplazó (si la previa es por aviso): su aceptación también cubre la v1.5.
  c_anterior_pdf   constant text := '87074c2b80496c882649fe1d33581fb14d78bc9887cd9cf75cd77a3cad98f2e1';
  c_texto_sha256   constant text := '36d7d51fbebe0ea0e738894708a84a54bc0cae6980c8a4d11360f33980a6eb8c';
  c_pdf_sha256     constant text := 'b12923d3e733d2b1641300004a1b3d46166adccf1aa58d1935da92cdd5c9ce67';
  c_pdf_path       constant text := 'cda-pruebas/terminos-suscripcion-valida-cda-v1.5.pdf';
  c_texto constant text := $texto$# TÉRMINOS DE SUSCRIPCIÓN AL SERVICIO VALIDA · PLAN CDA v1.5

**METRIK**: METRIK IA S.A.S., NIT 902.079.601-9, domiciliada en la Calle 24A Bis 100-71, Bogotá D.C., representada legalmente por Brallan Mauricio Moreno Guzmán. Correo: mauricio.moreno@metrik.com.co.

**EL CLIENTE**: CDA PRUEBAS (ESPACIO DE PRUEBAS METRIK), NIT 999.999.999-9, domiciliada en Calle 24A Bis 100-71, Bogotá D.C. (espacio de pruebas), representada legalmente por Brallan Mauricio Moreno Guzmán.

Estos Términos rigen desde su aceptación en la forma prevista en la cláusula 16 y constituyen el acuerdo completo entre las Partes sobre el Servicio.

## 0. Antecedente y continuidad

0.1. El Cliente venía accediendo a VALIDA en virtud del Contrato de Prestación de Servicios Tecnológicos de Validación en Listas Vinculantes y Restrictivas suscrito el 23 de septiembre de 2026 con AFI INTERNATIONAL GROUP S.A.S., terminado de mutuo acuerdo con efectos al 23 de septiembre de 2026.

0.2. VALIDA es de propiedad de METRIK. Estos Términos sustituyen ese contrato **sin interrumpir el servicio** y **respetando el plazo pactado en él**, en los términos de la cláusula 12.1.

0.3. **Versión 1.5.** Esta versión reemplaza la versión 1.4 de estos Términos. Conserva el precio, el alcance de la cláusula 1.2, los usuarios de la cláusula 2.3 y el plazo de la cláusula 12.1. Cambia la forma de pago y lo que ocurre cuando un período no se paga (cláusulas 2.4, 2.5, 2.6, 9.3, 11, 12 y 16.4).

## 1. Objeto y alcance

1.1. METRIK concede al Cliente acceso a **VALIDA**, servicio de computación en la nube para la consulta automatizada de personas naturales y jurídicas contra listas restrictivas y vinculantes utilizadas en la gestión del riesgo de LA/FT/FP (el "Servicio"), a través de su espacio de trabajo en cda-pruebas.metrikone.co.

1.2. El Servicio comprende: acceso a la plataforma, **un (1) usuario administrador y dos (2) usuarios operativos habilitados**, **consultas individuales ilimitadas**, **consultas masivas ilimitadas**, generación de reportes de validación, consulta de listas nacionales e internacionales aplicables al marco normativo colombiano, actualización permanente de las fuentes disponibles y soporte funcional básico.

1.3. El alcance es la consulta de listas del marco SARLAFT según el catálogo vigente publicado en la plataforma. No incluye asesoría jurídica, normativa ni tributaria, ni el diseño u operación del sistema SARLAFT/SAGRILAFT/SIPLAFT del Cliente. Tampoco incluye el acceso por interfaz de programación (API) ni integraciones con otros sistemas, que son otro producto y se contratan aparte, con sus propios términos.

1.4. El Cliente declara que contrata como empresa, para su actividad económica, y no como consumidor final (Ley 1480 de 2011).

## 2. Condiciones comerciales

2.1. **Precio.** La suscripción tiene un valor de **CIENTO CINCUENTA MIL PESOS ($150.000) mensuales**.

2.2. **Tributos.** El Servicio se factura como servicio de computación en la nube (cloud computing) **excluido del impuesto sobre las ventas**, conforme al **numeral 21 del artículo 476 del Estatuto Tributario**. El precio señalado en la cláusula 2.1 es el valor total a cargo del Cliente y no lleva IVA que sumar ni que discriminar. El soporte funcional previsto en la cláusula 1.2 es inherente al acceso al Servicio y no constituye un servicio facturado por separado. Si la autoridad tributaria determina que el Servicio se encuentra gravado, METRIK no trasladará al Cliente el impuesto correspondiente a los períodos ya facturados; para los períodos siguientes, las Partes ajustarán el precio para incorporar el tributo.

2.3. **Usuarios adicionales.** La suscripción incluye un (1) usuario administrador sin costo, que es la persona designada por el Cliente para aceptar estos Términos y gestionar la suscripción, y dos (2) usuarios operativos. Cada usuario operativo adicional tiene un valor de **CINCUENTA MIL PESOS ($50.000) mensuales**, bajo el mismo tratamiento tributario de la cláusula 2.2, y requiere solicitud expresa del Cliente.

2.4. **Pago y período.** La suscripción es mensual y se paga por anticipado. Cada período va desde la fecha de renovación hasta el día anterior a esa misma fecha del mes siguiente. Si ese día no existe en el mes, la renovación es el último día del mes, y al mes siguiente vuelve al día original. La fecha de renovación del Cliente es el día 23 de cada mes, que es el día en que empiezan los períodos que venía pagando, y solo cambia en el caso de la cláusula 11.4. Antes de cada fecha de renovación, METRIK envía al correo registrado y muestra en la plataforma un enlace de pago con el período, el valor y la fecha desde la cual la suscripción quedará Suspendida por pago si no se paga. Cuando la plataforma lo permita, el Cliente puede registrar una tarjeta para que el cobro se haga de forma automática en la fecha de renovación; en ese caso, METRIK solo intenta el cobro automático dentro de los cinco (5) días de gracia de la cláusula 11.1. Un pago hecho antes de la fecha de renovación paga el período que empieza en esa fecha. METRIK expide factura electrónica de venta por cada pago aprobado, por el período que ese pago cubre.

2.5. **Falta de pago.** No pagar un período no genera intereses ni penalidad, y METRIK no cobra los períodos que empiezan desde el **1 de diciembre de 2026** y el Cliente no pagó: su efecto es el de la cláusula 11. Los períodos que empiezan antes de esa fecha se rigen por la cláusula 11.7.

2.6. **Plan Anual.** Si el Cliente compró un Plan Anual conforme a su Anexo, ese Anexo prevalece para los períodos que cubre, que están pagados y a los que no se aplica la cláusula 11.

## 3. Credenciales

3.1. Las credenciales de acceso son personales de cada usuario habilitado, confidenciales e intransferibles.

3.2. El Cliente responde por el uso que se haga con sus credenciales y avisará a METRIK, sin demora, de cualquier uso no autorizado.

3.3. METRIK podrá rotar, suspender o revocar credenciales ante indicios de compromiso, uso indebido o incumplimiento de estos Términos.

## 4. Acceso al servicio, uso permitido y prohibido

4.1. **Exclusividad del acceso.** La suscripción y el acceso al servicio son exclusivos para CDA PRUEBAS (ESPACIO DE PRUEBAS METRIK) y no se extienden a empresas vinculadas, filiales, subordinadas, matrices, aliados ni terceros. Los usuarios habilitados deben pertenecer al Cliente.

4.2. **Uso permitido.** El Servicio se usa exclusivamente para la prevención y gestión del riesgo de LA/FT/FP en la operación propia del Cliente.

4.3. **Uso prohibido.** El Cliente no podrá ceder, transferir, compartir, sublicenciar ni revender el acceso; prestar con él servicios de consulta a terceros; extraer, copiar o reconstruir las bases de datos; ni usar medios automatizados no autorizados para acceder al Servicio.

4.4. El incumplimiento de esta cláusula faculta a METRIK para suspender el Servicio de inmediato y para terminar estos Términos sin indemnización.

## 5. Naturaleza del resultado

5.1. **Herramienta de apoyo.** VALIDA es una herramienta tecnológica de consulta automatizada. No constituye concepto jurídico ni decisión de vinculación.

5.2. **Responsabilidad del sujeto obligado.** El Cliente, como sujeto obligado, conserva íntegramente sus deberes de debida diligencia y la decisión final sobre cada caso.

5.3. **Clasificación de listas.** Cada resultado indica la naturaleza de la lista consultada.

5.4. **Fuentes.** El contenido corresponde a sus emisores oficiales. METRIK no garantiza la ausencia absoluta de errores, omisiones o modificaciones realizadas por dichos emisores.

## 6. Disponibilidad y soporte

6.1. METRIK realizará esfuerzos razonables para mantener disponible el Servicio y podrá programar mantenimientos, actualizaciones e interrupciones por fuerza mayor.

6.2. El soporte funcional básico se presta por los canales publicados en la plataforma.

## 7. Confidencialidad

7.1. Es Información Confidencial toda información no pública que una Parte reciba de la otra con ocasión de estos Términos.

7.2. La Parte receptora la usará solo para ejecutarlos y la protegerá con al menos el mismo cuidado que aplica a la propia.

7.3. La obligación rige durante la vigencia y **cinco (5) años** después de su terminación.

## 8. Propiedad intelectual

8.1. La plataforma, sus desarrollos, interfaces, bases de datos, metodologías, reportes, algoritmos y marcas son de propiedad exclusiva de METRIK o de sus licenciantes.

8.2. Estos Términos no transfieren derecho de propiedad intelectual alguno al Cliente.

## 9. Tratamiento de datos personales

9.1. Las Partes cumplirán la Ley 1581 de 2012 y las normas que la modifiquen o complementen.

9.2. Respecto de los datos personales que el Cliente consulte en la plataforma, el Cliente actúa como Responsable y METRIK como Encargado, y los trata únicamente conforme a las instrucciones del Cliente y para prestar el Servicio.

9.3. **Conservación y exportación.** Por instrucción del Cliente y para que este pueda cumplir su deber de conservación, METRIK conserva la bitácora de consultas del Cliente y la evidencia asociada (datos consultados, resultado, versión de las listas y reporte con su huella) durante **diez (10) años**, plazo de la Ley 962 de 2005, artículo 28, al que remite la Resolución 2328 de 2025 de la Superintendencia de Transporte (artículo 5.6.11.4). Durante ese plazo esos registros no se suprimen, ni siquiera a solicitud del Cliente o del titular. En cualquier estado de la suscripción, incluida la Cancelada, y aun después de terminados estos Términos, durante ese plazo, el Cliente puede pedir por escrito a mauricio.moreno@metrik.com.co, desde un correo registrado, la **exportación de la bitácora de sus consultas** en formato legible por máquina y de los reportes generados. METRIK la entrega sin costo dentro de los cinco (5) días hábiles siguientes al recibo de la solicitud, o dentro del plazo menor que fije una autoridad si el Cliente lo informa en la solicitud. Los reportes entregados conservan su código de verificación y su huella. METRIK traslada al Cliente, dentro de los dos (2) días hábiles siguientes, toda consulta o reclamo de un titular que reciba.

9.4. **Transmisión internacional.** El Cliente autoriza a METRIK a transmitir los datos personales necesarios para prestar el Servicio a los proveedores de infraestructura en la nube y de fuentes de información que METRIK utilice, incluidos los ubicados fuera de Colombia, conforme al **artículo 26 de la Ley 1581 de 2012** y al **artículo 25 del Decreto 1377 de 2013**. METRIK mantiene publicada en la plataforma la relación de dichos proveedores y exige de ellos garantías de seguridad no inferiores a las propias.

9.5. **Incidentes de seguridad.** METRIK notificará al Cliente cualquier incidente de seguridad que afecte sus datos **dentro de las setenta y dos (72) horas** siguientes a su conocimiento, con la información disponible sobre naturaleza, alcance y medidas adoptadas.

## 10. Responsabilidad

10.1. Las decisiones adoptadas por el Cliente con base en los resultados son de su exclusiva responsabilidad.

10.2. La responsabilidad total de METRIK por cualquier concepto se limita al valor pagado por el Cliente en los tres (3) meses anteriores al hecho que la origine.

## 11. Gracia, suspensión por pago y cancelación

11.1. **Días de gracia.** Si en la fecha de renovación el período no queda pagado, el Cliente sigue consultando con normalidad durante los cinco (5) días calendario siguientes. Desde el día siguiente a la fecha de renovación, la plataforma muestra a los usuarios del Cliente la fecha desde la cual la suscripción quedará Suspendida por pago.

11.2. **Suspendida por pago.** Si el período no se paga dentro de los días de gracia, la suscripción queda **Suspendida por pago** desde el sexto (6.º) día calendario siguiente a la fecha de renovación y hasta el trigésimo (30.º). Mientras está Suspendida por pago, el Cliente no puede hacer consultas nuevas, individuales ni masivas, pero conserva el acceso a la plataforma, sus usuarios siguen habilitados, y puede ver y descargar su historial y los reportes ya generados y exportar la bitácora. Si paga en este estado, las consultas se reactivan y el período pagado corre desde la fecha de renovación original, que no cambia: los días de suspensión hacen parte de ese período.

11.3. **Cancelada.** Si pasan más de treinta (30) días calendario desde la fecha de renovación sin que el período se pague, desde el trigésimo primer (31.º) día la suscripción queda **Cancelada**. Mientras está Cancelada, los usuarios del Cliente pueden entrar a la plataforma, que les muestra que la suscripción está cancelada y que su información está guardada, pero no pueden hacer consultas ni ver el historial ni los reportes en la plataforma. La información del Cliente se conserva íntegra y se puede obtener como dice la cláusula 9.3. Si el Cliente registró una tarjeta, METRIK pide a la pasarela eliminarla y lo informa al correo registrado. La cancelación se debe a la falta de pago del Cliente y no es terminación sin causa por parte de METRIK.

11.4. **Reactivación después de la cancelación.** El Cliente reactiva la suscripción Cancelada pagando un período con el enlace que le envíe METRIK. El nuevo período corre desde el día del pago aprobado, que pasa a ser la nueva fecha de renovación. Con el pago, el Cliente recupera las consultas y el acceso a su historial y a sus reportes. La fecha del pago es la de su registro conforme a la cláusula 11.5.

11.5. **Registro del pago.** El pago hecho por el enlace se registra al ser aprobado. El hecho por otro medio, a más tardar el día hábil siguiente a su acreditación en la cuenta de METRIK.

11.6. **Suspensión por otras causas.** METRIK podrá suspender el Servicio de inmediato ante uso indebido de credenciales, cesión de accesos a terceros, orden de autoridad o actividades que comprometan la seguridad de la plataforma o de la información, y lo informará a los correos registrados.

11.7. **Transición.** Los períodos que empiezan antes del **1 de diciembre de 2026** y no están pagados, sea bajo esta versión o bajo las anteriores, se deben y no se condonan. Para estar al día, el Cliente los paga a más tardar el **30 de noviembre de 2026**. Para efectos de las cláusulas 11.1 a 11.3, esa es su fecha de renovación: si no se pagan, la suscripción queda Suspendida por pago desde el 6 de diciembre de 2026 y Cancelada desde el 31 de diciembre de 2026, y antes de esas fechas METRIK no restringe, suspende ni pausa las consultas por esos períodos. Al pagarlos, el Cliente queda al día y su fecha de renovación es la de la cláusula 2.4. No se aplican la restricción ni la suspensión por mora de las cláusulas 11.1 y 11.3 de la versión 1.4.

## 12. Vigencia, renovación y terminación

12.1. **Plazo de los compromisos de METRIK.** Estos Términos rigen desde su aceptación y mientras el Cliente no se retire. Hasta el **23 de enero de 2027**, fecha en que vencía el contrato terminado con AFI, METRIK mantiene los compromisos de las cláusulas 12.3 y 13, de modo que el Cliente conserva íntegro el plazo que había contratado.

12.2. **Renovación y retiro.** La suscripción se renueva cada mes con el pago del período. El Cliente puede dejar de renovarla en cualquier momento, sin aviso previo y sin penalidad: basta con no pagar el período siguiente o, si registró tarjeta, retirarse desde la plataforma o escribiendo a mauricio.moreno@metrik.com.co. El Cliente conserva las consultas hasta el fin del período pagado; después, la suscripción sigue la cláusula 11.

12.3. **Terminación por METRIK.** Durante el plazo de la cláusula 12.1, METRIK no podrá terminar estos Términos sin causa imputable al Cliente. Después, podrá terminarlos con aviso escrito de treinta (30) días. Podrá terminarlos de inmediato, en cualquier tiempo, por incumplimiento de las cláusulas 3, 4 o 9.

12.4. **Saldo.** Si el Cliente se retira o deja de pagar, no hay reembolso del período ya pagado. Si METRIK termina sin causa imputable al Cliente, reembolsa a prorrata los días no prestados.

12.5. Sobreviven a la terminación las cláusulas 5, 7, 8, 9, 10, 12.4 y 14.

## 13. Modificaciones

13.1. METRIK podrá modificar estos Términos avisando al Cliente con treinta (30) días de anticipación. **Durante el plazo de la cláusula 12.1 ninguna modificación podrá aumentar el precio, reducir el alcance descrito en la cláusula 1.2 ni acortar ese plazo.** Si el Cliente no acepta una modificación, podrá terminar sin penalidad antes de que entre en vigor, con reembolso a prorrata de los días no prestados.

13.2. El precio no se modifica durante el plazo de la cláusula 12.1.

## 14. Ley aplicable, domicilio y controversias

14.1. Estos Términos se rigen por la ley colombiana. Las Partes fijan como domicilio contractual la ciudad de Bogotá D.C. y someterán sus diferencias a la jurisdicción ordinaria colombiana, previo intento de arreglo directo.

## 15. Notificaciones

15.1. Las notificaciones se surten a los correos registrados por cada Parte en la plataforma.

## 16. Aceptación

16.1. Estos Términos se aceptan **en la plataforma**, por el representante legal del Cliente o por quien tenga poder suficiente, mediante la confirmación expresa habilitada para ello. Quien acepta **declara bajo juramento, que se entiende prestado con la aceptación, que cuenta con facultades suficientes para obligar al Cliente**, y responde personalmente en los términos del **artículo 841 del Código de Comercio** si obra sin ellas o las excede.

16.2. La aceptación deja registro de la fecha y hora, el usuario que la realiza, la dirección IP, el dispositivo, la versión aceptada y la huella digital (SHA-256) del documento, y ese registro es la prueba de la aceptación.

16.3. El acceso al Servicio queda habilitado una vez registrada la aceptación.

16.4. **Paso desde la versión 1.4.** Para el Cliente que venía con la versión 1.4, esta versión rige desde que la acepta en la plataforma o, si no la acepta, desde el **1 de diciembre de 2026**, por la cláusula 13.1 de la versión 1.4, que permite modificarla con aviso de treinta (30) días. Antes de esa fecha el Cliente puede terminar sin penalidad, con reembolso a prorrata de los días no prestados del período pagado. El aviso publicado el 1 de noviembre de 2026 es también el aviso de no renovación de la cláusula 12.2 de la versión 1.4: vencido el plazo de la cláusula 12.1, la suscripción continúa solo si el Cliente aceptó esta versión. Desde el **24 de enero de 2027**, o desde el día siguiente al fin del último período pagado si es posterior, sin esa aceptación no se pueden hacer consultas, y el Cliente conserva la exportación de la cláusula 9.3.$texto$;

  v_ahora timestamptz := now();
  v_publicar_en timestamptz := (c_publicacion + c_hora_publicacion) at time zone 'America/Bogota';
  v_publicada_at timestamptz;
  v_previa record;
  v_id uuid;
  v_vigentes int;
begin
  -- ── Lo que tiene que existir antes ─────────────────────────────────────────
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'documentos_contractuales_versiones' and column_name = 'rige_por_aviso'
  ) or to_regclass('public.avisos_modificacion_vistos') is null then
    raise exception 'Falta la migración 20261007150000_terminos_modificacion_por_aviso.sql';
  end if;

  if c_vigencia <> c_publicacion + 30 then
    raise exception 'la vigencia (%) no es la publicación (%) + 30 días calendario (cláusula 13.1 de la v1.4)', c_vigencia, c_publicacion;
  end if;

  -- Cuándo queda publicada: a la hora fijada, o ahora si ya pasó. Siempre el día que dice el texto.
  v_publicada_at := greatest(v_ahora, v_publicar_en);
  if (v_publicada_at at time zone 'America/Bogota')::date <> c_publicacion then
    raise exception '%: hoy es % en Bogotá y el texto dice que el aviso se publica el % (rige el %). Publicar otro día cambia la vigencia: regenerar el texto, el PDF y este archivo con la fecha nueva.',
      c_slug_ws, (v_ahora at time zone 'America/Bogota')::date, c_publicacion, c_vigencia;
  end if;
  if v_publicada_at > v_ahora and not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'documentos_versiones_por_aviso'
       and position('publicacion_programada' in p.prosrc) > 0
  ) then
    raise exception '%: para registrar el aviso antes de publicarlo (%) falta la migración 20261029190000_terminos_aviso_publicacion_programada.sql. Sin ella, este bloque se corre el % (Bogotá).',
      c_slug_ws, v_publicar_en, c_publicacion;
  end if;

  -- Idempotencia: con la v1.5 ya registrada, nada que hacer.
  if exists (
    select 1 from public.documentos_contractuales_versiones d
     where d.empresa_id = c_empresa and d.slug = c_slug_doc and d.version = c_version
  ) then
    raise exception '%: la v1.5 de esta empresa ya está registrada. Nada que hacer.', c_slug_ws;
  end if;

  -- La versión que se modifica: la esperada, de esta empresa, con su huella y sin fecha de retiro.
  select d.id, d.workspace_id, d.linea_id, d.titulo, d.alcance, d.vigente_desde, d.vigente_hasta, d.reemplaza_version_id
    into v_previa
    from public.documentos_contractuales_versiones d
   where d.id = c_previa and d.empresa_id = c_empresa and d.slug = c_slug_doc
     and d.version = c_previa_version and d.pdf_sha256 = c_previa_pdf;
  if not found then
    raise exception '%: la % esperada (%) no está registrada para esta empresa con su huella', c_slug_ws, c_previa_version, c_previa;
  end if;
  if v_previa.workspace_id <> c_ws_metrik or v_previa.alcance <> 'cliente' then
    raise exception '%: la % no es un documento cliente del workspace metrik', c_slug_ws, c_previa_version;
  end if;
  if v_previa.vigente_hasta is not null then
    raise exception '%: la % ya tiene vigente_hasta (%): revisar antes de publicar', c_slug_ws, c_previa_version, v_previa.vigente_hasta;
  end if;
  if v_previa.vigente_desde >= c_vigencia then
    raise exception '%: la % rige desde el %, no antes de la v1.5 (%)', c_slug_ws, c_previa_version, v_previa.vigente_desde, c_vigencia;
  end if;
  -- Ninguna OTRA versión de estos términos vigente hoy o después, salvo la que la previa reemplazó (la
  -- v1.3, vigente hasta el 5-nov) y que ya tiene su fecha de retiro.
  select count(*) into v_vigentes
    from public.documentos_contractuales_versiones d
   where d.empresa_id = c_empresa and d.slug = c_slug_doc and d.id <> c_previa
     and d.id is distinct from v_previa.reemplaza_version_id
     and (d.vigente_hasta is null or d.vigente_hasta >= (v_ahora at time zone 'America/Bogota')::date);
  if v_vigentes > 0 then
    raise exception '%: hay otra versión vigente de los términos de esta empresa además de la %', c_slug_ws, c_previa_version;
  end if;
  if v_previa.reemplaza_version_id is not null and not exists (
    select 1 from public.documentos_contractuales_versiones d
     where d.id = v_previa.reemplaza_version_id and d.vigente_hasta is not null and d.vigente_hasta < c_vigencia
  ) then
    raise exception '%: la versión que la % reemplazó sigue sin fecha de retiro anterior al %', c_slug_ws, c_previa_version, c_vigencia;
  end if;

  -- Un contrato vivo de esta empresa que paga este espacio, con lo que la v1.5 modifica ACEPTADO (la
  -- previa, o la que la previa reemplazó por aviso): sin aceptación no hay qué modificar por aviso.
  if not exists (
    select 1 from public.servicios_contratados sc
     where sc.negocio_id = c_negocio and sc.empresa_id = c_empresa and sc.workspace_pagador_id = c_ws_cda
       and sc.estado not in ('cancelado', 'terminado')
  ) then
    raise exception '%: no hay contrato vivo de esta empresa pagado por el espacio', c_slug_ws;
  end if;
  if not exists (
    select 1 from public.aceptaciones_terminos a
     where a.estado = 'aceptado' and a.documento_sha256 in (c_previa_pdf, c_anterior_pdf) and a.negocio_id = c_negocio
  ) then
    raise exception '%: ni la % ni la versión que reemplazó tienen aceptación registrada en el contrato: la v1.5 no se publica por aviso', c_slug_ws, c_previa_version;
  end if;

  -- El PDF del aviso tiene que estar subido: la pantalla, el aviso y el correo enlazan a él.
  if not exists (select 1 from storage.objects o where o.bucket_id = 'aceptaciones-documentos' and o.name = c_pdf_path) then
    raise exception '%: falta subir el PDF a aceptaciones-documentos/% (paso 2 de la cabecera)', c_slug_ws, c_pdf_path;
  end if;

  -- El texto que se publica es exactamente el generado, con sus fechas.
  if encode(sha256(convert_to(c_texto, 'UTF8')), 'hex') is distinct from c_texto_sha256 then
    raise exception '%: el texto no es el generado (huella distinta). No se edita a mano: se regenera.', c_slug_ws;
  end if;
  if position('# TÉRMINOS DE SUSCRIPCIÓN AL SERVICIO VALIDA · PLAN CDA v1.5' in c_texto) <> 1
     or position('desde el **1 de diciembre de 2026**' in c_texto) = 0
     or position('publicado el 1 de noviembre de 2026' in c_texto) = 0 then
    raise exception '%: el texto no es la v1.5 con publicación el 1-nov y vigencia el 1-dic de 2026', c_slug_ws;
  end if;

  -- ── 1. La previa rige hasta el día anterior a la vigencia de la v1.5 ───────
  update public.documentos_contractuales_versiones
     set vigente_hasta = c_vigencia - 1
   where id = c_previa and vigente_hasta is null;

  -- ── 2. La v1.5 por aviso: se muestra desde `publicada_at` ──────────────────
  insert into public.documentos_contractuales_versiones
    (workspace_id, linea_id, slug, alcance, empresa_id, titulo, version, texto_md, texto_sha256,
     pdf_bucket, pdf_path, pdf_sha256, vigente_desde, rige_por_aviso, reemplaza_version_id, publicada_at,
     registrado_por)
  values
    (v_previa.workspace_id, v_previa.linea_id, c_slug_doc, 'cliente', c_empresa, c_titulo, c_version, c_texto,
     c_texto_sha256, 'aceptaciones-documentos', c_pdf_path, c_pdf_sha256, c_vigencia, true, c_previa, v_publicada_at,
     c_registrado_por)
  returning id into v_id;

  -- ── Comprobación ──────────────────────────────────────────────────────────
  if not exists (
    select 1 from public.documentos_contractuales_versiones d
     where d.id = v_id and d.rige_por_aviso and d.reemplaza_version_id = c_previa
       and d.vigente_desde = c_vigencia and d.publicada_at = v_publicada_at
       and (d.publicada_at at time zone 'America/Bogota')::date = c_publicacion
  ) or not exists (
    select 1 from public.documentos_contractuales_versiones d where d.id = c_previa and d.vigente_hasta = c_vigencia - 1
  ) then
    raise exception '%: la publicación no quedó como se esperaba', c_slug_ws;
  end if;

  if c_ensayo then
    raise exception 'ENSAYO OK %: v1.5 % por aviso, publicada %, rige el %; % vigente hasta el %. Nada quedó escrito.',
      c_slug_ws, v_id, v_publicada_at at time zone 'America/Bogota', c_vigencia, c_previa_version, c_vigencia - 1;
  end if;
  raise notice 'PUBLICADO %: v1.5 % por aviso, visible desde % (Bogotá), rige el %',
    c_slug_ws, v_id, v_publicada_at at time zone 'America/Bogota', c_vigencia;
end;
$bloque$;
