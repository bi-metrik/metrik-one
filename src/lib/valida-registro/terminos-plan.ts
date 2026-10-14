/**
 * Los Términos de Uso de VALIDA, variante Autoservicio, v2.0: los que acepta EN EL REGISTRO una
 * empresa que se registra sola en `/valida/empezar` con tarjeta (casilla v1.2; Términos 16.2: «Los
 * acepta, en nombre del Cliente, la persona que marca la casilla del registro»). Puro: lo importan la
 * pantalla del registro y el servidor; la huella la calcula el servidor (`node:crypto`).
 *
 * ## De dónde sale el texto
 *
 * `proyectos/metrik/valida/docs/legal/terminos-valida-v2.0-autoservicio.md` (Emilio, 2026-10-12;
 * APROBADO CON CAMBIOS por Vera en `vera-terminos-autoservicio.md`), copiado TAL CUAL desde el título
 * hasta la cláusula 16.6 (antes de `<!-- FIN-PDF -->`; las secciones A a D no van al cliente). Lo
 * único que cambia frente al archivo, y nada más:
 *   1. se quitan las marcas `[Δn]` (convención del propio archivo: «Max las quita antes de calcular
 *      la huella»);
 *   2. `{N}` (cláusulas 3.6 y 11.1) es 10: decisión P de Mauricio, 2026-10-14, igual a
 *      `DIAS_GRACIA_CICLO` de `plan.ts`;
 *   3. el campo `{recomendado_afi: sí o no, según lo que marcó el Cliente en el registro}` pasa a
 *      `{recomendado_afi}`: lo que estaba dentro de la llave era la instrucción de cómo llenarlo
 *      («sí» o «no», según la respuesta del registro), no texto del contrato.
 * Si el archivo cambia una letra, se vuelve a copiar y se sube `version`: la prueba fija la huella
 * de la Parte II (`terminos-plan.test.ts`).
 *
 * ## Dos partes, como el documento
 *
 *   - **Parte I, la Orden** (`PARTE_I_ORDEN`): los datos que el Cliente dio al registrarse. Sus campos
 *     `{campo}` los llena `camposDeLaOrden` con lo del registro; `llenarPlantilla` se niega a devolver
 *     un texto con un campo sin llenar.
 *   - **Parte II, los Términos** (`PARTE_II_TERMINOS`): el texto del producto, igual para todos. Su
 *     huella (`{huella_sha256}` de la Orden) es el sha256 de este texto exacto.
 *
 * El documento lleno de cada empresa se arma UNA vez, en el registro, entra a la huella de lo que la
 * persona aceptó (`textoAceptado`) y se guarda tal cual en `valida_registros.terminos_texto`. La
 * activación del día 7 registra ESE texto como los Términos de la empresa; no lo vuelve a armar.
 *
 * Por empresa (alcance `cliente` en `documentos_contractuales_versiones`), NO como plantilla genérica
 * del módulo: un documento `plantilla` de `valida_consulta` lo verían TODOS los espacios con contrato
 * de Valida (`20260929030000_documentos_alcance_plantilla.sql`), y la entrada de los 4 CDA de hoy
 * les pediría aceptarlo para seguir consultando.
 */

export const MARCADOR_TERMINOS_PENDIENTES = /\[TEXTO (EMILIO|LUCÍA|LUCIA)\b/

/** Parte I: la Orden de Suscripción, con sus campos `{campo}`. */
export const PARTE_I_ORDEN = `# TÉRMINOS DE USO DE VALIDA

**Variante: Autoservicio · Versión 2.0 · Rige desde {fecha_publicacion}**

**EL PRESTADOR:** METRIK IA S.A.S., NIT 902.079.601-9, domiciliada en la Calle 24A Bis # 100-71, Bogotá D.C., representada legalmente por Brallan Mauricio Moreno Guzmán. Correo: mauricio.moreno@metrik.com.co ("METRIK").

**EL CLIENTE:** la empresa identificada en la Orden de Suscripción de la Parte I, que se registró en Valida (el "Cliente").

Este documento tiene dos partes: la **Parte I** es la Orden de Suscripción, con los datos que el Cliente dio al registrarse, y la **Parte II** son los Términos (el texto del producto, igual para todos los clientes de esta variante).

---

## PARTE I. ORDEN DE SUSCRIPCIÓN

Fecha del registro: {fecha_registro}

| Concepto | Dato |
|---|---|
| **Cliente** | |
| Razón social (declarada en el registro) | {razon_social} |
| NIT (declarado en el registro) | {nit} |
| Correo de notificaciones (verificado con código en el registro) | {correo_notificaciones} |
| **Plan** | |
| Plan | Valida mensual |
| Acceso | Cuenta del Cliente en Valida |
| Usuarios incluidos | 2 |
| Consultas incluidas | Hasta 3.000 por mes |
| **Precio y pago** | |
| Valor mensual | $150.000 (ciento cincuenta mil pesos) |
| Tributos | Excluido de IVA (Estatuto Tributario, art. 476, num. 21). El valor indicado es el total. |
| Forma de pago | Cobro automático mensual al medio de pago registrado en la pasarela ePayco (cláusula 3.5) |
| **Vigencia** | |
| Prueba gratis | Según las Condiciones de la prueba gratis aceptadas en el registro |
| Fin del plazo para cancelar la prueba | {fecha_hora_vence_prueba} (7 días después de abrir la prueba). El primer cobro se hace después de ese momento, nunca antes, salvo que el Cliente cancele a tiempo |
| Período | Mensual, se renueva solo cada mes |
| Permanencia mínima | Ninguna. El Cliente se retira cuando quiera, sin penalidad (cláusula 12.3) |
| **Alianza** | |
| Recomendado por AFI (cláusula 15) | {recomendado_afi} |
| **Aceptación** | |
| Acepta | La persona que marcó la casilla del registro, con el correo {correo_notificaciones}, en nombre del Cliente |
| Canal de aceptación | Registro en Valida (casilla) |
| Huella SHA-256 de los Términos (Parte II) | {huella_sha256} |`

/** Parte II: los Términos, iguales para todos los clientes de la variante. Su sha256 es `{huella_sha256}`. */
export const PARTE_II_TERMINOS = `## PARTE II. TÉRMINOS

### 0. Cómo se leen estos Términos

0.1. La Orden de Suscripción (la "Orden") y estos Términos forman un solo acuerdo entre METRIK y el Cliente sobre el Servicio, y constituyen el acuerdo completo entre las Partes sobre él.

0.2. Los Términos son los del producto: se aplican sin cambios a todos los clientes de esta variante y no se editan por cliente. Lo particular de cada Cliente consta en la Orden, con los datos que dio al registrarse.

0.3. Si la Orden y estos Términos difieren en un dato particular, prevalece la Orden; en todo lo demás, prevalecen estos Términos.

0.4. Forman parte de este acuerdo, en su versión vigente publicada en https://valida.metrik.com.co/recursos: la Política de Tratamiento de Datos Personales de VALIDA, la Política de Devoluciones de VALIDA, el Acuerdo de Nivel de Servicio (ANS), la Política de Atención y Soporte y el catálogo de listas. Los cambios en esos documentos se avisan conforme a la cláusula 13.

0.5. **Prueba gratis.** La prueba gratis se rige por las Condiciones de la prueba gratis que el Cliente aceptó en el registro. Estos Términos obligan desde la aceptación; el plan que regulan inicia con el primer cobro exitoso, que se hace después del fin del plazo para cancelar que indica la Orden. Si el Cliente cancela la prueba a tiempo, el plan no inicia y estos Términos terminan sin obligaciones para ninguna de las Partes, salvo las cláusulas 7 y 9.

### 1. Objeto y alcance

1.1. METRIK concede al Cliente acceso a **VALIDA**, servicio de computación en la nube para la consulta automatizada de personas naturales y jurídicas contra listas restrictivas y vinculantes utilizadas en la gestión del riesgo de LA/FT/FP (el "Servicio"), a través de su cuenta en Valida.

1.2. El Servicio comprende el acceso a la plataforma, los usuarios y las consultas que indica la Orden, la generación de reportes de validación con código de verificación y huella de integridad, la consulta de las listas del catálogo vigente, la verificación diaria de sus fuentes y el soporte funcional básico.

1.3. El Servicio no incluye usuarios, consultas ni funciones que la Orden no mencione.

1.4. **Alcance.** El alcance es la consulta de las listas del catálogo vigente publicado en la plataforma. No incluye asesoría jurídica, normativa ni tributaria; el diseño, la implementación o la operación del sistema de gestión del riesgo de LA/FT/FP del Cliente; fuentes de diligencia fuera del catálogo; ni monitoreo continuo ni alertas de nuevas inclusiones. Cada consulta es un acto puntual contra la versión de cada lista vigente al momento de realizarse; repetirla periódicamente es decisión de quien consulta.

1.5. El Cliente declara que contrata para su actividad económica, a la que el Servicio está ligado, y no como consumidor final (Ley 1480 de 2011). Si el Cliente es persona natural, la declaración se refiere a su actividad como comerciante o profesional.

1.6. **Quién puede contratar.** Solo puede contratar el Servicio una empresa que (a) esté obligada por la norma de su supervisor a consultar listas, o (b) tenga otra base legal para consultar a terceros en listas, como la autorización del titular o la debida diligencia de sus propias contrapartes. El Cliente declara que está en uno de esos casos y que la razón social y el NIT que registró son ciertos. METRIK no verifica esos datos al registrarlo y puede pedir el RUT o el certificado de existencia y representación legal en cualquier momento; si no coinciden, aplica la cláusula 4.6.

### 2. Listas, norma del supervisor y responsabilidad de quien consulta

2.1. **Catálogo.** El Servicio consulta las listas del catálogo vigente, que METRIK publica en la plataforma con su fuente, su clasificación y la fecha de publicación de cada una. METRIK puede ampliar el catálogo. Si retira una fuente, lo avisa al Cliente con la anticipación razonable que las circunstancias permitan.

2.2. **Clasificación de las listas.** Cada resultado indica la clasificación de la lista consultada: (a) VINCULANTE, para las listas del Consejo de Seguridad de las Naciones Unidas y la lista del Consejo de Seguridad Nacional de Colombia; (b) OBLIGATORIA COLOMBIA, para los registros que la norma ordena construir, como el de personas expuestas políticamente; (c) VINCULANTE SEGÚN SU SUPERVISOR, para las coincidencias con designaciones de terrorismo de las listas de los Estados Unidos de América y de la Unión Europea, cuando la norma del supervisor del sujeto obligado las incluye en su definición de Listas Vinculantes; (d) LISTA RESTRICTIVA, para las demás coincidencias con OFAC y con la lista consolidada de la Unión Europea; y (e) VERIFIQUE CON SU SUPERVISOR, para las coincidencias de la categoría (c) cuando el Cliente no ha declarado su supervisor, cuando su supervisor no consta en VALIDA o cuando su norma no ha sido verificada por METRIK. Cada resultado indica la norma en que se basa su clasificación y la versión de la matriz aplicada, que queda registrada. La matriz se publica en la plataforma y puede cambiar cuando un supervisor modifique su norma. En esta variante el Cliente no declara su supervisor en VALIDA, por lo que las coincidencias de la categoría (c) se muestran en la categoría (e). La clasificación informa lo que dice la norma de cada supervisor y no sustituye el análisis de quien consulta: el Cliente confirma o descarta cada coincidencia, decide su tratamiento y presenta los reportes que su norma ordene; VALIDA no confirma coincidencias, no decide vinculaciones ni hace reportes. El Cliente es el único responsable de decidir cómo tratar las coincidencias de las categorías (d) y (e).

2.3. **Norma del supervisor.** Cada supervisor define, en su propia norma, qué listas son de consulta obligatoria para los sujetos que vigila y cómo se tratan las coincidencias. Si el Cliente tiene supervisor, verifica en esa norma qué listas debe consultar y decide, bajo su responsabilidad, cómo tratar cada coincidencia. Si no lo tiene, consulta solo con la base legal de la cláusula 1.6, literal (b). VALIDA informa la clasificación y el efecto que la norma del supervisor atribuye a cada lista, y no recomienda ni decide acciones sobre el caso concreto.

2.4. **Herramienta de apoyo.** VALIDA es una herramienta tecnológica de consulta automatizada. No constituye asesoría jurídica ni sustituye el sistema de gestión del riesgo de LA/FT/FP de quien consulta ni su debida diligencia.

2.5. **Responsabilidad del Cliente.** El Cliente conserva íntegramente la responsabilidad de analizar las coincidencias, confirmar o descartar homonimias, decidir la vinculación o el mantenimiento de la relación, reportar a la UIAF y a las demás autoridades lo que su norma ordene, y responder ante su supervisor, si lo tiene. Ningún proveedor tecnológico asume la calidad de oficial de cumplimiento ni sus funciones.

2.6. **Fuentes y frescura.** El contenido de las listas corresponde a sus emisores oficiales. El resultado refleja la versión de cada lista vigente en VALIDA al momento de la consulta, que queda registrada. VALIDA verifica sus fuentes a diario y muestra la fecha de publicación de cada una; no todas las fuentes publican actualizaciones con esa frecuencia. METRIK no responde por errores, omisiones o demoras de publicación de los emisores.

2.7. **Ausencia de coincidencia.** Que una consulta no arroje coincidencia no certifica que la persona consultada no pertenezca a la categoría que la lista busca identificar, como las personas expuestas políticamente. Cada consulta cubre solo a la persona consultada: no infiere beneficiarios finales, socios ni familiares.

2.8. **Régimen del Cliente.** El Servicio provee la consulta de listas, no el sistema de gestión del riesgo, y no se ofrece como cumplimiento completo del régimen de ningún supervisor. Al Cliente le corresponde confirmar ante su supervisor qué régimen le aplica y si el Servicio le sirve para ese régimen.

### 3. Condiciones comerciales

3.1. **Precio.** El precio y la periodicidad son los de la Orden. El precio es el valor total a cargo del Cliente. METRIK expide factura electrónica de venta por cada período, a la razón social y el NIT de la Orden, y la envía al correo de notificaciones.

3.2. **Tributos.** El Servicio se factura como servicio de computación en la nube excluido del impuesto sobre las ventas, conforme al numeral 21 del artículo 476 del Estatuto Tributario. El precio de la Orden es el valor total a cargo del Cliente y no lleva IVA que sumar ni que discriminar. El soporte funcional es inherente al acceso al Servicio y no se factura por separado. Si la autoridad tributaria determina que el Servicio se encuentra gravado, METRIK no trasladará al Cliente el impuesto correspondiente a los períodos ya facturados; para los siguientes, aplica la cláusula 3.7.

3.3. **Servicios profesionales.** Esta variante no incluye servicios profesionales. Si el Cliente los pide, como configuración o acompañamiento, se cotizan, se contratan y se facturan aparte, con el IVA que les corresponda, y no hacen parte del Servicio.

3.4. **Usuarios y consultas adicionales.** Los usuarios y las consultas incluidos son los de la Orden. Si el Cliente necesita más, lo pide por escrito y METRIK le ofrece un plan acorde, que requiere una nueva Orden.

3.5. **Pago automático.** El pago es anticipado y automático. El Cliente autoriza a METRIK a cobrar el valor mensual de la Orden al medio de pago que registró en la pasarela ePayco: el primer mes, después de que se cumplan los 7 días de la prueba y nunca antes; y después cada mes, en el mismo día del mes del primer cobro, o el último día del mes cuando ese día no exista, hasta que el Cliente se retire. METRIK no guarda los datos de la tarjeta; los guarda la pasarela. Por cada cobro, METRIK envía la factura electrónica al correo de notificaciones. El Cliente puede reemplazar el medio de pago escribiendo a mauricio.moreno@metrik.com.co o desde su cuenta, cuando esa opción esté disponible. La autorización de cobro termina cuando el Cliente se retira (cláusula 12.3): retirarse es la forma de revocarla.

3.6. **Si un cobro falla.** Si el primer cobro es rechazado, aplica el numeral 7.5 de las Condiciones de la prueba gratis. Si es rechazado un cobro mensual posterior, METRIK lo informa al correo de notificaciones, envía un enlace de pago y puede intentar el cobro de nuevo al mismo medio de pago durante los 10 días calendario siguientes. Si en ese plazo no se paga, aplica la cláusula 11.1.

3.7. **Cambio de precio.** METRIK puede modificar el precio con aviso al correo de notificaciones de treinta (30) días, desde el período siguiente a que se cumpla ese plazo. El Cliente puede retirarse antes de que el cambio rija, sin penalidad.

### 4. Credenciales y uso del Servicio

4.1. **Credenciales.** Las credenciales de acceso son personales de cada usuario habilitado, confidenciales e intransferibles. El Cliente responde por el uso que se haga con ellas y avisa a METRIK, sin demora, de cualquier uso no autorizado. METRIK puede rotarlas, suspenderlas o revocarlas ante indicios de compromiso, uso indebido o incumplimiento de estos Términos.

4.2. **Exclusividad del acceso.** La suscripción y el acceso son exclusivos del Cliente, identificado por razón social y NIT en la Orden, y no se extienden a empresas vinculadas, filiales, matrices, aliados ni terceros. Los usuarios habilitados deben pertenecer al Cliente.

4.3. **Uso permitido.** El Servicio se usa exclusivamente para la prevención y gestión del riesgo de LA/FT/FP y la debida diligencia de clientes, proveedores, empleados, socios u otras contrapartes reales o posibles del Cliente, en su operación propia.

4.4. **Uso prohibido.** El Cliente no puede ceder, transferir, compartir, sublicenciar ni revender el acceso; prestar con él servicios de consulta a terceros; consultar a personas sin relación con el Cliente o por curiosidad; usar los resultados para perfilar personas o armar listas o bases propias; extraer, copiar o reconstruir de forma masiva las bases de datos del Servicio; hacer ingeniería inversa, pruebas de carga o de intrusión; usar medios automatizados no autorizados para acceder al Servicio; consultar para finalidades distintas de la cláusula 4.3 o sin la base legal que exige la cláusula 9; ni enviar datos sensibles ni datos de niños, niñas y adolescentes en las consultas.

4.5. **Tope de consultas.** Las consultas incluidas son las de la Orden para cada período mensual. Al llegar al tope, VALIDA no hace más consultas hasta el período siguiente, salvo que el Cliente contrate un plan mayor (cláusula 3.4). Las consultas no usadas en un período no se acumulan para el siguiente.

4.6. El incumplimiento de esta cláusula, o que la razón social o el NIT registrados no sean ciertos (cláusula 1.6), faculta a METRIK para suspender de inmediato el Servicio y terminar estos Términos sin indemnización.

### 5. Reportes verificables

5.1. Los reportes PDF de VALIDA, con código de verificación y huella de integridad, identifican al Cliente y a la persona consultada. El Cliente puede entregarlos a su supervisor, a su revisor fiscal, a sus auditores y a las autoridades que se los requieran. Los reportes de la prueba gratis llevan la marca "PRUEBA" y no sirven para ese fin, como dicen las Condiciones de la prueba gratis.

5.2. El Cliente no puede modificar los reportes, recortarlos ni retirarles leyendas, marcas o código de verificación, ni presentarlos como emitidos para una razón social distinta de la suya.

5.3. Los documentos propios que el Cliente elabore con base en los resultados son suyos, no pueden imitar el reporte de VALIDA ni llevar su código de verificación, y deben indicar que el reporte verificable es el emitido por VALIDA.

### 6. Disponibilidad y soporte

6.1. Los niveles de servicio, las exclusiones y el procedimiento de reclamación se rigen por el ANS y la Política de Atención y Soporte vigentes, que forman parte de estos Términos. El soporte se presta al Cliente.

6.2. METRIK realiza esfuerzos razonables para mantener disponible el Servicio y puede programar mantenimientos, actualizaciones e interrupciones por fuerza mayor, conforme al ANS. Las compensaciones por indisponibilidad son las del ANS y son el único remedio por ese concepto, sin perjuicio de la cláusula 10.4.

### 7. Confidencialidad

7.1. Es Información Confidencial toda información no pública que una Parte reciba de la otra con ocasión del Servicio: credenciales, documentación técnica no publicada, datos de las consultas y sus resultados, condiciones comerciales, arquitectura, algoritmos y métodos de coincidencia.

7.2. La Parte receptora la usa solo para ejecutar estos Términos, la protege con al menos el cuidado que da a la propia y la comparte únicamente con empleados, contratistas y asesores que la necesiten y estén obligados a reserva equivalente. El Cliente puede entregar los reportes en los términos de la cláusula 5.

7.3. No es confidencial la información que sea o se vuelva pública sin culpa de la receptora; la que la receptora ya conociera legítimamente; la que reciba de un tercero sin obligación de reserva; ni la que desarrolle de forma independiente. Si una autoridad competente exige información confidencial, la receptora la entrega en lo estrictamente requerido, avisando previamente a la otra Parte cuando la ley lo permita. Los reportes a la UIAF y a los supervisores no requieren aviso.

7.4. La obligación rige durante la vigencia y cinco (5) años después de su terminación. Los secretos empresariales y los datos personales se protegen mientras conserven esa calidad.

### 8. Propiedad intelectual

8.1. METRIK IA S.A.S. es titular del software VALIDA, su código, bases de datos, algoritmos, documentación, marcas y signos. Estos Términos conceden al Cliente solo un derecho de acceso y uso del Servicio, no exclusivo, intransferible y revocable, limitado a la vigencia y a los usos de la cláusula 4.

8.2. Estos Términos no transfieren al Cliente derecho de propiedad intelectual alguno. Los datos que el Cliente envía para consultar son suyos.

### 9. Tratamiento de datos personales

9.1. **Marco.** Las Partes cumplen la Ley 1581 de 2012 y el Decreto 1377 de 2013, compilado en el Decreto Único Reglamentario 1074 de 2015 (Libro 2, Parte 2, Título 2, Capítulo 25).

9.2. **Roles.** Respecto de los datos personales que el Cliente envía para consultar y de sus resultados, el Cliente es Responsable del Tratamiento y METRIK es Encargado (Ley 1581 de 2012, art. 3, literales d y e). METRIK es Responsable de la base construida con información de las listas oficiales que descarga y procesa y de los datos de las personas que actúan por el Cliente (usuarios, quien se registra y acepta, y el titular del medio de pago), para el acceso, la seguridad, el soporte, el cobro y la prueba de la aceptación, conforme a la Política de Tratamiento de Datos Personales de VALIDA. Esta cláusula es el contrato de transmisión de datos entre el Cliente y METRIK (DUR 1074 de 2015, arts. 2.2.2.25.5.1 y 2.2.2.25.5.2) y continúa, desde el inicio del plan, el acuerdo de encargo del numeral 6 de las Condiciones de la prueba gratis.

9.3. **Alcance del encargo e instrucciones.** METRIK trata los datos solo para prestar el Servicio y por instrucciones del Cliente: recibir las consultas, contrastarlas con las listas, generar y conservar los reportes y la bitácora, y entregar los resultados. No usa los datos para fines propios, no los comercializa y no los comunica a terceros distintos de sus subencargados (cláusula 9.7).

9.4. **Obligaciones del Cliente.** El Cliente garantiza que: (a) cuenta con autorización previa, expresa e informada de los titulares consultados, que incluye la consulta en listas por medio de encargados, o con un mandato legal o una excepción del artículo 10 de la Ley 1581 de 2012 que le sea aplicable; (b) conserva y aporta prueba de lo anterior si METRIK o una autoridad se lo requieren; y (c) cumple los deberes del Responsable y atiende las consultas y reclamos de los titulares.

9.5. **Obligaciones de METRIK.** METRIK cumple, frente al Cliente, los deberes del artículo 18 de la Ley 1581 de 2012 y, en particular: (a) guarda reserva; (b) aplica las medidas técnicas y organizativas de la Política de Seguridad de la Información publicada, incluidos cifrado en tránsito, control de acceso y registros de auditoría con huella de integridad; (c) traslada al Cliente, dentro de los dos (2) días hábiles siguientes, toda consulta o reclamo de un titular que reciba; y (d) facilita la información razonable que el Cliente solicite para demostrar este cumplimiento.

9.6. **Conservación y bitácora.** Por instrucción del Cliente y para que este pueda cumplir su deber de conservación, METRIK conserva la bitácora de consultas, incluidas las de la prueba gratis, y la evidencia asociada (datos consultados, resultado, versión de las listas y huella del reporte) durante diez (10) años. Ese es el plazo de la Ley 962 de 2005, art. 28, al que remiten las normas de los supervisores, entre ellas la Resolución 2328 de 2025 de la Superintendencia de Transporte (art. 5.6.11.4) y la Circular Externa 100-000020 de 2026 de la Superintendencia de Sociedades (numeral 9.22). Si una consulta está vinculada a un reporte de operación sospechosa o a una investigación en curso y la autoridad lo requiere, se conserva hasta su cierre formal. Durante ese plazo los registros no se suprimen, ni siquiera a solicitud del Cliente o del titular, por existir un deber legal de conservación.

9.7. **Subencargados y transmisión internacional.** METRIK se apoya en los proveedores declarados en la Política de Tratamiento de Datos Personales de VALIDA vigente, incluidos proveedores de infraestructura en la nube y de correo transaccional ubicados en el exterior, a quienes exige obligaciones de seguridad y reserva equivalentes. La transmisión se hace bajo el contrato de transmisión de la cláusula 9.2 y conforme al artículo 26 de la Ley 1581 de 2012. Todo cambio de proveedores se refleja en la Política y se informa al correo del Cliente. Si el Cliente se opone con fundamento, puede retirarse conforme a la cláusula 12.3. La pasarela ePayco no recibe datos de las personas consultadas.

9.8. **Incidentes.** METRIK informa al Cliente, sin demora injustificada y a más tardar dentro de las setenta y dos (72) horas siguientes a su confirmación, todo incidente de seguridad que afecte datos tratados por su cuenta, con la información disponible y las medidas adoptadas. Cada Parte cumple su deber de informar a la Superintendencia de Industria y Comercio, de forma coordinada.

9.9. **Devolución y supresión.** Al terminar la relación, el Cliente puede pedir, dentro de los treinta (30) días siguientes, una exportación de la bitácora de sus consultas en formato legible por máquina. METRIK conserva los registros solo por el plazo de la cláusula 9.6 y para esa finalidad, y después los suprime o anonimiza. Al terminar, METRIK pide a la pasarela eliminar el medio de pago registrado.

9.10. **Política.** En lo no previsto aquí aplica la Política de Tratamiento de Datos Personales de VALIDA, en su versión vigente, publicada en https://valida.metrik.com.co/recursos/privacidad. Entre las Partes, en lo que se refiere al rol de cada una frente a los datos de las consultas, prevalece esta cláusula 9.

### 10. Responsabilidad e indemnidad

10.1. Las decisiones que el Cliente adopte con base en los resultados son de su exclusiva responsabilidad.

10.2. **Límite.** La responsabilidad total de METRIK por cualquier causa derivada de estos Términos se limita al valor efectivamente pagado por el Cliente en los doce (12) meses anteriores al hecho que la origina.

10.3. **Exclusiones.** METRIK no responde por lucro cesante, daños indirectos o pérdida de negocios. Tampoco responde por las decisiones de vinculación, los reportes o las sanciones que resulten de la gestión de riesgo del Cliente, ni por el contenido de las listas oficiales.

10.4. **Dolo y culpa grave.** Los límites y exclusiones anteriores no aplican en caso de dolo o culpa grave (Código Civil, arts. 63 y 1522).

10.5. **Indemnidad.** El Cliente mantiene indemne a METRIK frente a reclamaciones, sanciones y costos, incluidos honorarios razonables, que provengan de: (a) la falta de autorización o de base legal para consultar a los titulares; (b) el incumplimiento de las cláusulas 4 y 9; (c) la falsedad de la razón social, el NIT o la declaración de la cláusula 1.6. Se exceptúan los daños causados por dolo o culpa grave de METRIK.

10.6. Si, a pesar de lo declarado en la cláusula 1.5, el Cliente fuera considerado consumidor, nada en estos Términos limita los derechos que la Ley 1480 de 2011 le reconoce de manera irrenunciable.

### 11. Suspensión

11.1. METRIK puede suspender el Servicio, previo aviso por correo, cuando el cobro de un período no se haya podido hacer ni se haya pagado dentro de los 10 días calendario de la cláusula 3.6. Puede suspenderlo de inmediato ante uso indebido de credenciales, cesión de accesos a terceros, orden de autoridad o actividades que comprometan la seguridad de la plataforma o de la información.

11.2. La suspensión detiene las consultas nuevas. El Cliente conserva el acceso a sus reportes y a la exportación de su bitácora, y la evidencia ya generada permanece íntegra. El pago de lo vencido restablece el Servicio. Si pasan treinta (30) días calendario de suspensión por falta de pago sin que el Cliente pague, la suscripción termina sin más aviso y METRIK pide a la pasarela eliminar el medio de pago.

### 12. Vigencia, renovación y retiro

12.1. **Vigencia.** Estos Términos rigen desde la aceptación en el registro. El plan inicia con el primer cobro exitoso, si el Cliente no canceló la prueba a tiempo, y sigue mientras el Cliente no se retire.

12.2. **Renovación.** El plan es mensual, sin permanencia mínima, y se renueva solo cada mes con el cobro de la cláusula 3.5. El Cliente no tiene que dar aviso previo para que no se renueve: basta con retirarse antes de la fecha del siguiente cobro.

12.3. **Retiro del Cliente.** El Cliente puede retirarse en cualquier momento, sin aviso previo y sin penalidad, desde la opción de retiro de su cuenta en Valida o escribiendo a mauricio.moreno@metrik.com.co. METRIK confirma el retiro al correo de notificaciones. El retiro surte efecto cuando se hace en la cuenta o cuando el correo ingresa al buzón de METRIK, y desde ese momento no se hacen más cobros; si se hace un cobro después, METRIK lo devuelve completo conforme a la Política de Devoluciones de VALIDA. El Cliente conserva el acceso hasta el final del período ya pagado. El período ya pagado no se reembolsa, salvo lo que diga la Política de Devoluciones de VALIDA.

12.4. **Terminación por METRIK.** METRIK puede terminar estos Términos sin causa con aviso al correo de notificaciones de treinta (30) días, y de inmediato por incumplimiento de las cláusulas 4 o 9 o en el caso de la cláusula 11.2.

12.5. **Saldo.** Si se retira el Cliente, o termina METRIK por incumplimiento del Cliente, no hay reembolso del período ya pagado. Si METRIK termina sin causa imputable al Cliente, reembolsa a prorrata los días no prestados. Lo anterior es sin perjuicio de la Política de Devoluciones de VALIDA vigente.

12.6. **Efectos.** Al terminar, cesa el acceso al final del período pagado. Sobreviven las cláusulas 2.4 a 2.7, 7, 8, 9, 10, 12.5 y 14.

### 13. Modificaciones

13.1. METRIK puede actualizar el ANS, las políticas publicadas y estos Términos con aviso previo al correo del Cliente de treinta (30) días. Toda modificación de estos Términos que afecte los derechos del Cliente o le imponga nuevas obligaciones requiere su nueva aceptación en los términos de la cláusula 16; mientras no la acepte, rige la versión que aceptó.

13.2. Los cambios de precio siguen la cláusula 3.7.

13.3. Si el Cliente no acepta una modificación, puede retirarse sin penalidad antes de que entre en vigor, con reembolso a prorrata de los días no prestados.

### 14. Ley aplicable, domicilio, controversias y notificaciones

14.1. Estos Términos se rigen por la ley colombiana. El domicilio contractual es Bogotá D.C. Las Partes intentan resolver sus diferencias por arreglo directo durante treinta (30) días calendario desde la notificación escrita de la controversia; vencido ese plazo, cualquiera puede acudir a los jueces de Bogotá D.C.

14.2. Las notificaciones al Cliente se hacen al correo de notificaciones de la Orden, y a METRIK al correo indicado en el encabezado. El Cliente mantiene actualizado ese correo.

### 15. Recomendación de AFI

15.1. Las cláusulas 15.2 y 15.3 aplican solo cuando la Orden indica "Recomendado por AFI: sí". La cláusula 15.4 aplica siempre.

15.2. El Cliente declara que AFI INTERNATIONAL GROUP S.A.S. ("AFI"), NIT 902.003.244-6, aliado comercial de METRIK, le recomendó VALIDA, y autoriza a METRIK a informar a AFI la razón social y el NIT del Cliente, y si contrató el plan y sigue activo, para la alianza y la liquidación de la remuneración comercial que METRIK puede pagar a AFI. METRIK no informa a AFI el correo ni los datos de las personas que actúan por el Cliente, el contenido de las consultas, sus resultados ni los datos de las personas consultadas.

15.3. AFI no presta el Servicio ni lo opera, no garantiza sus resultados ni la suficiencia de las listas para el sistema de gestión del riesgo del Cliente, y no asume obligación alguna frente al Cliente por estos Términos. El único prestador y contraparte del Cliente por el Servicio es METRIK. Los servicios de consultoría que AFI preste al Cliente, si los hay, se rigen por su propio contrato con AFI y son ajenos a este.

15.4. El Cliente no usa el nombre, el logotipo ni el sello de AFI, salvo para mencionar de forma nominativa la alianza.

### 16. Aceptación

16.1. **Mensaje de datos.** Estos Términos y la Orden se perfeccionan por mensajes de datos (Ley 527 de 1999, arts. 14 y 15).

16.2. **Quién acepta.** Los acepta, en nombre del Cliente, la persona que marca la casilla del registro en Valida. Con ello declara que actúa por el Cliente con facultades suficientes para obligarlo, y responde personalmente en los términos del artículo 841 del Código de Comercio si obra sin ellas o las excede.

16.3. **Registro.** La aceptación deja registro de la fecha y hora, el usuario, el correo verificado con código, la dirección IP de origen, la versión aceptada, la huella digital (SHA-256) del documento y la referencia del medio de pago registrado en la pasarela. Ese registro es la prueba de la aceptación.

16.4. **Envío al correo de notificaciones.** METRIK remite estos Términos, la Orden y la constancia de la aceptación al correo de notificaciones de la Orden. Se entienden recibidos cuando ingresan a ese buzón (Ley 527 de 1999, art. 24).

16.5. **Ejecución.** El uso del Servicio después del inicio del plan y el pago del primer período ratifican la aceptación (Código de Comercio, art. 854). Si el Cliente no reconoce la aceptación, lo comunica a mauricio.moreno@metrik.com.co: antes del inicio del plan, se trata como la cancelación de la prueba y no se cobra nada; después, tiene efectos de retiro conforme a la cláusula 12.3, sin perjuicio de la Política de Devoluciones de VALIDA.

16.6. **Habilitación.** El acceso se habilita con la prueba gratis. El plan inicia con el primer cobro exitoso, después del fin del plazo para cancelar que indica la Orden; si ese cobro falla, aplica el numeral 7.5 de las Condiciones de la prueba gratis.`

/** Entre la Orden y los Términos, como en el documento. */
export const SEPARADOR_PARTES = '\n\n---\n\n'

export const TERMINOS_PLAN = {
  slug: 'terminos-uso-valida-autogestion',
  version: 'v2.0',
  titulo: 'Términos de Uso de VALIDA',
  plantilla: `${PARTE_I_ORDEN}${SEPARADOR_PARTES}${PARTE_II_TERMINOS}`,
} as const

export function terminosPlanListos(plantilla: string = TERMINOS_PLAN.plantilla): boolean {
  return !MARCADOR_TERMINOS_PENDIENTES.test(plantilla)
}

const CAMPO = /\{([a-z_0-9]+)\}/g

/** Los campos `{campo}` que usa una plantilla, sin repetir y en orden de aparición. */
export function camposDePlantilla(plantilla: string): string[] {
  return [...new Set([...plantilla.matchAll(CAMPO)].map((m) => m[1]))]
}

export type ResultadoLlenado = { ok: true; texto: string } | { ok: false; faltan: string[] }

/** Llena la plantilla. Si queda un solo campo sin valor, no devuelve texto: devuelve cuáles faltan. */
export function llenarPlantilla(plantilla: string, campos: Record<string, string | null | undefined>): ResultadoLlenado {
  const faltan = camposDePlantilla(plantilla).filter((c) => !campos[c] || !String(campos[c]).trim())
  if (faltan.length > 0) return { ok: false, faltan }
  return { ok: true, texto: plantilla.replace(CAMPO, (_, c: string) => String(campos[c]).trim()) }
}

const FECHA_LARGA = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Bogota' })
const FECHA_HORA = new Intl.DateTimeFormat('es-CO', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'America/Bogota',
})

/** NIT con puntos y DV: 900.123.456-7. */
export function nitLegible(nit: string, dv: string | null): string {
  const conPuntos = nit.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return dv ? `${conPuntos}-${dv}` : conPuntos
}

/**
 * Los campos de la Orden, con lo que el registro conoce en el momento de aceptar:
 *
 *   - `fecha_registro`: el día (Bogotá) en que se marca la casilla;
 *   - `fecha_publicacion` («Rige desde»): el MISMO día. Los Términos rigen desde la aceptación en el
 *     registro (12.1) y la Orden es de esta empresa. ⚠️ Lectura de Max, pendiente de Emilio: si
 *     «Rige desde» debe ser una fecha fija de publicación de la v2.0, se cambia aquí y se sube la
 *     versión;
 *   - `fecha_hora_vence_prueba`: el momento de aceptar más la duración de la prueba, a la hora y el
 *     minuto. Va truncado al minuto y la prueba se abre DESPUÉS de aceptar (`emitirPruebaDelEspacio`),
 *     así que el instante real del cobro (`cobro_programado_at`) nunca es anterior al que dice la
 *     Orden: «el primer cobro se hace después de ese momento, nunca antes»;
 *   - `recomendado_afi`: «sí» o «no», según lo que marcó en el registro;
 *   - `huella_sha256`: la de la Parte II (`PARTE_II_TERMINOS`), que calcula el servidor.
 */
export function camposDeLaOrden(p: {
  razonSocial: string
  nit: string
  dv: string | null
  correo: string
  recomendadoAfi: boolean | null
  aceptadoMs: number
  duracionPruebaMs: number
  huellaParteII: string
}): Record<string, string> {
  const fecha = FECHA_LARGA.format(new Date(p.aceptadoMs))
  return {
    fecha_publicacion: fecha,
    fecha_registro: fecha,
    razon_social: p.razonSocial,
    nit: nitLegible(p.nit, p.dv),
    correo_notificaciones: p.correo,
    fecha_hora_vence_prueba: `${FECHA_HORA.format(new Date(p.aceptadoMs + p.duracionPruebaMs))} (hora de Colombia)`,
    recomendado_afi: p.recomendadoAfi === true ? 'sí' : 'no',
    huella_sha256: p.huellaParteII,
  }
}

/** Los Términos de UNA empresa, llenos: lo que la persona acepta en el registro. */
export interface TerminosLlenos {
  titulo: string
  version: string
  texto: string
}

/**
 * El documento como lo lee la persona en la pantalla del registro mientras escribe: los campos que
 * todavía no tiene se ven como «…». Solo para mostrar: lo que se acepta y se guarda lo arma el
 * servidor con `terminosDeLaEmpresa`, que no admite huecos.
 */
export function vistaDeLosTerminos(campos: Record<string, string | null | undefined>): string {
  return TERMINOS_PLAN.plantilla.replace(CAMPO, (_, c: string) => {
    const v = campos[c]
    return v && String(v).trim() ? String(v).trim() : '…'
  })
}

/** El documento de la empresa (Orden + Términos), o los campos que faltan. */
export function terminosDeLaEmpresa(
  campos: Record<string, string>,
): { ok: true; terminos: TerminosLlenos } | { ok: false; faltan: string[] } {
  const r = llenarPlantilla(TERMINOS_PLAN.plantilla, campos)
  if (!r.ok) return r
  return { ok: true, terminos: { titulo: TERMINOS_PLAN.titulo, version: TERMINOS_PLAN.version, texto: r.texto } }
}
