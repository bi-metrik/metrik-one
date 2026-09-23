-- ============================================================================
-- Valida · los 4 CDA pasan a ser clientes directos de METRIK IA S.A.S. · 2026-09-23
--
-- Por cada CDA: su contrato `valida-cda-licencia` v1 (pagador = el espacio del CDA, con la persona
-- designada para aceptar), el módulo con su contrato y los Términos de Suscripción VALIDA ·
-- Licencia CDA v1.1 de ESA empresa (texto, huella del texto y huella del PDF).
--
-- ⚠️ ESTO NO ESTÁ APLICADO. Escribe datos de producción: lo corre la sesión principal, CDA por CDA,
-- cuando la empresa haya nombrado a su persona designada. Los cuatro bloques son independientes.
--
-- ⚠️ EFECTO al cargar un CDA: cada contrato nace con plazo para aceptar hasta el 30-sep-2026
-- (`c_plazo_terminos` → `servicios_contratados.terminos_plazo_hasta`, decisión de Mauricio del
-- 2026-09-23). Hasta ese día el CDA sigue consultando y ve un aviso; la persona designada acepta
-- desde el aviso. Desde el 1-oct, sin aceptación, `/valida` muestra solo los términos y NADIE
-- consulta hasta que ella acepte (los demás ven quién falta). Cargar un bloque DESPUÉS del 30-sep
-- es cerrar Valida de inmediato para ese CDA: correr el plazo antes, o dejarlo en null a propósito.
-- Por eso el bloque no corre sin `c_designado`: un contrato sin designada deja el módulo cerrado
-- sin nadie que pueda abrirlo.
--
-- ── Orden ───────────────────────────────────────────────────────────────────
--   0. Las migraciones `20260923220000_terminos_cda_designado_y_enlace_pago.sql` y
--      `20260924010000_valida_cda_plazo_terminos_y_facturas_cuota.sql` aplicadas (van ANTES del
--      merge de sus PR). El bloque comprueba las dos.
--   1. Merge y deploy del PR (sin el código nuevo, el contrato no cierra nada: el CDA sigue igual).
--   2. Subir los 4 PDF al bucket `aceptaciones-documentos`, cada uno en `<espacio>/terminos-suscripcion-valida-cda-v1.1.pdf`
--      (sin upsert). Los archivos son los de
--      `proyectos/metrik/valida/docs/entrega/legal/terminos-cda-v1.1/<espacio>/`, y su huella tiene
--      que ser la de `c_pdf_sha256`: WeasyPrint no genera bytes idénticos dos veces, así que
--      regenerarlos obliga a regenerar también este archivo.
--        curl -X POST "$URL/storage/v1/object/aceptaciones-documentos/<espacio>/terminos-suscripcion-valida-cda-v1.1.pdf" \
--          -H "Authorization: Bearer $SERVICE_ROLE" -H "Content-Type: application/pdf" \
--          --data-binary @<ruta del PDF>
--      El PDF es la evidencia: la declaración que firma la persona designada nombra su huella.
--   3. Con la designada confirmada: poner `c_designado`, correr el bloque tal cual (ENSAYO: tiene
--      que terminar en «ENSAYO OK … Nada quedó escrito»), cambiar `c_ensayo` a false y correrlo de
--      nuevo. Es UN statement: el ensayo deshace todo aunque pase por el pooler.
--   4. Los enlaces de Bold de cada cuota: `plantilla-enlace-de-pago-cuota.sql`.
--
-- ── Qué NO hace ─────────────────────────────────────────────────────────────
--   · No crea usuarios. La designada tiene que tener perfil en el espacio del CDA. Cada espacio
--     tiene hoy 2 licencias y 2 perfiles: un tercer usuario es un usuario adicional (cláusula 2.3),
--     salvo que se designe a uno de los dos que ya existen.
--   · No pone comisión a AFI (ver la nota en el insert).
--   · No enciende los planes de cobro (siguen `activo = false`: el emisor no emite sin factura
--     electrónica) ni carga enlaces de pago.
--
-- ── Verificación después de cargar (solo lectura) ───────────────────────────
--   select w.slug, sc.estado, p.full_name as designada, sc.terminos_plazo_hasta, sc.parametros
--     from public.servicios_contratados sc
--     join public.workspaces w on w.id = sc.workspace_pagador_id
--     left join public.profiles p on p.id = sc.aceptante_designado_id
--    where sc.servicio_slug = 'valida-cda-licencia';                 -- una fila por CDA cargado
--   select d.slug, d.version, e.razon_social, d.texto_sha256, d.pdf_sha256, d.pdf_path
--     from public.documentos_contractuales_versiones d
--     join public.empresas e on e.id = d.empresa_id
--    where d.slug = 'terminos-suscripcion-valida-cda';              -- una fila por CDA cargado
--   select name from storage.objects
--    where bucket_id = 'aceptaciones-documentos' and name like '%/terminos-suscripcion-valida-cda-v1.1.pdf';  -- los 4 PDF
--
-- Huellas (generadas el 2026-09-23 desde terminos-suscripcion-valida-cda-v1.md):
--   cda-caqueta     texto 3dfebe71d2f6773fa4fdaba25613bc93602fd1794a3213704f6bff043d80f534
--                   PDF   945615130cae642ebd1f0862e63a945445c3c1097aae9ff7d57e188a4f02f249
--   cda-elcarmen    texto f1ae47ba47fc0be136cd125d97713b11bcf339a9445d8193b2c792e48d1b06b3
--                   PDF   064a37e26b55e4b2d746bfd533c6ec7e20248902646321bbc694f95ab75110d8
--   cda-puertotest  texto 1929a815015e38c1bffa061eab4cc3c4f41adf914da7b431cf3915d1a70f24fe
--                   PDF   f2df5f46ba10636294ad4cfc4f8e9fe0ecac84c34f5ad71c1b378017ee3f1d36
--   maxitec         texto 8265e3905c186628c949e1ca826924a291f628b2443e2480fab1c412ffb40f21
--                   PDF   10b1bd2335873c0fa19526ddeefd4cdd8d7274a67f590e87d0e64b967ed60339
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- C1 26 1 · CENTRO DE DIAGNOSTICO AUTOMOTOR DEL CAQUETA LIMITADA · espacio `cda-caqueta`
--
-- ⚠️ Persona designada: la nombra la empresa (representante legal o apoderado con poder). Perfiles
-- del espacio hoy: 6c2362ba-7a90-4892-aa33-ce0f5cc9042d «Oficial de Cumplimiento» (owner) y 6cf5dc0d-b908-4cdb-87ee-0adfa427283d «CDA del Caquetá» (operator). La representante legal que nombran los términos, Alba Yurany Rosas Escandón, no tiene usuario.
-- ────────────────────────────────────────────────────────────────────────────
do $bloque$
declare
  -- ⚠️ true = ENSAYO: inserta, comprueba y deshace todo con RAISE EXCEPTION 'ENSAYO OK …'.
  --    Solo con la persona designada confirmada se cambia a false.
  c_ensayo constant boolean := true;
  -- ⚠️ profiles.id de quien acepta por la empresa, EN el espacio de este CDA. Sin él, no corre.
  c_designado constant uuid := null;
  -- Último día (inclusive) en que el CDA consulta sin la aceptación. null = se cierra al cargar.
  c_plazo_terminos constant date := date '2026-09-30';

  c_ws_metrik      constant uuid := 'a21bfc88-1a60-48c3-afcd-144226aa2392';
  c_linea_valida   constant uuid := '7d9f8994-a843-4032-a632-a6286ec61d94';
  c_registrado_por constant uuid := 'cc6f6100-4eb7-4eed-9a7c-096729f5cedf';  -- Mauricio (platform admin)
  c_ws_cda         constant uuid := 'b58e4b68-8bed-48b6-85f8-01995f64ffe6';
  c_slug_ws        constant text := 'cda-caqueta';
  c_empresa        constant uuid := 'e47db571-029c-45ab-a0e0-860c9d5c62dc';
  c_nit            constant text := '900156521-0';
  c_negocio        constant uuid := '8db0ced7-2ef9-4b18-9e57-de8db0d3fb58';
  c_codigo         constant text := 'C1 26 1';
  c_correo         constant text := 'tesoreriacdadelcaqueta@gmail.com';
  c_texto_sha256   constant text := '3dfebe71d2f6773fa4fdaba25613bc93602fd1794a3213704f6bff043d80f534';
  c_pdf_sha256     constant text := '945615130cae642ebd1f0862e63a945445c3c1097aae9ff7d57e188a4f02f249';
  c_pdf_path       constant text := 'cda-caqueta/terminos-suscripcion-valida-cda-v1.1.pdf';
  c_texto constant text := $texto$# TÉRMINOS DE SUSCRIPCIÓN VALIDA · LICENCIA CDA v1.1

**METRIK**: METRIK IA S.A.S., NIT 902.079.601-9, domiciliada en la Calle 24A Bis 100-71, Bogotá D.C., representada legalmente por Brallan Mauricio Moreno Guzmán. Correo: mauricio.moreno@metrik.com.co.

**EL CLIENTE**: CENTRO DE DIAGNOSTICO AUTOMOTOR DEL CAQUETA LIMITADA, NIT 900.156.521-0, domiciliada en CR 17 14 63 67 71 75 BRR LA VEGA, Florencia (Caquetá), representada legalmente por Alba Yurany Rosas Escandón.

Estos Términos rigen desde su aceptación en la forma prevista en la cláusula 16 y constituyen el acuerdo completo entre las Partes sobre el Servicio.

## 0. Antecedente y continuidad

0.1. El Cliente venía accediendo a VALIDA en virtud del Contrato de Prestación de Servicios Tecnológicos de Validación en Listas Vinculantes y Restrictivas suscrito el 16 de julio de 2026 con AFI INTERNATIONAL GROUP S.A.S., terminado de mutuo acuerdo con efectos al 15 de septiembre de 2026.

0.2. VALIDA es de propiedad de METRIK. Estos Términos sustituyen ese contrato **sin interrumpir el servicio** y **respetando el plazo pactado en él**, en los términos de la cláusula 12.1.

## 1. Objeto y alcance

1.1. METRIK concede al Cliente acceso a **VALIDA**, servicio de computación en la nube para la consulta automatizada de personas naturales y jurídicas contra listas restrictivas y vinculantes utilizadas en la gestión del riesgo de LA/FT/FP (el "Servicio"), a través de su espacio de trabajo en cda-caqueta.metrikone.co.

1.2. El Servicio comprende: acceso a la plataforma, **dos (2) usuarios habilitados**, **consultas individuales ilimitadas**, **consultas masivas ilimitadas**, generación de reportes de validación, consulta de listas nacionales e internacionales aplicables al marco normativo colombiano, actualización permanente de las fuentes disponibles y soporte funcional básico.

1.3. El alcance es la consulta de listas del marco SARLAFT según el catálogo vigente publicado en la plataforma. No incluye asesoría jurídica, normativa ni tributaria, ni el diseño u operación del sistema SARLAFT/SAGRILAFT/SIPLAFT del Cliente.

1.4. El Cliente declara que contrata como empresa, para su actividad económica, y no como consumidor final (Ley 1480 de 2011).

## 2. Condiciones comerciales

2.1. **Precio.** La suscripción tiene un valor de **CIENTO CINCUENTA MIL PESOS ($150.000) mensuales**.

2.2. **Tributos.** El Servicio se factura como servicio de computación en la nube (cloud computing) **excluido del impuesto sobre las ventas**, conforme al **numeral 21 del artículo 476 del Estatuto Tributario**. El precio señalado en la cláusula 2.1 es el valor total a cargo del Cliente y no lleva IVA que sumar ni que discriminar. El soporte funcional previsto en la cláusula 1.2 es inherente al acceso al Servicio y no constituye un servicio facturado por separado. Si la autoridad tributaria determina que el Servicio se encuentra gravado, METRIK no trasladará al Cliente el impuesto correspondiente a los períodos ya facturados; para los períodos siguientes, las Partes ajustarán el precio para incorporar el tributo. (Cambio frente al contrato de AFI, que liquidaba $150.000 más IVA, esto es $178.500 al mes. Bajo estos Términos el Cliente paga $28.500 menos por mes.)

2.3. **Usuarios adicionales.** La suscripción incluye dos (2) usuarios. Cada usuario adicional tiene un valor de **CINCUENTA MIL PESOS ($50.000) mensuales**, bajo el mismo tratamiento tributario de la cláusula 2.2, y requiere solicitud expresa del Cliente.

2.4. **Forma de pago.** El pago es **mensual y anticipado, dentro de los primeros cinco (5) días calendario** de cada período de servicio. METRIK remitirá al Cliente, antes del inicio de cada período, un **enlace de pago** con la referencia del período correspondiente. METRIK expedirá factura electrónica de venta por cada período. **El primer período de servicio bajo estos Términos no inicia antes de que METRIK cuente con habilitación vigente para facturar electrónicamente; hasta entonces no se causa ni se cobra suma alguna, y el acceso del Cliente continúa sin interrupción.**

2.5. **Mora.** El incumplimiento del pago faculta a METRIK para suspender el Servicio en los términos de la cláusula 11.

## 3. Credenciales

3.1. Las credenciales de acceso son personales de cada usuario habilitado, confidenciales e intransferibles.

3.2. El Cliente responde por el uso que se haga con sus credenciales y avisará a METRIK, sin demora, de cualquier uso no autorizado.

3.3. METRIK podrá rotar, suspender o revocar credenciales ante indicios de compromiso, uso indebido o incumplimiento de estos Términos.

## 4. Licencia, uso permitido y prohibido

4.1. **Exclusividad de la licencia.** La licencia es exclusiva para CENTRO DE DIAGNOSTICO AUTOMOTOR DEL CAQUETA LIMITADA y no se extiende a empresas vinculadas, filiales, subordinadas, matrices, aliados ni terceros. Los usuarios habilitados deben pertenecer al Cliente.

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

## 11. Suspensión

11.1. METRIK podrá suspender el Servicio cuando existan obligaciones económicas vencidas **superiores a treinta (30) días calendario**, se detecte uso indebido de credenciales, se evidencie cesión de accesos a terceros o se identifiquen actividades que comprometan la seguridad de la plataforma o de la información.

## 12. Vigencia y terminación

12.1. **Plazo.** Estos Términos rigen desde su aceptación hasta el **15 de enero de 2027**, fecha en que vencía el contrato terminado con AFI, de modo que el Cliente conserva íntegro el plazo que había contratado.

12.2. **Renovación.** Vencido ese plazo, la suscripción se **renueva automáticamente por períodos mensuales**, salvo que cualquiera de las Partes avise lo contrario por escrito con **quince (15) días** de anticipación. (Cambio frente al contrato de AFI, que solo se prorrogaba por acuerdo escrito.)

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

  v_perfil record;
  v_sc uuid;
  v_doc uuid;
  v_cambios jsonb;
begin
  -- ── Guardas: abortan antes de escribir ─────────────────────────────────────
  if c_designado is null then
    raise exception '%: falta la persona designada (c_designado). Sin ella nadie puede aceptar y Valida queda cerrado para el CDA.', c_slug_ws;
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'servicios_contratados' and column_name = 'aceptante_designado_id'
  ) then
    raise exception 'Falta la migración 20260923220000_terminos_cda_designado_y_enlace_pago.sql';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'servicios_contratados' and column_name = 'terminos_plazo_hasta'
  ) then
    raise exception 'Falta la migración 20260924010000_valida_cda_plazo_terminos_y_facturas_cuota.sql';
  end if;

  select p.id, p.full_name, p.workspace_id, coalesce(p.platform_admin, false) as platform_admin
    into v_perfil
    from public.profiles p
   where p.id = c_designado;
  if not found then
    raise exception '%: el perfil designado % no existe', c_slug_ws, c_designado;
  end if;
  if v_perfil.workspace_id is distinct from c_ws_cda then
    raise exception '%: el perfil designado % (%) no está en el espacio del CDA', c_slug_ws, c_designado, v_perfil.full_name;
  end if;
  if v_perfil.platform_admin then
    raise exception '%: el soporte de MeTRIK no puede ser la persona designada', c_slug_ws;
  end if;

  if not exists (select 1 from public.workspaces w where w.id = c_ws_cda and w.slug = c_slug_ws) then
    raise exception '%: el espacio % no es el esperado', c_slug_ws, c_ws_cda;
  end if;
  if not exists (
    select 1 from public.empresas e
     where e.id = c_empresa and e.workspace_id = c_ws_metrik and e.numero_documento = c_nit
  ) then
    raise exception '%: la empresa % no está en metrik con NIT %', c_slug_ws, c_empresa, c_nit;
  end if;
  if not exists (
    select 1 from public.negocios n
     where n.id = c_negocio and n.workspace_id = c_ws_metrik and n.empresa_id = c_empresa
       and n.linea_id = c_linea_valida and n.codigo = c_codigo
  ) then
    raise exception '%: el negocio % no es el % de la línea Valida de esa empresa', c_slug_ws, c_negocio, c_codigo;
  end if;
  if not exists (select 1 from public.catalogo_servicios_versiones v where v.slug = 'valida-cda-licencia' and v.version = 1) then
    raise exception 'El catálogo no tiene valida-cda-licencia v1';
  end if;

  -- Idempotencia: una segunda corrida no duplica nada, se detiene.
  if exists (
    select 1 from public.servicios_contratados sc
     where sc.negocio_id = c_negocio and sc.servicio_slug = 'valida-cda-licencia'
  ) then
    raise exception '%: el negocio % ya tiene contrato valida-cda-licencia. Nada que hacer.', c_slug_ws, c_codigo;
  end if;
  if exists (
    select 1 from public.documentos_contractuales_versiones d
     where d.empresa_id = c_empresa and d.slug = 'terminos-suscripcion-valida-cda' and d.version = 'v1.1'
  ) then
    raise exception '%: los términos v1.1 de esta empresa ya están registrados. Nada que hacer.', c_slug_ws;
  end if;

  -- El texto que se firma es exactamente el generado: su huella lo prueba.
  if encode(sha256(convert_to(c_texto, 'UTF8')), 'hex') is distinct from c_texto_sha256 then
    raise exception '%: el texto no es el generado (huella distinta). No se editó a mano: se regenera.', c_slug_ws;
  end if;

  -- ── 1. El contrato directo con METRIK ───────────────────────────────────────
  insert into public.servicios_contratados (
    workspace_id, empresa_id, negocio_id, servicio_slug, servicio_version, parametros,
    workspace_pagador_id, correo_facturacion, estado, vigente_desde, vigente_hasta,
    comision, autorizacion_sin_poder_permitida, actualizado_por, aceptante_designado_id, terminos_plazo_hasta
  ) values (
    c_ws_metrik, c_empresa, c_negocio, 'valida-cda-licencia', 1,
    jsonb_build_object('precio_mensual', 150000, 'licencias', 2),
    c_ws_cda, c_correo, 'activo', date '2026-09-23',
    -- Sin fin: al vencer el plazo de la cláusula 12.1 (15 de enero de 2027) la suscripción se renueva mes a
    -- mes (cláusula 12.2).
    null,
    -- ⚠️ Sin comisión: que AFI siga cobrando $50.000 por licencia después de la terminación no está
    -- decidido. Si se decide que sí, va en esta columna, con el MISMO criterio de 4D SOFT:
    --   jsonb_build_object('modo', 'monto_fijo', 'monto_fijo', 50000, 'base', 'cada_cobro',
    --     'beneficiario_empresa_id', 'ecc378c7-10c4-4984-a31d-5533a598ad71', 'beneficiario_nit', '902003244-6')
    null,
    false, c_registrado_por, c_designado, c_plazo_terminos
  )
  returning id into v_sc;

  insert into public.servicio_contratado_beneficiarios (servicio_contratado_id, workspace_id)
  values (v_sc, c_ws_cda);

  insert into public.servicios_contratados_cambios (servicio_contratado_id, campo, valor_anterior, valor_nuevo, motivo, registrado_por)
  values (
    v_sc, 'alta', null,
    jsonb_build_object(
      'parametros', jsonb_build_object('precio_mensual', 150000, 'licencias', 2),
      'workspace_pagador_id', c_ws_cda,
      'aceptante_designado_id', c_designado,
      'aceptante_designado_nombre', v_perfil.full_name,
      'terminos_plazo_hasta', c_plazo_terminos,
      'comision', null
    ),
    'Alta del contrato directo de CENTRO DE DIAGNOSTICO AUTOMOTOR DEL CAQUETA LIMITADA con METRIK IA S.A.S. al terminar el contrato AFI-CDA (efectos al 15 de septiembre de 2026). Términos de Suscripción VALIDA · Licencia CDA v1.1; $150.000 mensuales sin IVA (art. 476 num. 21 ET), ciclo del 23 al 22.',
    c_registrado_por
  );

  -- ── 2. El módulo, con su contrato (la proyección no cambia: Valida ya está encendido) ──
  if not exists (
    select 1 from public.workspace_modulos m
     where m.workspace_id = c_ws_cda and m.modulo = 'valida_consulta'
       and (m.activo_hasta is null or m.activo_hasta > now())
  ) then
    insert into public.workspace_modulos (workspace_id, modulo, origen, servicio_contratado_id, activo_desde, motivo, registrado_por)
    values (c_ws_cda, 'valida_consulta', 'servicio', v_sc, now(), 'Contrato valida-cda-licencia v1 de CENTRO DE DIAGNOSTICO AUTOMOTOR DEL CAQUETA LIMITADA (negocio C1 26 1): licencia directa con METRIK desde el 2026-09-23.', c_registrado_por);
  end if;

  -- ── 3. Los términos v1.1 de esta empresa ───────────────────────────────────
  insert into public.documentos_contractuales_versiones (
    workspace_id, linea_id, slug, alcance, empresa_id, titulo, version,
    texto_md, texto_sha256, pdf_bucket, pdf_path, pdf_sha256, vigente_desde, vigente_hasta, registrado_por
  ) values (
    c_ws_metrik, c_linea_valida, 'terminos-suscripcion-valida-cda', 'cliente', c_empresa,
    'Términos de Suscripción VALIDA · Licencia CDA', 'v1.1',
    c_texto, c_texto_sha256, 'aceptaciones-documentos', c_pdf_path, c_pdf_sha256, date '2026-09-23', null, c_registrado_por
  )
  returning id into v_doc;

  -- ── Comprobaciones antes de soltar la transacción ──────────────────────────
  v_cambios := public.proyectar_modulos(c_ws_cda) -> 'cambios';
  if jsonb_array_length(v_cambios) > 0 then
    raise exception '%: la proyección de módulos cambiaría el espacio: %', c_slug_ws, v_cambios;
  end if;
  if (select count(*) from public.servicios_contratados sc
       join public.catalogo_servicios cs on cs.slug = sc.servicio_slug
      where cs.modulo = 'valida_consulta' and sc.workspace_pagador_id = c_ws_cda) <> 1 then
    raise exception '%: el espacio no quedó con exactamente un contrato de Valida', c_slug_ws;
  end if;

  if c_ensayo then
    raise exception 'ENSAYO OK %: contrato %, términos %, designada % (%). Nada quedó escrito.',
      c_slug_ws, v_sc, v_doc, v_perfil.full_name, c_designado;
  end if;
  raise notice 'CARGA OK %: contrato %, términos %, designada % (%)',
    c_slug_ws, v_sc, v_doc, v_perfil.full_name, c_designado;
end;
$bloque$;


-- ────────────────────────────────────────────────────────────────────────────
-- C2 26 1 · CENTRO DE DIAGNOSTICO AUTOMOTOR EL CARMEN SAS · espacio `cda-elcarmen`
--
-- ⚠️ Persona designada: la nombra la empresa (representante legal o apoderado con poder). Perfiles
-- del espacio hoy: 1aeb196c-e5d2-4a0d-9b41-dc77ea1d1ed7 «Oficial de Cumplimiento» (owner) y 80bb3b74-63dc-40ed-a33e-4f350c91d33a «CDA El Carmen» (operator). El representante legal que nombran los términos, Carlos Arnulfo Castro Quintero, no tiene usuario.
-- ────────────────────────────────────────────────────────────────────────────
do $bloque$
declare
  -- ⚠️ true = ENSAYO: inserta, comprueba y deshace todo con RAISE EXCEPTION 'ENSAYO OK …'.
  --    Solo con la persona designada confirmada se cambia a false.
  c_ensayo constant boolean := true;
  -- ⚠️ profiles.id de quien acepta por la empresa, EN el espacio de este CDA. Sin él, no corre.
  c_designado constant uuid := null;
  -- Último día (inclusive) en que el CDA consulta sin la aceptación. null = se cierra al cargar.
  c_plazo_terminos constant date := date '2026-09-30';

  c_ws_metrik      constant uuid := 'a21bfc88-1a60-48c3-afcd-144226aa2392';
  c_linea_valida   constant uuid := '7d9f8994-a843-4032-a632-a6286ec61d94';
  c_registrado_por constant uuid := 'cc6f6100-4eb7-4eed-9a7c-096729f5cedf';  -- Mauricio (platform admin)
  c_ws_cda         constant uuid := 'e86ab950-961c-481b-9498-79c7d8b18e5e';
  c_slug_ws        constant text := 'cda-elcarmen';
  c_empresa        constant uuid := '382818cb-831b-40f2-8a8d-e54aa7e9e526';
  c_nit            constant text := '901079937-4';
  c_negocio        constant uuid := '72e182e9-4864-41ff-b77b-2b79edbfd81d';
  c_codigo         constant text := 'C2 26 1';
  c_correo         constant text := 'cdaelcarmensas@gmail.com';
  c_texto_sha256   constant text := 'f1ae47ba47fc0be136cd125d97713b11bcf339a9445d8193b2c792e48d1b06b3';
  c_pdf_sha256     constant text := '064a37e26b55e4b2d746bfd533c6ec7e20248902646321bbc694f95ab75110d8';
  c_pdf_path       constant text := 'cda-elcarmen/terminos-suscripcion-valida-cda-v1.1.pdf';
  c_texto constant text := $texto$# TÉRMINOS DE SUSCRIPCIÓN VALIDA · LICENCIA CDA v1.1

**METRIK**: METRIK IA S.A.S., NIT 902.079.601-9, domiciliada en la Calle 24A Bis 100-71, Bogotá D.C., representada legalmente por Brallan Mauricio Moreno Guzmán. Correo: mauricio.moreno@metrik.com.co.

**EL CLIENTE**: CENTRO DE DIAGNOSTICO AUTOMOTOR EL CARMEN SAS, NIT 901.079.937-4, domiciliada en CR 11 11 161 BRR VTE, El Cerrito (Valle del Cauca), representada legalmente por Carlos Arnulfo Castro Quintero.

Estos Términos rigen desde su aceptación en la forma prevista en la cláusula 16 y constituyen el acuerdo completo entre las Partes sobre el Servicio.

## 0. Antecedente y continuidad

0.1. El Cliente venía accediendo a VALIDA en virtud del Contrato de Prestación de Servicios Tecnológicos de Validación en Listas Vinculantes y Restrictivas suscrito el 16 de julio de 2026 con AFI INTERNATIONAL GROUP S.A.S., terminado de mutuo acuerdo con efectos al 15 de septiembre de 2026.

0.2. VALIDA es de propiedad de METRIK. Estos Términos sustituyen ese contrato **sin interrumpir el servicio** y **respetando el plazo pactado en él**, en los términos de la cláusula 12.1.

## 1. Objeto y alcance

1.1. METRIK concede al Cliente acceso a **VALIDA**, servicio de computación en la nube para la consulta automatizada de personas naturales y jurídicas contra listas restrictivas y vinculantes utilizadas en la gestión del riesgo de LA/FT/FP (el "Servicio"), a través de su espacio de trabajo en cda-elcarmen.metrikone.co.

1.2. El Servicio comprende: acceso a la plataforma, **dos (2) usuarios habilitados**, **consultas individuales ilimitadas**, **consultas masivas ilimitadas**, generación de reportes de validación, consulta de listas nacionales e internacionales aplicables al marco normativo colombiano, actualización permanente de las fuentes disponibles y soporte funcional básico.

1.3. El alcance es la consulta de listas del marco SARLAFT según el catálogo vigente publicado en la plataforma. No incluye asesoría jurídica, normativa ni tributaria, ni el diseño u operación del sistema SARLAFT/SAGRILAFT/SIPLAFT del Cliente.

1.4. El Cliente declara que contrata como empresa, para su actividad económica, y no como consumidor final (Ley 1480 de 2011).

## 2. Condiciones comerciales

2.1. **Precio.** La suscripción tiene un valor de **CIENTO CINCUENTA MIL PESOS ($150.000) mensuales**.

2.2. **Tributos.** El Servicio se factura como servicio de computación en la nube (cloud computing) **excluido del impuesto sobre las ventas**, conforme al **numeral 21 del artículo 476 del Estatuto Tributario**. El precio señalado en la cláusula 2.1 es el valor total a cargo del Cliente y no lleva IVA que sumar ni que discriminar. El soporte funcional previsto en la cláusula 1.2 es inherente al acceso al Servicio y no constituye un servicio facturado por separado. Si la autoridad tributaria determina que el Servicio se encuentra gravado, METRIK no trasladará al Cliente el impuesto correspondiente a los períodos ya facturados; para los períodos siguientes, las Partes ajustarán el precio para incorporar el tributo. (Cambio frente al contrato de AFI, que liquidaba $150.000 más IVA, esto es $178.500 al mes. Bajo estos Términos el Cliente paga $28.500 menos por mes.)

2.3. **Usuarios adicionales.** La suscripción incluye dos (2) usuarios. Cada usuario adicional tiene un valor de **CINCUENTA MIL PESOS ($50.000) mensuales**, bajo el mismo tratamiento tributario de la cláusula 2.2, y requiere solicitud expresa del Cliente.

2.4. **Forma de pago.** El pago es **mensual y anticipado, dentro de los primeros cinco (5) días calendario** de cada período de servicio. METRIK remitirá al Cliente, antes del inicio de cada período, un **enlace de pago** con la referencia del período correspondiente. METRIK expedirá factura electrónica de venta por cada período. **El primer período de servicio bajo estos Términos no inicia antes de que METRIK cuente con habilitación vigente para facturar electrónicamente; hasta entonces no se causa ni se cobra suma alguna, y el acceso del Cliente continúa sin interrupción.**

2.5. **Mora.** El incumplimiento del pago faculta a METRIK para suspender el Servicio en los términos de la cláusula 11.

## 3. Credenciales

3.1. Las credenciales de acceso son personales de cada usuario habilitado, confidenciales e intransferibles.

3.2. El Cliente responde por el uso que se haga con sus credenciales y avisará a METRIK, sin demora, de cualquier uso no autorizado.

3.3. METRIK podrá rotar, suspender o revocar credenciales ante indicios de compromiso, uso indebido o incumplimiento de estos Términos.

## 4. Licencia, uso permitido y prohibido

4.1. **Exclusividad de la licencia.** La licencia es exclusiva para CENTRO DE DIAGNOSTICO AUTOMOTOR EL CARMEN SAS y no se extiende a empresas vinculadas, filiales, subordinadas, matrices, aliados ni terceros. Los usuarios habilitados deben pertenecer al Cliente.

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

## 11. Suspensión

11.1. METRIK podrá suspender el Servicio cuando existan obligaciones económicas vencidas **superiores a treinta (30) días calendario**, se detecte uso indebido de credenciales, se evidencie cesión de accesos a terceros o se identifiquen actividades que comprometan la seguridad de la plataforma o de la información.

## 12. Vigencia y terminación

12.1. **Plazo.** Estos Términos rigen desde su aceptación hasta el **15 de enero de 2027**, fecha en que vencía el contrato terminado con AFI, de modo que el Cliente conserva íntegro el plazo que había contratado.

12.2. **Renovación.** Vencido ese plazo, la suscripción se **renueva automáticamente por períodos mensuales**, salvo que cualquiera de las Partes avise lo contrario por escrito con **quince (15) días** de anticipación. (Cambio frente al contrato de AFI, que solo se prorrogaba por acuerdo escrito.)

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

  v_perfil record;
  v_sc uuid;
  v_doc uuid;
  v_cambios jsonb;
begin
  -- ── Guardas: abortan antes de escribir ─────────────────────────────────────
  if c_designado is null then
    raise exception '%: falta la persona designada (c_designado). Sin ella nadie puede aceptar y Valida queda cerrado para el CDA.', c_slug_ws;
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'servicios_contratados' and column_name = 'aceptante_designado_id'
  ) then
    raise exception 'Falta la migración 20260923220000_terminos_cda_designado_y_enlace_pago.sql';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'servicios_contratados' and column_name = 'terminos_plazo_hasta'
  ) then
    raise exception 'Falta la migración 20260924010000_valida_cda_plazo_terminos_y_facturas_cuota.sql';
  end if;

  select p.id, p.full_name, p.workspace_id, coalesce(p.platform_admin, false) as platform_admin
    into v_perfil
    from public.profiles p
   where p.id = c_designado;
  if not found then
    raise exception '%: el perfil designado % no existe', c_slug_ws, c_designado;
  end if;
  if v_perfil.workspace_id is distinct from c_ws_cda then
    raise exception '%: el perfil designado % (%) no está en el espacio del CDA', c_slug_ws, c_designado, v_perfil.full_name;
  end if;
  if v_perfil.platform_admin then
    raise exception '%: el soporte de MeTRIK no puede ser la persona designada', c_slug_ws;
  end if;

  if not exists (select 1 from public.workspaces w where w.id = c_ws_cda and w.slug = c_slug_ws) then
    raise exception '%: el espacio % no es el esperado', c_slug_ws, c_ws_cda;
  end if;
  if not exists (
    select 1 from public.empresas e
     where e.id = c_empresa and e.workspace_id = c_ws_metrik and e.numero_documento = c_nit
  ) then
    raise exception '%: la empresa % no está en metrik con NIT %', c_slug_ws, c_empresa, c_nit;
  end if;
  if not exists (
    select 1 from public.negocios n
     where n.id = c_negocio and n.workspace_id = c_ws_metrik and n.empresa_id = c_empresa
       and n.linea_id = c_linea_valida and n.codigo = c_codigo
  ) then
    raise exception '%: el negocio % no es el % de la línea Valida de esa empresa', c_slug_ws, c_negocio, c_codigo;
  end if;
  if not exists (select 1 from public.catalogo_servicios_versiones v where v.slug = 'valida-cda-licencia' and v.version = 1) then
    raise exception 'El catálogo no tiene valida-cda-licencia v1';
  end if;

  -- Idempotencia: una segunda corrida no duplica nada, se detiene.
  if exists (
    select 1 from public.servicios_contratados sc
     where sc.negocio_id = c_negocio and sc.servicio_slug = 'valida-cda-licencia'
  ) then
    raise exception '%: el negocio % ya tiene contrato valida-cda-licencia. Nada que hacer.', c_slug_ws, c_codigo;
  end if;
  if exists (
    select 1 from public.documentos_contractuales_versiones d
     where d.empresa_id = c_empresa and d.slug = 'terminos-suscripcion-valida-cda' and d.version = 'v1.1'
  ) then
    raise exception '%: los términos v1.1 de esta empresa ya están registrados. Nada que hacer.', c_slug_ws;
  end if;

  -- El texto que se firma es exactamente el generado: su huella lo prueba.
  if encode(sha256(convert_to(c_texto, 'UTF8')), 'hex') is distinct from c_texto_sha256 then
    raise exception '%: el texto no es el generado (huella distinta). No se editó a mano: se regenera.', c_slug_ws;
  end if;

  -- ── 1. El contrato directo con METRIK ───────────────────────────────────────
  insert into public.servicios_contratados (
    workspace_id, empresa_id, negocio_id, servicio_slug, servicio_version, parametros,
    workspace_pagador_id, correo_facturacion, estado, vigente_desde, vigente_hasta,
    comision, autorizacion_sin_poder_permitida, actualizado_por, aceptante_designado_id, terminos_plazo_hasta
  ) values (
    c_ws_metrik, c_empresa, c_negocio, 'valida-cda-licencia', 1,
    jsonb_build_object('precio_mensual', 150000, 'licencias', 2),
    c_ws_cda, c_correo, 'activo', date '2026-09-23',
    -- Sin fin: al vencer el plazo de la cláusula 12.1 (15 de enero de 2027) la suscripción se renueva mes a
    -- mes (cláusula 12.2).
    null,
    -- ⚠️ Sin comisión: que AFI siga cobrando $50.000 por licencia después de la terminación no está
    -- decidido. Si se decide que sí, va en esta columna, con el MISMO criterio de 4D SOFT:
    --   jsonb_build_object('modo', 'monto_fijo', 'monto_fijo', 50000, 'base', 'cada_cobro',
    --     'beneficiario_empresa_id', 'ecc378c7-10c4-4984-a31d-5533a598ad71', 'beneficiario_nit', '902003244-6')
    null,
    false, c_registrado_por, c_designado, c_plazo_terminos
  )
  returning id into v_sc;

  insert into public.servicio_contratado_beneficiarios (servicio_contratado_id, workspace_id)
  values (v_sc, c_ws_cda);

  insert into public.servicios_contratados_cambios (servicio_contratado_id, campo, valor_anterior, valor_nuevo, motivo, registrado_por)
  values (
    v_sc, 'alta', null,
    jsonb_build_object(
      'parametros', jsonb_build_object('precio_mensual', 150000, 'licencias', 2),
      'workspace_pagador_id', c_ws_cda,
      'aceptante_designado_id', c_designado,
      'aceptante_designado_nombre', v_perfil.full_name,
      'terminos_plazo_hasta', c_plazo_terminos,
      'comision', null
    ),
    'Alta del contrato directo de CENTRO DE DIAGNOSTICO AUTOMOTOR EL CARMEN SAS con METRIK IA S.A.S. al terminar el contrato AFI-CDA (efectos al 15 de septiembre de 2026). Términos de Suscripción VALIDA · Licencia CDA v1.1; $150.000 mensuales sin IVA (art. 476 num. 21 ET), ciclo del 23 al 22.',
    c_registrado_por
  );

  -- ── 2. El módulo, con su contrato (la proyección no cambia: Valida ya está encendido) ──
  if not exists (
    select 1 from public.workspace_modulos m
     where m.workspace_id = c_ws_cda and m.modulo = 'valida_consulta'
       and (m.activo_hasta is null or m.activo_hasta > now())
  ) then
    insert into public.workspace_modulos (workspace_id, modulo, origen, servicio_contratado_id, activo_desde, motivo, registrado_por)
    values (c_ws_cda, 'valida_consulta', 'servicio', v_sc, now(), 'Contrato valida-cda-licencia v1 de CENTRO DE DIAGNOSTICO AUTOMOTOR EL CARMEN SAS (negocio C2 26 1): licencia directa con METRIK desde el 2026-09-23.', c_registrado_por);
  end if;

  -- ── 3. Los términos v1.1 de esta empresa ───────────────────────────────────
  insert into public.documentos_contractuales_versiones (
    workspace_id, linea_id, slug, alcance, empresa_id, titulo, version,
    texto_md, texto_sha256, pdf_bucket, pdf_path, pdf_sha256, vigente_desde, vigente_hasta, registrado_por
  ) values (
    c_ws_metrik, c_linea_valida, 'terminos-suscripcion-valida-cda', 'cliente', c_empresa,
    'Términos de Suscripción VALIDA · Licencia CDA', 'v1.1',
    c_texto, c_texto_sha256, 'aceptaciones-documentos', c_pdf_path, c_pdf_sha256, date '2026-09-23', null, c_registrado_por
  )
  returning id into v_doc;

  -- ── Comprobaciones antes de soltar la transacción ──────────────────────────
  v_cambios := public.proyectar_modulos(c_ws_cda) -> 'cambios';
  if jsonb_array_length(v_cambios) > 0 then
    raise exception '%: la proyección de módulos cambiaría el espacio: %', c_slug_ws, v_cambios;
  end if;
  if (select count(*) from public.servicios_contratados sc
       join public.catalogo_servicios cs on cs.slug = sc.servicio_slug
      where cs.modulo = 'valida_consulta' and sc.workspace_pagador_id = c_ws_cda) <> 1 then
    raise exception '%: el espacio no quedó con exactamente un contrato de Valida', c_slug_ws;
  end if;

  if c_ensayo then
    raise exception 'ENSAYO OK %: contrato %, términos %, designada % (%). Nada quedó escrito.',
      c_slug_ws, v_sc, v_doc, v_perfil.full_name, c_designado;
  end if;
  raise notice 'CARGA OK %: contrato %, términos %, designada % (%)',
    c_slug_ws, v_sc, v_doc, v_perfil.full_name, c_designado;
end;
$bloque$;


-- ────────────────────────────────────────────────────────────────────────────
-- C3 26 1 · CENTRO DE DIAGNOSTICO AUTOMOTOR PUERTOTEST S.A.S ZOMAC · espacio `cda-puertotest`
--
-- ⚠️ Persona designada: la nombra la empresa (representante legal o apoderado con poder). Perfiles
-- del espacio hoy: 1cca5920-efb9-4a6f-92e3-1e68ad4419a5 «Oficial de Cumplimiento» (owner) y a5997ba1-a77d-4dc3-9e4a-964cbf74134d «CDA Puerto Test» (operator). El representante legal que nombran los términos, Carlos Arnulfo Castro Quintero (el mismo de El Carmen), no tiene usuario.
-- ────────────────────────────────────────────────────────────────────────────
do $bloque$
declare
  -- ⚠️ true = ENSAYO: inserta, comprueba y deshace todo con RAISE EXCEPTION 'ENSAYO OK …'.
  --    Solo con la persona designada confirmada se cambia a false.
  c_ensayo constant boolean := true;
  -- ⚠️ profiles.id de quien acepta por la empresa, EN el espacio de este CDA. Sin él, no corre.
  c_designado constant uuid := null;
  -- Último día (inclusive) en que el CDA consulta sin la aceptación. null = se cierra al cargar.
  c_plazo_terminos constant date := date '2026-09-30';

  c_ws_metrik      constant uuid := 'a21bfc88-1a60-48c3-afcd-144226aa2392';
  c_linea_valida   constant uuid := '7d9f8994-a843-4032-a632-a6286ec61d94';
  c_registrado_por constant uuid := 'cc6f6100-4eb7-4eed-9a7c-096729f5cedf';  -- Mauricio (platform admin)
  c_ws_cda         constant uuid := '3f180b67-0f6b-442d-99f9-4ee1efe2410e';
  c_slug_ws        constant text := 'cda-puertotest';
  c_empresa        constant uuid := '2bc36ea7-8740-41e5-8b03-d6c644e14d32';
  c_nit            constant text := '901149905-1';
  c_negocio        constant uuid := '72d35ffc-cd38-47f1-8a8d-f23488052d39';
  c_codigo         constant text := 'C3 26 1';
  c_correo         constant text := 'cdapuertotest@gmail.com';
  c_texto_sha256   constant text := '1929a815015e38c1bffa061eab4cc3c4f41adf914da7b431cf3915d1a70f24fe';
  c_pdf_sha256     constant text := 'f2df5f46ba10636294ad4cfc4f8e9fe0ecac84c34f5ad71c1b378017ee3f1d36';
  c_pdf_path       constant text := 'cda-puertotest/terminos-suscripcion-valida-cda-v1.1.pdf';
  c_texto constant text := $texto$# TÉRMINOS DE SUSCRIPCIÓN VALIDA · LICENCIA CDA v1.1

**METRIK**: METRIK IA S.A.S., NIT 902.079.601-9, domiciliada en la Calle 24A Bis 100-71, Bogotá D.C., representada legalmente por Brallan Mauricio Moreno Guzmán. Correo: mauricio.moreno@metrik.com.co.

**EL CLIENTE**: CENTRO DE DIAGNOSTICO AUTOMOTOR PUERTOTEST S.A.S ZOMAC, NIT 901.149.905-1, domiciliada en VDA LA DANTA CARR CENTRAL PTO ASIS PASTO, Puerto Asís (Putumayo), representada legalmente por Carlos Arnulfo Castro Quintero.

Estos Términos rigen desde su aceptación en la forma prevista en la cláusula 16 y constituyen el acuerdo completo entre las Partes sobre el Servicio.

## 0. Antecedente y continuidad

0.1. El Cliente venía accediendo a VALIDA en virtud del Contrato de Prestación de Servicios Tecnológicos de Validación en Listas Vinculantes y Restrictivas suscrito el 16 de julio de 2026 con AFI INTERNATIONAL GROUP S.A.S., terminado de mutuo acuerdo con efectos al 15 de septiembre de 2026.

0.2. VALIDA es de propiedad de METRIK. Estos Términos sustituyen ese contrato **sin interrumpir el servicio** y **respetando el plazo pactado en él**, en los términos de la cláusula 12.1.

## 1. Objeto y alcance

1.1. METRIK concede al Cliente acceso a **VALIDA**, servicio de computación en la nube para la consulta automatizada de personas naturales y jurídicas contra listas restrictivas y vinculantes utilizadas en la gestión del riesgo de LA/FT/FP (el "Servicio"), a través de su espacio de trabajo en cda-puertotest.metrikone.co.

1.2. El Servicio comprende: acceso a la plataforma, **dos (2) usuarios habilitados**, **consultas individuales ilimitadas**, **consultas masivas ilimitadas**, generación de reportes de validación, consulta de listas nacionales e internacionales aplicables al marco normativo colombiano, actualización permanente de las fuentes disponibles y soporte funcional básico.

1.3. El alcance es la consulta de listas del marco SARLAFT según el catálogo vigente publicado en la plataforma. No incluye asesoría jurídica, normativa ni tributaria, ni el diseño u operación del sistema SARLAFT/SAGRILAFT/SIPLAFT del Cliente.

1.4. El Cliente declara que contrata como empresa, para su actividad económica, y no como consumidor final (Ley 1480 de 2011).

## 2. Condiciones comerciales

2.1. **Precio.** La suscripción tiene un valor de **CIENTO CINCUENTA MIL PESOS ($150.000) mensuales**.

2.2. **Tributos.** El Servicio se factura como servicio de computación en la nube (cloud computing) **excluido del impuesto sobre las ventas**, conforme al **numeral 21 del artículo 476 del Estatuto Tributario**. El precio señalado en la cláusula 2.1 es el valor total a cargo del Cliente y no lleva IVA que sumar ni que discriminar. El soporte funcional previsto en la cláusula 1.2 es inherente al acceso al Servicio y no constituye un servicio facturado por separado. Si la autoridad tributaria determina que el Servicio se encuentra gravado, METRIK no trasladará al Cliente el impuesto correspondiente a los períodos ya facturados; para los períodos siguientes, las Partes ajustarán el precio para incorporar el tributo. (Cambio frente al contrato de AFI, que liquidaba $150.000 más IVA, esto es $178.500 al mes. Bajo estos Términos el Cliente paga $28.500 menos por mes.)

2.3. **Usuarios adicionales.** La suscripción incluye dos (2) usuarios. Cada usuario adicional tiene un valor de **CINCUENTA MIL PESOS ($50.000) mensuales**, bajo el mismo tratamiento tributario de la cláusula 2.2, y requiere solicitud expresa del Cliente.

2.4. **Forma de pago.** El pago es **mensual y anticipado, dentro de los primeros cinco (5) días calendario** de cada período de servicio. METRIK remitirá al Cliente, antes del inicio de cada período, un **enlace de pago** con la referencia del período correspondiente. METRIK expedirá factura electrónica de venta por cada período. **El primer período de servicio bajo estos Términos no inicia antes de que METRIK cuente con habilitación vigente para facturar electrónicamente; hasta entonces no se causa ni se cobra suma alguna, y el acceso del Cliente continúa sin interrupción.**

2.5. **Mora.** El incumplimiento del pago faculta a METRIK para suspender el Servicio en los términos de la cláusula 11.

## 3. Credenciales

3.1. Las credenciales de acceso son personales de cada usuario habilitado, confidenciales e intransferibles.

3.2. El Cliente responde por el uso que se haga con sus credenciales y avisará a METRIK, sin demora, de cualquier uso no autorizado.

3.3. METRIK podrá rotar, suspender o revocar credenciales ante indicios de compromiso, uso indebido o incumplimiento de estos Términos.

## 4. Licencia, uso permitido y prohibido

4.1. **Exclusividad de la licencia.** La licencia es exclusiva para CENTRO DE DIAGNOSTICO AUTOMOTOR PUERTOTEST S.A.S ZOMAC y no se extiende a empresas vinculadas, filiales, subordinadas, matrices, aliados ni terceros. Los usuarios habilitados deben pertenecer al Cliente.

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

## 11. Suspensión

11.1. METRIK podrá suspender el Servicio cuando existan obligaciones económicas vencidas **superiores a treinta (30) días calendario**, se detecte uso indebido de credenciales, se evidencie cesión de accesos a terceros o se identifiquen actividades que comprometan la seguridad de la plataforma o de la información.

## 12. Vigencia y terminación

12.1. **Plazo.** Estos Términos rigen desde su aceptación hasta el **15 de enero de 2027**, fecha en que vencía el contrato terminado con AFI, de modo que el Cliente conserva íntegro el plazo que había contratado.

12.2. **Renovación.** Vencido ese plazo, la suscripción se **renueva automáticamente por períodos mensuales**, salvo que cualquiera de las Partes avise lo contrario por escrito con **quince (15) días** de anticipación. (Cambio frente al contrato de AFI, que solo se prorrogaba por acuerdo escrito.)

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

  v_perfil record;
  v_sc uuid;
  v_doc uuid;
  v_cambios jsonb;
begin
  -- ── Guardas: abortan antes de escribir ─────────────────────────────────────
  if c_designado is null then
    raise exception '%: falta la persona designada (c_designado). Sin ella nadie puede aceptar y Valida queda cerrado para el CDA.', c_slug_ws;
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'servicios_contratados' and column_name = 'aceptante_designado_id'
  ) then
    raise exception 'Falta la migración 20260923220000_terminos_cda_designado_y_enlace_pago.sql';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'servicios_contratados' and column_name = 'terminos_plazo_hasta'
  ) then
    raise exception 'Falta la migración 20260924010000_valida_cda_plazo_terminos_y_facturas_cuota.sql';
  end if;

  select p.id, p.full_name, p.workspace_id, coalesce(p.platform_admin, false) as platform_admin
    into v_perfil
    from public.profiles p
   where p.id = c_designado;
  if not found then
    raise exception '%: el perfil designado % no existe', c_slug_ws, c_designado;
  end if;
  if v_perfil.workspace_id is distinct from c_ws_cda then
    raise exception '%: el perfil designado % (%) no está en el espacio del CDA', c_slug_ws, c_designado, v_perfil.full_name;
  end if;
  if v_perfil.platform_admin then
    raise exception '%: el soporte de MeTRIK no puede ser la persona designada', c_slug_ws;
  end if;

  if not exists (select 1 from public.workspaces w where w.id = c_ws_cda and w.slug = c_slug_ws) then
    raise exception '%: el espacio % no es el esperado', c_slug_ws, c_ws_cda;
  end if;
  if not exists (
    select 1 from public.empresas e
     where e.id = c_empresa and e.workspace_id = c_ws_metrik and e.numero_documento = c_nit
  ) then
    raise exception '%: la empresa % no está en metrik con NIT %', c_slug_ws, c_empresa, c_nit;
  end if;
  if not exists (
    select 1 from public.negocios n
     where n.id = c_negocio and n.workspace_id = c_ws_metrik and n.empresa_id = c_empresa
       and n.linea_id = c_linea_valida and n.codigo = c_codigo
  ) then
    raise exception '%: el negocio % no es el % de la línea Valida de esa empresa', c_slug_ws, c_negocio, c_codigo;
  end if;
  if not exists (select 1 from public.catalogo_servicios_versiones v where v.slug = 'valida-cda-licencia' and v.version = 1) then
    raise exception 'El catálogo no tiene valida-cda-licencia v1';
  end if;

  -- Idempotencia: una segunda corrida no duplica nada, se detiene.
  if exists (
    select 1 from public.servicios_contratados sc
     where sc.negocio_id = c_negocio and sc.servicio_slug = 'valida-cda-licencia'
  ) then
    raise exception '%: el negocio % ya tiene contrato valida-cda-licencia. Nada que hacer.', c_slug_ws, c_codigo;
  end if;
  if exists (
    select 1 from public.documentos_contractuales_versiones d
     where d.empresa_id = c_empresa and d.slug = 'terminos-suscripcion-valida-cda' and d.version = 'v1.1'
  ) then
    raise exception '%: los términos v1.1 de esta empresa ya están registrados. Nada que hacer.', c_slug_ws;
  end if;

  -- El texto que se firma es exactamente el generado: su huella lo prueba.
  if encode(sha256(convert_to(c_texto, 'UTF8')), 'hex') is distinct from c_texto_sha256 then
    raise exception '%: el texto no es el generado (huella distinta). No se editó a mano: se regenera.', c_slug_ws;
  end if;

  -- ── 1. El contrato directo con METRIK ───────────────────────────────────────
  insert into public.servicios_contratados (
    workspace_id, empresa_id, negocio_id, servicio_slug, servicio_version, parametros,
    workspace_pagador_id, correo_facturacion, estado, vigente_desde, vigente_hasta,
    comision, autorizacion_sin_poder_permitida, actualizado_por, aceptante_designado_id, terminos_plazo_hasta
  ) values (
    c_ws_metrik, c_empresa, c_negocio, 'valida-cda-licencia', 1,
    jsonb_build_object('precio_mensual', 150000, 'licencias', 2),
    c_ws_cda, c_correo, 'activo', date '2026-09-23',
    -- Sin fin: al vencer el plazo de la cláusula 12.1 (15 de enero de 2027) la suscripción se renueva mes a
    -- mes (cláusula 12.2).
    null,
    -- ⚠️ Sin comisión: que AFI siga cobrando $50.000 por licencia después de la terminación no está
    -- decidido. Si se decide que sí, va en esta columna, con el MISMO criterio de 4D SOFT:
    --   jsonb_build_object('modo', 'monto_fijo', 'monto_fijo', 50000, 'base', 'cada_cobro',
    --     'beneficiario_empresa_id', 'ecc378c7-10c4-4984-a31d-5533a598ad71', 'beneficiario_nit', '902003244-6')
    null,
    false, c_registrado_por, c_designado, c_plazo_terminos
  )
  returning id into v_sc;

  insert into public.servicio_contratado_beneficiarios (servicio_contratado_id, workspace_id)
  values (v_sc, c_ws_cda);

  insert into public.servicios_contratados_cambios (servicio_contratado_id, campo, valor_anterior, valor_nuevo, motivo, registrado_por)
  values (
    v_sc, 'alta', null,
    jsonb_build_object(
      'parametros', jsonb_build_object('precio_mensual', 150000, 'licencias', 2),
      'workspace_pagador_id', c_ws_cda,
      'aceptante_designado_id', c_designado,
      'aceptante_designado_nombre', v_perfil.full_name,
      'terminos_plazo_hasta', c_plazo_terminos,
      'comision', null
    ),
    'Alta del contrato directo de CENTRO DE DIAGNOSTICO AUTOMOTOR PUERTOTEST S.A.S ZOMAC con METRIK IA S.A.S. al terminar el contrato AFI-CDA (efectos al 15 de septiembre de 2026). Términos de Suscripción VALIDA · Licencia CDA v1.1; $150.000 mensuales sin IVA (art. 476 num. 21 ET), ciclo del 23 al 22.',
    c_registrado_por
  );

  -- ── 2. El módulo, con su contrato (la proyección no cambia: Valida ya está encendido) ──
  if not exists (
    select 1 from public.workspace_modulos m
     where m.workspace_id = c_ws_cda and m.modulo = 'valida_consulta'
       and (m.activo_hasta is null or m.activo_hasta > now())
  ) then
    insert into public.workspace_modulos (workspace_id, modulo, origen, servicio_contratado_id, activo_desde, motivo, registrado_por)
    values (c_ws_cda, 'valida_consulta', 'servicio', v_sc, now(), 'Contrato valida-cda-licencia v1 de CENTRO DE DIAGNOSTICO AUTOMOTOR PUERTOTEST S.A.S ZOMAC (negocio C3 26 1): licencia directa con METRIK desde el 2026-09-23.', c_registrado_por);
  end if;

  -- ── 3. Los términos v1.1 de esta empresa ───────────────────────────────────
  insert into public.documentos_contractuales_versiones (
    workspace_id, linea_id, slug, alcance, empresa_id, titulo, version,
    texto_md, texto_sha256, pdf_bucket, pdf_path, pdf_sha256, vigente_desde, vigente_hasta, registrado_por
  ) values (
    c_ws_metrik, c_linea_valida, 'terminos-suscripcion-valida-cda', 'cliente', c_empresa,
    'Términos de Suscripción VALIDA · Licencia CDA', 'v1.1',
    c_texto, c_texto_sha256, 'aceptaciones-documentos', c_pdf_path, c_pdf_sha256, date '2026-09-23', null, c_registrado_por
  )
  returning id into v_doc;

  -- ── Comprobaciones antes de soltar la transacción ──────────────────────────
  v_cambios := public.proyectar_modulos(c_ws_cda) -> 'cambios';
  if jsonb_array_length(v_cambios) > 0 then
    raise exception '%: la proyección de módulos cambiaría el espacio: %', c_slug_ws, v_cambios;
  end if;
  if (select count(*) from public.servicios_contratados sc
       join public.catalogo_servicios cs on cs.slug = sc.servicio_slug
      where cs.modulo = 'valida_consulta' and sc.workspace_pagador_id = c_ws_cda) <> 1 then
    raise exception '%: el espacio no quedó con exactamente un contrato de Valida', c_slug_ws;
  end if;

  if c_ensayo then
    raise exception 'ENSAYO OK %: contrato %, términos %, designada % (%). Nada quedó escrito.',
      c_slug_ws, v_sc, v_doc, v_perfil.full_name, c_designado;
  end if;
  raise notice 'CARGA OK %: contrato %, términos %, designada % (%)',
    c_slug_ws, v_sc, v_doc, v_perfil.full_name, c_designado;
end;
$bloque$;


-- ────────────────────────────────────────────────────────────────────────────
-- M2 26 1 · CENTRO DE DIAGNOSTICO AUTOMOTOR MAXITEC S.A.S. · espacio `maxitec`
--
-- ⚠️ Persona designada: la nombra la empresa (representante legal o apoderado con poder). Perfiles
-- del espacio hoy: c66b9846-b3ba-4ee6-807c-9978bb70186b «Jairo Enrique Peña Bernal» (owner), que es el representante legal que nombran los términos, y 8b4a2cf8-6a7f-4580-a835-5710b9dd2332 «Andry Tatiana Cardoso Aldana» (operator).
-- ────────────────────────────────────────────────────────────────────────────
do $bloque$
declare
  -- ⚠️ true = ENSAYO: inserta, comprueba y deshace todo con RAISE EXCEPTION 'ENSAYO OK …'.
  --    Solo con la persona designada confirmada se cambia a false.
  c_ensayo constant boolean := true;
  -- ⚠️ profiles.id de quien acepta por la empresa, EN el espacio de este CDA. Sin él, no corre.
  c_designado constant uuid := null;
  -- Último día (inclusive) en que el CDA consulta sin la aceptación. null = se cierra al cargar.
  c_plazo_terminos constant date := date '2026-09-30';

  c_ws_metrik      constant uuid := 'a21bfc88-1a60-48c3-afcd-144226aa2392';
  c_linea_valida   constant uuid := '7d9f8994-a843-4032-a632-a6286ec61d94';
  c_registrado_por constant uuid := 'cc6f6100-4eb7-4eed-9a7c-096729f5cedf';  -- Mauricio (platform admin)
  c_ws_cda         constant uuid := '962df864-4dd8-44ba-aac0-bf994f391931';
  c_slug_ws        constant text := 'maxitec';
  c_empresa        constant uuid := '069cbc29-ed49-4e0c-b803-f2497440a5f2';
  c_nit            constant text := '900158425-0';
  c_negocio        constant uuid := '717b2c2c-c265-4cb3-a483-3383b104a412';
  c_codigo         constant text := 'M2 26 1';
  c_correo         constant text := 'maxitec.ingeniero@gmail.com';
  c_texto_sha256   constant text := '8265e3905c186628c949e1ca826924a291f628b2443e2480fab1c412ffb40f21';
  c_pdf_sha256     constant text := '10b1bd2335873c0fa19526ddeefd4cdd8d7274a67f590e87d0e64b967ed60339';
  c_pdf_path       constant text := 'maxitec/terminos-suscripcion-valida-cda-v1.1.pdf';
  c_texto constant text := $texto$# TÉRMINOS DE SUSCRIPCIÓN VALIDA · LICENCIA CDA v1.1

**METRIK**: METRIK IA S.A.S., NIT 902.079.601-9, domiciliada en la Calle 24A Bis 100-71, Bogotá D.C., representada legalmente por Brallan Mauricio Moreno Guzmán. Correo: mauricio.moreno@metrik.com.co.

**EL CLIENTE**: CENTRO DE DIAGNOSTICO AUTOMOTOR MAXITEC S.A.S., NIT 900.158.425-0, domiciliada en CL 5 A 10 06 38 CR 10 5 A 11 31 CR 10 A 5 A 31, Florencia (Caquetá), representada legalmente por Jairo Enrique Peña Bernal.

Estos Términos rigen desde su aceptación en la forma prevista en la cláusula 16 y constituyen el acuerdo completo entre las Partes sobre el Servicio.

## 0. Antecedente y continuidad

0.1. El Cliente venía accediendo a VALIDA en virtud del Contrato de Prestación de Servicios Tecnológicos de Validación en Listas Vinculantes y Restrictivas suscrito el 22 de junio de 2026 con AFI INTERNATIONAL GROUP S.A.S., terminado de mutuo acuerdo con efectos al 21 de septiembre de 2026.

0.2. VALIDA es de propiedad de METRIK. Estos Términos sustituyen ese contrato **sin interrumpir el servicio** y **respetando el plazo pactado en él**, en los términos de la cláusula 12.1.

## 1. Objeto y alcance

1.1. METRIK concede al Cliente acceso a **VALIDA**, servicio de computación en la nube para la consulta automatizada de personas naturales y jurídicas contra listas restrictivas y vinculantes utilizadas en la gestión del riesgo de LA/FT/FP (el "Servicio"), a través de su espacio de trabajo en maxitec.metrikone.co.

1.2. El Servicio comprende: acceso a la plataforma, **dos (2) usuarios habilitados**, **consultas individuales ilimitadas**, **consultas masivas ilimitadas**, generación de reportes de validación, consulta de listas nacionales e internacionales aplicables al marco normativo colombiano, actualización permanente de las fuentes disponibles y soporte funcional básico.

1.3. El alcance es la consulta de listas del marco SARLAFT según el catálogo vigente publicado en la plataforma. No incluye asesoría jurídica, normativa ni tributaria, ni el diseño u operación del sistema SARLAFT/SAGRILAFT/SIPLAFT del Cliente.

1.4. El Cliente declara que contrata como empresa, para su actividad económica, y no como consumidor final (Ley 1480 de 2011).

## 2. Condiciones comerciales

2.1. **Precio.** La suscripción tiene un valor de **CIENTO CINCUENTA MIL PESOS ($150.000) mensuales**.

2.2. **Tributos.** El Servicio se factura como servicio de computación en la nube (cloud computing) **excluido del impuesto sobre las ventas**, conforme al **numeral 21 del artículo 476 del Estatuto Tributario**. El precio señalado en la cláusula 2.1 es el valor total a cargo del Cliente y no lleva IVA que sumar ni que discriminar. El soporte funcional previsto en la cláusula 1.2 es inherente al acceso al Servicio y no constituye un servicio facturado por separado. Si la autoridad tributaria determina que el Servicio se encuentra gravado, METRIK no trasladará al Cliente el impuesto correspondiente a los períodos ya facturados; para los períodos siguientes, las Partes ajustarán el precio para incorporar el tributo. (Cambio frente al contrato de AFI, que liquidaba $150.000 más IVA, esto es $178.500 al mes. Bajo estos Términos el Cliente paga $28.500 menos por mes.)

2.3. **Usuarios adicionales.** La suscripción incluye dos (2) usuarios. Cada usuario adicional tiene un valor de **CINCUENTA MIL PESOS ($50.000) mensuales**, bajo el mismo tratamiento tributario de la cláusula 2.2, y requiere solicitud expresa del Cliente.

2.4. **Forma de pago.** El pago es **mensual y anticipado, dentro de los primeros cinco (5) días calendario** de cada período de servicio. METRIK remitirá al Cliente, antes del inicio de cada período, un **enlace de pago** con la referencia del período correspondiente. METRIK expedirá factura electrónica de venta por cada período. **El primer período de servicio bajo estos Términos no inicia antes de que METRIK cuente con habilitación vigente para facturar electrónicamente; hasta entonces no se causa ni se cobra suma alguna, y el acceso del Cliente continúa sin interrupción.**

2.5. **Mora.** El incumplimiento del pago faculta a METRIK para suspender el Servicio en los términos de la cláusula 11.

## 3. Credenciales

3.1. Las credenciales de acceso son personales de cada usuario habilitado, confidenciales e intransferibles.

3.2. El Cliente responde por el uso que se haga con sus credenciales y avisará a METRIK, sin demora, de cualquier uso no autorizado.

3.3. METRIK podrá rotar, suspender o revocar credenciales ante indicios de compromiso, uso indebido o incumplimiento de estos Términos.

## 4. Licencia, uso permitido y prohibido

4.1. **Exclusividad de la licencia.** La licencia es exclusiva para CENTRO DE DIAGNOSTICO AUTOMOTOR MAXITEC S.A.S. y no se extiende a empresas vinculadas, filiales, subordinadas, matrices, aliados ni terceros. Los usuarios habilitados deben pertenecer al Cliente.

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

## 11. Suspensión

11.1. METRIK podrá suspender el Servicio cuando existan obligaciones económicas vencidas **superiores a treinta (30) días calendario**, se detecte uso indebido de credenciales, se evidencie cesión de accesos a terceros o se identifiquen actividades que comprometan la seguridad de la plataforma o de la información.

## 12. Vigencia y terminación

12.1. **Plazo.** Estos Términos rigen desde su aceptación hasta el **21 de diciembre de 2026**, fecha en que vencía el contrato terminado con AFI, de modo que el Cliente conserva íntegro el plazo que había contratado.

12.2. **Renovación.** Vencido ese plazo, la suscripción se **renueva automáticamente por períodos mensuales**, salvo que cualquiera de las Partes avise lo contrario por escrito con **quince (15) días** de anticipación. (Cambio frente al contrato de AFI, que solo se prorrogaba por acuerdo escrito.)

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

  v_perfil record;
  v_sc uuid;
  v_doc uuid;
  v_cambios jsonb;
begin
  -- ── Guardas: abortan antes de escribir ─────────────────────────────────────
  if c_designado is null then
    raise exception '%: falta la persona designada (c_designado). Sin ella nadie puede aceptar y Valida queda cerrado para el CDA.', c_slug_ws;
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'servicios_contratados' and column_name = 'aceptante_designado_id'
  ) then
    raise exception 'Falta la migración 20260923220000_terminos_cda_designado_y_enlace_pago.sql';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'servicios_contratados' and column_name = 'terminos_plazo_hasta'
  ) then
    raise exception 'Falta la migración 20260924010000_valida_cda_plazo_terminos_y_facturas_cuota.sql';
  end if;

  select p.id, p.full_name, p.workspace_id, coalesce(p.platform_admin, false) as platform_admin
    into v_perfil
    from public.profiles p
   where p.id = c_designado;
  if not found then
    raise exception '%: el perfil designado % no existe', c_slug_ws, c_designado;
  end if;
  if v_perfil.workspace_id is distinct from c_ws_cda then
    raise exception '%: el perfil designado % (%) no está en el espacio del CDA', c_slug_ws, c_designado, v_perfil.full_name;
  end if;
  if v_perfil.platform_admin then
    raise exception '%: el soporte de MeTRIK no puede ser la persona designada', c_slug_ws;
  end if;

  if not exists (select 1 from public.workspaces w where w.id = c_ws_cda and w.slug = c_slug_ws) then
    raise exception '%: el espacio % no es el esperado', c_slug_ws, c_ws_cda;
  end if;
  if not exists (
    select 1 from public.empresas e
     where e.id = c_empresa and e.workspace_id = c_ws_metrik and e.numero_documento = c_nit
  ) then
    raise exception '%: la empresa % no está en metrik con NIT %', c_slug_ws, c_empresa, c_nit;
  end if;
  if not exists (
    select 1 from public.negocios n
     where n.id = c_negocio and n.workspace_id = c_ws_metrik and n.empresa_id = c_empresa
       and n.linea_id = c_linea_valida and n.codigo = c_codigo
  ) then
    raise exception '%: el negocio % no es el % de la línea Valida de esa empresa', c_slug_ws, c_negocio, c_codigo;
  end if;
  if not exists (select 1 from public.catalogo_servicios_versiones v where v.slug = 'valida-cda-licencia' and v.version = 1) then
    raise exception 'El catálogo no tiene valida-cda-licencia v1';
  end if;

  -- Idempotencia: una segunda corrida no duplica nada, se detiene.
  if exists (
    select 1 from public.servicios_contratados sc
     where sc.negocio_id = c_negocio and sc.servicio_slug = 'valida-cda-licencia'
  ) then
    raise exception '%: el negocio % ya tiene contrato valida-cda-licencia. Nada que hacer.', c_slug_ws, c_codigo;
  end if;
  if exists (
    select 1 from public.documentos_contractuales_versiones d
     where d.empresa_id = c_empresa and d.slug = 'terminos-suscripcion-valida-cda' and d.version = 'v1.1'
  ) then
    raise exception '%: los términos v1.1 de esta empresa ya están registrados. Nada que hacer.', c_slug_ws;
  end if;

  -- El texto que se firma es exactamente el generado: su huella lo prueba.
  if encode(sha256(convert_to(c_texto, 'UTF8')), 'hex') is distinct from c_texto_sha256 then
    raise exception '%: el texto no es el generado (huella distinta). No se editó a mano: se regenera.', c_slug_ws;
  end if;

  -- ── 1. El contrato directo con METRIK ───────────────────────────────────────
  insert into public.servicios_contratados (
    workspace_id, empresa_id, negocio_id, servicio_slug, servicio_version, parametros,
    workspace_pagador_id, correo_facturacion, estado, vigente_desde, vigente_hasta,
    comision, autorizacion_sin_poder_permitida, actualizado_por, aceptante_designado_id, terminos_plazo_hasta
  ) values (
    c_ws_metrik, c_empresa, c_negocio, 'valida-cda-licencia', 1,
    jsonb_build_object('precio_mensual', 150000, 'licencias', 2),
    c_ws_cda, c_correo, 'activo', date '2026-09-23',
    -- Sin fin: al vencer el plazo de la cláusula 12.1 (21 de diciembre de 2026) la suscripción se renueva mes a
    -- mes (cláusula 12.2).
    null,
    -- ⚠️ Sin comisión: que AFI siga cobrando $50.000 por licencia después de la terminación no está
    -- decidido. Si se decide que sí, va en esta columna, con el MISMO criterio de 4D SOFT:
    --   jsonb_build_object('modo', 'monto_fijo', 'monto_fijo', 50000, 'base', 'cada_cobro',
    --     'beneficiario_empresa_id', 'ecc378c7-10c4-4984-a31d-5533a598ad71', 'beneficiario_nit', '902003244-6')
    null,
    false, c_registrado_por, c_designado, c_plazo_terminos
  )
  returning id into v_sc;

  insert into public.servicio_contratado_beneficiarios (servicio_contratado_id, workspace_id)
  values (v_sc, c_ws_cda);

  insert into public.servicios_contratados_cambios (servicio_contratado_id, campo, valor_anterior, valor_nuevo, motivo, registrado_por)
  values (
    v_sc, 'alta', null,
    jsonb_build_object(
      'parametros', jsonb_build_object('precio_mensual', 150000, 'licencias', 2),
      'workspace_pagador_id', c_ws_cda,
      'aceptante_designado_id', c_designado,
      'aceptante_designado_nombre', v_perfil.full_name,
      'terminos_plazo_hasta', c_plazo_terminos,
      'comision', null
    ),
    'Alta del contrato directo de CENTRO DE DIAGNOSTICO AUTOMOTOR MAXITEC S.A.S. con METRIK IA S.A.S. al terminar el contrato AFI-CDA (efectos al 21 de septiembre de 2026). Términos de Suscripción VALIDA · Licencia CDA v1.1; $150.000 mensuales sin IVA (art. 476 num. 21 ET), ciclo del 23 al 22.',
    c_registrado_por
  );

  -- ── 2. El módulo, con su contrato (la proyección no cambia: Valida ya está encendido) ──
  if not exists (
    select 1 from public.workspace_modulos m
     where m.workspace_id = c_ws_cda and m.modulo = 'valida_consulta'
       and (m.activo_hasta is null or m.activo_hasta > now())
  ) then
    insert into public.workspace_modulos (workspace_id, modulo, origen, servicio_contratado_id, activo_desde, motivo, registrado_por)
    values (c_ws_cda, 'valida_consulta', 'servicio', v_sc, now(), 'Contrato valida-cda-licencia v1 de CENTRO DE DIAGNOSTICO AUTOMOTOR MAXITEC S.A.S. (negocio M2 26 1): licencia directa con METRIK desde el 2026-09-23.', c_registrado_por);
  end if;

  -- ── 3. Los términos v1.1 de esta empresa ───────────────────────────────────
  insert into public.documentos_contractuales_versiones (
    workspace_id, linea_id, slug, alcance, empresa_id, titulo, version,
    texto_md, texto_sha256, pdf_bucket, pdf_path, pdf_sha256, vigente_desde, vigente_hasta, registrado_por
  ) values (
    c_ws_metrik, c_linea_valida, 'terminos-suscripcion-valida-cda', 'cliente', c_empresa,
    'Términos de Suscripción VALIDA · Licencia CDA', 'v1.1',
    c_texto, c_texto_sha256, 'aceptaciones-documentos', c_pdf_path, c_pdf_sha256, date '2026-09-23', null, c_registrado_por
  )
  returning id into v_doc;

  -- ── Comprobaciones antes de soltar la transacción ──────────────────────────
  v_cambios := public.proyectar_modulos(c_ws_cda) -> 'cambios';
  if jsonb_array_length(v_cambios) > 0 then
    raise exception '%: la proyección de módulos cambiaría el espacio: %', c_slug_ws, v_cambios;
  end if;
  if (select count(*) from public.servicios_contratados sc
       join public.catalogo_servicios cs on cs.slug = sc.servicio_slug
      where cs.modulo = 'valida_consulta' and sc.workspace_pagador_id = c_ws_cda) <> 1 then
    raise exception '%: el espacio no quedó con exactamente un contrato de Valida', c_slug_ws;
  end if;

  if c_ensayo then
    raise exception 'ENSAYO OK %: contrato %, términos %, designada % (%). Nada quedó escrito.',
      c_slug_ws, v_sc, v_doc, v_perfil.full_name, c_designado;
  end if;
  raise notice 'CARGA OK %: contrato %, términos %, designada % (%)',
    c_slug_ws, v_sc, v_doc, v_perfil.full_name, c_designado;
end;
$bloque$;
