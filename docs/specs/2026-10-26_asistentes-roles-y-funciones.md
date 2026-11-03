---
tipo: spec
fecha: 2026-10-26
autor: Max (Tech Lead)
estado: rev 2 (26-oct). Incorpora las respuestas de Mauricio del 26-oct (§6.1) y su decisión de lanzar los tres asistentes sobre el modelo de roles, Sabor incluido desde su salida. No se construye nada hasta que apruebe esta versión.
base_codigo: origin/main 78f06453 (26-oct-2026). Todas las citas `archivo:línea` son de ese commit.
fuentes:
  - Diseño aprobado «ADN del asistente MeTRIK» (26-oct, rev 57, los 7 puntos), con su diagnóstico (22-oct) y su estado del arte (22-oct)
  - proyectos/sabor-experiencias/clarity/ (CONTEXT, propuesta, kickoff, plantilla de ficha, diseño de la etapa 1 y de la etapa 2, nota de voz del evento del 23-oct)
  - proyectos/imperviun/proyecto-360/ (CONTEXT, pipeline.json, docs/diseno/asistente-whatsapp.md)
  - proyectos/laura-jaramillo/clarity/ (CONTEXT, propuesta, fichas, contrato integral)
  - PR abiertos que tocan esto: #1234 (Sabor etapa 2), #1235 y #1237 (Imperviun), #966 (recordatorios por plantilla), #1271 (correos internos)
---

# Asistentes MeTRIK: roles y funciones

## 0. Resumen para Mauricio

**Qué se construye.** Se construye la forma de armar asistentes por piezas, para no escribir uno a mano por cliente. MeTRIK escribe cada **función** una sola vez (registrar un gasto, marcar una llegada, mostrar la ficha de una experiencia, apartar una cita), con sus reglas y sus pruebas. A cada empresa se le **prenden** las funciones que compró. Cada **rol** (mano derecha, recolector, asesor-vendedor) es una ficha con su tono, sus límites, a quién pasa la conversación y las funciones que puede usar. Cada persona o canal queda **asignado** a un rol. El código solo le entrega al modelo las herramientas de ese rol: lo que no está asignado no existe para él.

**Casi todo ya existe.** El núcleo de hoy ya trabaja así por dentro: el modelo solo puede llamar las herramientas que le declara el dominio, y el núcleo rechaza las demás (`nucleo.ts:338`, `nucleo.ts:421`). El reglamento ya se guarda por versiones con marcha atrás (`bot_reglamentos`). Lo que falta es pasar de «un dominio por producto, armado a mano» a «un rol armado con funciones del catálogo», y guardar en la base quién usa qué rol. Lo demás es nuevo: el resumen diario, la calificación de conversaciones, el correo cuando se caen los modelos, el traspaso a una persona en ONE y la prueba de transcripción.

**Decisión del 26-oct.** Mauricio decidió que los tres asistentes (Sabor, Imperviun y Laura) salgan sobre el modelo de roles y funciones, y Sabor también desde su salida. Ya no existe la fase «Sabor sale sobre `publico/` y pasa a roles después del 13-nov». Las fechas de Sabor no cambian.

**En qué orden (por las fechas de los clientes).**
1. **Antes del jue 29-oct: el núcleo de roles y Sabor como su primer rol.** Entran la migración de roles (§2.8), el componedor (§2.6) y las funciones `clientes.*` de la etapa 1, que despachan al código que ya está en `publico/` sin cambiarle el comportamiento. Sabor sale a clientes reales el 29-oct como el rol `asesor_vendedor`, publicado con su banco del arnés y asignado por su inbox de Chatwoot. El arnés de Sabor tiene que dar lo mismo sobre el rol compuesto que sobre el dominio de hoy. Su respaldo es una persona de Sabor en Chatwoot: si el modelo se cae, o aparece cualquier señal de escalamiento, la conversación pasa a un agente humano dentro de Chatwoot, y a MéTRIK le llega un correo inmediato si fue caída del modelo (§4.1). Siguen haciendo falta los insumos y la operación de Sabor (§5.1).
2. **Entre el 29-oct y el 13-nov:** la etapa 2 de Sabor (cupos, reservas y pago, PR #1234) entra como versión nueva del mismo rol, con sus funciones nuevas. La pieza crítica es el cobro del saldo antes de la experiencia; además, cualquier experiencia (cine, cata, taller) se trata igual y se reconoce la experiencia por el anuncio o la publicación de origen. En prueba el lun 9-nov y con el espacio completo el vie 13-nov. En paralelo: el dominio ONE de hoy partido por cargo, el toque de los botones de plantilla (PR #966), el traspaso en ONE, el resumen diario y la calificación.
3. **Laura, desde ya y sin esperar la firma:** se someten a Meta sus plantillas (resumen de los lunes y recordatorio de deudas) y se prepara la migración del módulo de citas, portafolio y cuotas. Con la firma quedan los 5 días hábiles para cargar su espacio y publicar su rol `mano_derecha`.
4. **Imperviun, con su firma:** el asistente del PR #1235 se reutiliza dentro del modelo de roles antes de su merge, partido en las funciones de dos roles (mano derecha y recolector), sin reescribirlo. La apertura diaria por plantilla del recolector se construye y entra apagada; se prende después.

**Lo que decidiste el 26-oct** (detalle en §6.1):
1. Sabor no tiene modelo de respaldo en otro proveedor: su respaldo es una persona de Sabor en Chatwoot. Se mantiene el correo inmediato si se cae el modelo.
2. Imperviun: la apertura diaria por plantilla entra apagada y se prende después.
3. El PR #1235 se reutiliza dentro del modelo de roles antes de su merge.
4. Laura se adelanta ya, sin esperar la firma.
5. Los tres asistentes salen sobre el modelo de roles, Sabor desde el 29-oct.

Quedan abiertas siete preguntas de menor peso en §6.2.

**Lo que no hace este documento.** No toca código, no aplica migraciones y no escribe en producción. El SQL va como borrador (§2.8). Las consultas a producción que hacen falta están escritas en §7, para que las corra la sesión principal.

---

## 1. Lo que ya existe frente a lo que pide el diseño

### 1.1 Cómo está armado hoy

- **Un núcleo, cuatro puertos.** `Modelo`, `Almacen`, `Mensajero` y `Dominio` (`supabase/functions/_shared/agente/tipos.ts:6-11`). El núcleo arma el turno, llama al modelo con las herramientas del dominio, verifica la respuesta y solo escribe con el toque sobre una propuesta con huella (`nucleo.ts:264`, `nucleo.ts:575`).
- **Tres dominios**, cada uno armado a mano:
  - ONE (equipo interno, en todo workspace desde el 21-oct): `agente/one/dominio.ts:554`.
  - Bandeja de Trappvel: `agente/bandeja/dominio.ts`.
  - Asistente público de Sabor, sobre Chatwoot: `agente/publico/dominio.ts:158`, con su entrada propia `supabase/functions/chatwoot-agente/index.ts`.
- **Quién atiende a quién** lo decide `dominioDelAgente` con llaves del jsonb `config_extra.bot_conversacional`: `agente: true` da la bandeja, `false` lo apaga y, si no hay nada, toma el dominio ONE (`agente/config.ts:170-180`). El rol de la persona sale de `wa_identify_user` (staff) o de `wa_collaborators`, que entra siempre como `operator` (`_shared/wa-identificar.ts:21`, `wa-identificar.ts:33`).
- **Reglamento por versiones.** Las fichas se editan en `bot_parametros` y se publican inmutables en `bot_reglamentos`, con huella sha256. Volver atrás es mover el puntero `agente_config.reglamento_id` (`supabase/migrations/20261006213200_bot_reglamento_y_uso.sql:29`, `:59`, `:81-95`, `:99`). `cargarReglamento` lee la versión del puntero o la última (`agente/produccion.ts:98`). El reglamento de ONE vive en el código y un workspace lo reemplaza publicando el suyo (`agente/one/reglamento.ts:8-10`).

### 1.2 Punto por punto

Leyenda: **tal cual** = sirve sin cambios. **Generalizar** = existe para un caso y hay que abrirlo a todos. **Nuevo** = no existe.

| Lo que pide el ADN | Qué hay hoy (origin/main) | Estado |
|---|---|---|
| **Delegar, «sí» antes de escribir, de un toque** | `proponer` es la única puerta de escritura y solo se ejecuta con el toque o con un «sí» escrito solo sobre la propuesta vigente (`agente/herramientas.ts:53-73`, `nucleo.ts:570-650`) | Tal cual |
| **«Sí» en lote** (varios registros con un toque) | Hoy hay una sola propuesta vigente por chat. El PR #1235 trae la tanda con varias partidas y una huella (C19), sin mergear | Generalizar desde #1235 |
| **Recordar preferencias** («este proveedor siempre es gasto de empresa») | No existe | Nuevo (§2.8, tabla `asistente_preferencias`) |
| **«código · empresa — nombre»** | `nombreNegocio` y la ficha `g.nombrar_negocio` (`agente/one/reglamento.ts:62`); la lista de destino la arma el código (`one/dominio.ts:1005-1027`) | Tal cual |
| **La base manda** | `Dominio.registros` revisa en la base, en cada turno, lo que la conversación dice que se registró (`tipos.ts:300-305`, `nucleo.ts:276-278`) | Tal cual. Falta en los dominios nuevos (cada función lo declara) |
| **No inventa** | Verificador de `responder` (cifras, fechas y links con respaldo, `agente/verificador.ts`). En público, además, la guarda de plata (`DepsTurno.guardaTexto`, `nucleo.ts:39-47`; `publico/precios.ts`) | Tal cual |
| **Opciones cerradas con botones** (3 botones o lista de 10) | `renderizar` con los límites de Meta (`agente/render.ts:51`); `responder.opciones` (`herramientas.ts:74-90`) | Tal cual |
| **Fricción de botones caducados** (4 de 9 corridas, diagnóstico F6) | Si la propuesta cambió, el toque viejo reenvía la vigente (`nucleo.ts:591`). Si no hay vigente, sigue saliendo «Ese botón ya no está vigente: no hice nada» (`nucleo.ts:564`, `:592`) | Generalizar: sin vigente, ofrecer rearmar el resumen, no cerrar la puerta |
| **Audio, foto, PDF y documentos** | Audio transcrito por Gemini antes del turno (`_shared/wa-agente.ts:131-135`, `_shared/wa-transcribe.ts:63`). Foto y PDF guardados y leídos (`agente/adjuntos.ts`, `one/lectura-adjunto.ts`, `tipos.ts:286-297`). Documento entra como clase `otro` con su `media` (`_shared/wa-conversacion.ts:75-77`) | Tal cual |
| **Pistas de nombres y códigos para transcribir** | El prompt es neutro y no recibe pistas (`wa-transcribe.ts:56-57`). El modelo de audio es `gemini-2.5-flash-lite` por defecto (`wa-transcribe.ts:9`). La llave va en la URL (`wa-transcribe.ts:125`) | Nuevo (§4.6) |
| **Saludo del día con nombre propio y presentación en el primer contacto** | En público, el aviso de bienvenida en el primer mensaje, al volver de persona y tras una pausa larga (`publico/autorizacion.ts:119`). En ONE no hay saludo por hora | Generalizar: el saludo es parte de la ficha de rol (§2.4) |
| **Catálogo de funciones** | No existe como tal. Lo más cercano: las herramientas de etapa 2 de público, declaradas y apagadas (`publico/dominio.ts:50-56`, `encendida: false`) | Nuevo (§2.2) |
| **Funciones prendidas por empresa** | Solo interruptores sueltos en el jsonb: `obras` (en #1235), `chatwoot.activo`, `leer_adjuntos` (`config.ts:45-50`) | Nuevo (§2.3) |
| **Ficha de rol, por versiones, con marcha atrás** | El reglamento ya es eso, pero por (workspace, bot) y con **un solo puntero por workspace** (`config.ts:60-61`, `:121`) | Generalizar: un puntero por rol (§2.4) |
| **Ningún rol se prende sin pasar el arnés** | `bot_reglamentos.banco` guarda el resultado, pero nada lo exige al publicar (`20261006213200_bot_reglamento_y_uso.sql:68-69`, `:99-137`) | Generalizar: publicar exige un banco que pasa (§2.8) |
| **Permiso en el código** | El núcleo solo deja llamar lo declarado (`nucleo.ts:338`, `nucleo.ts:421`). Pero el dominio ONE declara **todas** sus herramientas a todos los roles (`one/dominio.ts:1043-1048`) y frena por rol al ejecutar (`one/dominio.ts:148-164`, `:541-542`). Un operador ve `ingreso` y `contacto_nuevo` y recibe «tu rol no permite» | Generalizar: declarar solo lo del rol (§2.6) |
| **Se pasan el trabajo por la base** | Ya pasa así: la bandeja y ONE escriben en las tablas de negocio y las pantallas lo leen | Tal cual, como regla (§2.7) |
| **Cuatro señales para parar y pasar a una persona** | Público: `pasar_a_persona` con 14 motivos, nota privada, etiqueta y `toggle_status` en Chatwoot (`publico/dominio.ts:192-205`, `publico/tipos.ts:57-64`). ONE y la bandeja: no tienen a quién pasar. El único aviso a MéTRIK es el del cupo (`agente/uso.ts:86`) | Generalizar desde público; nuevo en ONE (§4.2) |
| **Resumen diario por correo (Resend)** | No existe. Los avisos internos salen por WhatsApp (`enviarAvisoInterno`, `agente/produccion.ts:135`; `chatwoot-agente/index.ts:92`) y se pierden fuera de la ventana de 24 h (25 perdidos, diagnóstico F8) | Nuevo (§4.3) |
| **Correo inmediato si caen principal y respaldo** | ONE y la bandeja: Haiku 5.5 de principal y Gemini de respaldo, ya en proveedores distintos (`agente/modelo-gemini.ts:16-19`). Si caen los dos, la persona recibe `rf.modelo_caido` y nadie se entera (`nucleo.ts:256-260`). Sabor: sin modelo de respaldo (`agente/modelo-anthropic.ts:1-12`); si falla, pasa a persona (`publico/cola.ts:264-270`). Decisión del 26-oct: ese es su respaldo, una persona de Sabor en Chatwoot | Nuevo: el correo (§4.1) |
| **Calificación diaria de conversaciones** | No existe. El arnés califica casos sintéticos (`agente/arnes/calificar.ts:65`) | Nuevo (§4.4) |
| **Arnés: cada caso 3 veces, solo se despliega si pasa siempre** | Público corre pass^k por el CLI (`publico/arnes/correr.ts`). El arnés del núcleo corre conjuntos, pero sin pass^k como puerta (`agente/arnes/correr.ts:1-14`) | Generalizar |
| **Toque de botones de plantilla** (`type:"button"`) | **No llega.** `mensajeConTelefono` no construye `type: 'button'` y cae en el `return null` de «tipo no soportado» (`_shared/wa-webhook-payload.ts:384`). Lo de después ya lo soporta: `claseDelEntrante` lo cuenta como toque (`wa-conversacion.ts:71`) y el agente lo mira (`wa-agente.ts:106`). El arreglo ya está escrito en el PR #966, junto con los recordatorios (apagados) y sus dos migraciones | Tal cual al mergear #966, que Mauricio pidió mergear el 26-oct (§4.5) |
| **Métricas por rol** | El uso del mes sale de las trazas (`agente/uso.ts:41`, RPC `bot_uso_mes`). Costo por modelo con `bot_modelo_precios` | Generalizar: métricas por rol (§2.9) |
| **Cupo** | 800 turnos por workspace, con aviso a MéTRIK por WhatsApp (`config.ts:76`, `uso.ts:86-102`). #1235 lo cuenta en mensajes, como dicen los contratos | Generalizar desde #1235 |

### 1.3 Qué se usa tal cual, qué se generaliza y qué es nuevo

- **Tal cual:** el núcleo (turno, propuestas con huella, verificador, registros contra la base, render de Meta), los puertos de Chatwoot, las autorizaciones de público, la lectura de adjuntos, el adaptador nativo de Anthropic y el reglamento inmutable con huella.
- **Se generaliza:**
  - el dominio de cada producto pasa a ser la **composición** de las funciones del rol;
  - el puntero del reglamento pasa de uno por workspace a uno por rol;
  - el permiso por rol pasa de frenar al ejecutar a no declarar;
  - el paso a persona sale de público y llega a ONE;
  - la tanda en lote y el cupo en mensajes salen de #1235.
- **Nuevo:**
  - tablas de funciones por empresa, roles y asignaciones;
  - traspaso con botón al WhatsApp de MeTRIK;
  - correo inmediato;
  - resumen diario;
  - calificación diaria;
  - botón de plantilla con su prefijo;
  - transcripción con pistas y su prueba;
  - preferencias recordadas.

---

## 2. Modelo de roles y funciones

### 2.1 Las piezas

| Pieza | Qué es | Dónde vive | Quién la cambia |
|---|---|---|---|
| **Función** | Una capacidad con sus herramientas (lecturas, acciones de `proponer`, cierres), sus candados, sus fichas de reglas y sus casos del arnés | Código: `agente/funciones/<clave>.ts` | MéTRIK, con PR y arnés |
| **Funciones de la empresa** | Qué funciones tiene prendidas un workspace y con qué parámetros (rubros sí o no, abono, tope de obras por día) | Base: `asistente_funciones_empresa` | MéTRIK por SQL o pantalla de configuración, sin desplegar |
| **Rol** | La ficha: a quién atiende, tono, nombre del asistente, funciones asignadas, límites, saludo, a quién escala y canal | Base: `asistente_roles` (cabecera) más su reglamento publicado en `bot_reglamentos` (contenido, por versiones) | El skill de Yuto y Mik la arma con el cliente; se publica solo si pasa el arnés |
| **Asignación** | Qué persona o canal habla con qué rol | Base: `asistente_asignaciones` | MéTRIK o el admin del workspace |

Regla de composición: **herramientas del turno = funciones asignadas al rol ∩ funciones prendidas en la empresa.** Si una función está asignada pero apagada en la empresa, no aparece. Si está prendida pero no asignada, tampoco.

### 2.2 Catálogo de funciones (sale de los tres casos)

Cada función declara: `clave`, `familia` (equipo o clientes), sus herramientas, sus candados en código, sus fichas (`con_herramienta` y de índice) y su conjunto de casos del arnés. La columna «Casos» dice de dónde sale; una función sin cliente no entra al catálogo.

**Columnas:**
- **Herramientas que aporta:** lecturas, acciones de `proponer` y cierres.
- **Hoy en el código:** dónde vive ya.
- **Casos:** S = Sabor, I = Imperviun, L1 = Laura frente 1, L2 = Laura frente 2.

**Comunes a todo rol** (las pone el núcleo; no se asignan):

| Clave | Herramientas que aporta | Candado principal | Hoy en el código | Casos |
|---|---|---|---|---|
| `nucleo.responder` | `responder` | verificador: cifras, fechas y links con respaldo | `herramientas.ts:74` | Todos |
| `nucleo.proponer` | `proponer` (las acciones las ponen las funciones) | solo con toque y huella vigente | `herramientas.ts:53` | Todos los que escriben |
| `comun.persona` | cierre `pasar_a_persona` (o `ofrecer_persona` en ONE) | nunca dos veces seguidas; motivo de lista cerrada | `publico/dominio.ts:194` | Todos |
| `comun.fuera_de_tema` | ficha y respuesta fija que nombra lo que sí hace el rol | la arma el código con las funciones del rol, no un texto fijo | `one/reglamento.ts:87` (texto fijo) | Todos |

**Familia equipo** (personas de la empresa, conocidas por su número):

| Clave | Herramientas que aporta | Candados | Hoy en el código | Casos |
|---|---|---|---|---|
| `equipo.gastos` | `buscar_negocios`, `negocios_abiertos`, `gastos_recientes`, cierre `preguntar_destino`; acciones `gasto`, `adjuntar_soporte`, `corregir_gasto` | destino real o «gasto de empresa» elegido; monto positivo; soporte de esta conversación y no usado | `one/dominio.ts:444-480`, `ACCIONES_ONE` (`:126`) | I, L1 |
| `equipo.gastos_obra` | la de arriba más rubros propios, número de transacción, fecha del pantallazo, huella de imagen y pago partido entre dos obras | número repetido pregunta, no bloquea; rubro de la lista del workspace | PR #1235 (C1-C3, C22, D3) | I |
| `equipo.ingresos` | acción `ingreso` contra cuotas pendientes | cuota real del negocio; un depósito a la cuenta propia es ingreso | `one/dominio.ts` (#1231) | I, L1 (ver `equipo.cobros_clienta`) |
| `equipo.facturas` | acción `factura`; asociar cobro a factura | número repetido pregunta; no marca pagada ni habla de retenciones | PR #1235 (C9, C16) | I |
| `equipo.correcciones` | acción `corregir` de cualquier campo de un registro, buscado en la base, con antes y después | el registro existe y no está revisado | `corregir_gasto` solo cambia el monto; #1235 C14 lo abre a todo | I, L1 |
| `equipo.consulta_negocio` | `ver_negocio`; cierre de obra con utilidad hasta hoy | toda cifra sale de la base en el turno | `one/dominio.ts:455`; #1235 C15 | I |
| `equipo.asistencia` | consulta de llegadas por día o período, y quién no marcó | solo gestión; sin pesos | PR #1235 (C23) | I |
| `equipo.actividades` | acción `actividad` | negocio real | `one/dominio.ts` | (equipo ONE de hoy) |
| `equipo.contactos` | acción `contacto_nuevo` | teléfono escrito en la conversación | `one/dominio.ts` | L1 (proveedores) |
| `equipo.citas` | acción `cita` (clienta, servicio del portafolio, precio, descuento, resultado: atendida, no asistió, cancelada) | servicio del portafolio; descuento ≤ precio; la clienta existe o se propone nueva | No existe | L1 |
| `equipo.cobros_clienta` | acción `pago_clienta` (abono a deuda o a cuota); lecturas `deudas`, `cuotas_de_clienta` | el pago no pasa del saldo sin preguntar; la cuota es real | No existe | L1 |
| `equipo.portafolio` | lectura `ver_portafolio` | precio de la base; sin inventar servicios | No existe | L1 (y L2 la comparte) |
| `equipo.resumen_negocio` | lectura `como_voy` (entra, sale, quién debe, por período) | cifras de la base | parcial: `gastos_recientes` | L1 |
| `equipo.cupo` | lectura «¿cuántos mensajes llevamos?» | cifra de la base; nunca a un operario | PR #1235 (C17) | I |

**Familia equipo, recolector** (conversación corta y cerrada):

| Clave | Herramientas que aporta | Candados | Hoy en el código | Casos |
|---|---|---|---|---|
| `recolector.llegada_obra` | acción `llegada`; lectura `obras_activas` | hora del servidor, no la del texto; el mismo día; máximo dos obras por día; vence a medianoche de Bogotá; sin ubicación (D10) | PR #1235 (C5, C7) | I |
| `recolector.mis_jornadas` | lectura de sus propios días | sin pesos (la guarda del texto los rechaza); nunca datos de otros | PR #1235 (`operario.ts`, `sinPesos`) | I |
| `recolector.apertura_diaria` | plantilla de utilidad que abre la jornada; el toque abre la ventana | día hábil; solo a inscritos con autorización; una por día | No existe (el envío por plantilla está en #966, sin mergear) | I: entra apagada y se prende después (decisión del 26-oct, §6.1-2) |

**Familia clientes** (clientes de la empresa, muchas veces desconocidos):

| Clave | Herramientas que aporta | Candados | Hoy en el código | Casos |
|---|---|---|---|---|
| `clientes.ficha` | `ver_catalogo`, `ver_funciones` (generalizar a «experiencia» y «horarios»: una función de cine es un tipo de experiencia más, §3.1) | solo lo vigente hoy; nunca dice «disponible»; precios solo de la herramienta; ningún código distinto por tipo de experiencia | `publico/dominio.ts:163-176`, `publico/catalogo.ts`, `publico/precios.ts` | S, L2 |
| `clientes.origen` | sin herramienta: el código lee el origen del mensaje (anuncio, código de campaña) y lo pone en el Estado del turno con la experiencia que le corresponde | el origen solo orienta; nunca bloquea ni reemplaza lo que dice la persona; sin origen, se pregunta solo si hay más de una experiencia activa | No existe en el asistente. Las tablas y RPC de campañas y anuncios están en #1234 (`funcion_campanas.codigo`, `funcion_campana_anuncios`, `funcion_campana_por_anuncio`) | S |
| `clientes.cobro_saldo` | `preparar_pago_saldo` (link por el saldo de una reserva ya apartada) | el saldo lo calcula la base; el link vence en el plazo de la campaña; la experiencia no empieza con saldo sin pagar (lo vigila el equipo en la lista del día) | RPC `funcion_saldo` y `funcion_preparar_pago_saldo` en #1234 | S |
| `clientes.reglas` | `consultar_reglas` por clave | `sin_dato` lleva a `duda_abierta` y persona | `publico/dominio.ts:173` | S, L2 |
| `clientes.autorizacion` | respuestas fijas de autorización general y sensible, leídas por el código | sin «sí» no se guarda ningún dato; prueba inmutable | `publico/autorizacion.ts`, tabla `chatwoot_consentimientos` (`20261021090000_asistente_chatwoot.sql:92-139`) | S, L2 |
| `clientes.toma_datos` | acción `reserva` (`proponer`): arma el resumen con lo escrito después del «sí» | exige autorización; etapa 1 pasa a persona con `reserva_lista` | `publico/dominio.ts:209-215` | S, L2 |
| `clientes.cupo` | `consultar_cupo` | lo calcula la base; con margen bajo la capacidad (A6) | declarada y apagada (`publico/dominio.ts:52`); tablas en #1234 | S (9-nov) |
| `clientes.apartar` | `apartar` | sin sobreventa; con propuesta vigente y autorización | declarada y apagada (`:53`); #1234 | S, L2 (cita) |
| `clientes.cobro_link` | `generar_link_pago`, `verificar_pago` | monto y referencia salen del apartado; solo «aprobado» confirma | declaradas y apagadas (`:54-55`); llaves por workspace en #1234 | S, L2 |
| `clientes.agenda` | `horarios_libres` y acción `cita` | disponibilidad de la base; nunca promete una hora que no devolvió | No existe | L2 |
| `clientes.precio_autorizado` | respuesta fija ante crítica de precio o pedido de descuento | no negocia | `publico/sobreventa.ts` (#1266) | S |

Lo que el catálogo **no** trae, porque ningún caso lo pide: inventario, cartera, nómina, cotizaciones, un asistente para los clientes de Imperviun ni ubicación del operario (fuera de alcance en el diseño de Imperviun, §7). Tampoco pedidos en sala ni cuenta por persona en Sabor, que son un proyecto posterior.

**Casos de prueba mínimos por función.** Cada función trae los suyos en `agente/funciones/<clave>.casos.ts`, con tres tipos, y pasa pass^3:
- donde **debe** actuar;
- donde **no debe** actuar (el modelo propone algo que el candado tiene que atajar);
- un caso de rol, que pide la función desde un rol que no la tiene y espera que no exista.

Los casos reales de cada cliente van aparte, en el conjunto de su rol (§3).

### 2.3 Funciones prendidas por empresa

- Tabla `asistente_funciones_empresa`: `(workspace_id, funcion, activa, parametros jsonb)`. `parametros` lleva lo que la función deja configurar. Ejemplos:
  - `equipo.gastos_obra`: `{ "rubros": true }`;
  - `recolector.llegada_obra`: `{ "max_obras_dia": 2 }`;
  - `clientes.cobro_link`: `{ "pasarela": "bold", "abono": 100000 }`.
- **El catálogo vive en el código** (es código). La base solo dice cuáles están prendidas. Una clave que no existe en el código se ignora y queda en el log: nunca abre nada.
- Las funciones comunes del núcleo no se prenden ni se apagan.
- **Transición.** Los workspaces que hoy usan el dominio ONE por defecto siguen igual hasta tener filas. Sin filas, rige el conjunto de hoy (`permisosDe`, `one/dominio.ts:148`), así que no hay cambio de comportamiento el día del merge.

### 2.4 La ficha de rol, con versiones y marcha atrás

**Cabecera** (`asistente_roles`, una fila por rol del workspace; cambia poco):

| Campo | Qué es |
|---|---|
| `clave` | `mano_derecha`, `recolector`, `asesor_vendedor`… (única en el workspace) |
| `familia` | `equipo` o `clientes`: decide qué autorización se pide y qué métricas se suman |
| `canal` | `wa_one` (el número de Agus, `wa-webhook`), `chatwoot` (`chatwoot-agente`) o `wa_propio` (número de la empresa; §3.3) |
| `reglamento_id` | **El puntero** a la versión publicada en `bot_reglamentos`. Marcha atrás = mover el puntero a una versión anterior |
| `activo` | Interruptor del rol (apagado: el canal responde la respuesta fija de «no disponible» o, en Chatwoot, no contesta) |

**Contenido** (va dentro del reglamento publicado, para que versione junto con las reglas). Son fichas del reglamento de hoy, más tres claves nuevas:

| Ficha | Tipo | Qué lleva |
|---|---|---|
| `perfil` | `perfil` | `valores.nombre` (Agus por defecto), `audiencia`, `idioma`, trato (tú o usted) |
| `rol.funciones` | `alcance`, nueva clave | `valores.funciones: string[]`: las funciones asignadas. El código lee esta lista para componer el dominio |
| `rol.escalamiento` | `alcance`, nueva clave | `valores`: a quién se pasa (`chatwoot_equipo` con id por motivo, o `wa_link` con número y plantilla del mensaje), si ofrece o pasa directo, y el horario si lo hay |
| `rol.saludo` | `estilo`, nueva clave | Si saluda por hora con el nombre, la presentación del primer contacto y la plantilla diaria (nombre aprobado en Meta), si la hay |
| `alc.*`, `inv.*`, `g.*`, `p.*`, `rf.*` | los de hoy | Las del rol. Las de las funciones viajan con su herramienta (`con_herramienta`) y no se duplican aquí |

**Por qué así.** Publicar sigue siendo una foto inmutable con huella (`bot_reglamentos_inmutable`, `20261006213200_bot_reglamento_y_uso.sql:81-95`). Cambiar las funciones de un rol es publicar una versión nueva. Volver atrás devuelve a la vez las reglas y las funciones de ese momento, sin desajustes.

**Publicar exige el arnés.** Una función nueva `asistente_publicar_rol` envuelve a `bot_publicar_reglamento` y rechaza la publicación si:
- el `banco` no trae `pasa = true` con su `k`, la fecha y la huella de las fichas que se probaron;
- o alguna función de `rol.funciones` no está prendida en la empresa.

El banco lo produce el arnés (`arnes/correr.ts` y `publico/arnes/correr.ts`) con la huella de lo probado. Si las fichas cambian después de probar, la huella no coincide y no publica.

**El skill que arma la ficha** (pendiente de Yuto y Mik en el ADN) produce las filas de `bot_parametros` del rol. Este documento solo fija el formato de salida: las fichas de la tabla de arriba.

### 2.5 Cómo se asigna cada persona o canal a un rol

Tabla `asistente_asignaciones`. Una fila asigna un **sujeto** a un rol, con vigencia:

| `sujeto_tipo` | Llave | Ejemplo |
|---|---|---|
| `staff` | `profile_id` (usuario de ONE) | Liliana → `mano_derecha` |
| `colaborador` | `collaborator_id` (`wa_collaborators`) | cada operario → `recolector` |
| `cargo` | el `role` de ONE (`owner`, `admin`, `operator`…) | todo `owner` del workspace → `mano_derecha` (regla por defecto) |
| `inbox` | `inbox_id` de Chatwoot o `phone_number_id` de Meta | el inbox de Instagram de Sabor → `asesor_vendedor` |

**Cómo se resuelve**, de lo más específico a lo menos: persona (staff o colaborador), luego cargo, luego inbox.
- Gana la fila vigente más específica.
- **Sin ninguna fila**, rige el enrutamiento de hoy (`dominioDelAgente`, `config.ts:170`), sin cambios para los workspaces que no se migran.
- **Conservador por diseño.** Si la lectura falla, entra el rol con menos funciones del workspace. Es el mismo criterio de #1235, que deja como operario a quien no se puede clasificar.
- **Una persona, un rol por canal.** Si Liliana es mano derecha en Imperviun, no hay un segundo rol para ella en el mismo número. El caso «una persona en dos workspaces» (diseño de Imperviun §6.3-f) no lo resuelve este modelo: sigue el comportamiento de hoy, que toma el primero (`wa-identificar.ts:37`). Queda como riesgo en §6.

### 2.6 El permiso en el código

Hoy el núcleo ya tiene la regla correcta: solo deja llamar las herramientas que el dominio declaró (`nucleo.ts:338`) y solo las acciones de su lista (`nucleo.ts:421`). Lo que falla es que el dominio ONE declara todo a todos. El cambio:

1. **`componerDominio(rol, funcionesEmpresa, puertos)`** arma un `Dominio` cuyas `lecturas`, `cierres`, `acciones` y `datosProponer` son **solo** la unión de las funciones que quedan tras la intersección de §2.1. `leer`, `proponer`, `ejecutar` y `cerrar` despachan a la función dueña de esa herramienta. El núcleo no cambia.
2. **El reglamento del turno lleva solo las fichas de esas funciones.** Las `con_herramienta` ya se filtran solas (`reglamento.ts:57-61`); las de índice de cada función se agregan al componer. El modelo no lee reglas de lo que no tiene.
3. **La respuesta de fuera de tema la arma el código** con las funciones del rol. Hoy es un texto fijo que nombra todo lo de ONE (`one/reglamento.ts:87`), y en la bandeja tapa consultas legítimas (diagnóstico F2).
4. **Segunda llave en el ejecutor.** Cada función, al ejecutar, vuelve a revisar que su clave esté en el rol del turno. Así, aunque alguien declare de más por error, no escribe.
5. **Prueba que lo hace cumplir.** Para cada rol de los casos de §3, la lista de herramientas declaradas tiene que ser exactamente la esperada, y una herramienta ajena devuelve «No existe la herramienta». Si alguien agrega una herramienta a una función sin actualizar los roles, la prueba falla.

**Efecto en ONE de hoy.** Si se aplica a `dominioOne` (cada cargo con sus funciones según `permisosDe`), un operador deja de ver `ingreso` y `contacto_nuevo` y el modelo deja de proponerlos. Cambia lo que el modelo ve, así que hay que volver a correr la evaluación del dominio ONE antes del merge (la de Haiku del 21-oct, 6 de 6). Caché: la lista de herramientas de un rol es fija, así que el caché por rol se mantiene. Cambiar herramientas entre turnos de una misma conversación sí lo invalidaría, y con razonamiento da error (ADN, condición técnica; estado del arte §6). Por eso **el rol se fija al empezar la conversación y no cambia a mitad**.

### 2.7 Cómo se pasan el trabajo por la base

- **Ningún rol llama a otro.** No hay herramienta «avisarle a la mano derecha». Lo que un rol escribe queda en las tablas de ONE, y otro rol lo lee con sus funciones de lectura, en su turno, consultando la base.
- Ejemplos de los tres casos:
  - **Sabor:** el asesor-vendedor aparta y cobra (`funcion_reservas` de #1234). El equipo lo ve en el panel y en la lista del día de ONE.
  - **Imperviun:** el recolector marca la llegada (`llegadas_obra`, #1235). La mano derecha la ve con `equipo.asistencia`, y el cierre de la obra suma la jornada (`v_cierre_obra`).
  - **Laura (frente 2, cuando exista):** el asesor aparta una cita (`clientes.agenda`). La mano derecha la ve en «citas de hoy» y la cierra con su resultado y su pago (`equipo.citas`).
- **Qué tiene que garantizar cada función de escritura:**
  - escribe con `registrado_por` (rol y canal) para que la otra sepa de dónde vino;
  - no deja estados intermedios que la otra tenga que adivinar (una reserva sin pago es «apartada», no «confirmada»).
- **Lo único que sale de un rol hacia una persona es el traspaso** (§4.2), y queda en `asistente_escalamientos`.

### 2.8 Borrador de SQL (no se aplica)

Migración propuesta: `supabase/migrations/2026MMDDHHMMSS_asistentes_roles.sql`. El timestamp se fija al construir, revisando que no choque con otra del mismo día. Es aditiva:
- solo tablas y funciones nuevas;
- `epoca: no-rompe`;
- nada del código de hoy las lee hasta que se construya el componedor.

Server-only, como `bot_parametros` y `bot_reglamentos`. Lleva su ensayo `DO $dry$ … RAISE` en el PR, como siempre.

```sql
-- BORRADOR. No aplicar. Spec docs/specs/2026-10-26_asistentes-roles-y-funciones.md, §2.

-- 1. Funciones prendidas por empresa. El catálogo vive en el código; aquí solo qué está prendido y con qué parámetros.
create table public.asistente_funciones_empresa (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  funcion text not null,                       -- clave del catálogo en código: 'equipo.gastos', 'clientes.cupo'…
  activa boolean not null default true,
  parametros jsonb not null default '{}'::jsonb,
  prendida_por text not null,                  -- quién la prendió (correo o 'max', como bot_reglamentos.publicado_por)
  updated_at timestamptz not null default now(),
  primary key (workspace_id, funcion),
  constraint asistente_funciones_empresa_clave check (funcion ~ '^(equipo|recolector|clientes)\.[a-z_]+$')
);
alter table public.asistente_funciones_empresa enable row level security;
revoke all on public.asistente_funciones_empresa from anon, authenticated;
grant all on public.asistente_funciones_empresa to service_role;

-- 2. Roles: la cabecera. El contenido (funciones, escalamiento, saludo, reglas) va en la versión publicada de bot_reglamentos.
create table public.asistente_roles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  clave text not null,                         -- 'mano_derecha', 'recolector', 'asesor_vendedor'
  familia text not null,
  canal text not null,
  reglamento_id uuid references public.bot_reglamentos(id),   -- puntero; null = el rol no se ha publicado y no atiende
  activo boolean not null default false,       -- nace apagado: se prende después de publicar con banco que pasa
  updated_at timestamptz not null default now(),
  constraint asistente_roles_clave unique (workspace_id, clave),
  constraint asistente_roles_familia check (familia is not null and familia in ('equipo', 'clientes')),
  constraint asistente_roles_canal check (canal is not null and canal in ('wa_one', 'chatwoot', 'wa_propio')),
  constraint asistente_roles_activo_publicado check (not activo or reglamento_id is not null)
);
-- El puntero tiene que ser una versión del MISMO workspace y del bot del rol (bot = 'rol:' || clave).
create or replace function public.asistente_roles_puntero_valido() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.reglamento_id is not null and not exists (
    select 1 from public.bot_reglamentos r
    where r.id = new.reglamento_id and r.workspace_id = new.workspace_id and r.bot = 'rol:' || new.clave
  ) then
    raise exception 'el reglamento % no es una versión del rol % en este workspace', new.reglamento_id, new.clave;
  end if;
  new.updated_at := now();
  return new;
end; $$;
revoke execute on function public.asistente_roles_puntero_valido() from public, anon, authenticated;
create trigger asistente_roles_puntero_valido before insert or update on public.asistente_roles
  for each row execute function public.asistente_roles_puntero_valido();
alter table public.asistente_roles enable row level security;
revoke all on public.asistente_roles from anon, authenticated;
grant all on public.asistente_roles to service_role;

-- 3. Asignaciones: quién (persona, cargo o canal) habla con qué rol.
create table public.asistente_asignaciones (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  rol_id uuid not null references public.asistente_roles(id) on delete cascade,
  sujeto_tipo text not null,
  profile_id uuid references public.profiles(id) on delete cascade,
  collaborator_id uuid references public.wa_collaborators(id) on delete cascade,
  cargo text,
  inbox text,                                  -- inbox_id de Chatwoot o phone_number_id de Meta, como texto
  desde timestamptz not null default now(),
  hasta timestamptz,
  asignado_por text not null,
  constraint asistente_asignaciones_tipo check (sujeto_tipo is not null and sujeto_tipo in ('staff', 'colaborador', 'cargo', 'inbox')),
  constraint asistente_asignaciones_una_llave check (
    (sujeto_tipo = 'staff'       and profile_id is not null and collaborator_id is null and cargo is null and inbox is null) or
    (sujeto_tipo = 'colaborador' and collaborator_id is not null and profile_id is null and cargo is null and inbox is null) or
    (sujeto_tipo = 'cargo'       and cargo is not null and profile_id is null and collaborator_id is null and inbox is null) or
    (sujeto_tipo = 'inbox'       and inbox is not null and profile_id is null and collaborator_id is null and cargo is null)
  ),
  constraint asistente_asignaciones_vigencia check (hasta is null or hasta > desde)
);
-- Un sujeto tiene una sola asignación vigente por workspace (la resolución no tiene que desempatar).
create unique index asistente_asignaciones_vigente on public.asistente_asignaciones
  (workspace_id, sujeto_tipo, coalesce(profile_id::text, collaborator_id::text, cargo, inbox))
  where hasta is null;
alter table public.asistente_asignaciones enable row level security;
revoke all on public.asistente_asignaciones from anon, authenticated;
grant all on public.asistente_asignaciones to service_role;
-- SIN VERIFICAR: que la llave de staff sea profiles.id (wa_identify_user devuelve user_id; hay que confirmar la tabla
-- y la columna exactas antes de construir). Ver la consulta 7.6.

-- 4. Publicar un rol: exige banco que pasa y funciones prendidas.
create or replace function public.asistente_publicar_rol(
  p_workspace_id uuid, p_rol text, p_publicado_por text, p_banco jsonb
) returns uuid
language plpgsql set search_path = public as $$
declare
  v_id uuid;
  v_funciones jsonb;
  v_faltan text[];
begin
  if p_banco is null or coalesce((p_banco->>'pasa')::boolean, false) is not true
     or p_banco->>'huella_fichas' is null or coalesce((p_banco->>'k')::int, 0) < 3 then
    raise exception 'el rol % no se publica sin un banco del arnés que pase con k >= 3', p_rol;
  end if;
  v_id := public.bot_publicar_reglamento(p_workspace_id, 'rol:' || p_rol, p_publicado_por, p_banco);
  -- Lo probado tiene que ser lo publicado.
  if (select huella from public.bot_reglamentos where id = v_id) <> p_banco->>'huella_fichas' then
    raise exception 'las fichas cambiaron después de la prueba: vuelve a correr el arnés';
  end if;
  select f->'valores'->'funciones' into v_funciones
    from public.bot_reglamentos r, jsonb_array_elements(r.fichas) f
   where r.id = v_id and f->>'clave' = 'rol.funciones';
  select array_agg(x) into v_faltan
    from jsonb_array_elements_text(coalesce(v_funciones, '[]'::jsonb)) x
   where not exists (select 1 from public.asistente_funciones_empresa e
                      where e.workspace_id = p_workspace_id and e.funcion = x and e.activa);
  if v_faltan is not null then
    raise exception 'funciones asignadas que la empresa no tiene prendidas: %', v_faltan;
  end if;
  return v_id;  -- mover el puntero (asistente_roles.reglamento_id) es un paso aparte y explícito
end; $$;
revoke execute on function public.asistente_publicar_rol(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.asistente_publicar_rol(uuid, text, text, jsonb) to service_role;
-- Ojo: la excepción revierte también la versión que insertó bot_publicar_reglamento (misma transacción).
-- SIN VERIFICAR: que la huella que calcula bot_publicar_reglamento (sha256 del jsonb en SQL) sea la misma que calcula
-- el arnés en TypeScript (`huellaDe`, canónico ordenado). Si no coinciden, el banco guarda la huella calculada en SQL
-- con una consulta de ensayo, o se compara el canónico. Se prueba en PGlite antes de construir.

-- 5. Traspasos a una persona (para el resumen diario y la métrica «escalamientos hechos y debidos»).
create table public.asistente_escalamientos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  rol_clave text not null,
  canal text not null,
  conversacion text not null,                  -- 'wa:<phone>' o 'cw:<cuenta>:<conversacion>'
  motivo text not null,                        -- pide_persona, bucle, no_pude, frustracion, sin_dato, falla, …
  resumen text not null,                       -- lo arma el código; nunca un dato sensible
  modo text not null,                          -- 'ofrecido' (la persona no lo tomó), 'pasado', 'link'
  created_at timestamptz not null default now(),
  constraint asistente_escalamientos_modo check (modo is not null and modo in ('ofrecido', 'pasado', 'link'))
);
create index asistente_escalamientos_dia on public.asistente_escalamientos (workspace_id, created_at);
alter table public.asistente_escalamientos enable row level security;
revoke all on public.asistente_escalamientos from anon, authenticated;
grant all on public.asistente_escalamientos to service_role;

-- 6. Calificación diaria de conversaciones (una fila por conversación y día).
create table public.asistente_calificaciones (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  rol_clave text not null,
  fecha date not null,                         -- día de Bogotá
  conversacion text not null,
  fallas jsonb not null default '[]'::jsonb,   -- [{ tipo: 'F6', turno: '<turno_id>', evidencia: '…' }]
  resuelta boolean,
  nota smallint,                               -- 1 a 5
  juez text not null,                          -- modelo y versión de la lista de fallas
  revisada_por text,                           -- Mauricio, si la confirmó o la corrigió (calibración)
  created_at timestamptz not null default now(),
  constraint asistente_calificaciones_una unique (workspace_id, fecha, conversacion),
  constraint asistente_calificaciones_nota check (nota is null or nota between 1 and 5)
);
alter table public.asistente_calificaciones enable row level security;
revoke all on public.asistente_calificaciones from anon, authenticated;
grant all on public.asistente_calificaciones to service_role;

-- 7. Preferencias recordadas (ADN regla 3). Se proponen con un toque; nunca se aprenden en silencio.
create table public.asistente_preferencias (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  sujeto text not null,                        -- 'staff:<id>' o 'colaborador:<id>'
  clave text not null,                         -- 'proveedor:<nit o nombre normalizado>'
  valor jsonb not null,                        -- { destino: 'empresa' } o { rubro: '<id>' }
  confirmada_en_turno uuid not null,           -- el turno del toque que la aceptó
  activa boolean not null default true,
  created_at timestamptz not null default now(),
  constraint asistente_preferencias_una unique (workspace_id, sujeto, clave)
);
alter table public.asistente_preferencias enable row level security;
revoke all on public.asistente_preferencias from anon, authenticated;
grant all on public.asistente_preferencias to service_role;
```

Lo que **no** trae esta migración, a propósito:
- Las tablas de dominio de cada cliente. Las de Sabor están en #1234 y las de Imperviun en #1235 y #1237. Las de Laura van en su propia migración (§3.3).
- Ninguna fila sembrada. Los roles y las asignaciones de cada cliente se cargan por SQL aparte, con autorización.

### 2.9 Métricas por rol

Salen de las trazas (`wa_conversacion.traza`, `chatwoot_conversacion.traza`), de `asistente_escalamientos` y de `asistente_calificaciones`. Para eso, la traza de cada turno tiene que traer `rol` y la versión del reglamento: hoy trae `bot` y `reglamento` (`tipos.ts:341-344`), así que se agrega `rol`.

| Métrica | Cómo se calcula | Fuente |
|---|---|---|
| Resolución | Registros confirmados que siguen en la base sin corrección 7 días después ÷ registros confirmados | traza `ejecucion` y tablas de dominio |
| Fricción | Mensajes y toques de la persona desde el primer mensaje del pedido hasta la ejecución | traza |
| Bloqueos falsos | Fallas F1 y F2 del calificador ÷ conversaciones | `asistente_calificaciones` |
| Reencauce | Turnos con tema `fuera` seguidos de un pedido del alcance | traza `tema` |
| Escalamientos hechos y debidos | Filas de `asistente_escalamientos` frente a fallas F9 del calificador | ambas |
| Acciones dañinas (meta 0) | Registros sin «sí», registros corregidos por estar errados y datos inventados ante un cliente | calificador más candados atajados (traza `candados`) |
| Costo por conversación resuelta | (LLM + transcripción + mensajes Meta facturables) ÷ conversaciones resueltas | `bot_uso_mes` más el pricing del webhook de estados de Meta (SIN VERIFICAR: si `aplicarStatuses` guarda la categoría de cobro) |
| Objetivo del rol | Ventas: reservas pagadas (Sabor, desde la etapa 2). Recolector: llegadas marcadas ÷ operarios inscritos por día hábil. Mano derecha: citas cerradas con su pago (Laura) | tablas de dominio |

---

## 3. Los tres casos armados con el modelo

### 3.1 Sabor & Experiencias (S2 26 1): asesor-vendedor

**Estado.**
- Contrato firmado el 19-oct.
- Salida a clientes reales: jue 29-oct.
- Etapa 2 en prueba el lun 9-nov.
- Espacio completo el vie 13-nov.
- La etapa 1 ya está en `main` (#1225, #1233, #1255, #1256, #1266), con la migración `20261021090000` aplicada (según Yuto, 21-oct).

| Elemento | Definición |
|---|---|
| Rol | `asesor_vendedor`, familia `clientes`. Uno solo |
| Canal | `chatwoot`: Agent Bot por webhook (`chatwoot-agente?ws=<slug>`). Instagram primero, luego TikTok; WhatsApp después del acuerdo escrito del 3-nov (diseño de la etapa 1, D15). No es el número de Agus |
| Funciones, etapa 1 (29-oct) | `clientes.ficha`, `clientes.reglas`, `clientes.autorizacion`, `clientes.toma_datos` (pasa a persona con `reserva_lista`), `clientes.precio_autorizado`, `comun.persona` |
| Funciones, etapa 2 (9-nov) | más `clientes.cupo` (con margen bajo la capacidad, A6), `clientes.apartar`, `clientes.cobro_link` (Bold con las llaves de Sabor, A9; abono configurable, A11), `clientes.cobro_saldo` y `clientes.origen` |
| Escalamiento | Es también su respaldo (decisión del 26-oct): ante la caída del modelo o cualquier señal de escalamiento (§4.2), la conversación pasa a un agente humano de Sabor dentro de Chatwoot con `pasar_a_persona` y los 14 motivos (`publico/tipos.ts:61-64`): nota privada, etiqueta, `toggle_status` a `open`. Si fue caída del modelo, además sale el correo inmediato a MéTRIK (§4.1). Persona pedida: pregunta una vez por qué (§6.4 del diseño, #1256). Pendiente: quién recibe cada motivo y el horario (HUECO de Paula; `persona.horario` vacío = variante sin horario) |
| Saludo y plantilla | Primer contacto: `rf.bienvenida`, que dice que es un asistente virtual, con su nombre y el link de términos (`publico/autorizacion.ts:22`). Sin plantilla: el cliente escribe primero, y escribirle primero para vender es marketing (COP 46,02). El nombre lo da Paula antes del 29-oct (pendiente del kickoff) |
| Autorización de datos | General de un toque antes de pedir nombre, cédula y teléfono; sensible aparte y facultativa para restricciones alimentarias. Prueba inmutable en `chatwoot_consentimientos`. Textos: Emilio, antes del 29-oct. Términos publicados por Sabor (el link aún es de ejemplo: `publico/config.ts:74`) |
| Métricas del rol | Las comunes, más: exactitud del catálogo contra la ficha (100 %), paso a persona correcto (≥ 95 %), tiempo interno p90 ≤ 5 s (diseño §10.2) y, desde la etapa 2, reservas pagadas por el link y reservas con el saldo en cero al empezar la experiencia |
| Casos del arnés | Ya existen: escenarios, adversario, lenguaje, sobreventa y operación (70/70 en seco con k=3; por CLI, sobreventa 15/15 con pass^3 y 0 dañinas, según la memoria del 22-oct). Faltan: el **conjunto real** con las conversaciones de Paula, anonimizadas; la ficha real de la película de la semana; y el payload real de Chatwoot como fixture (hoy armado de la doc, SIN VERIFICAR) |

**Lo que cambió con la nota de voz de Mauricio del 23-oct** (`docs/entrada/nota-voz-evento-2026-10-23.md` del proyecto):

1. **Experiencias, no solo funciones de cine.** Sabor también vende catas de vino, preparación de sushi y otras experiencias gastronómicas, y todas funcionan igual: horarios, precios y cupo.
   - En el modelo, la «experiencia» es genérica y la función de cine es un tipo más, como dato y sin código distinto por tipo.
   - El código del asistente ya es genérico. La ficha del catálogo se llama `experiencia` (`publico/reglamento-sabor.ts:134`) y `catalogo.ts` no distingue tipos.
   - Lo que dice «película» está en los textos, no en la lógica: el perfil del reglamento («películas inmersivas», `reglamento-sabor.ts:41`), la regla de niños (`:167`) y los campos de texto de #1234 (`funcion_experiencias`, «la película o experiencia»).
   - Cambio propuesto: una columna `tipo` en `funcion_experiencias` (texto libre de Sabor: «cine», «cata», «taller»), que solo se muestra; y el perfil y las reglas reescritos para que hablen de experiencias. Los nombres de las tablas de #1234 (`funcion_*`) se quedan: cambiarlos ahora solo agrega riesgo.
   - Caso del arnés: una cata de vino con dos horarios se atiende igual que una función de cine.
2. **Cada experiencia tiene un ID y el asistente sabe cuál interesa por el origen del mensaje** (función `clientes.origen`).
   - Llave: el código de la campaña (`funcion_campanas.codigo`) y los ids de anuncio asociados (`funcion_campana_anuncios`), los dos en #1234.
   - El código lee el origen y lo pone en el Estado del turno («viene del anuncio de la campaña HP-OCT26: experiencia …»). Así no pregunta a qué viene, y la reserva queda atribuida.
   - Sin origen, pregunta solo si hay más de una experiencia activa. El origen nunca bloquea la reserva.
   - Hoy `leerPayload` no lee ningún dato de origen: de `content_attributes` solo toma `submitted_values` (`publico/chatwoot-webhook.ts:100-110`).
   - **SIN VERIFICAR** (lo revisa Yuto) qué dato de origen entregan Meta y Chatwoot en cada caso:
     - anuncios que abren WhatsApp: el diseño de la etapa 2 (§1.7) leyó en la doc que Meta manda `referral` (`source_id`, `ctwa_clid`) y que Chatwoot lo guarda en `content_attributes.referral`, pero falta verlo en un payload real de la cuenta de Sabor y saber si llega solo en el primer mensaje;
     - anuncios de Instagram: según el mismo diseño, Chatwoot descarta el `referral`;
     - publicaciones orgánicas de Instagram y TikTok: no se sabe si llega algo.
   - Respaldo cuando no llega: el código de campaña en el texto precargado del enlace o en la bienvenida del anuncio.
3. **Cobrar el saldo antes de que empiece la experiencia es crítico para Sabor.**
   - Va en la etapa 2 como función propia (`clientes.cobro_saldo`), sobre las RPC de #1234 (`funcion_saldo`, `funcion_preparar_pago_saldo`), con el link del saldo que vence en el plazo de la campaña (`dias_saldo_antes`, desde 1 día).
   - Métrica del rol que se suma: reservas con saldo en cero a la hora de inicio ÷ reservas de la función.
   - Lo que el asistente no cierra: decir que alguien «ya pagó» sin que la pasarela lo confirme.
   - El alcance contractual del link del saldo sigue pendiente del otrosí (diseño de la etapa 2, §1.11-1).
4. **Pedidos en sala y cuenta por persona** son un proyecto posterior, fuera de esta especificación: el modelo no debe cerrar ni prometer pedidos, consumos ni cuentas en sala.

**Cómo entra al modelo de roles.** Desde su salida el 29-oct (decisión del 26-oct). Sabor es el primer rol que corre sobre el componedor:
- las herramientas de `dominioPublico` se reparten en las funciones `clientes.*` de la etapa 1, que despachan al mismo código de `publico/`, sin cambiar comportamiento;
- se registra el rol `asesor_vendedor` (bot `rol:asesor_vendedor`), se publica su reglamento con `asistente_publicar_rol` y su banco del arnés, y se asigna por el inbox de Chatwoot;
- el arnés de Sabor (escenarios, adversario, lenguaje, sobreventa, operación y el conjunto real) tiene que dar lo mismo sobre el rol compuesto que sobre `dominioPublico`, con pass^3 y 0 dañinas. Si no da lo mismo, no sale;
- la etapa 2 (9-nov) no es una migración del rol: es una versión nueva del mismo rol con `clientes.cupo`, `clientes.apartar`, `clientes.cobro_link`, `clientes.cobro_saldo` y `clientes.origen` agregadas, prendidas en la empresa y publicadas con su banco.

Mientras el componedor no tenga filas de un workspace, ese workspace sigue con el enrutamiento de hoy. Eso protege a ONE y a la bandeja de Trappvel, no a Sabor: Sabor sale ya sobre el rol.

### 3.2 Imperviun (I1 26 5): mano derecha y recolector

**Estado.**
- Contrato pendiente del RUT (`pipeline.json`, etapa `contrato`).
- El asistente está construido en el PR #1235 y la web en el #1237, los dos sin mergear y con la migración `20261021183000_obras_asistente_wa.sql` sin aplicar.
- Hoy se enciende con `bot_conversacional.obras = true`. Con eso, el colaborador `tipo = 'operario'` entra con el dominio del operario y `owner`/`admin` con el de obras (rama `feat/imperviun-asistente-wa`, `wa-agente.ts`, función `armarObras`).
- Fechas del contrato: el workspace con obras, rubros y operarios 8 días hábiles después de la firma (paso 3), y el asistente en la semana de prueba de la tercera semana (paso 4).

| Elemento | Mano derecha | Recolector |
|---|---|---|
| Quién | Liliana y quien Imperviun habilite como gestión (cada usuario adicional, $50.000/mes) | Los operarios registrados con su número y su valor de jornada |
| Asignación | `staff` de Liliana → `mano_derecha` (o `cargo: owner` y `admin`) | `cargo` de colaborador con `tipo = 'operario'` → `recolector`. En el modelo nuevo, una fila `colaborador` por operario, que carga la oficina al registrarlo |
| Canal | `wa_one` (el número de Agus) | `wa_one` |
| Funciones | `equipo.gastos_obra`, `equipo.ingresos`, `equipo.facturas`, `equipo.correcciones`, `equipo.consulta_negocio` (cierre de obra), `equipo.asistencia`, `equipo.cupo`, `comun.persona` | `recolector.llegada_obra`, `recolector.mis_jornadas` y `recolector.apertura_diaria`, prendida en la empresa pero apagada al arranque (§6.1-2) |
| Lo que no ve | Lo retenido (se maneja en la plataforma, D1); no crea obras | Plata, datos de otros, resultados de obra (la guarda `sinPesos` del #1235). Su pantallazo lo contesta el código, sin modelo |
| Escalamiento | Botón al WhatsApp de MeTRIK (de Mauricio) con el mensaje escrito (§4.2) | A «la oficina», sin nombrar a Liliana (diseño de Imperviun §3.3). El número lo define Imperviun en la ficha. Pregunta abierta §6.2-a |
| Saludo | Primer mensaje del día: saludo por hora con su nombre; tutea si ella tutea | Inscripción por saludo: se presenta, confirma y pide la autorización. Después, de usted; corto |
| Plantilla | No hace falta: ella escribe primero | `recolector.apertura_diaria` (apagada al arranque; se prende después): utilidad, tres versiones (una por saludo), nombre y empresa como variables, botones `[Empezar]` `[Hoy no]`. Las obras van libres dentro de la ventana, porque cambian y la plantilla no |
| Autorización | La de usuaria de ONE | Aviso corto con `[Acepto]` antes de la primera llegada; sin autorización no se guarda la jornada. Ya existe: `aviso-datos-bot*` y `wa_collaborators.consent_accepted_at`. Texto final: Emilio |
| Métricas | Resolución y fricción por pago registrado; correcciones; consultas | Llegadas marcadas ÷ operarios inscritos por día hábil; toques por llegada (meta: uno) |
| Casos del arnés | Los 39 del #1235 (`arnes/obras.ts`), con las metas de §7 del diseño: cero escrituras sin toque, cero cifras sin respaldo, cero gastos de un operario, cero consultas de asistencia desde un operario. Más los 5 casos del criterio de recepción (Anexo 2.7) de punta a punta | Los del #1235 del operario, más: toque de plantilla (`type:"button"`), «Hoy no», toque de ayer y una tercera obra en el día |

**Cómo entra al modelo de roles (decidido el 26-oct, §6.1-3).** No se reescribe #1235: se reutiliza dentro del modelo de roles antes de su merge.
1. Poner #1235 al día con `main` (merge, sin rebase ni force).
2. Partir `obras.ts` y `operario.ts` en las funciones de la tabla, que despachan a ese mismo código.
3. Cambiar el enrutamiento: de `obras = true` y `wa_collaborators.tipo` a `asistente_asignaciones`.
4. Correr el arnés de obras: tiene que dar lo mismo.
5. Construir `recolector.apertura_diaria` y dejarla apagada al arranque; se prende después (§6.1-2).

Es lo que hace que «armar el rol con funciones» se pruebe con un caso real y no en teoría.

### 3.3 Laura Jaramillo (L2 26 1)

**Estado.**
- Frente 1 aprobado el 21-oct; contrato lleno y en ZapSign (ID 21), sin enviar.
- Persona natural, trabaja sola, de 4 a 6 citas diarias.
- Fechas del contrato (Anexo 2.6): sesión de portafolio dentro de 3 días hábiles; **workspace listo con servicios, saldos y su número registrado dentro de 5 días hábiles**; semana de prueba en la segunda semana.
- Recepción: 5 citas reales con 80 % de éxito (Anexo 2.7).

#### Frente 1 (contratado): mano derecha

| Elemento | Definición |
|---|---|
| Rol | `mano_derecha`, familia `equipo`. Asignación: `staff` de Laura (única usuaria) |
| Canal | `wa_one`: el número del asistente de MeTRIK ONE (+57 318 1362594, Anexo 2.3 del contrato). Sus clientas no escriben a ese número |
| Funciones | `equipo.citas`, `equipo.cobros_clienta` (deudas y cuotas), `equipo.portafolio`, `equipo.gastos` (con proveedor), `equipo.contactos` (clientas y proveedores), `equipo.resumen_negocio` («¿quién me debe?», «¿cómo voy?»), `equipo.correcciones`, `comun.persona` |
| Recordatorios | Dos mensajes que inicia el asistente, por plantilla de utilidad aprobada por Meta (el contrato los anuncia así, Anexo 2.3): el **resumen de los lunes** y el **recordatorio de deudas abiertas**. Necesitan el envío por plantilla y el toque de sus botones (§4.5) |
| Escalamiento | Botón al WhatsApp de MeTRIK con el mensaje escrito (§4.2) |
| Saludo | Primer mensaje del día por hora y con su nombre. Presentación en el primer contacto, no en las plantillas |
| Autorización | Laura es la usuaria y acepta los términos de ONE. **Los datos de sus clientas los registra ella**, así que la responsable frente a sus clientas es Laura y MéTRIK es encargado. El contrato ya tiene el capítulo de datos; si hace falta un aviso para las clientas, lo dice Emilio (§6.2-c) |
| Métricas | Resolución por cita (el criterio de recepción: clienta, servicio, precio, descuento, resultado y estado de pago); fricción, con meta de un mensaje o nota de voz y un toque por cita; deudas cerradas |
| Casos del arnés | De la propuesta y el contrato, inventados: «le hice cejas y pestañas a Marcela, 60 mil, me pagó 40» (deuda por 20); cita en 6 cuotas; abono a la cuota 3; descuento a una clienta; no asistió; cancelada; «compré tintes donde Andrés, 85 mil» (gasto con proveedor); «¿quién me debe?»; corregir el precio de una cita de ayer; servicio que no está en el portafolio (no lo inventa, pregunta); nota de voz con el nombre de la clienta mal transcrito (pista del portafolio y de las clientas, §4.6) |

**Lo que falta en ONE para Laura** (no es del asistente, pero sus funciones lo necesitan). ONE no tiene dónde guardar citas, portafolio con precios ni cuotas por clienta:
- `catalogo_servicios` es el catálogo de lo que vende MéTRIK (`20260916120000_catalogo_y_servicios_contratados.sql:11-12`), no el de un workspace;
- los planes de cobro cuelgan de un negocio, y una cita no es un negocio (serían 90 a 130 negocios al mes).

Borrador mínimo, en una migración propia del frente de Laura, para revisar al construir:
- `portafolio_servicios`: workspace, nombre, precio, admite cuotas, activo y vigencia de precio;
- `citas`: workspace, clienta (contacto), servicio, fecha, precio de lista, descuento, precio final, resultado y `registrado_por`;
- `cita_pagos`: cita, monto, fecha y soporte;
- `cita_plan_cuotas`: cita, número de cuotas y valor; cada pago se descuenta de la cuota más vieja.

La deuda y «en qué cuota va» se **calculan** (vista), no se guardan, por la misma regla del diseño de Imperviun: «se calculan, no se guardan». **Pregunta para el momento de construir:** si una clienta es un `contacto` de ONE o una tabla aparte.

#### Frente 2 (sin contratar): asesor de clientas

| Elemento | Definición |
|---|---|
| Rol | `asesor_vendedor`, familia `clientes`, en otro canal |
| Canal | Un número propio del salón (el contrato lo excluye del frente 1). Opciones: Chatwoot (como Sabor, con bandeja humana para Laura) o una entrada directa de WhatsApp para el dominio público, que hoy no existe. Se decide al cotizarlo (§6.2-e) |
| Funciones | Las de Sabor reutilizadas: `clientes.ficha` (sobre `portafolio_servicios`), `clientes.reglas`, `clientes.autorizacion`, `clientes.cobro_link`, `comun.persona`; más `clientes.agenda`, que es nueva |
| Se pasan el trabajo | El asesor aparta la cita; la mano derecha la ve en «citas de hoy» y la cierra con su pago (§2.7) |
| Lo que prueba | Que el catálogo sirve a dos clientes distintos sin escribir funciones nuevas, salvo la agenda |

No se construye hasta que se contrate. Se deja aquí porque es la prueba de que las funciones de la familia clientes no quedaron atadas a Sabor.

---

## 4. Piezas comunes

### 4.1 Respaldo del modelo y correo inmediato si caen los dos

**Hoy.**
- ONE y la bandeja ya tienen el respaldo en otro proveedor: Haiku 5.5 de principal por `fetchModelo` y Gemini de respaldo directo (`modelo-gemini.ts:16-19`, `:74-75`). Si falta la llave de Gemini, corre sin respaldo y solo queda en el log (`modelo-gemini.ts:130-134`). La caída del 9-oct (principal y respaldo en el mismo proyecto de Gemini) ya no se repite igual.
- Sabor no tiene respaldo, por decisión del 20-oct (`modelo-anthropic.ts:1-12`).

**Lo nuevo.**
1. **Disparador.** Un turno termina con `error` que empieza por `modelo:` (`nucleo.ts:322`), o en público con un desenlace `falla` o `rechazo` (`publico/reintento.ts`, `publico/cola.ts:264-270`). Si en ese turno fallaron **todos** los modelos configurados (los `usos` de la traza traen `ok: false` en principal y respaldo, o en el único), se manda la alerta.
2. **Correo** por Resend a mauricio.moreno@metrik.com.co. Las edge functions ya mandan correo directo a `api.resend.com` (`supabase/functions/alertas-plazo/index.ts:160`, `notificar-etapa/index.ts:470`). Se agrega `_shared/correo-interno.ts` (Deno) con el mismo patrón que `enviarCorreoInternoPorResend` (`src/lib/cobros/reverso-pasarela-servidor.ts:39`) y que el PR #1271:
   - asunto: «Asistente caído: <workspace> · <rol>»;
   - cuerpo: hora, modelos y motivo de cada uno (`usos[].motivo`, por ejemplo «http 403», «corte»), cuántas personas quedaron sin respuesta en la última hora y el enlace a la traza;
   - nunca el texto del cliente.
3. **Un correo por incidente**, no uno por turno. Candado `agente:caido:<workspace>:<ventana de 30 min>` con `tomar_candado`, el mismo patrón del cupo (`uso.ts:95`), e `Idempotency-Key` en Resend. Si sigue caído, un recordatorio por hora.
4. **La persona no queda colgada.** En público ya pasa a persona con `falla`. En ONE, `rf.modelo_caido` deja la propuesta vigente (`nucleo.ts:256-260`); se le suma el botón de traspaso (§4.2) si es el segundo «no pude» seguido.
5. **Los avisos internos pasan de WhatsApp a correo.** El cupo (`produccion.ts:135`) y el presupuesto diario de público (`chatwoot-agente/index.ts:92`) salen hoy por `enviarAvisoInterno` y se pierden fuera de la ventana de 24 h (diagnóstico F8, 25 perdidos). Mismo puerto (`AvisosInternos`, `publico/puertos.ts:68`) con otra implementación.
6. **Respaldo para Sabor (decidido el 26-oct, §6.1-1).** No hay modelo de respaldo en otro proveedor. El respaldo es una persona de Sabor en Chatwoot: si el modelo se cae, el turno pasa a un agente humano con `pasar_a_persona` y motivo `falla` (nota privada, etiqueta y `open`), como ya hace `publico/cola.ts:264-270`. El correo inmediato de esta sección se manda igual. Es lo que da trabajar sobre la plataforma del tercero: Chatwoot ya trae la bandeja humana.

**Casos de prueba.**
- Principal 529 y respaldo 403: un correo con los dos motivos.
- Diez turnos caídos en 30 minutos: un solo correo.
- Principal cae y respaldo contesta: ningún correo.
- Sin llave de respaldo y principal caído: correo.
- Resend falla: el turno no se cae (envío a mejor esfuerzo, `catch`).

### 4.2 Traspaso a una persona

**Las cuatro señales del ADN y quién las detecta.**

| Señal | La detecta | Cómo |
|---|---|---|
| Pide una persona | El modelo (motivo `pide_persona`) | Como en público. Sin listas de palabras: el modelo interpreta, el código ejecuta (columna vertebral de los bots) |
| Repite o corrige lo mismo 3 veces, o 2 «no pude» seguidos | **El código**, contando en la conversación | «No pude» = turnos con `respuesta_fija` `rf.modelo_caido` o error en la traza. Repetición = 3 propuestas reemplazadas sobre el mismo `sobre` o 3 respuestas de la persona tras la misma pregunta del bot. El umbral es parámetro de la ficha |
| Frustración fuerte | El modelo (motivo `no_entiende` o `frustracion`) | Ficha del rol |
| Un cliente pregunta algo que no está en la base | La función (`sin_dato` → `duda_abierta`) | Ya existe en público (`publico/dominio.ts:173`) |

**Qué hace, según `rol.escalamiento`.**
- **`chatwoot_equipo` (Sabor).** Pasa directo, sin ofrecer: con cualquiera de las cuatro señales, y también si se cae el modelo, la conversación pasa a un agente humano de Sabor en Chatwoot (decisión del 26-oct). Ya existe tal cual: nota privada, etiqueta y `open`. Se agrega la fila en `asistente_escalamientos` con `modo = 'pasado'`.
- **`wa_link` (ONE: Imperviun gestión, Laura, el equipo de hoy).**
  - El asistente **ofrece** («¿Quieres hablar con alguien de MeTRIK?»), nunca dos veces seguidas.
  - Si la persona lo pide de forma explícita, manda de una un **botón de enlace** a `https://wa.me/573159509103?text=<mensaje>`. El mensaje lo arma el código: «Hola, soy <nombre> de <empresa>. El asistente no pudo con: <resumen en una línea>».
  - La conversación queda marcada para revisión (`asistente_escalamientos.modo = 'link'`).
  - El número de Agus y el de MeTRIK son distintos, así que el chat se abre con Mauricio.
- **`wa_link` hacia la empresa (operarios de Imperviun).** El mismo botón, con el número que la empresa ponga en la ficha y el texto «la oficina».

**Lo que hay que construir para el botón.** Nuestra `Salida` solo tiene texto, botones y lista (`tipos.ts:144-147`). Se agrega `{ tipo: 'enlace'; texto; boton; url }`, que el `Mensajero` de WhatsApp manda como mensaje interactivo con botón de URL. SIN VERIFICAR contra la doc oficial de la Cloud API, en el momento de construir:
- el tipo exacto (`interactive.type = "cta_url"`);
- el largo máximo del título;
- que acepte `wa.me` con texto prellenado.

Si no se puede, va el enlace en el texto (WhatsApp lo vuelve clicable). Pidió Yuto confirmar esto (pendiente del doc de escalamiento).

**Casos de prueba.**
- «Quiero hablar con alguien»: el enlace sale de una.
- Dos «no pude» seguidos: se ofrece una vez.
- Tercera corrección del mismo campo: se ofrece.
- Ya se ofreció en el turno anterior: no se repite.
- Operario que pide persona: sale el número de la oficina y nunca el nombre de Liliana.
- En Sabor, el comportamiento actual no cambia (regresión del arnés de público).

### 4.3 Resumen diario por correo (Resend)

- **Cuándo.** Todos los días a las 7:00 de Bogotá, con lo del día anterior. Es un cron de Vercel nuevo (`/api/crons/resumen-asistentes`, en `vercel.json` como los demás) que corre después de la calificación (§4.4). La hora es parámetro. Pregunta §6.2-b.
- **Qué lee.**
  - Trazas de `wa_conversacion` y `chatwoot_conversacion` del día, por workspace y rol;
  - `asistente_escalamientos`;
  - `asistente_calificaciones`;
  - candados atajados;
  - costo con `bot_modelo_precios`.
- **Qué dice, por workspace y rol.**
  - conversaciones;
  - registros confirmados;
  - bloqueos («no pude», candados);
  - escalamientos (hechos y los que debieron hacerse según el calificador);
  - fallas por tipo;
  - costo del día;
  - y **la lección del día**: la falla más repetida, con un caso y la propuesta de caso para el arnés.
  - Arriba, lo que pide acción.
- **Cómo sale.** `enviarCorreoInternoPorResend` (`src/lib/cobros/reverso-pasarela-servidor.ts:39`) con `Idempotency-Key` por fecha. Un solo correo con todos los workspaces. Si no hubo conversaciones, sale igual con «sin actividad», para que su ausencia sea señal de que el cron se cayó.
- **Datos.** Sin nombres ni teléfonos de clientes finales: alias de la conversación y enlace a la traza. Nombres del equipo sí (son usuarios de ONE). Lo revisa Emilio (§6.2-b).
- **Casos de prueba.**
  - Día sin actividad: el correo sale.
  - Dos workspaces: un solo correo.
  - Reintento del cron: Resend deduplica.
  - Un cliente final con nombre en la conversación: no aparece en el correo.

### 4.4 Calificación diaria de conversaciones

- **Qué.** Un juez (modelo) lee cada conversación del día y la marca contra una **lista fija de fallas**:
  - F1 a F9 del diagnóstico: bloqueo explícito, falso «no puedo», error engañoso, reformulación, dato inventado o duplicado, fricción de botones, fuera de tema, error técnico, debió avisar;
  - más las dañinas del ADN: registro sin «sí», registro errado, dato inventado ante un cliente.
  
  Devuelve JSON (§2.8, `asistente_calificaciones`): fallas con turno y evidencia, si se resolvió y una nota de 1 a 5.
- **Qué recibe el juez.**
  - la conversación, con los nombres de los clientes reemplazados por alias;
  - las trazas (herramientas, propuestas, ejecuciones);
  - la ficha del rol.
  
  No recibe datos de otros clientes de MéTRIK. Las conversaciones de cada cliente solo se usan para su propio asistente (ADN, decisión 12).
- **Calibración.** Las primeras 50 conversaciones calificadas las revisa Mauricio (`revisada_por`), y se mide el acuerdo. Si queda bajo el umbral que fije Mauricio (propuesta: 90 %), se ajusta la lista o se prueba un juez mayor solo para esto (§6.2-d). No se usa para iterar el arnés sellado de Vera.
- **De falla a caso.** Cada falla real confirmada la convierte Max en un caso del arnés de ese rol, seudonimizado y con los datos cambiados. Bloquea el despliegue siguiente si vuelve a fallar en alguna de las 3 corridas. Los casos viven en el repo, no en la base.
- **Cuándo y cuánto.** Cron a las 6:30 de Bogotá, antes del resumen. El costo del juez se mide y entra al resumen.
- **Retención.** Lo crudo dura 90 días en el espacio del cliente (ADN, legales). Las calificaciones guardan evidencia corta, no la conversación.
- **Casos de prueba.**
  - Una conversación del diagnóstico con F6 conocida (toque caducado) sale marcada F6.
  - Una sin fallas sale limpia.
  - El juez nunca recibe un teléfono.
  - Reintento del cron: no duplica (llave única).

### 4.5 El toque de los botones de plantilla (`type:"button"`)

**El problema.**
- Cuando alguien toca una respuesta rápida de una plantilla, Meta manda `type: "button"` con `button.payload` y `button.text`, no `interactive.button_reply`.
- `mensajeConTelefono` no tiene esa rama y devuelve `null` (`_shared/wa-webhook-payload.ts:384`); el tipo `MetaMensaje` ni siquiera declara `button` (`wa-webhook-payload.ts:33-44`). El toque se pierde.

**El arreglo ya existe en el PR #966** (rama `worktree-agente-24aead2e4686`): declara `button` en `MetaMensaje`, lo suma a `textoLegible` y construye el mensaje con `type: 'button'` e `interactive_reply = payload`. Ese PR trae además el motor de recordatorios por plantilla, apagado, y sus dos migraciones (`20260930140000` y `20260930140100`).

**Propuesta.**
1. **#966 se mergea completo, con los recordatorios apagados.** Mauricio pidió mergear los PR pendientes el 26-oct, así que ya no se saca el arreglo a un PR propio. Sus migraciones se aplican antes del merge; el envío programado y su registro (el «ledger») quedan en `main` listos para el recolector de Imperviun y los recordatorios de Laura.
2. **Prefijo para el payload de nuestras plantillas:** `ag|t|<plantilla>|<accion>`, por ejemplo `ag|t|jornada_v1|empezar`. Hoy `leerToque` solo conoce propuesta (`ag|p|`) y conversación (`ag|c|`) (`agente/render.ts:119-128`). Con el prefijo nuevo:
   - devuelve `{ clase: 'plantilla', plantilla, accion }`;
   - el agente lo toma, en vez de soltarlo al bot de siempre (`wa-agente.ts:106`);
   - entra al turno como un toque con su texto («Empezar»).
   - Un payload ajeno (otra plantilla, sin prefijo) sigue por el camino de hoy.
3. **El prefijo va en un PR aparte, sin migración,** después de #966. Ese PR no manda plantillas: encender los recordatorios de #966 es un paso aparte, por workspace.

**Casos de prueba.**
- Payload real de Meta de una respuesta rápida: llega con `type: 'button'`, el payload y el `wa_message_id`.
- `textoLegible` devuelve el texto del botón.
- `ag|t|jornada_v1|empezar` entra al agente.
- Un payload sin prefijo no lo toma el agente.
- Reintento de Meta: se deduplica por `wa_message_id` (`wa-webhook-payload.ts:225`).
- `claseDelEntrante` lo clasifica como `toque` (`wa-conversacion.ts:71`).

Fixture: el payload de la doc de Meta, marcado como «armado de la doc», hasta tener uno real.

### 4.6 Prueba de transcripción: 20 notas inventadas y pistas de la base

**Lo que se mide.** Si la transcripción acierta lo que importa para registrar: nombres de personas y clientes, cifras y códigos. La tasa de error de palabras general es secundaria.

**El conjunto.**
- **20 notas de voz inventadas**, con su texto de referencia, repartidas entre los tres casos:
  - 7 de Imperviun: obras con nombre corto, rubros, cifras con «millones» y «mil», un número de factura y un operario que dice la obra;
  - 7 de Laura: nombre de clienta, servicio del portafolio, «me pagó 40», cuotas;
  - 6 de Sabor: nombre de la experiencia, «el sábado a las 5», número de personas, una cédula dictada.
- Mezcla de condiciones: ruido de calle, obra o salón; alguien que habla rápido; una nota que se corta al final (la del 21-oct, «gastos meus»).
- **Quién las graba:** pregunta §6.2-f. Recomiendo personas reales leyendo guiones inventados, no voz sintética: la voz sintética no trae el acento ni el ruido que nos falla.
- Viven en el repo (`agente/arnes/audios/`) con permiso escrito de quien graba. Sin datos reales.

**Las pistas.**
- `transcribeAudio` recibe un parámetro nuevo `pistas` y las agrega al prompt como «Palabras que pueden aparecer». Hoy el prompt es literal y sin contexto (`wa-transcribe.ts:56-57`).
- Las pistas salen de la base del workspace en el momento:
  - nombres del equipo y de los colaboradores;
  - empresas de los negocios abiertos y nombres cortos de las obras;
  - el **formato** de los códigos (letra y número de la empresa, año, consecutivo: «I1 26 5»), no la lista entera;
  - servicios del portafolio (Laura);
  - nombre de la experiencia vigente (Sabor).
- Tope de pistas por turno, para no inflar el prompt.

**El riesgo de las pistas:** que la transcripción meta un nombre de la lista que no se dijo. Por eso la prueba mide también la **inserción falsa**: nombres de la lista que aparecen sin estar en la referencia.

**La corrida.**
- Cada nota con y sin pistas, 3 veces.
- Modelos: el de hoy (`gemini-2.5-flash-lite`, `wa-transcribe.ts:9`) y el que configura público para audios.
- Llave de pruebas, nunca la de producción.
- Se reporta, por modelo y con o sin pistas: aciertos de nombres, de cifras y de códigos, la inserción falsa y la tasa de error de palabras.
- Regla para adoptar pistas: mejoran nombres y códigos sin subir la inserción falsa.

**Arreglo de paso:** la llave de Gemini pasa de la URL (`wa-transcribe.ts:125`) a la cabecera `x-goog-api-key`, para que no quede en logs.

---

## 5. Fases ordenadas por las fechas de los clientes

No hay estimaciones de duración: el orden sale de las fechas de los contratos y de la decisión del 26-oct de lanzar los tres asistentes sobre el modelo de roles.

### 5.1 Antes del jue 29-oct: el núcleo de roles, y Sabor sale a clientes reales como su primer rol

Sabor ya no sale sobre `publico/` tal cual: sale como el rol `asesor_vendedor` compuesto con funciones (§3.1). El código de `publico/` se reutiliza dentro de las funciones; lo que se agrega antes del 29 es el núcleo de roles.

**Código (Max):**

| # | Qué | Bloquea la salida |
|---|---|---|
| 1 | Migración de roles (§2.8), con su ensayo `DO $dry$ … RAISE`, aplicada antes del merge por la sesión principal. Antes, la prueba en PGlite de que la huella del arnés y la de `bot_publicar_reglamento` coinciden (§2.8, supuesto 6) | Sí |
| 2 | Componedor (§2.6) con la prueba de permisos, y la resolución por asignación (§2.5) con el inbox de Chatwoot. Sin filas en las tablas nuevas, ONE y la bandeja de Trappvel siguen con el enrutamiento de hoy: sus tests y arneses pasan en el mismo PR | Sí |
| 3 | Funciones de la etapa 1 de Sabor: `clientes.ficha`, `clientes.reglas`, `clientes.autorizacion`, `clientes.toma_datos`, `clientes.precio_autorizado` y `comun.persona`, que despachan al código de `publico/`. `chatwoot-agente` arma el turno con el rol compuesto | Sí |
| 4 | Arnés de Sabor igual sobre el rol compuesto que sobre `dominioPublico`, pass^3 y 0 dañinas, con el conjunto real (fila 11) | Sí |
| 5 | Escalamiento de Sabor como respaldo: la caída del modelo o cualquier señal de escalamiento pasa a un agente humano en Chatwoot y queda en `asistente_escalamientos` (§4.2) | Sí |
| 6 | Correo inmediato si se cae el modelo y aviso del presupuesto por correo (§4.1, puntos 2 y 5), para `chatwoot-agente` | Sí (decisión del 26-oct: se mantiene el correo) |

**Insumos y operación:**

| # | Qué | Quién | Bloquea la salida |
|---|---|---|---|
| 7 | Confirmar que existe el workspace de Sabor en ONE y que la migración `20261021090000` está aplicada (consultas 7.1 y 7.2) | Sesión principal | Sí |
| 8 | Secretos por slug (`CHATWOOT_WEBHOOK_SECRET_<SLUG>`, `CHATWOOT_API_TOKEN_<SLUG>`, `GEMINI_API_KEY_PAGO`) y despliegue de `chatwoot-agente` | Sesión principal (los despliegues no se delegan) | Sí |
| 9 | Agent Bot creado en la cuenta Chatwoot de Sabor, apuntando a `chatwoot-agente?ws=<slug>`, en el inbox de Instagram, y un equipo humano de Sabor que reciba los traspasos | Mauricio con Paula | Sí |
| 10 | Payload real de Chatwoot capturado y convertido en fixture; verificar `message_type`, remitente, `data_url` y si el token del Agent Bot puede crear notas privadas y cambiar el estado (D7). Con el respaldo en una persona, este punto es el que sostiene la caída del modelo | Max | Sí |
| 11 | Arnés real: conjunto real con las conversaciones de Paula, anonimizadas | Max | Sí |
| 12 | Ficha real de la experiencia de la semana (plantilla), nombre del asistente, horario de quien atiende y quién recibe cada motivo | Paula | Sí: ficha y nombre. No: horario (hay variante sin horario) |
| 13 | Términos y aviso de datos con el visto de Emilio, publicados por Sabor (link real en `terminos_url`) | Emilio, Sabor | Sí (criterio de salida 6 del diseño) |
| 14 | Funciones de la etapa 1 prendidas en `asistente_funciones_empresa`; rol `asesor_vendedor` publicado con `asistente_publicar_rol` (bot `rol:asesor_vendedor`) y su banco; puntero movido; asignación del inbox; rol activo | Max entrega el SQL; la sesión principal lo corre | Sí |
| 15 | Prueba con el equipo de Sabor sin hallazgos altos abiertos, incluido un traspaso por caída del modelo | Sabor, Max | Sí |
| 16 | Presupuesto diario configurado (D12, Carmen) | Carmen, Mauricio | Sí (criterio 9) |

**En paralelo, sin bloquear la salida de Sabor: Laura, desde ya** (decisión del 26-oct, §6.1-4):
- someter a Meta las plantillas de utilidad del resumen de los lunes y del recordatorio de deudas (Yuto);
- preparar la migración del módulo de citas, portafolio y cuotas (§3.3), con su ensayo, sin aplicar hasta que Mauricio lo decida.

No bloquean el 29-oct: el dominio ONE partido por cargo, el resumen diario, la calificación, el traspaso en ONE y el prefijo de los botones de plantilla.

### 5.2 Del 29-oct al lun 9-nov: Sabor etapa 2 en prueba, como versión nueva del rol

- **Sabor etapa 2** (fecha de contrato, 9-nov en prueba):
  - PR #1234 (sin el mapa del salón, ya decidido el 22-oct), con su migración aplicada antes del merge;
  - las funciones `clientes.cupo`, `clientes.apartar` y `clientes.cobro_link`, sobre las herramientas hoy apagadas de `publico/` (`publico/dominio.ts:51-56`), prendidas en la empresa;
  - el cobro del saldo antes de la experiencia (`clientes.cobro_saldo`), que es lo crítico para Sabor;
  - la experiencia genérica (columna `tipo` y textos sin «película») y el origen del mensaje (`clientes.origen`), en cuanto Yuto confirme qué dato llega (§3.1);
  - llaves de Bold de Sabor;
  - versión nueva del rol `asesor_vendedor` publicada con su banco. Marcha atrás = volver el puntero a la versión del 29-oct.
- **En paralelo, sin tocar a Sabor:**
  1. Merge de #966 con los recordatorios apagados (§4.5) y, después, el PR del prefijo `ag|t|`, sin migración.
  2. Correo inmediato también en ONE y la bandeja (§4.1), y los avisos del cupo por correo.
  3. El dominio ONE de hoy partido por cargo sobre el componedor, con la evaluación de ONE en verde.
  4. Traspaso en ONE con el botón de enlace (§4.2).
  5. Resumen diario (§4.3) y calificación (§4.4), al principio solo con Sabor, que tiene autorización contractual (cláusulas 3.6 y 5.6).

### 5.3 Vie 13-nov: Sabor con el espacio completo

- La lista del día, el resumen semanal, la exportación CSV y la base de clientes (frente de ONE de Sabor, CONTEXT).
- Sabor corre sobre el modelo de roles desde el 29-oct: esta fecha no trae ningún cambio de arquitectura.

### 5.4 Con la firma de Laura

Laura tiene el contrato listo en ZapSign y los plazos más cortos (workspace a 5 días hábiles de la firma). Las plantillas de Meta y la migración del módulo de citas van adelantadas desde el 26-oct (§5.1).
- **Dentro de los 5 días hábiles:**
  - migración del módulo de citas aplicada;
  - workspace;
  - portafolio y saldos cargados (sesión del paso 2);
  - funciones del frente 1 prendidas y rol `mano_derecha` publicado con su banco;
  - su número asignado.
- **Semana 2:** prueba real; recepción con 5 citas al 80 %.
- **Transcripción con pistas** (§4.6): entra aquí, porque las notas de voz son el camino principal de Laura.

### 5.5 Con la firma de Imperviun

- **Paso 3 (8 días hábiles):** migración de obras aplicada; #1235 y #1237 al día con `main`, con el asistente partido en funciones y el enrutamiento por asignación (§3.2, decisión del 26-oct); workspace con obras, rubros y operarios.
- **Paso 4 (semana 3):** prueba con Liliana y los operarios. La apertura diaria del recolector va construida y apagada (§6.1-2); se prende después, cuando estén la plantilla aprobada por Meta y el envío por plantilla de #966. Recepción con los 5 casos del Anexo 2.7.

### 5.6 Sin fecha: Laura frente 2

Se cotiza aparte (cláusula 3.12). Reutiliza las funciones `clientes.*`, agrega `clientes.agenda` y el canal que se decida.

---

## 6. Riesgos y preguntas abiertas

### 6.1 Decisiones tomadas (Mauricio, 26-oct)

| # | Pregunta | Decisión (26-oct) | Qué cambia en este documento |
|---|---|---|---|
| 1 | Sabor sale sin modelo de respaldo (D1, 20-oct) y el ADN pide respaldo en otro proveedor. ¿Qué rige? | **No hay modelo de respaldo en otro proveedor.** El respaldo es una persona real de Sabor en Chatwoot: si el modelo se cae, o aparece cualquier señal de escalamiento, el asistente pasa la conversación a un agente humano dentro de Chatwoot. Se mantiene el correo inmediato si se cae el modelo. En palabras de Mauricio: «es lo potente de trabajar desde la plataforma del tercero» | §3.1 (escalamiento), §4.1 (punto 6 y casos), §4.2 (`chatwoot_equipo` pasa directo), §5.1 (filas 5, 6, 9, 10 y 15) |
| 2 | Imperviun: ¿la apertura diaria con plantilla (ADN) entra en la Fase 1, contra la decisión D9 del 21-oct? | **Entra apagada y se prende después** | §2.2, §3.2 y §5.5 |
| 3 | PR #1235: ¿se reutiliza dentro del modelo de roles antes del merge, o se mergea tal cual con `obras = true`? | **Se reutiliza** dentro del modelo de roles antes de su merge | §3.2 y §5.5 |
| 4 | Laura: ¿se prepara su módulo cuando se mande el ZapSign, o con la firma? | **Se adelanta ya, sin esperar la firma:** se someten sus plantillas a Meta y se prepara la migración del módulo de citas | §5.1 (en paralelo) y §5.4 |
| 5 | (Dirección nueva) ¿Sabor sale sobre `publico/` y pasa a roles después del 13-nov? | **No. Los tres asistentes salen sobre el modelo de roles y funciones, Sabor incluido desde su salida.** «Tenemos el tiempo suficiente para hacerlo sin contratiempos.» Las fechas de Sabor no cambian: 29-oct, 9-nov y 13-nov | §0, §3.1, §5 completo y §6.3 |

### 6.2 Las de menor peso

| # | Pregunta | Mi recomendación |
|---|---|---|
| a | Cuando un operario de Imperviun pide una persona, ¿va a MeTRIK o a la oficina? | A la oficina, con el número que Imperviun ponga en la ficha y sin nombrar a Liliana. MeTRIK queda para Liliana |
| b | Resumen diario: ¿a qué hora? ¿Con nombres de clientes finales? | A las 7:00 de Bogotá; sin nombres ni teléfonos de clientes finales, solo alias y enlace. Que lo confirme Emilio |
| c | ¿Las conversaciones reales de Imperviun y de Laura se pueden calificar con IA y volver casos? Sus contratos no lo dicen como el de Sabor | Que Emilio lo revise. Mientras tanto, solo Sabor entra a la calificación con texto; Imperviun y Laura, solo con métricas de trazas |
| d | El juez de la calificación: ¿Haiku 5.5 o un modelo mayor? | Haiku 5.5 con la lista fija. Un modelo mayor solo si el acuerdo con tus 50 revisiones queda bajo 90 %. Los precios se consultan en la doc oficial al decidir, no de memoria |
| e | Laura frente 2: ¿Chatwoot o una entrada directa de WhatsApp? | Se decide al cotizarlo. Chatwoot le da a Laura una bandeja para atender, pero cuesta USD 19 al mes por persona. La entrada directa no existe hoy |
| f | Las 20 notas de voz: ¿quién las graba? | Tú y dos personas más, leyendo guiones inventados, con ruido real. Voz sintética no |
| g | Preferencias recordadas (ADN regla 3): ¿en qué fase? | Con Imperviun («este proveedor siempre es gasto de empresa» es su caso), después del modelo de roles |

### 6.3 Riesgos

| Riesgo | Qué lo controla |
|---|---|
| Tocar el núcleo rompe la bandeja de Trappvel o el ONE de todos, que están en producción | El componedor es aditivo y el núcleo no cambia. Los tests y los arneses de bandeja, ONE y público tienen que pasar en el mismo PR. Sin filas en las tablas nuevas, rige el enrutamiento de hoy |
| Filtrar herramientas por cargo cambia lo que ve el modelo en ONE | Volver a correr la evaluación de ONE antes del merge; el rol se fija al empezar la conversación (caché y razonamiento) |
| El núcleo de roles entra antes de la salida de Sabor (29-oct), y Sabor sale sobre él | Las funciones de Sabor despachan al código de `publico/` que ya pasa su arnés; el rol no sale si su arnés no da lo mismo que sobre `dominioPublico` (pass^3, 0 dañinas). El respaldo ante cualquier falla es una persona de Sabor en Chatwoot, con correo inmediato. Marcha atrás de una versión del rol = mover el puntero |
| #1234, #1235, #1237 y #966 llevan días sin mergear, con migraciones sin aplicar, y van a chocar con el componedor | Orden de merge explícito en §5. Cada uno se pone al día con `main` antes de su fecha, por merge, sin rebase ni force |
| Meta rechaza o recategoriza una plantilla como marketing | Tres versiones por saludo, sin la presentación de Agus (reglas de Yuto del 23-oct). Si se recategoriza, se avisa antes de mandar más |
| Un número en dos workspaces (Liliana lleva varias empresas): hoy se toma el primero sin preguntar | Para Imperviun basta verificar que su número solo esté ahí (consulta 7.5). La solución de fondo queda fuera de este documento |
| Sabor depende de insumos de Paula (ficha, nombre, términos, equipo humano en Chatwoot) y de Emilio | Las filas 9, 12 y 13 de §5.1 bloquean. Cada día de atraso corre la fecha (Anexo 2, numeral 2.6 del contrato de Sabor) |
| Las pistas de transcripción meten nombres que no se dijeron | La prueba mide la inserción falsa y no se adoptan si la sube |
| El juez diario cuesta y se equivoca | Se mide en el resumen; calibración con 50 revisiones; no reemplaza al arnés |
| Huella del banco: TypeScript y SQL pueden calcular distinto | Se prueba en PGlite antes de construir (§2.8) |

---

## 7. Consultas a producción (solo lectura, para la sesión principal)

No las corrí: este documento no lee producción. Van con el filtro de workspace donde aplica. Las de varios workspaces son de inventario y no traen datos de clientes finales.

```sql
-- 7.1 ¿Existe el workspace de Sabor y cómo está su configuración del asistente?
select id, slug, name, config_extra->'bot_conversacional' as bot
from workspaces where slug ilike '%sabor%' or name ilike '%sabor%';

-- 7.2 ¿Están aplicadas las migraciones de las que dependen las fases?
select to_regclass('public.chatwoot_conversacion')    as chatwoot_conversacion,      -- 20261021090000 (Sabor etapa 1)
       to_regclass('public.chatwoot_consentimientos') as chatwoot_consentimientos,
       to_regclass('public.llegadas_obra')            as llegadas_obra,              -- 20261021183000 (Imperviun, #1235)
       to_regclass('public.wa_recordatorios')         as wa_recordatorios;           -- 20260930140000 (#966); nombre leído del archivo de la migración

-- 7.3 Reglamentos publicados hoy (qué bots y versiones existen).
select w.slug, r.bot, r.version, r.publicado_por, r.publicado_at, r.banco is not null as con_banco
from bot_reglamentos r join workspaces w on w.id = r.workspace_id
order by r.publicado_at desc limit 30;

-- 7.4 ¿Existen ya los workspaces de Imperviun y de Laura?
select id, slug, name from workspaces
where slug ilike any (array['%imperv%', '%laura%', '%jaramillo%']) or name ilike any (array['%imperv%', '%jaramillo%']);

-- 7.5 Números de colaboradores que están en más de un workspace (riesgo «un número, un workspace»).
select phone, count(distinct workspace_id) as workspaces
from wa_collaborators group by phone having count(distinct workspace_id) > 1;

-- 7.6 La llave del staff para asistente_asignaciones: qué devuelve wa_identify_user.
select pg_get_function_result(p.oid) as devuelve, pg_get_function_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'wa_identify_user';

-- 7.7 Línea base de métricas: turnos del modelo por workspace desde el despliegue del agente ONE (21-oct).
select w.slug, count(*) as turnos,
       count(*) filter (where c.traza->>'error' like 'modelo:%') as caidos,
       count(*) filter (where c.traza->>'respuesta_fija' = 'rf.modelo_caido') as no_pude
from wa_conversacion c join workspaces w on w.id = c.workspace_id
where c.traza->>'tipo' = 'modelo' and c.created_at >= '2026-10-21'
group by w.slug order by turnos desc;
```

---

## 8. Supuestos sin verificar

1. Que la migración `20261021090000` de Sabor está aplicada. Lo dijo Yuto el 21-oct; consulta 7.1 y 7.2.
2. Que el workspace de Sabor ya existe en ONE. Al 21-oct no existía y crearlo lo autorizaba Mauricio.
3. El payload real del webhook de Chatwoot, y si el token del Agent Bot puede crear notas privadas, etiquetar y cambiar estado (D7).
4. El tipo de mensaje interactivo con botón de URL para el enlace a WhatsApp (§4.2).
5. Que la llave de staff para las asignaciones sea `profiles.id` (consulta 7.6).
6. Que la huella del arnés y la de `bot_publicar_reglamento` coincidan (§2.8).
7. ~~El nombre de la tabla de recordatorios del #966 en la consulta 7.2.~~ Verificado en la rama del PR: `wa_recordatorios` y `wa_recordatorio_eventos`.
8. Que el webhook de estados de Meta guarde la categoría de cobro para la métrica de costo (§2.9).
9. Que los contratos de Imperviun y de Laura permitan calificar sus conversaciones con IA (§6.2-c).
10. Qué dato de origen entregan Meta y Chatwoot para saber de qué anuncio o publicación viene un mensaje: anuncios que abren WhatsApp (`referral`), anuncios de Instagram, y publicaciones orgánicas de Instagram y TikTok (§3.1-2). Lo revisa Yuto con un payload real de la cuenta de Sabor.
11. La tasa de corte de la nota de voz y el modelo de audio que configura público para Sabor. Se lee de su configuración al correr §4.6.
