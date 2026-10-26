---
tipo: guía técnica
fecha: 2026-10-26
autor: Max (Tech Lead)
para: las sesiones que construyen asistentes encima del modelo de roles (Sabor, Imperviun, Laura)
fuente: docs/specs/2026-10-26_asistentes-roles-y-funciones.md (§2), migración 20261026183000 (PR #1282) y el componedor (este PR)
---

# Asistentes MeTRIK: cómo construir encima de roles y funciones

Esta guía explica cómo se arma un asistente con el modelo común. Lo particular de cada cliente lo hace su sesión: por ejemplo, partir `publico/dominio.ts` en `clientes.*` para Sabor o las funciones de obras para Imperviun. Aquí está lo que todas comparten.

## 1. Las piezas en una línea cada una

| Pieza | Dónde vive | Qué es |
|---|---|---|
| Motor | Código: un `Dominio` (`agente/one/dominio.ts`, `agente/publico/dominio.ts`) | Implementa las herramientas: lecturas, acciones de `proponer` y cierres. |
| Función | Código: `agente/funciones/<archivo>.ts` y su entrada en `funciones/catalogo.ts` | Dice qué herramientas de un motor son suyas, qué fichas del reglamento son suyas y qué hace en una línea. |
| Funciones prendidas | Base: `asistente_funciones_empresa` | Qué funciones tiene prendidas cada empresa y con qué parámetros. |
| Rol | Base: `asistente_roles`, más su reglamento en `bot_reglamentos` con bot `rol:<clave>` | El rol es una ficha versionada; la cabecera tiene el puntero `reglamento_id` y el interruptor `activo`. |
| Asignación | Base: `asistente_asignaciones` | Qué staff, colaborador, cargo o inbox habla con qué rol. |
| Componedor | `agente/componer.ts` | Arma el `Dominio` del turno con las herramientas del rol que la empresa tiene prendidas, más las comunes. |

Las herramientas del turno son las funciones asignadas al rol que además están prendidas en la empresa.

- La RPC `asistente_resolver_rol` hace esa intersección en una sola ida a la base.
- Lo que no está declarado no existe para el modelo:
  - una lectura ajena devuelve «No existe la herramienta»;
  - una acción ajena devuelve `accion_desconocida`;
  - `ejecutar` de una acción ajena lanza un error. Esa es la segunda llave.

## 2. Cómo se declara una función

**1. El archivo.** Va en `supabase/functions/_shared/agente/funciones/`. El tipo es `Funcion`, de `funciones/tipos.ts`:

```ts
export const CLIENTES_FICHA: Funcion = {
  clave: 'clientes.ficha',              // ^(equipo|recolector|clientes)\.[a-z][a-z0-9_]*$
  familia: 'clientes',
  queHace: 'contarte las experiencias, sus horarios y precios', // va en el fuera de tema y en la ayuda; '' = no se nombra
  herramientas: { publico: { lecturas: ['ver_catalogo', 'ver_funciones'] } }, // por motor: lecturas, acciones, cierres
  candados: ['...'],                    // los `candado` que el motor devuelve al atajar (documentan la función)
  fichas: ['alc.experiencias'],         // fichas del reglamento que son suyas: sin la función, no van al modelo
  temas: ['experiencia', 'funciones'],  // los de `alc.temas` que aporta
  requiere: [],                         // otras funciones sin las que esta no sirve (sin ellas, queda fuera)
  pistas: async (ctx) => [],            // opcional: palabras de la base para la transcripción (§4.6, sección 2.1)
}
```

Reglas:

- **La función no implementa nada.** Toma por nombre herramientas que el motor ya declara. Si la herramienta es nueva, va en el motor y la función la reclama.
- **Cada herramienta de un motor tiene exactamente una función dueña.** La prueba `componer.test.ts` («el catálogo cubre cada herramienta de cada motor una sola vez») falla si una queda sin dueña o con dos. Una herramienta sin dueña no la ve ningún rol.
- **Una ficha es de una función si la función toma algo del motor de ese canal.** Por eso una ficha de Sabor que se llame igual que una de ONE no es de ONE. Una ficha que no es de ninguna función va siempre. Si es de varias, va cuando está alguna de ellas.
- **Las comunes las pone el componedor.** Se declaran con `familia: 'comun'` y `comun: true`:
  - `comun.persona`: el paso a una persona. En Chatwoot es `pasar_a_persona` del motor `publico`; en WhatsApp es `pasar_a_persona` del motor `persona` (`agente/persona.ts`). Lo configura la ficha `rol.escalamiento` (sección 3.1).
  - `comun.fuera_de_tema`: la respuesta fija `rf.fuera_de_tema` la arma el código con las líneas `queHace` del rol. Si ninguna función del turno trae su línea `queHace`, se deja el texto del reglamento.

**2. La entrada en el catálogo.** Se agrega al arreglo de `funciones/catalogo.ts`. `catalogoDe` lanza si la clave está mal formada o repetida.

**3. Los casos.** Cada función trae tres casos con el modelo guionado, como en `funciones/equipo-one.casos.test.ts`:

- `actua`: donde debe actuar, y lo hace.
- `no_actua`: el modelo la intenta mal y el candado la ataja.
- `rol`: desde un rol que no la tiene, la herramienta no existe o la acción es `accion_desconocida`.

La prueba exige los tres por cada función del archivo. Los casos reales del cliente van aparte, en el arnés de su rol.

**4. Si el motor es nuevo** (obras, citas): es un `Dominio` como cualquier otro. Se pasa en `componerDominio({ motores: { obras: dominioObras(...) } })`. Si su `proponer` usa propiedades distintas por acción, se pasa también `datosPorAccion`, para que el rol vea solo las de sus acciones. Así lo hace `DATOS_POR_ACCION_ONE` en `one/dominio.ts`.

### 2.1 Cómo una función aporta pistas a la transcripción (spec §4.6)

Una función puede declarar `pistas(ctx)`. Devuelve las palabras de la base que pueden aparecer en una nota de voz de su dominio: los servicios del portafolio, la experiencia vigente o los nombres cortos de las obras. `ctx` trae `workspaceId` y los `parametros` con que la empresa prendió la función.

**Cómo llega a la transcripción.** Solo aportan las funciones que quedaron en la composición del turno: una que el componedor dejó fuera, por no tener motor o por faltarle lo que requiere, no aporta. `fuentesDeComposicion` (`agente/pistas.ts`) toma cada función compuesta con sus parámetros, y `pistasDeFunciones` junta lo que devuelven. Eso va a `pistasSiEncendidas` como `extras`.

- En WhatsApp, `wa-agente.ts` pasa la composición del turno (`turno.composicion`, del rol o del cargo de quien escribe).
- En Chatwoot, la cola compone y le pasa al transcriptor `fuentesDePistas`, y `chatwoot-agente` las junta.

Los `extras` van después del equipo y los colaboradores y antes de los clientes, dentro del tope. Una función que falla no frena la transcripción: no aporta.

**Qué devolver.** Nombres cortos, de 40 caracteres como máximo, sin listas de códigos. Si el rol atiende a clientes, tampoco van datos de un cliente final: en público ya no entran los otros clientes ni el formato de los códigos.

**El interruptor.** Está apagado en todos los workspaces. Se prende por workspace en `workspaces.config_extra`:

```json
{ "bot_conversacional": { "transcripcion": { "pistas": true, "tope": 40 } } }
```

- Solo `pistas: true` literal lo prende.
- El `tope` es el máximo de palabras: va de 5 a 80 y por defecto es 40. Además hay un tope de 900 caracteres.
- Apagado, no se lee la base, no se llama a ningún gancho y el pedido a Gemini es byte a byte el de antes. Vale igual para ONE, la bandeja y público.

**La corrida del 26-oct** (arnés `agente/arnes/audios/`, llave de Gemini de pruebas). Fueron 20 notas **sintéticas**, hechas con el TTS de Gemini más ruido; ninguna real. Se corrió con k = 3, con y sin pistas: 240 intentos.

| Modelo | Pistas | Fallos | Nombres | Cifras | Códigos | Inserción falsa | WER |
|---|---|---|---|---|---|---|---|
| gemini-3.5-flash-lite | sin | 0/60 | 74,5 % | 96,0 % | 55,6 % | 0,0 % | 14,8 % |
| gemini-3.5-flash-lite | con | 0/60 | 92,2 % | 100 % | 100 % | 0,0 % | 10,9 % |
| gemini-2.5-flash-lite | ambas | 120/120 | — | — | — | — | — |

- Por workspace (3.5-flash-lite, sin → con pistas):
  - Imperviun: nombres de 81,0 a 97,6 % y códigos de 55,6 a 100 %;
  - Laura: nombres de 53,8 a 84,6 %;
  - Sabor: nombres de 100 a 95,2 %, por un fallo en 1 de 3 intentos.
- gemini-2.5-flash-lite devolvió HTTP 404, «no longer available to new users». No es el código: la llave de pruebas es de un proyecto nuevo. Es el modelo por defecto de ONE (`wa-transcribe.ts`); la llave de producción, más vieja, lo sigue usando, pero Google lo está retirando.

**Las pistas siguen apagadas hasta repetir la corrida con notas reales** (`arnes/audios/GRABAR.md`): el resultado de arriba es con voces sintéticas. Ninguna función del catálogo declara `pistas` todavía.

## 3. Cómo se arma y se publica la ficha de un rol

El contenido del rol va en `bot_parametros` con `bot = 'rol:<clave>'`, y se publica como versión inmutable en `bot_reglamentos`. Además de las fichas de siempre (`alc.*`, `inv.*`, `g.*`, `p.*`, `rf.*`), lleva cuatro fichas.

| Ficha | Tipo | Qué lleva |
|---|---|---|
| `perfil` | `perfil` | `valores.nombre`, `audiencia`, `idioma` y el trato. |
| `rol.funciones` | `alcance` | `valores.funciones: string[]`. Es obligatoria: `asistente_publicar_rol` la exige y la RPC la lee. |
| `rol.escalamiento` | `alcance` | A quién se pasa la conversación (`chatwoot_equipo` o `wa_link`), los umbrales de las señales del código y el horario. Ver la sección 3.1. |
| `rol.saludo` | `estilo` | Saludo por hora, presentación en el primer contacto y la plantilla diaria, si la hay. |

### 3.1 La ficha `rol.escalamiento` (el paso a una persona, spec §4.2)

Es una ficha `alcance` con `carga: 'siempre'`. El modelo lee su `hacer` (una línea corta basta); el código lee sus `valores`. Sin la ficha, rige el modo por defecto del canal: en WhatsApp, el WhatsApp de MeTRIK; en Chatwoot, el equipo de `config_extra` y sin horario. Una ficha con el modo de otro canal, o con un número que no sirve, también cae al de por defecto y queda en el log.

**Las cuatro señales.**

| Señal | La detecta | Qué hace |
|---|---|---|
| Pide una persona | El modelo: `pasar_a_persona` con motivo `pide_persona` | WhatsApp: el botón sale de una (`link`). Chatwoot: pasa. |
| Frustración, no entiende, dato que no está | El modelo: `frustracion`, `no_entiende`, `sin_dato` (en Chatwoot, sus 14 motivos) | WhatsApp: se ofrece el botón (`ofrecido`), nunca dos turnos seguidos. Chatwoot: pasa. |
| Dos «no pude» seguidos | El código: turnos con `rf.modelo_caido` o con un error del turno en la traza (un error del envío no cuenta) | WhatsApp: el botón se ofrece debajo de la respuesta fija. Chatwoot (con rol): pasa con `no_entiende`. |
| Tres correcciones de lo mismo | El código: 3 propuestas sobre lo mismo (acción y `sobre`) reemplazadas sin tocarse, o 3 respuestas tras la misma pregunta | Igual que la anterior. |

**Modo `wa_link`** (ONE: el equipo de hoy, la gestión de Imperviun, Laura):

```json
{
  "modo": "wa_link",
  "numero": "573159509103",
  "atiende": "alguien de MeTRIK",
  "boton": "Escribir a MeTRIK",
  "plantilla": "Hola, soy {nombre} de {empresa}. El asistente no pudo con: {resumen}",
  "umbral_no_pude": 2,
  "umbral_correcciones": 3
}
```

- Todo es opcional. Sin `numero`, el de MeTRIK. Con un número propio y sin `atiende`, «alguien del equipo».
- `atiende` es como lo lee la persona: «alguien de MeTRIK», «la oficina». **Nunca el nombre de una persona**: un rol de operarios pone el número de la oficina y `"atiende": "la oficina"`.
- `boton`: hasta 20 caracteres (límite de Meta). Uno más largo no se corta: va «Abrir WhatsApp».
- `plantilla`: tiene que traer `{resumen}`; si no, va la de por defecto. `{nombre}` es quien escribe y `{empresa}` el workspace. El `{resumen}` lo arma el código en una línea y sin datos sensibles: sin correos, links ni cifras de cinco dígitos o más.
- El botón es un mensaje `cta_url` que abre `https://wa.me/<numero>?text=<mensaje>`.

Ejemplo para los operarios de una obra (datos inventados):

```sql
insert into public.bot_parametros (workspace_id, bot, clave, tipo, carga, hacer, valores) values
  ('00000000-0000-4000-8000-0000000000d1', 'rol:recolector', 'rol.escalamiento', 'alcance', 'siempre',
   'Si pide hablar con alguien, pásalo a la oficina con pasar_a_persona.',
   '{"modo": "wa_link", "numero": "576015550101", "atiende": "la oficina", "boton": "Escribir a oficina"}');
```

**Modo `chatwoot_equipo`** (Sabor): pasa directo, sin ofrecer. Hace la nota privada, la etiqueta, el equipo y el `open`.

```json
{
  "modo": "chatwoot_equipo",
  "equipos": { "pago": 3, "queja": 2, "reserva_lista": 3 },
  "equipo_por_defecto": 1,
  "horario": { "dias": [1, 2, 3, 4, 5, 6], "desde": "09:00", "hasta": "21:00" },
  "umbral_no_pude": 2,
  "umbral_correcciones": 3
}
```

- El equipo de un motivo sale de `equipos`, luego de `equipo_por_defecto` y, al final, del `config_extra` de siempre.
- `horario` va en hora de Bogotá, con los días de 1 (lunes) a 7 (domingo) y `hasta` exclusivo. Sin horario, siempre se pasa igual. Fuera del horario, la nota lo dice; si el reglamento trae `rf.persona.fuera_de_horario`, ese texto le sale al cliente aparte.
- **La nota** tiene una cabecera común: motivo, qué pidió, qué consultó y el siguiente paso. El bloque del medio lo aporta cada función con su gancho `notaPersona(ctx)`. Si ninguna función del rol lo declara, va el bloque del motor público: la reserva, la mesa, la autorización y la alimentación de Sabor. La sesión de Sabor lo mueve a sus funciones cuando parta `publico/dominio.ts` (por ejemplo, la reserva a `clientes.toma_datos`).
- Las señales del código solo corren con un rol. Sin filas de roles, Sabor sigue exactamente como hoy.

**La fila.** Cada traspaso deja una fila en `asistente_escalamientos`:

- `modo`: `ofrecido`, `link` o `pasado`;
- el motivo y el `rol_clave` (sin roles: `cargo:<cargo>` en WhatsApp y `asistente-publico` en Chatwoot);
- el canal;
- la conversación por alias: `wa-` más 10 hex en WhatsApp, `cw:<cuenta>:<conversación>` en Chatwoot;
- el resumen del código.

Se escribe a mejor esfuerzo: si falla, el traspaso sale igual y queda en el log. La traza del turno lo trae en `escalamiento`.

**Publicar exige el banco del arnés.**

1. Se corre el arnés del rol con el modelo real, con k = 3:
   - para Chatwoot: `publico/arnes/correr.ts --fichas-rol <fichas.json> --k 3 --salida <dir>`;
   - para la bandeja: `arnes/correr.ts --k 3 --salida <dir>`.
2. El arnés deja `<dir>/banco.json` con `pasa`, `k`, `fecha` y `huella_fichas`. La huella es `huellaPublicable(fichas)`; **no** es `huellaDe`. Una corrida en seco nunca pasa.
3. Se publica con SQL. Este paso NO mueve el puntero:
   ```sql
   select public.asistente_publicar_rol('<workspace>', '<clave>', 'max', '<banco.json>'::jsonb);
   ```
   La función rechaza, y revierte la versión, si pasa algo de esto:
   - el rol no está en `asistente_roles`;
   - el banco no pasa, o trae k < 3;
   - falta la fecha;
   - la huella no es la de lo publicado;
   - falta `rol.funciones`;
   - alguna función no está prendida en la empresa.
4. Se mueve el puntero y se prende el rol. Volver atrás es mover el puntero a la versión anterior:
   ```sql
   update public.asistente_roles set reglamento_id = '<id de la versión>', activo = true where workspace_id = '<workspace>' and clave = '<clave>';
   ```
   El trigger rechaza una versión de otro workspace, de otro rol o de otro bot.

**La versión no cambia a mitad de conversación.** En WhatsApp, el rol se fija al empezar la conversación (`traza.rol`, `roles.ts`, `rolFijo`). Una versión nueva entra en la conversación siguiente. Dos excepciones:

- si la empresa apaga una función, sale enseguida;
- si el rol se apaga, se para.

### 3.2 Botones de una plantilla (spec §4.5)

Si el rol manda una plantilla con respuestas rápidas, como la apertura de la jornada o un recordatorio, el toque de cada botón llega al asistente. Para eso, cada botón lleva el payload `ag|t|<plantilla>|<accion>`.

- `componenteBotonPlantilla(plantilla, accion, index)` (`agente/render.ts`) arma el componente `button`/`quick_reply` con su `payload`. Va en los `components` del envío. `index` va de 0 a 9.
- `payloadPlantilla(plantilla, accion)` arma solo el payload. Lanza un error si una clave no es válida o si el payload pasa de 256 caracteres.
- Plantilla y acción van en minúsculas, dígitos y `_` (`[a-z0-9_]+`), como pide Meta para el nombre de una plantilla.

**La trampa: el componente es obligatorio.** Si la plantilla sale sin él, Meta devuelve como payload el texto del botón (el ejemplo oficial: `"payload": "Unsubscribe", "text": "Unsubscribe"`). Ese toque no lleva el prefijo, así que no llega al asistente y sigue por el bot de siempre.

**Qué ve el turno.** `leerToque` lo devuelve como `{ clase: 'plantilla', plantilla, accion }`. En la conversación aparece como `[toque: "<texto del botón>" · botón de la plantilla <plantilla>]`; si Meta no trae el texto, va la acción. El mensaje con la plantilla no queda en la conversación, por eso se dice de cuál viene.

**No hay código por acción.** El modelo decide qué sigue con las funciones del rol. Si una acción tiene que escribir algo, va por `proponer`, como cualquier otra.

**Lo que no es del asistente.**

- Un payload sin el prefijo, mal formado o de otra plantilla sigue por el camino de hoy.
- Los payloads `rec_ok` y `rec_ok:<evento>` de los recordatorios (#966) los resuelve el webhook antes y nunca llegan al agente.

**El tope de 256 no está verificado contra Meta.** Meta no publica un tope para el `payload` de un botón de plantilla. El de 256 es el único que publica para el id de un botón (mensajes interactivos de respuesta), el mismo de `META.idBoton`, y no se ha probado con un envío real.

## 4. Cómo se prende una función para una empresa

```sql
insert into public.asistente_funciones_empresa (workspace_id, funcion, activa, parametros, prendida_por)
values ('<workspace>', 'equipo.gastos', true, '{"rubros": true}', 'max')
on conflict (workspace_id, funcion) do update set activa = excluded.activa, parametros = excluded.parametros;
```

- Apagar una función: `activa = false`. Sale del turno siguiente de todos los roles que la tienen.
- Los parámetros llegan al componedor en `Composicion.parametros[clave]`.
- Una clave que el código no conoce queda en el log y no abre nada.

## 5. Cómo se asigna una persona, un cargo o un inbox

```sql
-- Por persona (staff): la llave es staff.id, no profiles.id.
insert into public.asistente_asignaciones (workspace_id, rol_id, sujeto_tipo, staff_id, asignado_por) values ('<ws>', '<rol>', 'staff', '<staff.id>', 'max');
-- Por colaborador de WhatsApp.
insert into public.asistente_asignaciones (workspace_id, rol_id, sujeto_tipo, collaborator_id, asignado_por) values ('<ws>', '<rol>', 'colaborador', '<wa_collaborators.id>', 'max');
-- Por cargo de ONE (owner, admin, supervisor, operator, contador, read_only).
insert into public.asistente_asignaciones (workspace_id, rol_id, sujeto_tipo, cargo, asignado_por) values ('<ws>', '<rol>', 'cargo', 'owner', 'max');
-- Por inbox: 'cw:<cuenta>:<inbox>' (Chatwoot) o 'wa:<phone_number_id>' (Meta).
insert into public.asistente_asignaciones (workspace_id, rol_id, sujeto_tipo, inbox, asignado_por) values ('<ws>', '<rol>', 'inbox', 'cw:77:5', 'max');
```

**Cuál gana.** Gana la asignación vigente más específica: persona, luego cargo, luego inbox. La RPC solo mira roles del canal del turno.

**Vigencia.** Cada asignación vale en `[desde, hasta)`, y un sujeto no puede tener dos que se crucen. Para cambiarle el rol a alguien, se cierra la vigente (`hasta = now()`) y se abre otra.

**Ojo con el cargo por WhatsApp.** Hoy todo staff que no es el principal entra como `operator`, porque `wa_identify_user` no devuelve el rol. Al staff hay que asignarlo **por persona**. Una asignación por `cargo: admin` hoy no la alcanza nadie por WhatsApp.

**Qué pasa en cada caso.**

| Situación | WhatsApp (`wa_one`) | Chatwoot |
|---|---|---|
| El workspace no tiene roles en el canal | Camino de hoy: el dominio ONE recortado al cargo. | Camino de hoy: el reglamento `asistente-publico` y el dominio público entero. |
| La migración todavía no está (42883, 42P01, PGRST202, PGRST205) | Camino de hoy. | Camino de hoy. |
| Rol activo y publicado | El rol compuesto. | El rol compuesto. |
| Usa roles, pero el remitente o el inbox no tiene uno activo | Respuesta fija, sin modelo: `RF_SIN_ROL`. | Nota privada y la conversación pasa a una persona. |
| Falla la lectura en un workspace que se sabe que usa roles | Respuesta fija: `RF_ROL_NO_LEIDO`. | Pasa a una persona. |
| Falla la lectura en un workspace del que no se sabe | Camino de hoy (ya frena por cargo). | Camino de hoy. |

## 6. Ejemplo de punta a punta (datos inventados)

Una empresa de prueba, «Obras Demo» (workspace `00000000-0000-4000-8000-0000000000d1`), quiere una «mano derecha» que registre gastos y consulte negocios. Usa el motor `one`.

```sql
-- 1. Prender las funciones en la empresa.
insert into public.asistente_funciones_empresa (workspace_id, funcion, prendida_por) values
  ('00000000-0000-4000-8000-0000000000d1', 'equipo.gastos', 'max'),
  ('00000000-0000-4000-8000-0000000000d1', 'equipo.consulta_negocio', 'max');

-- 2. Registrar el rol (nace apagado y sin puntero).
insert into public.asistente_roles (workspace_id, clave, familia, canal)
values ('00000000-0000-4000-8000-0000000000d1', 'mano_derecha', 'equipo', 'wa_one');

-- 3. Cargar sus fichas: las de ONE más rol.funciones (en la práctica, generadas desde el código, como semilla-sql.ts).
insert into public.bot_parametros (workspace_id, bot, clave, tipo, carga, hacer, valores) values
  ('00000000-0000-4000-8000-0000000000d1', 'rol:mano_derecha', 'rol.funciones', 'alcance', 'siempre', 'Funciones del rol.',
   '{"funciones": ["equipo.gastos", "equipo.consulta_negocio", "comun.persona"]}');
-- … y el resto de fichas del rol (perfil, alc.temas, g.*, rf.*).

-- 4. Correr el arnés con esas fichas y publicar con su banco (banco.json del arnés, k = 3).
select public.asistente_publicar_rol('00000000-0000-4000-8000-0000000000d1', 'mano_derecha', 'max', '{"pasa": true, "k": 3, "fecha": "2026-10-27T15:00:00Z", "huella_fichas": "<huellaPublicable de las fichas>"}'::jsonb);

-- 5. Mover el puntero y prender.
update public.asistente_roles set reglamento_id = '<id que devolvió el paso 4>', activo = true
where workspace_id = '00000000-0000-4000-8000-0000000000d1' and clave = 'mano_derecha';

-- 6. Asignar a la persona (su staff.id).
insert into public.asistente_asignaciones (workspace_id, rol_id, sujeto_tipo, staff_id, asignado_por)
select '00000000-0000-4000-8000-0000000000d1', id, 'staff', '00000000-0000-4000-8000-0000000000e1', 'max'
from public.asistente_roles where workspace_id = '00000000-0000-4000-8000-0000000000d1' and clave = 'mano_derecha';
```

Desde el siguiente mensaje de esa persona por WhatsApp, el modelo ve exactamente esto:

- `buscar_negocios`, `negocios_abiertos`, `ver_negocio`;
- `preguntar_destino`;
- `proponer` con `gasto`, `adjuntar_soporte` y `corregir_gasto`;
- `responder`.

La traza de cada turno trae `rol: { clave: 'mano_derecha', version: 1, … }`.

**Para Chatwoot (Sabor)** se hace lo mismo con canal `chatwoot`, motor `publico`, funciones `clientes.*` y la asignación por inbox `cw:<cuenta>:<inbox>`. El camino está probado con un catálogo de prueba en `publico/roles-chatwoot.test.ts`: con todas las funciones, el arnés en seco da lo mismo que el dominio público entero.

## 7. Interruptores y avisos por workspace

Lo que corre alrededor de los asistentes y no es una función del rol. Ninguna de estas piezas trae migración.

### 7.1 Calificación diaria (spec §4.4, #1289)

Cada mañana un juez lee cada conversación del día anterior y la marca contra la lista fija de fallas (`src/lib/asistentes/fallas.ts`). Deja una fila por conversación y día en `asistente_calificaciones`.

- **El interruptor:** `config_extra.bot_conversacional.calificacion.con_texto = true`. Está apagado por defecto y solo `true` literal lo prende.
- **Es un permiso del contrato, no una función del rol.** Autoriza que el texto de las conversaciones del cliente salga hacia el juez. Por eso no vive en `asistente_funciones_empresa`: una función prendida viaja al componedor y al modelo, y ese catálogo solo admite `equipo.*`, `recolector.*` y `clientes.*`. Para prenderlo a un cliente, primero Emilio confirma que su contrato lo cubre y después va el SQL.
- **Sin el interruptor** no se arma el texto, no se llama al juez y no se escribe fila. El workspace aparece en el resumen solo con las métricas de sus trazas.
- **El juez es Claude Haiku 5.5 sin respaldo de Gemini.** El pedido sale sin llave de Gemini y se corta antes de salir si Haiku no está activo (`haikuActivo()`: `LLM_PROVEEDOR` y `ANTHROPIC_API_KEY`). Así el texto de un cliente solo va al proveedor que su contrato cubre. Si Haiku falla, esa conversación queda sin calificar ese día y el resumen lo dice.
- **El cron:** `calificar-asistentes` (`vercel.json`, `30 11 * * *`): 11:30 UTC, 6:30 de Bogotá, con el día anterior. `?fecha=AAAA-MM-DD` con `CRON_SECRET` califica otro día y `?forzar=1` salta el candado para terminar una corrida que se quedó sin tiempo. Las conversaciones ya calificadas se saltan.

```sql
update public.workspaces
set config_extra = coalesce(config_extra, '{}'::jsonb) || jsonb_build_object(
  'bot_conversacional',
  coalesce(config_extra->'bot_conversacional', '{}'::jsonb)
    || '{"calificacion": {"con_texto": true, "autorizado_por": "<contrato y cláusulas>"}}'::jsonb
)
where id = '<WORKSPACE>';
```

### 7.2 Resumen diario por correo (spec §4.3, #1290)

- **El cron:** `resumen-asistentes` (`vercel.json`, `0 12 * * *`): 12:00 UTC, 7:00 de Bogotá, media hora después de la calificación y con el mismo día.
- **A quién le llega:** un solo correo a Mauricio (`PARA_RESUMEN`, `mauricio.moreno@metrik.com.co`) con todos los workspaces. No se configura por workspace.
- **Qué trae, por workspace y rol:**
  - arriba, lo que pide acción;
  - conversaciones y turnos;
  - registros confirmados;
  - bloqueos («no pude» y candados);
  - escalamientos hechos;
  - el costo del día (modelo, juez y notas de voz; la transcripción queda «sin medir»).
- **Con el interruptor de §7.1** suma las calificadas y resueltas, las fallas por tipo, los escalamientos debidos (F9 sin fila de escalamiento), las fallas dañinas arriba y la lección del día con un caso propuesto para el arnés.
- **Sin el interruptor** el workspace sale marcado «solo métricas de trazas: sin calificación con texto»: sin fallas ni lección, y los escalamientos debidos en 0 porque nadie los midió.
- **Sale aunque no haya actividad**, con «sin actividad». Si un día no llega, se cayó el cron.
- El correo no lee el texto de ninguna conversación. La conversación va por alias y la traza se ubica por `turno_id`.

### 7.3 Correo si se caen los modelos (spec §4.1, #1286)

- **No se configura.** Aplica a todos los workspaces en los tres canales: ONE y la bandeja (`_shared/wa-agente.ts`) y el asistente público de Chatwoot (`chatwoot-agente`, por `alertaCaida` de `publico/cola.ts`).
- **Qué cuenta como caída** (`caidaDelTurno` en `agente/caida.ts`): el turno terminó por error del modelo y en el llamado que falló ningún modelo contestó. Un `refusal` o un «sin llamada» no cuentan, porque el proveedor está arriba; eso lo cuenta el resumen.
- **Un correo por incidente.** El candado es `agente:caido:<workspace>:<ventana de 30 min>`. Si la ventana anterior también tuvo caída, el incidente sigue y solo sale un recordatorio por hora (`agente:caido:<workspace>:recordatorio`). Si Resend falla, los candados se sueltan y el próximo turno caído lo intenta otra vez.
- **El secreto:** `RESEND_API_KEY` en los secretos de las edge functions. Sin él no sale ningún correo; el turno no se cae por eso.
- **Los avisos de cupo (ONE) y de presupuesto del día (público) ahora van por correo** a Mauricio. Ya no dependen de `WA_ADMIN_NOTIFY_PHONE`.

### 7.4 Transcripción con pistas (spec §4.6, #1291)

Su interruptor (`config_extra.bot_conversacional.transcripcion.pistas`) y la corrida del arnés están en la sección 2.1.

## 8. Dónde está cada cosa

| Qué | Archivo |
|---|---|
| Tipo de una función | `supabase/functions/_shared/agente/funciones/tipos.ts` |
| Catálogo | `…/agente/funciones/catalogo.ts` |
| Funciones de ONE (`equipo.*`) y sus casos | `…/agente/funciones/equipo-one.ts`, `equipo-one.casos.test.ts` |
| Comunes | `…/agente/funciones/comunes.ts` |
| Paso a una persona (`rol.escalamiento`, señales, botón, fila) | `…/agente/persona.ts`, `persona-produccion.ts`; pruebas en `persona.test.ts` |
| Componedor y reglamento del turno | `…/agente/componer.ts` |
| Mapa cargo → funciones de ONE | `…/agente/one/cargos.ts` |
| Resolución del rol, rol fijo y traza | `…/agente/roles.ts` |
| Turno de WhatsApp con roles | `…/agente/one/turno-con-rol.ts` (lo usa `_shared/wa-agente.ts`) |
| Turno de Chatwoot con roles | `…/agente/publico/turno-con-rol.ts` (lo usa `chatwoot-agente/index.ts`); compone `publico/cola.ts`, `dominioYReglamento` |
| Pistas para transcribir (constructor, interruptor, gancho de las funciones) | `…/agente/pistas.ts`, lector `pistas-supabase.ts`; arnés en `…/agente/arnes/audios/` |
| Botones de plantilla (`ag\|t\|`, `payloadPlantilla`, `componenteBotonPlantilla`) | `…/agente/render.ts`; pruebas en `toque-plantilla.test.ts` |
| Banco del arnés | `…/agente/arnes/banco.ts` |
| Correo si se caen los modelos | `…/agente/caida.ts`; envío en `_shared/correo-interno.ts` |
| Calificación diaria y su interruptor | `src/lib/asistentes/calificacion.ts`, `calificacion-servidor.ts`, `fallas.ts`; cron `src/app/api/crons/calificar-asistentes` |
| Resumen diario por correo | `src/lib/asistentes/resumen.ts`, `resumen-servidor.ts`; cron `src/app/api/crons/resumen-asistentes` |
| Tablas, RPC y publicación | `supabase/migrations/20261026183000_asistentes_roles.sql` |
