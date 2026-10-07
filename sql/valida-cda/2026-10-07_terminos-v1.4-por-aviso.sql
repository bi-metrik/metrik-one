-- ============================================================================
-- Valida · los Términos de los 4 CDA pasan de la v1.3 a la v1.4 POR AVISO (cláusula 13.1)
-- Preparado el 2026-10-07 (decisión de Mauricio, dictamen de Emilio). Lo corre la sesión principal.
--
-- La v1.4 es la v1.3 con las cláusulas 2.5 y 11 reemplazadas (restricción de las consultas nuevas a los
-- 5 días de mora). Se avisa POR LA PLATAFORMA: insertar la fila ES publicar el aviso, que desde ese
-- momento ven todos los usuarios del CDA en /valida (qué cambia, vigencia, documento, PDF y el derecho de
-- la 13.1). La persona designada puede aceptarla con el mismo mecanismo de la entrada; no aceptarla NUNCA
-- pausa ni restringe (la v1.3 aceptada sigue valiendo y la v1.4 rige por el aviso).
--
-- Por cada CDA, en UNA transacción: la v1.3 queda vigente hasta el 2026-11-05 (`vigente_hasta`, lo único
-- que la inmutabilidad deja mover) y se registra la v1.4 con `rige_por_aviso = true`,
-- `reemplaza_version_id` = la v1.3, `publicada_at = now()` y `vigente_desde = 2026-11-06` (publicación +
-- 30 días calendario; la base lo vuelve a exigir en `documentos_versiones_por_aviso()`).
--
-- ⚠️ ESTO NO ESTÁ APLICADO. Escribe datos de producción.
--
-- ⚠️⚠️ EL DÍA IMPORTA: los textos dicen «publicado el 7 de octubre de 2026» y «rige desde el 6 de noviembre
-- de 2026». Cada bloque se niega a correr si hoy (Bogotá) no es el 2026-10-07. Si se publica otro día, hay
-- que regenerar la cláusula 11.4 (maestro v1.4 + `terminos-cda-v1.4/_generador/generar.py`), el PDF de la
-- modificación (`aviso-clausula-11-v1.4/`), este archivo, y correr `RESTRICCION_VIGENTE_DESDE` en
-- `src/lib/valida-cda/plazos.ts` (que la puerta ya no usa para decidir, pero una prueba exige que
-- coincida con este archivo).
--
-- ── Orden (sesión principal) ────────────────────────────────────────────────
--   0. Migración `20261007150000_terminos_modificacion_por_aviso.sql` aplicada (solo DDL; el código que
--      hoy está en producción la tolera: lee las columnas nuevas y las ignora).
--   1. El PR mergeado y desplegado. ⚠️ Sin el código nuevo, la v1.4 sin aceptar PAUSARÍA Valida desde el
--      6-nov (la puerta vieja la trataría como términos de entrada pendientes) y nadie vería el aviso.
--      Además, el código de hoy restringe desde el 5-nov (#1064): este PR lo corre al 6-nov.
--   2. Subir los 4 PDF al bucket `aceptaciones-documentos`, cada uno en
--      `<espacio>/terminos-suscripcion-valida-cda-v1.4.pdf`, SIN upsert (si ya hay un objeto con ese
--      nombre, parar y avisar: no se pisa evidencia). Los archivos son los de
--      `proyectos/metrik/valida/docs/entrega/legal/terminos-cda-v1.4/<espacio>/`, y antes de subirlos
--      `sha256sum` tiene que dar exactamente la huella de `c_pdf_sha256` de su bloque (tabla de abajo).
--      WeasyPrint no genera bytes idénticos dos veces: regenerar los PDF obliga a regenerar este archivo.
--        curl -X POST "$URL/storage/v1/object/aceptaciones-documentos/<espacio>/terminos-suscripcion-valida-cda-v1.4.pdf" \
--          -H "Authorization: Bearer $SERVICE_ROLE" -H "Content-Type: application/pdf" \
--          --data-binary @<ruta del PDF>
--   3. Por cada CDA, el bloque tal cual (ENSAYO): tiene que terminar en «ENSAYO OK <espacio>: …
--      Nada quedó escrito». Es UN statement: el ensayo deshace todo aunque pase por el pooler.
--   4. Cambiar `c_ensayo` a false en ese bloque y correrlo de nuevo: «PUBLICADO <espacio>: …». Desde ese
--      momento el aviso está en /valida de ese CDA.
--   5. (Opcional) El bloque de QA del final, para CDA Pruebas.
--
-- Correr un bloque dos veces es seguro: la segunda corrida se detiene en «la v1.4 de esta empresa ya
-- está registrada. Nada que hacer.» y no escribe.
--
-- ── Qué NO hace ─────────────────────────────────────────────────────────────
--   · No sube los PDF (paso 2) ni manda correos: el aviso es el de la plataforma.
--   · No registra ninguna aceptación de la v1.4: la acepta (si quiere) la persona designada en /valida.
--   · No toca contratos, cuotas ni módulos.
--
-- ── La constancia del preaviso (solo lectura, después de publicar) ──────────
--   -- Cuándo se publicó, por CDA:
--   select w.slug, d.version, d.publicada_at, d.vigente_desde, d.pdf_sha256
--     from public.documentos_contractuales_versiones d
--     join public.servicios_contratados sc on sc.empresa_id = d.empresa_id and sc.estado not in ('cancelado','terminado')
--     join public.workspaces w on w.id = sc.workspace_pagador_id
--    where d.slug = 'terminos-suscripcion-valida-cda' and d.rige_por_aviso
--    order by w.slug;
--   -- Quién vio el aviso y cuándo por primera vez, por CDA (la tabla solo se inserta):
--   select w.slug, p.full_name, v.visto_at, v.ip
--     from public.avisos_modificacion_vistos v
--     join public.workspaces w on w.id = v.workspace_id
--     join public.profiles p on p.id = v.usuario_id
--    order by w.slug, v.visto_at;
--   -- Quién aceptó la v1.4 (mismo registro que la v1.3: persona, cédula, IP, huella):
--   select a.workspace_cliente_id, a.nombre_aceptante, a.cedula_aceptante, a.respondido_at, a.ip, a.documento_sha256
--     from public.aceptaciones_terminos a
--    where a.documento_version = 'v1.4' and a.estado = 'aceptado';
--
-- Huellas de la v1.4 (generador en proyectos/metrik/valida/docs/entrega/legal/terminos-cda-v1.4/_generador/,
-- `verificar.py` al lado comprueba que frente a la v1.3 solo cambian el título, la 2.5 y la 11):
--   cda-caqueta     texto 059023cdd321b9148870247eb48a9e0c2b907363b7678a1654116389b27a89b3
--                   PDF   a59d45b84babebff0910394ea1d8265e2270966df24d280b17d741da885fd268
--   cda-elcarmen    texto 453d674f54299db3fbc29291aaf9e72e56a66df313d09b607b8f4b0c8380d601
--                   PDF   36c794148b3912db0ddec7bd3f089c9a5e185e5e5e2f330d5c06f63b5aafa88f
--   cda-puertotest  texto c594912c7465fee63581b472316b434404313b0ca20c304545257de7739b9156
--                   PDF   491efebd0075db2d7a78a8aa470f07611c25da0cf976bb1adc77dc9b6b0afc0d
--   maxitec         texto 196854fa6a3b6b9e4c14e586ab0b9da17515a00c96c0a6daef1375c1d325618c
--                   PDF   d3d1f92a40351c40e8766e03244f5b32bc177664077a9ce337ac95bc80cf5c3d
--   cda-pruebas QA  texto e192479c1891e22a822dd56c90c565f8baf656d1588abf04588809802b5d04e0
--                   PDF   6abf5e342f4ad61b2bccb68e32d9b6d74cf65b8866ebf1abea67421a6c558e67
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- C1 26 1 · espacio `cda-caqueta` · aceptó la v1.3 el 2026-10-02 (ALBA YURANY ROSAS ESACANDON)
-- La v1.3 (3456f5a8-5ad2-49e5-96bf-6af5b9aeb483) queda vigente hasta el 5-nov; la v1.4 por aviso rige desde el 6-nov.
-- ────────────────────────────────────────────────────────────────────────────
do $bloque$
declare
  -- ⚠️ true = ENSAYO: escribe, comprueba y deshace todo con RAISE EXCEPTION 'ENSAYO OK …'.
  c_ensayo constant boolean := true;
  -- El día (Bogotá) en que se publica el aviso, el que dicen los textos. Si hoy no es este día, el bloque
  -- no corre: la cláusula 11.4 y el PDF dirían una vigencia falsa (regenerar con la fecha nueva).
  c_publicacion constant date := date '2026-10-07';
  c_vigencia    constant date := date '2026-11-06';

  c_ws_metrik      constant uuid := 'a21bfc88-1a60-48c3-afcd-144226aa2392';
  c_registrado_por constant uuid := 'cc6f6100-4eb7-4eed-9a7c-096729f5cedf';  -- Mauricio (platform admin)
  c_slug_doc       constant text := 'terminos-suscripcion-valida-cda';
  c_titulo         constant text := 'Términos de Suscripción al Servicio VALIDA · Plan CDA';
  c_ws_cda         constant uuid := 'b58e4b68-8bed-48b6-85f8-01995f64ffe6';
  c_slug_ws        constant text := 'cda-caqueta';
  c_empresa        constant uuid := 'e47db571-029c-45ab-a0e0-860c9d5c62dc';
  c_negocio        constant uuid := '8db0ced7-2ef9-4b18-9e57-de8db0d3fb58';
  c_previa         constant uuid := '3456f5a8-5ad2-49e5-96bf-6af5b9aeb483';
  c_previa_version constant text := 'v1.3';
  c_previa_pdf     constant text := 'f876ed626457ac998e25c0e9e710112f9907799e746827d36dd6e990d1cfacd2';
  c_texto_sha256   constant text := '059023cdd321b9148870247eb48a9e0c2b907363b7678a1654116389b27a89b3';
  c_pdf_sha256     constant text := 'a59d45b84babebff0910394ea1d8265e2270966df24d280b17d741da885fd268';
  c_pdf_path       constant text := 'cda-caqueta/terminos-suscripcion-valida-cda-v1.4.pdf';
  c_texto constant text := $texto$# TÉRMINOS DE SUSCRIPCIÓN AL SERVICIO VALIDA · PLAN CDA v1.4

**METRIK**: METRIK IA S.A.S., NIT 902.079.601-9, domiciliada en la Calle 24A Bis 100-71, Bogotá D.C., representada legalmente por Brallan Mauricio Moreno Guzmán. Correo: mauricio.moreno@metrik.com.co.

**EL CLIENTE**: CENTRO DE DIAGNOSTICO AUTOMOTOR DEL CAQUETA LIMITADA, NIT 900.156.521-0, domiciliada en CR 17 14 63 67 71 75 BRR LA VEGA, Florencia (Caquetá), representada legalmente por Alba Yurany Rosas Escandón.

Estos Términos rigen desde su aceptación en la forma prevista en la cláusula 16 y constituyen el acuerdo completo entre las Partes sobre el Servicio.

## 0. Antecedente y continuidad

0.1. El Cliente venía accediendo a VALIDA en virtud del Contrato de Prestación de Servicios Tecnológicos de Validación en Listas Vinculantes y Restrictivas suscrito el 16 de julio de 2026 con AFI INTERNATIONAL GROUP S.A.S., terminado de mutuo acuerdo con efectos al 15 de septiembre de 2026.

0.2. VALIDA es de propiedad de METRIK. Estos Términos sustituyen ese contrato **sin interrumpir el servicio** y **respetando el plazo pactado en él**, en los términos de la cláusula 12.1.

## 1. Objeto y alcance

1.1. METRIK concede al Cliente acceso a **VALIDA**, servicio de computación en la nube para la consulta automatizada de personas naturales y jurídicas contra listas restrictivas y vinculantes utilizadas en la gestión del riesgo de LA/FT/FP (el "Servicio"), a través de su espacio de trabajo en cda-caqueta.metrikone.co.

1.2. El Servicio comprende: acceso a la plataforma, **un (1) usuario administrador y dos (2) usuarios operativos habilitados**, **consultas individuales ilimitadas**, **consultas masivas ilimitadas**, generación de reportes de validación, consulta de listas nacionales e internacionales aplicables al marco normativo colombiano, actualización permanente de las fuentes disponibles y soporte funcional básico.

1.3. El alcance es la consulta de listas del marco SARLAFT según el catálogo vigente publicado en la plataforma. No incluye asesoría jurídica, normativa ni tributaria, ni el diseño u operación del sistema SARLAFT/SAGRILAFT/SIPLAFT del Cliente.

1.4. El Cliente declara que contrata como empresa, para su actividad económica, y no como consumidor final (Ley 1480 de 2011).

## 2. Condiciones comerciales

2.1. **Precio.** La suscripción tiene un valor de **CIENTO CINCUENTA MIL PESOS ($150.000) mensuales**.

2.2. **Tributos.** El Servicio se factura como servicio de computación en la nube (cloud computing) **excluido del impuesto sobre las ventas**, conforme al **numeral 21 del artículo 476 del Estatuto Tributario**. El precio señalado en la cláusula 2.1 es el valor total a cargo del Cliente y no lleva IVA que sumar ni que discriminar. El soporte funcional previsto en la cláusula 1.2 es inherente al acceso al Servicio y no constituye un servicio facturado por separado. Si la autoridad tributaria determina que el Servicio se encuentra gravado, METRIK no trasladará al Cliente el impuesto correspondiente a los períodos ya facturados; para los períodos siguientes, las Partes ajustarán el precio para incorporar el tributo.

2.3. **Usuarios adicionales.** La suscripción incluye un (1) usuario administrador sin costo, que es la persona designada por el Cliente para aceptar estos Términos y gestionar la suscripción, y dos (2) usuarios operativos. Cada usuario operativo adicional tiene un valor de **CINCUENTA MIL PESOS ($50.000) mensuales**, bajo el mismo tratamiento tributario de la cláusula 2.2, y requiere solicitud expresa del Cliente.

2.4. **Forma de pago.** El pago es **mensual y anticipado, dentro de los primeros cinco (5) días calendario** de cada período de servicio. METRIK remitirá al Cliente, antes del inicio de cada período, un **enlace de pago** con la referencia del período correspondiente. METRIK expedirá factura electrónica de venta por cada período. **El primer período de servicio bajo estos Términos no inicia antes de que METRIK cuente con habilitación vigente para facturar electrónicamente; hasta entonces no se causa ni se cobra suma alguna, y el acceso del Cliente continúa sin interrupción.**

2.5. **Mora.** El incumplimiento del pago faculta a METRIK para restringir o suspender el Servicio en los términos de la cláusula 11.

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

9.3. METRIK conserva los registros de consulta necesarios para la trazabilidad del Servicio y para acreditar la debida diligencia del Cliente. A la terminación, y durante los treinta (30) días siguientes, el Cliente podrá **exportar la bitácora de sus consultas** en formato legible por máquina.

9.4. **Transmisión internacional.** El Cliente autoriza a METRIK a transmitir los datos personales necesarios para prestar el Servicio a los proveedores de infraestructura en la nube y de fuentes de información que METRIK utilice, incluidos los ubicados fuera de Colombia, conforme al **artículo 26 de la Ley 1581 de 2012** y al **artículo 25 del Decreto 1377 de 2013**. METRIK mantiene publicada en la plataforma la relación de dichos proveedores y exige de ellos garantías de seguridad no inferiores a las propias.

9.5. **Incidentes de seguridad.** METRIK notificará al Cliente cualquier incidente de seguridad que afecte sus datos **dentro de las setenta y dos (72) horas** siguientes a su conocimiento, con la información disponible sobre naturaleza, alcance y medidas adoptadas.

## 10. Responsabilidad

10.1. Las decisiones adoptadas por el Cliente con base en los resultados son de su exclusiva responsabilidad.

10.2. La responsabilidad total de METRIK por cualquier concepto se limita al valor pagado por el Cliente en los tres (3) meses anteriores al hecho que la origine.

## 11. Restricción y suspensión

11.1. **Restricción por mora.** Si una cuota no se paga dentro de los cinco (5) días calendario siguientes a su fecha de vencimiento, desde el día siguiente METRIK restringirá la realización de consultas nuevas, individuales y masivas. Durante la restricción el Cliente conserva el acceso a la plataforma, sus usuarios siguen habilitados y puede consultar y descargar los reportes ya generados. La restricción se levanta en cuanto el pago queda registrado: el que se hace por el enlace de pago enviado por METRIK se registra automáticamente al ser aprobado; el que se hace por otro medio, a más tardar el día hábil siguiente a su acreditación en la cuenta de METRIK.

11.2. **Aviso en la plataforma.** Desde el día siguiente al vencimiento de una cuota impaga, la plataforma muestra a los usuarios del Cliente la fecha a partir de la cual se aplicará la restricción.

11.3. **Suspensión.** METRIK podrá suspender el Servicio cuando existan obligaciones económicas vencidas superiores a treinta (30) días calendario, se detecte uso indebido de credenciales, se evidencie cesión de accesos a terceros o se identifiquen actividades que comprometan la seguridad de la plataforma o de la información.

11.4. **Transición.** Esta cláusula rige desde el 6 de noviembre de 2026 y se aplica también a las cuotas que en esa fecha estén vencidas e impagas.

## 12. Vigencia y terminación

12.1. **Plazo.** Estos Términos rigen desde su aceptación hasta el **15 de enero de 2027**, fecha en que vencía el contrato terminado con AFI, de modo que el Cliente conserva íntegro el plazo que había contratado.

12.2. **Renovación.** Vencido ese plazo, la suscripción se **renueva automáticamente por períodos mensuales**, salvo que cualquiera de las Partes avise lo contrario por escrito con **quince (15) días** de anticipación.

12.3. **Durante el plazo de la cláusula 12.1 METRIK no podrá terminar estos Términos sin causa imputable al Cliente.** Vencido ese plazo, y durante las renovaciones de la cláusula 12.2, cualquiera de las Partes podrá terminarlos con aviso escrito de treinta (30) días. El Cliente podrá terminarlos en cualquier momento con el mismo aviso. METRIK podrá terminarlos de inmediato, en cualquier tiempo, por incumplimiento de las cláusulas 3, 4 o 9.

12.4. **Saldo.** Si termina el Cliente, o METRIK por incumplimiento del Cliente, no hay reembolso del período ya pagado. Si METRIK termina sin causa imputable al Cliente, reembolsa a prorrata los días no prestados.

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

16.3. El acceso al Servicio queda habilitado una vez registrada la aceptación.$texto$;

  v_hoy date := (now() at time zone 'America/Bogota')::date;
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
    raise exception 'la vigencia (%) no es la publicación (%) + 30 días calendario (cláusula 13.1)', c_vigencia, c_publicacion;
  end if;
  if v_hoy <> c_publicacion then
    raise exception '%: hoy es % en Bogotá y el texto dice que el aviso se publica el % (rige el %). Publicar otro día cambia la vigencia: regenerar el texto, el PDF y este archivo con la fecha nueva.',
      c_slug_ws, v_hoy, c_publicacion, c_vigencia;
  end if;

  -- Idempotencia: con la v1.4 ya registrada, nada que hacer.
  if exists (
    select 1 from public.documentos_contractuales_versiones d
     where d.empresa_id = c_empresa and d.slug = c_slug_doc and d.version = 'v1.4'
  ) then
    raise exception '%: la v1.4 de esta empresa ya está registrada. Nada que hacer.', c_slug_ws;
  end if;

  -- La versión que se modifica: la esperada, de esta empresa, vigente y sin fecha de retiro.
  select d.id, d.workspace_id, d.linea_id, d.titulo, d.alcance, d.vigente_desde, d.vigente_hasta
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
  -- Ninguna OTRA versión de estos términos vigente para la empresa.
  select count(*) into v_vigentes
    from public.documentos_contractuales_versiones d
   where d.empresa_id = c_empresa and d.slug = c_slug_doc and d.id <> c_previa
     and (d.vigente_hasta is null or d.vigente_hasta >= v_hoy);
  if v_vigentes > 0 then
    raise exception '%: hay otra versión vigente de los términos de esta empresa además de la %', c_slug_ws, c_previa_version;
  end if;

  -- Un contrato vivo de esta empresa que paga este espacio, con la versión previa ACEPTADA: la v1.4 por
  -- aviso modifica lo aceptado. Sin aceptación, no hay qué modificar (sería la entrada de siempre).
  if not exists (
    select 1 from public.servicios_contratados sc
     where sc.negocio_id = c_negocio and sc.empresa_id = c_empresa and sc.workspace_pagador_id = c_ws_cda
       and sc.estado not in ('cancelado', 'terminado')
  ) then
    raise exception '%: no hay contrato vivo de esta empresa pagado por el espacio', c_slug_ws;
  end if;
  if not exists (
    select 1 from public.aceptaciones_terminos a
     where a.estado = 'aceptado' and a.documento_sha256 = c_previa_pdf and a.negocio_id = c_negocio
  ) then
    raise exception '%: la % no tiene aceptación registrada en el contrato: la v1.4 no se publica por aviso', c_slug_ws, c_previa_version;
  end if;

  -- El PDF del aviso tiene que estar subido: el aviso enlaza a él.
  if not exists (select 1 from storage.objects o where o.bucket_id = 'aceptaciones-documentos' and o.name = c_pdf_path) then
    raise exception '%: falta subir el PDF a aceptaciones-documentos/% (paso 2 de la cabecera)', c_slug_ws, c_pdf_path;
  end if;

  -- El texto que se publica es exactamente el generado, con la vigencia del 6-nov.
  if encode(sha256(convert_to(c_texto, 'UTF8')), 'hex') is distinct from c_texto_sha256 then
    raise exception '%: el texto no es el generado (huella distinta). No se edita a mano: se regenera.', c_slug_ws;
  end if;
  if position('rige desde el 6 de noviembre de 2026' in c_texto) = 0 then
    raise exception '%: el texto no dice la vigencia del 6 de noviembre de 2026', c_slug_ws;
  end if;

  -- ── 1. La versión previa rige hasta el día anterior a la vigencia ──────────
  update public.documentos_contractuales_versiones
     set vigente_hasta = c_vigencia - 1
   where id = c_previa and vigente_hasta is null;

  -- ── 2. La v1.4 por aviso: publicarla ES insertarla (el aviso aparece en /valida) ──
  insert into public.documentos_contractuales_versiones
    (workspace_id, linea_id, slug, alcance, empresa_id, titulo, version, texto_md, texto_sha256,
     pdf_bucket, pdf_path, pdf_sha256, vigente_desde, rige_por_aviso, reemplaza_version_id, publicada_at,
     registrado_por)
  values
    (v_previa.workspace_id, v_previa.linea_id, c_slug_doc, 'cliente', c_empresa, c_titulo, 'v1.4', c_texto,
     c_texto_sha256, 'aceptaciones-documentos', c_pdf_path, c_pdf_sha256, c_vigencia, true, c_previa, now(),
     c_registrado_por)
  returning id into v_id;

  -- ── Comprobación ──────────────────────────────────────────────────────────
  if not exists (
    select 1 from public.documentos_contractuales_versiones d
     where d.id = v_id and d.rige_por_aviso and d.reemplaza_version_id = c_previa
       and d.vigente_desde = c_vigencia and (d.publicada_at at time zone 'America/Bogota')::date = c_publicacion
  ) or not exists (
    select 1 from public.documentos_contractuales_versiones d where d.id = c_previa and d.vigente_hasta = c_vigencia - 1
  ) then
    raise exception '%: la publicación no quedó como se esperaba', c_slug_ws;
  end if;

  if c_ensayo then
    raise exception 'ENSAYO OK %: v1.4 % por aviso, publicada el %, rige el %; % vigente hasta el %. Nada quedó escrito.',
      c_slug_ws, v_id, c_publicacion, c_vigencia, c_previa_version, c_vigencia - 1;
  end if;
  raise notice 'PUBLICADO %: v1.4 % por aviso, rige el %', c_slug_ws, v_id, c_vigencia;
end;
$bloque$;

-- ────────────────────────────────────────────────────────────────────────────
-- C2 26 1 · espacio `cda-elcarmen` · aceptó la v1.3 el 2026-09-28 (CARLOS ARNULFO CASTRO QUINTERO)
-- La v1.3 (c0e9786a-fbb6-4844-9c72-2c95d242963c) queda vigente hasta el 5-nov; la v1.4 por aviso rige desde el 6-nov.
-- ────────────────────────────────────────────────────────────────────────────
do $bloque$
declare
  -- ⚠️ true = ENSAYO: escribe, comprueba y deshace todo con RAISE EXCEPTION 'ENSAYO OK …'.
  c_ensayo constant boolean := true;
  -- El día (Bogotá) en que se publica el aviso, el que dicen los textos. Si hoy no es este día, el bloque
  -- no corre: la cláusula 11.4 y el PDF dirían una vigencia falsa (regenerar con la fecha nueva).
  c_publicacion constant date := date '2026-10-07';
  c_vigencia    constant date := date '2026-11-06';

  c_ws_metrik      constant uuid := 'a21bfc88-1a60-48c3-afcd-144226aa2392';
  c_registrado_por constant uuid := 'cc6f6100-4eb7-4eed-9a7c-096729f5cedf';  -- Mauricio (platform admin)
  c_slug_doc       constant text := 'terminos-suscripcion-valida-cda';
  c_titulo         constant text := 'Términos de Suscripción al Servicio VALIDA · Plan CDA';
  c_ws_cda         constant uuid := 'e86ab950-961c-481b-9498-79c7d8b18e5e';
  c_slug_ws        constant text := 'cda-elcarmen';
  c_empresa        constant uuid := '382818cb-831b-40f2-8a8d-e54aa7e9e526';
  c_negocio        constant uuid := '72e182e9-4864-41ff-b77b-2b79edbfd81d';
  c_previa         constant uuid := 'c0e9786a-fbb6-4844-9c72-2c95d242963c';
  c_previa_version constant text := 'v1.3';
  c_previa_pdf     constant text := 'bb03d0c2c37903e0168d045d9d6055f8e8bb8007b758a39e15d25ba7b1c6ad44';
  c_texto_sha256   constant text := '453d674f54299db3fbc29291aaf9e72e56a66df313d09b607b8f4b0c8380d601';
  c_pdf_sha256     constant text := '36c794148b3912db0ddec7bd3f089c9a5e185e5e5e2f330d5c06f63b5aafa88f';
  c_pdf_path       constant text := 'cda-elcarmen/terminos-suscripcion-valida-cda-v1.4.pdf';
  c_texto constant text := $texto$# TÉRMINOS DE SUSCRIPCIÓN AL SERVICIO VALIDA · PLAN CDA v1.4

**METRIK**: METRIK IA S.A.S., NIT 902.079.601-9, domiciliada en la Calle 24A Bis 100-71, Bogotá D.C., representada legalmente por Brallan Mauricio Moreno Guzmán. Correo: mauricio.moreno@metrik.com.co.

**EL CLIENTE**: CENTRO DE DIAGNOSTICO AUTOMOTOR EL CARMEN SAS, NIT 901.079.937-4, domiciliada en CR 11 11 161 BRR VTE, El Cerrito (Valle del Cauca), representada legalmente por Carlos Arnulfo Castro Quintero.

Estos Términos rigen desde su aceptación en la forma prevista en la cláusula 16 y constituyen el acuerdo completo entre las Partes sobre el Servicio.

## 0. Antecedente y continuidad

0.1. El Cliente venía accediendo a VALIDA en virtud del Contrato de Prestación de Servicios Tecnológicos de Validación en Listas Vinculantes y Restrictivas suscrito el 16 de julio de 2026 con AFI INTERNATIONAL GROUP S.A.S., terminado de mutuo acuerdo con efectos al 15 de septiembre de 2026.

0.2. VALIDA es de propiedad de METRIK. Estos Términos sustituyen ese contrato **sin interrumpir el servicio** y **respetando el plazo pactado en él**, en los términos de la cláusula 12.1.

## 1. Objeto y alcance

1.1. METRIK concede al Cliente acceso a **VALIDA**, servicio de computación en la nube para la consulta automatizada de personas naturales y jurídicas contra listas restrictivas y vinculantes utilizadas en la gestión del riesgo de LA/FT/FP (el "Servicio"), a través de su espacio de trabajo en cda-elcarmen.metrikone.co.

1.2. El Servicio comprende: acceso a la plataforma, **un (1) usuario administrador y dos (2) usuarios operativos habilitados**, **consultas individuales ilimitadas**, **consultas masivas ilimitadas**, generación de reportes de validación, consulta de listas nacionales e internacionales aplicables al marco normativo colombiano, actualización permanente de las fuentes disponibles y soporte funcional básico.

1.3. El alcance es la consulta de listas del marco SARLAFT según el catálogo vigente publicado en la plataforma. No incluye asesoría jurídica, normativa ni tributaria, ni el diseño u operación del sistema SARLAFT/SAGRILAFT/SIPLAFT del Cliente.

1.4. El Cliente declara que contrata como empresa, para su actividad económica, y no como consumidor final (Ley 1480 de 2011).

## 2. Condiciones comerciales

2.1. **Precio.** La suscripción tiene un valor de **CIENTO CINCUENTA MIL PESOS ($150.000) mensuales**.

2.2. **Tributos.** El Servicio se factura como servicio de computación en la nube (cloud computing) **excluido del impuesto sobre las ventas**, conforme al **numeral 21 del artículo 476 del Estatuto Tributario**. El precio señalado en la cláusula 2.1 es el valor total a cargo del Cliente y no lleva IVA que sumar ni que discriminar. El soporte funcional previsto en la cláusula 1.2 es inherente al acceso al Servicio y no constituye un servicio facturado por separado. Si la autoridad tributaria determina que el Servicio se encuentra gravado, METRIK no trasladará al Cliente el impuesto correspondiente a los períodos ya facturados; para los períodos siguientes, las Partes ajustarán el precio para incorporar el tributo.

2.3. **Usuarios adicionales.** La suscripción incluye un (1) usuario administrador sin costo, que es la persona designada por el Cliente para aceptar estos Términos y gestionar la suscripción, y dos (2) usuarios operativos. Cada usuario operativo adicional tiene un valor de **CINCUENTA MIL PESOS ($50.000) mensuales**, bajo el mismo tratamiento tributario de la cláusula 2.2, y requiere solicitud expresa del Cliente.

2.4. **Forma de pago.** El pago es **mensual y anticipado, dentro de los primeros cinco (5) días calendario** de cada período de servicio. METRIK remitirá al Cliente, antes del inicio de cada período, un **enlace de pago** con la referencia del período correspondiente. METRIK expedirá factura electrónica de venta por cada período. **El primer período de servicio bajo estos Términos no inicia antes de que METRIK cuente con habilitación vigente para facturar electrónicamente; hasta entonces no se causa ni se cobra suma alguna, y el acceso del Cliente continúa sin interrupción.**

2.5. **Mora.** El incumplimiento del pago faculta a METRIK para restringir o suspender el Servicio en los términos de la cláusula 11.

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

9.3. METRIK conserva los registros de consulta necesarios para la trazabilidad del Servicio y para acreditar la debida diligencia del Cliente. A la terminación, y durante los treinta (30) días siguientes, el Cliente podrá **exportar la bitácora de sus consultas** en formato legible por máquina.

9.4. **Transmisión internacional.** El Cliente autoriza a METRIK a transmitir los datos personales necesarios para prestar el Servicio a los proveedores de infraestructura en la nube y de fuentes de información que METRIK utilice, incluidos los ubicados fuera de Colombia, conforme al **artículo 26 de la Ley 1581 de 2012** y al **artículo 25 del Decreto 1377 de 2013**. METRIK mantiene publicada en la plataforma la relación de dichos proveedores y exige de ellos garantías de seguridad no inferiores a las propias.

9.5. **Incidentes de seguridad.** METRIK notificará al Cliente cualquier incidente de seguridad que afecte sus datos **dentro de las setenta y dos (72) horas** siguientes a su conocimiento, con la información disponible sobre naturaleza, alcance y medidas adoptadas.

## 10. Responsabilidad

10.1. Las decisiones adoptadas por el Cliente con base en los resultados son de su exclusiva responsabilidad.

10.2. La responsabilidad total de METRIK por cualquier concepto se limita al valor pagado por el Cliente en los tres (3) meses anteriores al hecho que la origine.

## 11. Restricción y suspensión

11.1. **Restricción por mora.** Si una cuota no se paga dentro de los cinco (5) días calendario siguientes a su fecha de vencimiento, desde el día siguiente METRIK restringirá la realización de consultas nuevas, individuales y masivas. Durante la restricción el Cliente conserva el acceso a la plataforma, sus usuarios siguen habilitados y puede consultar y descargar los reportes ya generados. La restricción se levanta en cuanto el pago queda registrado: el que se hace por el enlace de pago enviado por METRIK se registra automáticamente al ser aprobado; el que se hace por otro medio, a más tardar el día hábil siguiente a su acreditación en la cuenta de METRIK.

11.2. **Aviso en la plataforma.** Desde el día siguiente al vencimiento de una cuota impaga, la plataforma muestra a los usuarios del Cliente la fecha a partir de la cual se aplicará la restricción.

11.3. **Suspensión.** METRIK podrá suspender el Servicio cuando existan obligaciones económicas vencidas superiores a treinta (30) días calendario, se detecte uso indebido de credenciales, se evidencie cesión de accesos a terceros o se identifiquen actividades que comprometan la seguridad de la plataforma o de la información.

11.4. **Transición.** Esta cláusula rige desde el 6 de noviembre de 2026 y se aplica también a las cuotas que en esa fecha estén vencidas e impagas.

## 12. Vigencia y terminación

12.1. **Plazo.** Estos Términos rigen desde su aceptación hasta el **15 de enero de 2027**, fecha en que vencía el contrato terminado con AFI, de modo que el Cliente conserva íntegro el plazo que había contratado.

12.2. **Renovación.** Vencido ese plazo, la suscripción se **renueva automáticamente por períodos mensuales**, salvo que cualquiera de las Partes avise lo contrario por escrito con **quince (15) días** de anticipación.

12.3. **Durante el plazo de la cláusula 12.1 METRIK no podrá terminar estos Términos sin causa imputable al Cliente.** Vencido ese plazo, y durante las renovaciones de la cláusula 12.2, cualquiera de las Partes podrá terminarlos con aviso escrito de treinta (30) días. El Cliente podrá terminarlos en cualquier momento con el mismo aviso. METRIK podrá terminarlos de inmediato, en cualquier tiempo, por incumplimiento de las cláusulas 3, 4 o 9.

12.4. **Saldo.** Si termina el Cliente, o METRIK por incumplimiento del Cliente, no hay reembolso del período ya pagado. Si METRIK termina sin causa imputable al Cliente, reembolsa a prorrata los días no prestados.

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

16.3. El acceso al Servicio queda habilitado una vez registrada la aceptación.$texto$;

  v_hoy date := (now() at time zone 'America/Bogota')::date;
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
    raise exception 'la vigencia (%) no es la publicación (%) + 30 días calendario (cláusula 13.1)', c_vigencia, c_publicacion;
  end if;
  if v_hoy <> c_publicacion then
    raise exception '%: hoy es % en Bogotá y el texto dice que el aviso se publica el % (rige el %). Publicar otro día cambia la vigencia: regenerar el texto, el PDF y este archivo con la fecha nueva.',
      c_slug_ws, v_hoy, c_publicacion, c_vigencia;
  end if;

  -- Idempotencia: con la v1.4 ya registrada, nada que hacer.
  if exists (
    select 1 from public.documentos_contractuales_versiones d
     where d.empresa_id = c_empresa and d.slug = c_slug_doc and d.version = 'v1.4'
  ) then
    raise exception '%: la v1.4 de esta empresa ya está registrada. Nada que hacer.', c_slug_ws;
  end if;

  -- La versión que se modifica: la esperada, de esta empresa, vigente y sin fecha de retiro.
  select d.id, d.workspace_id, d.linea_id, d.titulo, d.alcance, d.vigente_desde, d.vigente_hasta
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
  -- Ninguna OTRA versión de estos términos vigente para la empresa.
  select count(*) into v_vigentes
    from public.documentos_contractuales_versiones d
   where d.empresa_id = c_empresa and d.slug = c_slug_doc and d.id <> c_previa
     and (d.vigente_hasta is null or d.vigente_hasta >= v_hoy);
  if v_vigentes > 0 then
    raise exception '%: hay otra versión vigente de los términos de esta empresa además de la %', c_slug_ws, c_previa_version;
  end if;

  -- Un contrato vivo de esta empresa que paga este espacio, con la versión previa ACEPTADA: la v1.4 por
  -- aviso modifica lo aceptado. Sin aceptación, no hay qué modificar (sería la entrada de siempre).
  if not exists (
    select 1 from public.servicios_contratados sc
     where sc.negocio_id = c_negocio and sc.empresa_id = c_empresa and sc.workspace_pagador_id = c_ws_cda
       and sc.estado not in ('cancelado', 'terminado')
  ) then
    raise exception '%: no hay contrato vivo de esta empresa pagado por el espacio', c_slug_ws;
  end if;
  if not exists (
    select 1 from public.aceptaciones_terminos a
     where a.estado = 'aceptado' and a.documento_sha256 = c_previa_pdf and a.negocio_id = c_negocio
  ) then
    raise exception '%: la % no tiene aceptación registrada en el contrato: la v1.4 no se publica por aviso', c_slug_ws, c_previa_version;
  end if;

  -- El PDF del aviso tiene que estar subido: el aviso enlaza a él.
  if not exists (select 1 from storage.objects o where o.bucket_id = 'aceptaciones-documentos' and o.name = c_pdf_path) then
    raise exception '%: falta subir el PDF a aceptaciones-documentos/% (paso 2 de la cabecera)', c_slug_ws, c_pdf_path;
  end if;

  -- El texto que se publica es exactamente el generado, con la vigencia del 6-nov.
  if encode(sha256(convert_to(c_texto, 'UTF8')), 'hex') is distinct from c_texto_sha256 then
    raise exception '%: el texto no es el generado (huella distinta). No se edita a mano: se regenera.', c_slug_ws;
  end if;
  if position('rige desde el 6 de noviembre de 2026' in c_texto) = 0 then
    raise exception '%: el texto no dice la vigencia del 6 de noviembre de 2026', c_slug_ws;
  end if;

  -- ── 1. La versión previa rige hasta el día anterior a la vigencia ──────────
  update public.documentos_contractuales_versiones
     set vigente_hasta = c_vigencia - 1
   where id = c_previa and vigente_hasta is null;

  -- ── 2. La v1.4 por aviso: publicarla ES insertarla (el aviso aparece en /valida) ──
  insert into public.documentos_contractuales_versiones
    (workspace_id, linea_id, slug, alcance, empresa_id, titulo, version, texto_md, texto_sha256,
     pdf_bucket, pdf_path, pdf_sha256, vigente_desde, rige_por_aviso, reemplaza_version_id, publicada_at,
     registrado_por)
  values
    (v_previa.workspace_id, v_previa.linea_id, c_slug_doc, 'cliente', c_empresa, c_titulo, 'v1.4', c_texto,
     c_texto_sha256, 'aceptaciones-documentos', c_pdf_path, c_pdf_sha256, c_vigencia, true, c_previa, now(),
     c_registrado_por)
  returning id into v_id;

  -- ── Comprobación ──────────────────────────────────────────────────────────
  if not exists (
    select 1 from public.documentos_contractuales_versiones d
     where d.id = v_id and d.rige_por_aviso and d.reemplaza_version_id = c_previa
       and d.vigente_desde = c_vigencia and (d.publicada_at at time zone 'America/Bogota')::date = c_publicacion
  ) or not exists (
    select 1 from public.documentos_contractuales_versiones d where d.id = c_previa and d.vigente_hasta = c_vigencia - 1
  ) then
    raise exception '%: la publicación no quedó como se esperaba', c_slug_ws;
  end if;

  if c_ensayo then
    raise exception 'ENSAYO OK %: v1.4 % por aviso, publicada el %, rige el %; % vigente hasta el %. Nada quedó escrito.',
      c_slug_ws, v_id, c_publicacion, c_vigencia, c_previa_version, c_vigencia - 1;
  end if;
  raise notice 'PUBLICADO %: v1.4 % por aviso, rige el %', c_slug_ws, v_id, c_vigencia;
end;
$bloque$;

-- ────────────────────────────────────────────────────────────────────────────
-- C3 26 1 · espacio `cda-puertotest` · aceptó la v1.3 el 2026-09-25 (CARLOS ARNULFO CASTRO QUINTERO)
-- La v1.3 (048d8943-308f-4fc4-837e-41052dc667c4) queda vigente hasta el 5-nov; la v1.4 por aviso rige desde el 6-nov.
-- ────────────────────────────────────────────────────────────────────────────
do $bloque$
declare
  -- ⚠️ true = ENSAYO: escribe, comprueba y deshace todo con RAISE EXCEPTION 'ENSAYO OK …'.
  c_ensayo constant boolean := true;
  -- El día (Bogotá) en que se publica el aviso, el que dicen los textos. Si hoy no es este día, el bloque
  -- no corre: la cláusula 11.4 y el PDF dirían una vigencia falsa (regenerar con la fecha nueva).
  c_publicacion constant date := date '2026-10-07';
  c_vigencia    constant date := date '2026-11-06';

  c_ws_metrik      constant uuid := 'a21bfc88-1a60-48c3-afcd-144226aa2392';
  c_registrado_por constant uuid := 'cc6f6100-4eb7-4eed-9a7c-096729f5cedf';  -- Mauricio (platform admin)
  c_slug_doc       constant text := 'terminos-suscripcion-valida-cda';
  c_titulo         constant text := 'Términos de Suscripción al Servicio VALIDA · Plan CDA';
  c_ws_cda         constant uuid := '3f180b67-0f6b-442d-99f9-4ee1efe2410e';
  c_slug_ws        constant text := 'cda-puertotest';
  c_empresa        constant uuid := '2bc36ea7-8740-41e5-8b03-d6c644e14d32';
  c_negocio        constant uuid := '72d35ffc-cd38-47f1-8a8d-f23488052d39';
  c_previa         constant uuid := '048d8943-308f-4fc4-837e-41052dc667c4';
  c_previa_version constant text := 'v1.3';
  c_previa_pdf     constant text := 'd43e1162b304adc3ea955b97bf55ed9b1e49636344ba9468b0ab479f1a5c50be';
  c_texto_sha256   constant text := 'c594912c7465fee63581b472316b434404313b0ca20c304545257de7739b9156';
  c_pdf_sha256     constant text := '491efebd0075db2d7a78a8aa470f07611c25da0cf976bb1adc77dc9b6b0afc0d';
  c_pdf_path       constant text := 'cda-puertotest/terminos-suscripcion-valida-cda-v1.4.pdf';
  c_texto constant text := $texto$# TÉRMINOS DE SUSCRIPCIÓN AL SERVICIO VALIDA · PLAN CDA v1.4

**METRIK**: METRIK IA S.A.S., NIT 902.079.601-9, domiciliada en la Calle 24A Bis 100-71, Bogotá D.C., representada legalmente por Brallan Mauricio Moreno Guzmán. Correo: mauricio.moreno@metrik.com.co.

**EL CLIENTE**: CENTRO DE DIAGNOSTICO AUTOMOTOR PUERTOTEST S.A.S ZOMAC, NIT 901.149.905-1, domiciliada en VDA LA DANTA CARR CENTRAL PTO ASIS PASTO, Puerto Asís (Putumayo), representada legalmente por Carlos Arnulfo Castro Quintero.

Estos Términos rigen desde su aceptación en la forma prevista en la cláusula 16 y constituyen el acuerdo completo entre las Partes sobre el Servicio.

## 0. Antecedente y continuidad

0.1. El Cliente venía accediendo a VALIDA en virtud del Contrato de Prestación de Servicios Tecnológicos de Validación en Listas Vinculantes y Restrictivas suscrito el 16 de julio de 2026 con AFI INTERNATIONAL GROUP S.A.S., terminado de mutuo acuerdo con efectos al 15 de septiembre de 2026.

0.2. VALIDA es de propiedad de METRIK. Estos Términos sustituyen ese contrato **sin interrumpir el servicio** y **respetando el plazo pactado en él**, en los términos de la cláusula 12.1.

## 1. Objeto y alcance

1.1. METRIK concede al Cliente acceso a **VALIDA**, servicio de computación en la nube para la consulta automatizada de personas naturales y jurídicas contra listas restrictivas y vinculantes utilizadas en la gestión del riesgo de LA/FT/FP (el "Servicio"), a través de su espacio de trabajo en cda-puertotest.metrikone.co.

1.2. El Servicio comprende: acceso a la plataforma, **un (1) usuario administrador y dos (2) usuarios operativos habilitados**, **consultas individuales ilimitadas**, **consultas masivas ilimitadas**, generación de reportes de validación, consulta de listas nacionales e internacionales aplicables al marco normativo colombiano, actualización permanente de las fuentes disponibles y soporte funcional básico.

1.3. El alcance es la consulta de listas del marco SARLAFT según el catálogo vigente publicado en la plataforma. No incluye asesoría jurídica, normativa ni tributaria, ni el diseño u operación del sistema SARLAFT/SAGRILAFT/SIPLAFT del Cliente.

1.4. El Cliente declara que contrata como empresa, para su actividad económica, y no como consumidor final (Ley 1480 de 2011).

## 2. Condiciones comerciales

2.1. **Precio.** La suscripción tiene un valor de **CIENTO CINCUENTA MIL PESOS ($150.000) mensuales**.

2.2. **Tributos.** El Servicio se factura como servicio de computación en la nube (cloud computing) **excluido del impuesto sobre las ventas**, conforme al **numeral 21 del artículo 476 del Estatuto Tributario**. El precio señalado en la cláusula 2.1 es el valor total a cargo del Cliente y no lleva IVA que sumar ni que discriminar. El soporte funcional previsto en la cláusula 1.2 es inherente al acceso al Servicio y no constituye un servicio facturado por separado. Si la autoridad tributaria determina que el Servicio se encuentra gravado, METRIK no trasladará al Cliente el impuesto correspondiente a los períodos ya facturados; para los períodos siguientes, las Partes ajustarán el precio para incorporar el tributo.

2.3. **Usuarios adicionales.** La suscripción incluye un (1) usuario administrador sin costo, que es la persona designada por el Cliente para aceptar estos Términos y gestionar la suscripción, y dos (2) usuarios operativos. Cada usuario operativo adicional tiene un valor de **CINCUENTA MIL PESOS ($50.000) mensuales**, bajo el mismo tratamiento tributario de la cláusula 2.2, y requiere solicitud expresa del Cliente.

2.4. **Forma de pago.** El pago es **mensual y anticipado, dentro de los primeros cinco (5) días calendario** de cada período de servicio. METRIK remitirá al Cliente, antes del inicio de cada período, un **enlace de pago** con la referencia del período correspondiente. METRIK expedirá factura electrónica de venta por cada período. **El primer período de servicio bajo estos Términos no inicia antes de que METRIK cuente con habilitación vigente para facturar electrónicamente; hasta entonces no se causa ni se cobra suma alguna, y el acceso del Cliente continúa sin interrupción.**

2.5. **Mora.** El incumplimiento del pago faculta a METRIK para restringir o suspender el Servicio en los términos de la cláusula 11.

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

9.3. METRIK conserva los registros de consulta necesarios para la trazabilidad del Servicio y para acreditar la debida diligencia del Cliente. A la terminación, y durante los treinta (30) días siguientes, el Cliente podrá **exportar la bitácora de sus consultas** en formato legible por máquina.

9.4. **Transmisión internacional.** El Cliente autoriza a METRIK a transmitir los datos personales necesarios para prestar el Servicio a los proveedores de infraestructura en la nube y de fuentes de información que METRIK utilice, incluidos los ubicados fuera de Colombia, conforme al **artículo 26 de la Ley 1581 de 2012** y al **artículo 25 del Decreto 1377 de 2013**. METRIK mantiene publicada en la plataforma la relación de dichos proveedores y exige de ellos garantías de seguridad no inferiores a las propias.

9.5. **Incidentes de seguridad.** METRIK notificará al Cliente cualquier incidente de seguridad que afecte sus datos **dentro de las setenta y dos (72) horas** siguientes a su conocimiento, con la información disponible sobre naturaleza, alcance y medidas adoptadas.

## 10. Responsabilidad

10.1. Las decisiones adoptadas por el Cliente con base en los resultados son de su exclusiva responsabilidad.

10.2. La responsabilidad total de METRIK por cualquier concepto se limita al valor pagado por el Cliente en los tres (3) meses anteriores al hecho que la origine.

## 11. Restricción y suspensión

11.1. **Restricción por mora.** Si una cuota no se paga dentro de los cinco (5) días calendario siguientes a su fecha de vencimiento, desde el día siguiente METRIK restringirá la realización de consultas nuevas, individuales y masivas. Durante la restricción el Cliente conserva el acceso a la plataforma, sus usuarios siguen habilitados y puede consultar y descargar los reportes ya generados. La restricción se levanta en cuanto el pago queda registrado: el que se hace por el enlace de pago enviado por METRIK se registra automáticamente al ser aprobado; el que se hace por otro medio, a más tardar el día hábil siguiente a su acreditación en la cuenta de METRIK.

11.2. **Aviso en la plataforma.** Desde el día siguiente al vencimiento de una cuota impaga, la plataforma muestra a los usuarios del Cliente la fecha a partir de la cual se aplicará la restricción.

11.3. **Suspensión.** METRIK podrá suspender el Servicio cuando existan obligaciones económicas vencidas superiores a treinta (30) días calendario, se detecte uso indebido de credenciales, se evidencie cesión de accesos a terceros o se identifiquen actividades que comprometan la seguridad de la plataforma o de la información.

11.4. **Transición.** Esta cláusula rige desde el 6 de noviembre de 2026 y se aplica también a las cuotas que en esa fecha estén vencidas e impagas.

## 12. Vigencia y terminación

12.1. **Plazo.** Estos Términos rigen desde su aceptación hasta el **15 de enero de 2027**, fecha en que vencía el contrato terminado con AFI, de modo que el Cliente conserva íntegro el plazo que había contratado.

12.2. **Renovación.** Vencido ese plazo, la suscripción se **renueva automáticamente por períodos mensuales**, salvo que cualquiera de las Partes avise lo contrario por escrito con **quince (15) días** de anticipación.

12.3. **Durante el plazo de la cláusula 12.1 METRIK no podrá terminar estos Términos sin causa imputable al Cliente.** Vencido ese plazo, y durante las renovaciones de la cláusula 12.2, cualquiera de las Partes podrá terminarlos con aviso escrito de treinta (30) días. El Cliente podrá terminarlos en cualquier momento con el mismo aviso. METRIK podrá terminarlos de inmediato, en cualquier tiempo, por incumplimiento de las cláusulas 3, 4 o 9.

12.4. **Saldo.** Si termina el Cliente, o METRIK por incumplimiento del Cliente, no hay reembolso del período ya pagado. Si METRIK termina sin causa imputable al Cliente, reembolsa a prorrata los días no prestados.

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

16.3. El acceso al Servicio queda habilitado una vez registrada la aceptación.$texto$;

  v_hoy date := (now() at time zone 'America/Bogota')::date;
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
    raise exception 'la vigencia (%) no es la publicación (%) + 30 días calendario (cláusula 13.1)', c_vigencia, c_publicacion;
  end if;
  if v_hoy <> c_publicacion then
    raise exception '%: hoy es % en Bogotá y el texto dice que el aviso se publica el % (rige el %). Publicar otro día cambia la vigencia: regenerar el texto, el PDF y este archivo con la fecha nueva.',
      c_slug_ws, v_hoy, c_publicacion, c_vigencia;
  end if;

  -- Idempotencia: con la v1.4 ya registrada, nada que hacer.
  if exists (
    select 1 from public.documentos_contractuales_versiones d
     where d.empresa_id = c_empresa and d.slug = c_slug_doc and d.version = 'v1.4'
  ) then
    raise exception '%: la v1.4 de esta empresa ya está registrada. Nada que hacer.', c_slug_ws;
  end if;

  -- La versión que se modifica: la esperada, de esta empresa, vigente y sin fecha de retiro.
  select d.id, d.workspace_id, d.linea_id, d.titulo, d.alcance, d.vigente_desde, d.vigente_hasta
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
  -- Ninguna OTRA versión de estos términos vigente para la empresa.
  select count(*) into v_vigentes
    from public.documentos_contractuales_versiones d
   where d.empresa_id = c_empresa and d.slug = c_slug_doc and d.id <> c_previa
     and (d.vigente_hasta is null or d.vigente_hasta >= v_hoy);
  if v_vigentes > 0 then
    raise exception '%: hay otra versión vigente de los términos de esta empresa además de la %', c_slug_ws, c_previa_version;
  end if;

  -- Un contrato vivo de esta empresa que paga este espacio, con la versión previa ACEPTADA: la v1.4 por
  -- aviso modifica lo aceptado. Sin aceptación, no hay qué modificar (sería la entrada de siempre).
  if not exists (
    select 1 from public.servicios_contratados sc
     where sc.negocio_id = c_negocio and sc.empresa_id = c_empresa and sc.workspace_pagador_id = c_ws_cda
       and sc.estado not in ('cancelado', 'terminado')
  ) then
    raise exception '%: no hay contrato vivo de esta empresa pagado por el espacio', c_slug_ws;
  end if;
  if not exists (
    select 1 from public.aceptaciones_terminos a
     where a.estado = 'aceptado' and a.documento_sha256 = c_previa_pdf and a.negocio_id = c_negocio
  ) then
    raise exception '%: la % no tiene aceptación registrada en el contrato: la v1.4 no se publica por aviso', c_slug_ws, c_previa_version;
  end if;

  -- El PDF del aviso tiene que estar subido: el aviso enlaza a él.
  if not exists (select 1 from storage.objects o where o.bucket_id = 'aceptaciones-documentos' and o.name = c_pdf_path) then
    raise exception '%: falta subir el PDF a aceptaciones-documentos/% (paso 2 de la cabecera)', c_slug_ws, c_pdf_path;
  end if;

  -- El texto que se publica es exactamente el generado, con la vigencia del 6-nov.
  if encode(sha256(convert_to(c_texto, 'UTF8')), 'hex') is distinct from c_texto_sha256 then
    raise exception '%: el texto no es el generado (huella distinta). No se edita a mano: se regenera.', c_slug_ws;
  end if;
  if position('rige desde el 6 de noviembre de 2026' in c_texto) = 0 then
    raise exception '%: el texto no dice la vigencia del 6 de noviembre de 2026', c_slug_ws;
  end if;

  -- ── 1. La versión previa rige hasta el día anterior a la vigencia ──────────
  update public.documentos_contractuales_versiones
     set vigente_hasta = c_vigencia - 1
   where id = c_previa and vigente_hasta is null;

  -- ── 2. La v1.4 por aviso: publicarla ES insertarla (el aviso aparece en /valida) ──
  insert into public.documentos_contractuales_versiones
    (workspace_id, linea_id, slug, alcance, empresa_id, titulo, version, texto_md, texto_sha256,
     pdf_bucket, pdf_path, pdf_sha256, vigente_desde, rige_por_aviso, reemplaza_version_id, publicada_at,
     registrado_por)
  values
    (v_previa.workspace_id, v_previa.linea_id, c_slug_doc, 'cliente', c_empresa, c_titulo, 'v1.4', c_texto,
     c_texto_sha256, 'aceptaciones-documentos', c_pdf_path, c_pdf_sha256, c_vigencia, true, c_previa, now(),
     c_registrado_por)
  returning id into v_id;

  -- ── Comprobación ──────────────────────────────────────────────────────────
  if not exists (
    select 1 from public.documentos_contractuales_versiones d
     where d.id = v_id and d.rige_por_aviso and d.reemplaza_version_id = c_previa
       and d.vigente_desde = c_vigencia and (d.publicada_at at time zone 'America/Bogota')::date = c_publicacion
  ) or not exists (
    select 1 from public.documentos_contractuales_versiones d where d.id = c_previa and d.vigente_hasta = c_vigencia - 1
  ) then
    raise exception '%: la publicación no quedó como se esperaba', c_slug_ws;
  end if;

  if c_ensayo then
    raise exception 'ENSAYO OK %: v1.4 % por aviso, publicada el %, rige el %; % vigente hasta el %. Nada quedó escrito.',
      c_slug_ws, v_id, c_publicacion, c_vigencia, c_previa_version, c_vigencia - 1;
  end if;
  raise notice 'PUBLICADO %: v1.4 % por aviso, rige el %', c_slug_ws, v_id, c_vigencia;
end;
$bloque$;

-- ────────────────────────────────────────────────────────────────────────────
-- M2 26 1 · espacio `maxitec` · aceptó la v1.3 el 2026-10-01 (JAIRO ENRIQUE PEÑA BERNAL)
-- La v1.3 (67f3a71c-715b-4fdb-a4bd-a3a8ceb327be) queda vigente hasta el 5-nov; la v1.4 por aviso rige desde el 6-nov.
-- ────────────────────────────────────────────────────────────────────────────
do $bloque$
declare
  -- ⚠️ true = ENSAYO: escribe, comprueba y deshace todo con RAISE EXCEPTION 'ENSAYO OK …'.
  c_ensayo constant boolean := true;
  -- El día (Bogotá) en que se publica el aviso, el que dicen los textos. Si hoy no es este día, el bloque
  -- no corre: la cláusula 11.4 y el PDF dirían una vigencia falsa (regenerar con la fecha nueva).
  c_publicacion constant date := date '2026-10-07';
  c_vigencia    constant date := date '2026-11-06';

  c_ws_metrik      constant uuid := 'a21bfc88-1a60-48c3-afcd-144226aa2392';
  c_registrado_por constant uuid := 'cc6f6100-4eb7-4eed-9a7c-096729f5cedf';  -- Mauricio (platform admin)
  c_slug_doc       constant text := 'terminos-suscripcion-valida-cda';
  c_titulo         constant text := 'Términos de Suscripción al Servicio VALIDA · Plan CDA';
  c_ws_cda         constant uuid := '962df864-4dd8-44ba-aac0-bf994f391931';
  c_slug_ws        constant text := 'maxitec';
  c_empresa        constant uuid := '069cbc29-ed49-4e0c-b803-f2497440a5f2';
  c_negocio        constant uuid := '717b2c2c-c265-4cb3-a483-3383b104a412';
  c_previa         constant uuid := '67f3a71c-715b-4fdb-a4bd-a3a8ceb327be';
  c_previa_version constant text := 'v1.3';
  c_previa_pdf     constant text := '18aedd2c070b9f820e1f08abc825fb0f0098c19c1ff06fdc07bc256dbe5cfda8';
  c_texto_sha256   constant text := '196854fa6a3b6b9e4c14e586ab0b9da17515a00c96c0a6daef1375c1d325618c';
  c_pdf_sha256     constant text := 'd3d1f92a40351c40e8766e03244f5b32bc177664077a9ce337ac95bc80cf5c3d';
  c_pdf_path       constant text := 'maxitec/terminos-suscripcion-valida-cda-v1.4.pdf';
  c_texto constant text := $texto$# TÉRMINOS DE SUSCRIPCIÓN AL SERVICIO VALIDA · PLAN CDA v1.4

**METRIK**: METRIK IA S.A.S., NIT 902.079.601-9, domiciliada en la Calle 24A Bis 100-71, Bogotá D.C., representada legalmente por Brallan Mauricio Moreno Guzmán. Correo: mauricio.moreno@metrik.com.co.

**EL CLIENTE**: CENTRO DE DIAGNOSTICO AUTOMOTOR MAXITEC S.A.S., NIT 900.158.425-0, domiciliada en CL 5 A 10 06 38 CR 10 5 A 11 31 CR 10 A 5 A 31, Florencia (Caquetá), representada legalmente por Jairo Enrique Peña Bernal.

Estos Términos rigen desde su aceptación en la forma prevista en la cláusula 16 y constituyen el acuerdo completo entre las Partes sobre el Servicio.

## 0. Antecedente y continuidad

0.1. El Cliente venía accediendo a VALIDA en virtud del Contrato de Prestación de Servicios Tecnológicos de Validación en Listas Vinculantes y Restrictivas suscrito el 22 de junio de 2026 con AFI INTERNATIONAL GROUP S.A.S., terminado de mutuo acuerdo con efectos al 21 de septiembre de 2026.

0.2. VALIDA es de propiedad de METRIK. Estos Términos sustituyen ese contrato **sin interrumpir el servicio** y **respetando el plazo pactado en él**, en los términos de la cláusula 12.1.

## 1. Objeto y alcance

1.1. METRIK concede al Cliente acceso a **VALIDA**, servicio de computación en la nube para la consulta automatizada de personas naturales y jurídicas contra listas restrictivas y vinculantes utilizadas en la gestión del riesgo de LA/FT/FP (el "Servicio"), a través de su espacio de trabajo en maxitec.metrikone.co.

1.2. El Servicio comprende: acceso a la plataforma, **un (1) usuario administrador y dos (2) usuarios operativos habilitados**, **consultas individuales ilimitadas**, **consultas masivas ilimitadas**, generación de reportes de validación, consulta de listas nacionales e internacionales aplicables al marco normativo colombiano, actualización permanente de las fuentes disponibles y soporte funcional básico.

1.3. El alcance es la consulta de listas del marco SARLAFT según el catálogo vigente publicado en la plataforma. No incluye asesoría jurídica, normativa ni tributaria, ni el diseño u operación del sistema SARLAFT/SAGRILAFT/SIPLAFT del Cliente.

1.4. El Cliente declara que contrata como empresa, para su actividad económica, y no como consumidor final (Ley 1480 de 2011).

## 2. Condiciones comerciales

2.1. **Precio.** La suscripción tiene un valor de **CIENTO CINCUENTA MIL PESOS ($150.000) mensuales**.

2.2. **Tributos.** El Servicio se factura como servicio de computación en la nube (cloud computing) **excluido del impuesto sobre las ventas**, conforme al **numeral 21 del artículo 476 del Estatuto Tributario**. El precio señalado en la cláusula 2.1 es el valor total a cargo del Cliente y no lleva IVA que sumar ni que discriminar. El soporte funcional previsto en la cláusula 1.2 es inherente al acceso al Servicio y no constituye un servicio facturado por separado. Si la autoridad tributaria determina que el Servicio se encuentra gravado, METRIK no trasladará al Cliente el impuesto correspondiente a los períodos ya facturados; para los períodos siguientes, las Partes ajustarán el precio para incorporar el tributo.

2.3. **Usuarios adicionales.** La suscripción incluye un (1) usuario administrador sin costo, que es la persona designada por el Cliente para aceptar estos Términos y gestionar la suscripción, y dos (2) usuarios operativos. Cada usuario operativo adicional tiene un valor de **CINCUENTA MIL PESOS ($50.000) mensuales**, bajo el mismo tratamiento tributario de la cláusula 2.2, y requiere solicitud expresa del Cliente.

2.4. **Forma de pago.** El pago es **mensual y anticipado, dentro de los primeros cinco (5) días calendario** de cada período de servicio. METRIK remitirá al Cliente, antes del inicio de cada período, un **enlace de pago** con la referencia del período correspondiente. METRIK expedirá factura electrónica de venta por cada período. **El primer período de servicio bajo estos Términos no inicia antes de que METRIK cuente con habilitación vigente para facturar electrónicamente; hasta entonces no se causa ni se cobra suma alguna, y el acceso del Cliente continúa sin interrupción.**

2.5. **Mora.** El incumplimiento del pago faculta a METRIK para restringir o suspender el Servicio en los términos de la cláusula 11.

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

9.3. METRIK conserva los registros de consulta necesarios para la trazabilidad del Servicio y para acreditar la debida diligencia del Cliente. A la terminación, y durante los treinta (30) días siguientes, el Cliente podrá **exportar la bitácora de sus consultas** en formato legible por máquina.

9.4. **Transmisión internacional.** El Cliente autoriza a METRIK a transmitir los datos personales necesarios para prestar el Servicio a los proveedores de infraestructura en la nube y de fuentes de información que METRIK utilice, incluidos los ubicados fuera de Colombia, conforme al **artículo 26 de la Ley 1581 de 2012** y al **artículo 25 del Decreto 1377 de 2013**. METRIK mantiene publicada en la plataforma la relación de dichos proveedores y exige de ellos garantías de seguridad no inferiores a las propias.

9.5. **Incidentes de seguridad.** METRIK notificará al Cliente cualquier incidente de seguridad que afecte sus datos **dentro de las setenta y dos (72) horas** siguientes a su conocimiento, con la información disponible sobre naturaleza, alcance y medidas adoptadas.

## 10. Responsabilidad

10.1. Las decisiones adoptadas por el Cliente con base en los resultados son de su exclusiva responsabilidad.

10.2. La responsabilidad total de METRIK por cualquier concepto se limita al valor pagado por el Cliente en los tres (3) meses anteriores al hecho que la origine.

## 11. Restricción y suspensión

11.1. **Restricción por mora.** Si una cuota no se paga dentro de los cinco (5) días calendario siguientes a su fecha de vencimiento, desde el día siguiente METRIK restringirá la realización de consultas nuevas, individuales y masivas. Durante la restricción el Cliente conserva el acceso a la plataforma, sus usuarios siguen habilitados y puede consultar y descargar los reportes ya generados. La restricción se levanta en cuanto el pago queda registrado: el que se hace por el enlace de pago enviado por METRIK se registra automáticamente al ser aprobado; el que se hace por otro medio, a más tardar el día hábil siguiente a su acreditación en la cuenta de METRIK.

11.2. **Aviso en la plataforma.** Desde el día siguiente al vencimiento de una cuota impaga, la plataforma muestra a los usuarios del Cliente la fecha a partir de la cual se aplicará la restricción.

11.3. **Suspensión.** METRIK podrá suspender el Servicio cuando existan obligaciones económicas vencidas superiores a treinta (30) días calendario, se detecte uso indebido de credenciales, se evidencie cesión de accesos a terceros o se identifiquen actividades que comprometan la seguridad de la plataforma o de la información.

11.4. **Transición.** Esta cláusula rige desde el 6 de noviembre de 2026 y se aplica también a las cuotas que en esa fecha estén vencidas e impagas.

## 12. Vigencia y terminación

12.1. **Plazo.** Estos Términos rigen desde su aceptación hasta el **21 de diciembre de 2026**, fecha en que vencía el contrato terminado con AFI, de modo que el Cliente conserva íntegro el plazo que había contratado.

12.2. **Renovación.** Vencido ese plazo, la suscripción se **renueva automáticamente por períodos mensuales**, salvo que cualquiera de las Partes avise lo contrario por escrito con **quince (15) días** de anticipación.

12.3. **Durante el plazo de la cláusula 12.1 METRIK no podrá terminar estos Términos sin causa imputable al Cliente.** Vencido ese plazo, y durante las renovaciones de la cláusula 12.2, cualquiera de las Partes podrá terminarlos con aviso escrito de treinta (30) días. El Cliente podrá terminarlos en cualquier momento con el mismo aviso. METRIK podrá terminarlos de inmediato, en cualquier tiempo, por incumplimiento de las cláusulas 3, 4 o 9.

12.4. **Saldo.** Si termina el Cliente, o METRIK por incumplimiento del Cliente, no hay reembolso del período ya pagado. Si METRIK termina sin causa imputable al Cliente, reembolsa a prorrata los días no prestados.

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

16.3. El acceso al Servicio queda habilitado una vez registrada la aceptación.$texto$;

  v_hoy date := (now() at time zone 'America/Bogota')::date;
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
    raise exception 'la vigencia (%) no es la publicación (%) + 30 días calendario (cláusula 13.1)', c_vigencia, c_publicacion;
  end if;
  if v_hoy <> c_publicacion then
    raise exception '%: hoy es % en Bogotá y el texto dice que el aviso se publica el % (rige el %). Publicar otro día cambia la vigencia: regenerar el texto, el PDF y este archivo con la fecha nueva.',
      c_slug_ws, v_hoy, c_publicacion, c_vigencia;
  end if;

  -- Idempotencia: con la v1.4 ya registrada, nada que hacer.
  if exists (
    select 1 from public.documentos_contractuales_versiones d
     where d.empresa_id = c_empresa and d.slug = c_slug_doc and d.version = 'v1.4'
  ) then
    raise exception '%: la v1.4 de esta empresa ya está registrada. Nada que hacer.', c_slug_ws;
  end if;

  -- La versión que se modifica: la esperada, de esta empresa, vigente y sin fecha de retiro.
  select d.id, d.workspace_id, d.linea_id, d.titulo, d.alcance, d.vigente_desde, d.vigente_hasta
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
  -- Ninguna OTRA versión de estos términos vigente para la empresa.
  select count(*) into v_vigentes
    from public.documentos_contractuales_versiones d
   where d.empresa_id = c_empresa and d.slug = c_slug_doc and d.id <> c_previa
     and (d.vigente_hasta is null or d.vigente_hasta >= v_hoy);
  if v_vigentes > 0 then
    raise exception '%: hay otra versión vigente de los términos de esta empresa además de la %', c_slug_ws, c_previa_version;
  end if;

  -- Un contrato vivo de esta empresa que paga este espacio, con la versión previa ACEPTADA: la v1.4 por
  -- aviso modifica lo aceptado. Sin aceptación, no hay qué modificar (sería la entrada de siempre).
  if not exists (
    select 1 from public.servicios_contratados sc
     where sc.negocio_id = c_negocio and sc.empresa_id = c_empresa and sc.workspace_pagador_id = c_ws_cda
       and sc.estado not in ('cancelado', 'terminado')
  ) then
    raise exception '%: no hay contrato vivo de esta empresa pagado por el espacio', c_slug_ws;
  end if;
  if not exists (
    select 1 from public.aceptaciones_terminos a
     where a.estado = 'aceptado' and a.documento_sha256 = c_previa_pdf and a.negocio_id = c_negocio
  ) then
    raise exception '%: la % no tiene aceptación registrada en el contrato: la v1.4 no se publica por aviso', c_slug_ws, c_previa_version;
  end if;

  -- El PDF del aviso tiene que estar subido: el aviso enlaza a él.
  if not exists (select 1 from storage.objects o where o.bucket_id = 'aceptaciones-documentos' and o.name = c_pdf_path) then
    raise exception '%: falta subir el PDF a aceptaciones-documentos/% (paso 2 de la cabecera)', c_slug_ws, c_pdf_path;
  end if;

  -- El texto que se publica es exactamente el generado, con la vigencia del 6-nov.
  if encode(sha256(convert_to(c_texto, 'UTF8')), 'hex') is distinct from c_texto_sha256 then
    raise exception '%: el texto no es el generado (huella distinta). No se edita a mano: se regenera.', c_slug_ws;
  end if;
  if position('rige desde el 6 de noviembre de 2026' in c_texto) = 0 then
    raise exception '%: el texto no dice la vigencia del 6 de noviembre de 2026', c_slug_ws;
  end if;

  -- ── 1. La versión previa rige hasta el día anterior a la vigencia ──────────
  update public.documentos_contractuales_versiones
     set vigente_hasta = c_vigencia - 1
   where id = c_previa and vigente_hasta is null;

  -- ── 2. La v1.4 por aviso: publicarla ES insertarla (el aviso aparece en /valida) ──
  insert into public.documentos_contractuales_versiones
    (workspace_id, linea_id, slug, alcance, empresa_id, titulo, version, texto_md, texto_sha256,
     pdf_bucket, pdf_path, pdf_sha256, vigente_desde, rige_por_aviso, reemplaza_version_id, publicada_at,
     registrado_por)
  values
    (v_previa.workspace_id, v_previa.linea_id, c_slug_doc, 'cliente', c_empresa, c_titulo, 'v1.4', c_texto,
     c_texto_sha256, 'aceptaciones-documentos', c_pdf_path, c_pdf_sha256, c_vigencia, true, c_previa, now(),
     c_registrado_por)
  returning id into v_id;

  -- ── Comprobación ──────────────────────────────────────────────────────────
  if not exists (
    select 1 from public.documentos_contractuales_versiones d
     where d.id = v_id and d.rige_por_aviso and d.reemplaza_version_id = c_previa
       and d.vigente_desde = c_vigencia and (d.publicada_at at time zone 'America/Bogota')::date = c_publicacion
  ) or not exists (
    select 1 from public.documentos_contractuales_versiones d where d.id = c_previa and d.vigente_hasta = c_vigencia - 1
  ) then
    raise exception '%: la publicación no quedó como se esperaba', c_slug_ws;
  end if;

  if c_ensayo then
    raise exception 'ENSAYO OK %: v1.4 % por aviso, publicada el %, rige el %; % vigente hasta el %. Nada quedó escrito.',
      c_slug_ws, v_id, c_publicacion, c_vigencia, c_previa_version, c_vigencia - 1;
  end if;
  raise notice 'PUBLICADO %: v1.4 % por aviso, rige el %', c_slug_ws, v_id, c_vigencia;
end;
$bloque$;


-- ════════════════════════════════════════════════════════════════════════════
-- QA OPCIONAL: el espacio de pruebas CDA Pruebas (no es uno de los 4 CDA con contrato real).
-- Sirve para ver el aviso, el documento, el PDF y la aceptación en producción antes que los CDA (o a la
-- vez). Corre igual que los otros: su PDF va en aceptaciones-documentos/cda-pruebas/…, generado con
-- `generar.py --qa` (carpeta terminos-cda-v1.4/_qa/cda-pruebas/). Si no se quiere QA en producción, no
-- se corre este bloque: los otros cuatro no dependen de él.
-- ════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
-- QA (OPCIONAL) · CP 26 1 · espacio `cda-pruebas` · aceptó la v1.1 el 2026-09-23 (espacio de pruebas)
-- La v1.1 (a515f1bf-1303-4d2e-b3cf-0ac08ec0ea50) queda vigente hasta el 5-nov; la v1.4 por aviso rige desde el 6-nov.
-- ────────────────────────────────────────────────────────────────────────────
do $bloque$
declare
  -- ⚠️ true = ENSAYO: escribe, comprueba y deshace todo con RAISE EXCEPTION 'ENSAYO OK …'.
  c_ensayo constant boolean := true;
  -- El día (Bogotá) en que se publica el aviso, el que dicen los textos. Si hoy no es este día, el bloque
  -- no corre: la cláusula 11.4 y el PDF dirían una vigencia falsa (regenerar con la fecha nueva).
  c_publicacion constant date := date '2026-10-07';
  c_vigencia    constant date := date '2026-11-06';

  c_ws_metrik      constant uuid := 'a21bfc88-1a60-48c3-afcd-144226aa2392';
  c_registrado_por constant uuid := 'cc6f6100-4eb7-4eed-9a7c-096729f5cedf';  -- Mauricio (platform admin)
  c_slug_doc       constant text := 'terminos-suscripcion-valida-cda';
  c_titulo         constant text := 'Términos de Suscripción al Servicio VALIDA · Plan CDA';
  c_ws_cda         constant uuid := '475da39a-5aa5-4857-a3c2-0d21277d8d53';
  c_slug_ws        constant text := 'cda-pruebas';
  c_empresa        constant uuid := '73c0f5d7-29fb-4b6b-825a-b5c7dbd70ae5';
  c_negocio        constant uuid := 'c4a1ca06-4134-4cef-9376-a10222f81478';
  c_previa         constant uuid := 'a515f1bf-1303-4d2e-b3cf-0ac08ec0ea50';
  c_previa_version constant text := 'v1.1';
  c_previa_pdf     constant text := '87074c2b80496c882649fe1d33581fb14d78bc9887cd9cf75cd77a3cad98f2e1';
  c_texto_sha256   constant text := 'e192479c1891e22a822dd56c90c565f8baf656d1588abf04588809802b5d04e0';
  c_pdf_sha256     constant text := '6abf5e342f4ad61b2bccb68e32d9b6d74cf65b8866ebf1abea67421a6c558e67';
  c_pdf_path       constant text := 'cda-pruebas/terminos-suscripcion-valida-cda-v1.4.pdf';
  c_texto constant text := $texto$# TÉRMINOS DE SUSCRIPCIÓN AL SERVICIO VALIDA · PLAN CDA v1.4

**METRIK**: METRIK IA S.A.S., NIT 902.079.601-9, domiciliada en la Calle 24A Bis 100-71, Bogotá D.C., representada legalmente por Brallan Mauricio Moreno Guzmán. Correo: mauricio.moreno@metrik.com.co.

**EL CLIENTE**: CDA PRUEBAS (ESPACIO DE PRUEBAS METRIK), NIT 999.999.999-9, domiciliada en Calle 24A Bis 100-71, Bogotá D.C. (espacio de pruebas), representada legalmente por Brallan Mauricio Moreno Guzmán.

Estos Términos rigen desde su aceptación en la forma prevista en la cláusula 16 y constituyen el acuerdo completo entre las Partes sobre el Servicio.

## 0. Antecedente y continuidad

0.1. El Cliente venía accediendo a VALIDA en virtud del Contrato de Prestación de Servicios Tecnológicos de Validación en Listas Vinculantes y Restrictivas suscrito el 23 de septiembre de 2026 con AFI INTERNATIONAL GROUP S.A.S., terminado de mutuo acuerdo con efectos al 23 de septiembre de 2026.

0.2. VALIDA es de propiedad de METRIK. Estos Términos sustituyen ese contrato **sin interrumpir el servicio** y **respetando el plazo pactado en él**, en los términos de la cláusula 12.1.

## 1. Objeto y alcance

1.1. METRIK concede al Cliente acceso a **VALIDA**, servicio de computación en la nube para la consulta automatizada de personas naturales y jurídicas contra listas restrictivas y vinculantes utilizadas en la gestión del riesgo de LA/FT/FP (el "Servicio"), a través de su espacio de trabajo en cda-pruebas.metrikone.co.

1.2. El Servicio comprende: acceso a la plataforma, **un (1) usuario administrador y dos (2) usuarios operativos habilitados**, **consultas individuales ilimitadas**, **consultas masivas ilimitadas**, generación de reportes de validación, consulta de listas nacionales e internacionales aplicables al marco normativo colombiano, actualización permanente de las fuentes disponibles y soporte funcional básico.

1.3. El alcance es la consulta de listas del marco SARLAFT según el catálogo vigente publicado en la plataforma. No incluye asesoría jurídica, normativa ni tributaria, ni el diseño u operación del sistema SARLAFT/SAGRILAFT/SIPLAFT del Cliente.

1.4. El Cliente declara que contrata como empresa, para su actividad económica, y no como consumidor final (Ley 1480 de 2011).

## 2. Condiciones comerciales

2.1. **Precio.** La suscripción tiene un valor de **CIENTO CINCUENTA MIL PESOS ($150.000) mensuales**.

2.2. **Tributos.** El Servicio se factura como servicio de computación en la nube (cloud computing) **excluido del impuesto sobre las ventas**, conforme al **numeral 21 del artículo 476 del Estatuto Tributario**. El precio señalado en la cláusula 2.1 es el valor total a cargo del Cliente y no lleva IVA que sumar ni que discriminar. El soporte funcional previsto en la cláusula 1.2 es inherente al acceso al Servicio y no constituye un servicio facturado por separado. Si la autoridad tributaria determina que el Servicio se encuentra gravado, METRIK no trasladará al Cliente el impuesto correspondiente a los períodos ya facturados; para los períodos siguientes, las Partes ajustarán el precio para incorporar el tributo.

2.3. **Usuarios adicionales.** La suscripción incluye un (1) usuario administrador sin costo, que es la persona designada por el Cliente para aceptar estos Términos y gestionar la suscripción, y dos (2) usuarios operativos. Cada usuario operativo adicional tiene un valor de **CINCUENTA MIL PESOS ($50.000) mensuales**, bajo el mismo tratamiento tributario de la cláusula 2.2, y requiere solicitud expresa del Cliente.

2.4. **Forma de pago.** El pago es **mensual y anticipado, dentro de los primeros cinco (5) días calendario** de cada período de servicio. METRIK remitirá al Cliente, antes del inicio de cada período, un **enlace de pago** con la referencia del período correspondiente. METRIK expedirá factura electrónica de venta por cada período. **El primer período de servicio bajo estos Términos no inicia antes de que METRIK cuente con habilitación vigente para facturar electrónicamente; hasta entonces no se causa ni se cobra suma alguna, y el acceso del Cliente continúa sin interrupción.**

2.5. **Mora.** El incumplimiento del pago faculta a METRIK para restringir o suspender el Servicio en los términos de la cláusula 11.

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

9.3. METRIK conserva los registros de consulta necesarios para la trazabilidad del Servicio y para acreditar la debida diligencia del Cliente. A la terminación, y durante los treinta (30) días siguientes, el Cliente podrá **exportar la bitácora de sus consultas** en formato legible por máquina.

9.4. **Transmisión internacional.** El Cliente autoriza a METRIK a transmitir los datos personales necesarios para prestar el Servicio a los proveedores de infraestructura en la nube y de fuentes de información que METRIK utilice, incluidos los ubicados fuera de Colombia, conforme al **artículo 26 de la Ley 1581 de 2012** y al **artículo 25 del Decreto 1377 de 2013**. METRIK mantiene publicada en la plataforma la relación de dichos proveedores y exige de ellos garantías de seguridad no inferiores a las propias.

9.5. **Incidentes de seguridad.** METRIK notificará al Cliente cualquier incidente de seguridad que afecte sus datos **dentro de las setenta y dos (72) horas** siguientes a su conocimiento, con la información disponible sobre naturaleza, alcance y medidas adoptadas.

## 10. Responsabilidad

10.1. Las decisiones adoptadas por el Cliente con base en los resultados son de su exclusiva responsabilidad.

10.2. La responsabilidad total de METRIK por cualquier concepto se limita al valor pagado por el Cliente en los tres (3) meses anteriores al hecho que la origine.

## 11. Restricción y suspensión

11.1. **Restricción por mora.** Si una cuota no se paga dentro de los cinco (5) días calendario siguientes a su fecha de vencimiento, desde el día siguiente METRIK restringirá la realización de consultas nuevas, individuales y masivas. Durante la restricción el Cliente conserva el acceso a la plataforma, sus usuarios siguen habilitados y puede consultar y descargar los reportes ya generados. La restricción se levanta en cuanto el pago queda registrado: el que se hace por el enlace de pago enviado por METRIK se registra automáticamente al ser aprobado; el que se hace por otro medio, a más tardar el día hábil siguiente a su acreditación en la cuenta de METRIK.

11.2. **Aviso en la plataforma.** Desde el día siguiente al vencimiento de una cuota impaga, la plataforma muestra a los usuarios del Cliente la fecha a partir de la cual se aplicará la restricción.

11.3. **Suspensión.** METRIK podrá suspender el Servicio cuando existan obligaciones económicas vencidas superiores a treinta (30) días calendario, se detecte uso indebido de credenciales, se evidencie cesión de accesos a terceros o se identifiquen actividades que comprometan la seguridad de la plataforma o de la información.

11.4. **Transición.** Esta cláusula rige desde el 6 de noviembre de 2026 y se aplica también a las cuotas que en esa fecha estén vencidas e impagas.

## 12. Vigencia y terminación

12.1. **Plazo.** Estos Términos rigen desde su aceptación hasta el **23 de enero de 2027**, fecha en que vencía el contrato terminado con AFI, de modo que el Cliente conserva íntegro el plazo que había contratado.

12.2. **Renovación.** Vencido ese plazo, la suscripción se **renueva automáticamente por períodos mensuales**, salvo que cualquiera de las Partes avise lo contrario por escrito con **quince (15) días** de anticipación.

12.3. **Durante el plazo de la cláusula 12.1 METRIK no podrá terminar estos Términos sin causa imputable al Cliente.** Vencido ese plazo, y durante las renovaciones de la cláusula 12.2, cualquiera de las Partes podrá terminarlos con aviso escrito de treinta (30) días. El Cliente podrá terminarlos en cualquier momento con el mismo aviso. METRIK podrá terminarlos de inmediato, en cualquier tiempo, por incumplimiento de las cláusulas 3, 4 o 9.

12.4. **Saldo.** Si termina el Cliente, o METRIK por incumplimiento del Cliente, no hay reembolso del período ya pagado. Si METRIK termina sin causa imputable al Cliente, reembolsa a prorrata los días no prestados.

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

16.3. El acceso al Servicio queda habilitado una vez registrada la aceptación.$texto$;

  v_hoy date := (now() at time zone 'America/Bogota')::date;
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
    raise exception 'la vigencia (%) no es la publicación (%) + 30 días calendario (cláusula 13.1)', c_vigencia, c_publicacion;
  end if;
  if v_hoy <> c_publicacion then
    raise exception '%: hoy es % en Bogotá y el texto dice que el aviso se publica el % (rige el %). Publicar otro día cambia la vigencia: regenerar el texto, el PDF y este archivo con la fecha nueva.',
      c_slug_ws, v_hoy, c_publicacion, c_vigencia;
  end if;

  -- Idempotencia: con la v1.4 ya registrada, nada que hacer.
  if exists (
    select 1 from public.documentos_contractuales_versiones d
     where d.empresa_id = c_empresa and d.slug = c_slug_doc and d.version = 'v1.4'
  ) then
    raise exception '%: la v1.4 de esta empresa ya está registrada. Nada que hacer.', c_slug_ws;
  end if;

  -- La versión que se modifica: la esperada, de esta empresa, vigente y sin fecha de retiro.
  select d.id, d.workspace_id, d.linea_id, d.titulo, d.alcance, d.vigente_desde, d.vigente_hasta
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
  -- Ninguna OTRA versión de estos términos vigente para la empresa.
  select count(*) into v_vigentes
    from public.documentos_contractuales_versiones d
   where d.empresa_id = c_empresa and d.slug = c_slug_doc and d.id <> c_previa
     and (d.vigente_hasta is null or d.vigente_hasta >= v_hoy);
  if v_vigentes > 0 then
    raise exception '%: hay otra versión vigente de los términos de esta empresa además de la %', c_slug_ws, c_previa_version;
  end if;

  -- Un contrato vivo de esta empresa que paga este espacio, con la versión previa ACEPTADA: la v1.4 por
  -- aviso modifica lo aceptado. Sin aceptación, no hay qué modificar (sería la entrada de siempre).
  if not exists (
    select 1 from public.servicios_contratados sc
     where sc.negocio_id = c_negocio and sc.empresa_id = c_empresa and sc.workspace_pagador_id = c_ws_cda
       and sc.estado not in ('cancelado', 'terminado')
  ) then
    raise exception '%: no hay contrato vivo de esta empresa pagado por el espacio', c_slug_ws;
  end if;
  if not exists (
    select 1 from public.aceptaciones_terminos a
     where a.estado = 'aceptado' and a.documento_sha256 = c_previa_pdf and a.negocio_id = c_negocio
  ) then
    raise exception '%: la % no tiene aceptación registrada en el contrato: la v1.4 no se publica por aviso', c_slug_ws, c_previa_version;
  end if;

  -- El PDF del aviso tiene que estar subido: el aviso enlaza a él.
  if not exists (select 1 from storage.objects o where o.bucket_id = 'aceptaciones-documentos' and o.name = c_pdf_path) then
    raise exception '%: falta subir el PDF a aceptaciones-documentos/% (paso 2 de la cabecera)', c_slug_ws, c_pdf_path;
  end if;

  -- El texto que se publica es exactamente el generado, con la vigencia del 6-nov.
  if encode(sha256(convert_to(c_texto, 'UTF8')), 'hex') is distinct from c_texto_sha256 then
    raise exception '%: el texto no es el generado (huella distinta). No se edita a mano: se regenera.', c_slug_ws;
  end if;
  if position('rige desde el 6 de noviembre de 2026' in c_texto) = 0 then
    raise exception '%: el texto no dice la vigencia del 6 de noviembre de 2026', c_slug_ws;
  end if;

  -- ── 1. La versión previa rige hasta el día anterior a la vigencia ──────────
  update public.documentos_contractuales_versiones
     set vigente_hasta = c_vigencia - 1
   where id = c_previa and vigente_hasta is null;

  -- ── 2. La v1.4 por aviso: publicarla ES insertarla (el aviso aparece en /valida) ──
  insert into public.documentos_contractuales_versiones
    (workspace_id, linea_id, slug, alcance, empresa_id, titulo, version, texto_md, texto_sha256,
     pdf_bucket, pdf_path, pdf_sha256, vigente_desde, rige_por_aviso, reemplaza_version_id, publicada_at,
     registrado_por)
  values
    (v_previa.workspace_id, v_previa.linea_id, c_slug_doc, 'cliente', c_empresa, c_titulo, 'v1.4', c_texto,
     c_texto_sha256, 'aceptaciones-documentos', c_pdf_path, c_pdf_sha256, c_vigencia, true, c_previa, now(),
     c_registrado_por)
  returning id into v_id;

  -- ── Comprobación ──────────────────────────────────────────────────────────
  if not exists (
    select 1 from public.documentos_contractuales_versiones d
     where d.id = v_id and d.rige_por_aviso and d.reemplaza_version_id = c_previa
       and d.vigente_desde = c_vigencia and (d.publicada_at at time zone 'America/Bogota')::date = c_publicacion
  ) or not exists (
    select 1 from public.documentos_contractuales_versiones d where d.id = c_previa and d.vigente_hasta = c_vigencia - 1
  ) then
    raise exception '%: la publicación no quedó como se esperaba', c_slug_ws;
  end if;

  if c_ensayo then
    raise exception 'ENSAYO OK %: v1.4 % por aviso, publicada el %, rige el %; % vigente hasta el %. Nada quedó escrito.',
      c_slug_ws, v_id, c_publicacion, c_vigencia, c_previa_version, c_vigencia - 1;
  end if;
  raise notice 'PUBLICADO %: v1.4 % por aviso, rige el %', c_slug_ws, v_id, c_vigencia;
end;
$bloque$;
