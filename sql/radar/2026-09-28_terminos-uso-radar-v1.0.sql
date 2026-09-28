-- ============================================================
-- 2026-09-28 — Publicación de `terminos-uso-radar` v1.0 (Radar SECOP)
--
-- ⚠️ PROPUESTA. NO APLICADA. Escribe UNA fila de datos en producción.
--
-- Documento aprobado y cerrado por Emilio Castañeda (CLO) el 2026-09-28
-- (proyectos/metrik/legal/terminos-uso-radar-v1.0.md). El texto de abajo es su TEXTO CANÓNICO,
-- generado —junto con el PDF y las dos huellas— por
-- proyectos/metrik/legal/terminos-radar-v1.0/_generador/generar.py. No se edita a mano: se
-- regenera, o el PDF y la pantalla dejan de decir lo mismo.
--
-- ## Antes de correr esto hay que subir el PDF
--
-- El archivo `aceptaciones-documentos/metrik/terminos-uso-radar-v1.0.pdf` (60.912 bytes,
-- sha256 3682b406d8c072c517295596d432a67cfeae6c8ba2c39fc5e5c68eaba94869b4) tiene que existir en el bucket ANTES,
-- porque `pdf_sha256` es la llave con la que una aceptación se ata a lo aceptado
-- (`aceptaciones_terminos.documento_sha256 = pdf_sha256`) y la pestaña de términos entrega ESE
-- archivo. Una fila que apunte a un objeto que no está deja al cliente sin su copia.
--
-- ## ⚠️⚠️ Con esta fila SOLA el gate del Radar todavía NO abre
--
-- Medido el 2026-09-28 contra origin/main (b0ee9074): el mecanismo de Valida solo sabe de
-- documentos de alcance 'cliente', o sea con `empresa_id`. Un documento 'plantilla' —y este lo es,
-- porque su texto no lleva datos de ningún cliente— queda invisible y no se puede aceptar, en
-- TRES lugares:
--
--   1. `mis_documentos_de_servicio()` (20260916213000): `join mios m on m.empresa_id = d.empresa_id`
--      es un join interno; con `empresa_id` nulo el documento nunca sale.
--   2. `aceptaciones_terminos_modulo()` (20260923220000, paso 2): exige un contrato con
--      `sc.empresa_id = v_doc.empresa_id`; con nulo levanta excepción.
--   3. `versionContratada()` (src/lib/valida-api/terminos-servidor.ts): `if (!v?.empresa_id) return null`.
--
-- Registrar la fila igual es correcto y es inocuo (la tabla es server-only, sin grants, y la
-- versión es inmutable por trigger: se registra una vez y no se reescribe). Lo que falta es que
-- esos tres puntos aprendan el alcance 'plantilla', que hoy no tiene NI UNA fila en producción.
-- Ir por el otro camino —registrarlo como 'cliente' por empresa— no sirve: `pdf_sha256` es UNIQUE
-- y el PDF es el mismo para todos, así que el segundo cliente del Radar no podría registrarse.
--
-- ## Verificación después de aplicar (solo lectura)
--
--   select slug, version, alcance, empresa_id, vigente_desde, pdf_sha256,
--          encode(sha256(convert_to(texto_md, 'UTF8')), 'hex') = texto_sha256 as texto_cuadra
--     from public.documentos_contractuales_versiones where slug = 'terminos-uso-radar';
--     -> 1 fila, alcance 'plantilla', empresa_id null, texto_cuadra = true
-- ============================================================

insert into public.documentos_contractuales_versiones (
  workspace_id, linea_id, slug, alcance, empresa_id, titulo, version,
  texto_md, texto_sha256, pdf_bucket, pdf_path, pdf_sha256, vigente_desde, registrado_por
) values (
  'a21bfc88-1a60-48c3-afcd-144226aa2392',   -- workspace metrik (el cobrador; el documento es de MeTRIK)
  '139b19bc-4d58-468a-85ed-c3a941ed7e12',   -- linea ONE: el Radar es un modulo de MeTRIK ONE
  'terminos-uso-radar',
  'plantilla',                               -- el texto no lleva datos de ningun cliente
  null,
  'Términos de Uso — Radar SECOP',
  '1.0',
  '# Términos de Uso — Radar SECOP

**Documento:** terminos-uso-radar · **Versión:** 1.0 · **Rige desde:** 2026-09-28
**Servicio:** Radar SECOP, módulo de MéTRIK ONE
**Prestador:** METRIK IA S.A.S., NIT 902.079.601-9, Bogotá D.C., Colombia
**Contacto:** mauricio.moreno@metrik.com.co · +57 315 950 9103

Estos Términos se aceptan dentro de MéTRIK ONE, al entrar al módulo. Complementan los Términos de Adhesión de MéTRIK ONE y la Política de Tratamiento de Datos de MéTRIK ONE. En lo que no se contradigan, aplican los tres.

## 1. Qué es el Radar SECOP

El Radar SECOP muestra, ordenados por afinidad con los temas que el Cliente configura, los procesos de contratación pública publicados por las entidades del Estado colombiano en el SECOP II. Es una **herramienta de priorización de información pública**.

## 2. De dónde sale la información

Toda la información proviene del dato abierto publicado por el Estado: el conjunto de datos de procesos de contratación del SECOP II, alojado en el portal de datos abiertos del Gobierno Nacional (datos.gov.co). MéTRIK no produce ese dato, no lo corrige y no lo controla.

En consecuencia, MéTRIK **no garantiza**:

- que el conjunto esté completo — si la entidad no publicó un proceso, el Radar no lo puede mostrar;

- que esté actualizado al minuto — la sincronización es diaria y la entidad puede modificar fechas, valores, modalidad o estado después de publicar;

- que los valores, plazos o modalidades mostrados coincidan con los del pliego. **El pliego y la plataforma del SECOP II son la única fuente válida** para tomar decisiones y para presentar una oferta.

## 3. Qué significa —y qué no significa— el puntaje de afinidad

El Radar asigna a cada proceso un puntaje ("fit") calculado sobre los temas y pesos que el Cliente configuró. Ese puntaje:

- es un **orden de lectura**, no una recomendación;

- **no** es un concepto jurídico, ni una asesoría en contratación estatal, ni una verificación de que el Cliente cumple los requisitos habilitantes del proceso;

- **no** evalúa el RUP del Cliente, su capacidad financiera, su experiencia acreditada, ni su aptitud para el objeto contractual.

Un proceso con puntaje alto puede ser inconveniente o inalcanzable para el Cliente, y un proceso con puntaje bajo o sin puntaje puede ser una oportunidad real. La decisión es siempre del Cliente.

## 4. Lo que hace el Cliente

El Cliente es el único responsable de:

- leer el pliego y los anexos completos antes de decidir;

- verificar plazos, modalidad, requisitos habilitantes y su inscripción en el RUP;

- **presentar la oferta** en la plataforma del SECOP II, dentro del término y con los documentos que la entidad exija;

- cualquier obligación que adquiera frente a la entidad contratante.

MéTRIK **no presenta ofertas** a nombre del Cliente, no radica documentos, no lo representa ante las entidades y no interviene en el proceso contractual.

## 5. Sin garantía de resultado y sin éxito compartido

La suscripción da acceso a la herramienta. **No** garantiza que el Cliente encuentre procesos afines, que resulte habilitado, ni que le sea adjudicado ningún contrato. MéTRIK **no cobra comisión, participación ni honorario de éxito** sobre contratos que el Cliente obtenga; la contraprestación es exclusivamente la suscripción mensual pactada.

## 6. Período de prueba: 5 días desde esta aceptación

El Radar abre con un **período de prueba de cinco (5) días calendario, contados desde la fecha y hora en que el Cliente acepta estos Términos**, sin costo y sin obligación de continuar.

- Durante la prueba el Cliente usa el módulo completo.

- Al vencer la prueba, para continuar usándolo el Cliente **paga la primera cuota** por el enlace de pago que MéTRIK ONE le envía y que también está disponible dentro de la plataforma.

- **Si la primera cuota no se paga, el módulo se cierra.** El Cliente conserva en pantalla el enlace de pago y, con él, la posibilidad de abrirlo en cualquier momento. Esto no es una sanción por mora: es que **el pago de la primera cuota es la condición de entrega del servicio**, y antes de ese pago no hay servicio entregado que retirar.

- La configuración del Cliente (sus temas, pesos, exclusiones y procesos marcados) **se conserva al menos sesenta (60) días** desde el cierre y el Cliente puede pedir una copia por escrito a la dirección de contacto de estos Términos. El pago del enlace la reactiva tal como quedó.

## 7. Suscripción, precio y pago

- Suscripción **mensual, de renovación automática**, cancelable por el Cliente en cualquier momento con efecto al final del ciclo en curso. La cancelación no da derecho a devolución del ciclo ya pagado.

- **Precio de lista vigente: $20.000 por mes.** El precio aplicable al Cliente es el que se muestra en la pantalla de aceptación y en el enlace de pago, y consta en su contrato u orden de suscripción; puede ser inferior al de lista si se pactó un descuento.

- **Un cambio de precio requiere aviso escrito con treinta (30) días de anticipación** y solo aplica desde el ciclo siguiente. El Cliente puede cancelar antes de que rija.

- **Sin IVA.** El acceso recurrente a una plataforma en la nube está **excluido del impuesto sobre las ventas** conforme al art. 476 del Estatuto Tributario. El precio indicado es el total que paga el Cliente, sin IVA que sumar ni discriminar.

- **Si la autoridad tributaria desconociera esta exclusión, METRIK IA S.A.S. asume el IVA y cualquier mayor valor, sanción o interés asociado, sin trasladarlo al Cliente.**

- Cada cuota es **anticipada** y habilita el mes de uso.

- **Autorización de pago recurrente.** Al aceptar estos Términos y pagar la primera cuota, el Cliente autoriza a MéTRIK a generar el cobro de cada ciclo por el medio de pago que registró y a enviarle el enlace correspondiente. El Cliente puede revocar esta autorización cancelando la suscripción, con el efecto de la primera viñeta.

## 8. Qué pasa si una cuota posterior se vence

Una vez pagada la primera cuota, el impago de una cuota posterior **no cierra el acceso**:

- **Del vencimiento al día 5:** Acceso normal. Período de gracia, con aviso escrito

- **Desde el día 6:** **Solo lectura**, en los términos del párrafo siguiente

- **Nunca:** Bloqueo total del acceso

**Qué significa solo lectura en el Radar.** El Cliente sigue viendo **la totalidad de los procesos vigentes**, tal como los publica el Estado, y sigue viendo su configuración, que además puede exportar. Lo que queda suspendido es la priorización: no puede aplicar sus temas, pesos ni exclusiones, no puede filtrar ni ordenar por afinidad, no puede seguir ni ocultar procesos, y no puede editar su perfil. En el Radar, **priorizar es operar**: es eso lo que se suspende, no el acceso a la información.

La información que el Cliente construyó dentro del módulo es suya. MéTRIK no la retiene como palanca de cobro ni la elimina por mora. El recibo del pago restablece la operación tal como estaba y no perdona las cuotas causadas.

## 9. Datos del Cliente y datos de los procesos

Los temas, pesos, exclusiones y procesos marcados como seguidos son del Cliente y viven en su espacio de trabajo. El tratamiento se rige por la **Política de Tratamiento de Datos de MéTRIK ONE**, conforme a la Ley 1581 de 2012 y el Decreto 1377 de 2013.

El Radar **no está destinado a tratar datos personales de terceros**: la información de los procesos es pública y de entidades estatales. Si un dato público publicado por la entidad contiene de forma incidental datos de una persona natural (por ejemplo, el nombre de un contratista), ese dato se trata únicamente para mostrar el proceso tal como la entidad lo publicó, bajo la misma Política y sin cruzarlo con otras fuentes.

## 10. Disponibilidad y límites

La herramienta se presta **según disponibilidad**, sin garantía de operación ininterrumpida.

- **Indisponibilidad relevante** es la del módulo, imputable a MéTRIK, que supere **veinticuatro (24) horas continuas** o **cuarenta y ocho (48) horas acumuladas dentro de un mismo mes calendario**, contadas desde el aviso del Cliente a la dirección de contacto de estos Términos.

- Cuando ocurre, MéTRIK **descuenta 1/30 de la cuota del mes por cada día completo de indisponibilidad**, aplicado en el ciclo siguiente. **El descuento tiene como tope la cuota del mes afectado** y es el único remedio: no hay indemnización adicional, lucro cesante ni responsabilidad por oportunidades no vistas.

- **No cuentan como indisponibilidad relevante**: la interrupción del portal de datos abiertos del Estado o de su API, el mantenimiento anunciado con al menos veinticuatro (24) horas de anticipación, ni las fallas de la conexión o de los equipos del Cliente.

- **Si la fuente pública estuviera indisponible más de diez (10) días continuos**, el Cliente puede pedir por escrito la suspensión de la suscripción, sin cobro, hasta que la fuente vuelva.

## 11. Quién acepta y cómo queda la constancia

Estos Términos los acepta, a nombre del Cliente, el **representante legal** o un **apoderado** designado por él, y MéTRIK ONE registra en qué calidad lo hizo. Quien acepta declara tener facultades para obligar al Cliente. El pago de la primera cuota ratifica lo aceptado.

Al aceptar dentro de MéTRIK ONE, el Cliente declara que leyó estos Términos y que entiende en particular las cláusulas **2, 3, 4, 5, 6 y 8**. La aceptación queda registrada con fecha y hora, usuario, calidad en que actúa, versión del documento y su huella criptográfica (SHA-256), junto con la del texto del aviso mostrado en pantalla. Esa constancia es la prueba de lo aceptado y el Cliente puede pedir copia.

Una versión nueva de estos Términos se avisa con treinta (30) días de anticipación y se acepta de nuevo dentro de la plataforma; mientras no se acepte, rige la versión vigente al momento de la aceptación anterior.

## 12. Ley aplicable y controversias

Estos Términos se rigen por la ley colombiana. Las controversias se intentarán resolver directamente entre las partes dentro de los quince (15) días hábiles siguientes al aviso escrito de una a la otra; de no lograrse, se someterán a los jueces competentes de Bogotá D.C.

Las comunicaciones se entienden válidas en las direcciones de correo electrónico que cada parte registró en MéTRIK ONE.',
  'dbb05f3e0a3da57462c283eecba157af39246b99bbd4e4ebd7ea7cbc467cb5d2',
  'aceptaciones-documentos',
  'metrik/terminos-uso-radar-v1.0.pdf',
  '3682b406d8c072c517295596d432a67cfeae6c8ba2c39fc5e5c68eaba94869b4',
  '2026-09-28',
  'cc6f6100-4eb7-4eed-9a7c-096729f5cedf'    -- Mauricio Moreno, igual que las versiones de Valida
)
-- Idempotente por la huella del PDF, no por (workspace, slug, versión, empresa): con
-- `empresa_id` nulo ese UNIQUE no compara igual (dos NULL son distintos en Postgres) y una
-- segunda corrida insertaría una fila más. `pdf_sha256` sí es UNIQUE de verdad.
on conflict (pdf_sha256) do nothing;
