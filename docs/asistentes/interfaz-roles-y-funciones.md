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
  pistas: async (ctx) => [],            // opcional: palabras de la base para la transcripción (§4.6, pieza futura)
}
```

Reglas:

- **La función no implementa nada.** Toma por nombre herramientas que el motor ya declara. Si la herramienta es nueva, va en el motor y la función la reclama.
- **Cada herramienta de un motor tiene exactamente una función dueña.** La prueba `componer.test.ts` («el catálogo cubre cada herramienta de cada motor una sola vez») falla si una queda sin dueña o con dos. Una herramienta sin dueña no la ve ningún rol.
- **Una ficha es de una función si la función toma algo del motor de ese canal.** Por eso una ficha de Sabor que se llame igual que una de ONE no es de ONE. Una ficha que no es de ninguna función va siempre. Si es de varias, va cuando está alguna de ellas.
- **Las comunes las pone el componedor.** Se declaran con `familia: 'comun'` y `comun: true`:
  - `comun.persona`: en Chatwoot es `pasar_a_persona`; en WhatsApp es un hueco hasta la pieza de traspaso.
  - `comun.fuera_de_tema`: la respuesta fija `rf.fuera_de_tema` la arma el código con las líneas `queHace` del rol. Si ninguna función del turno trae su línea `queHace`, se deja el texto del reglamento.

**2. La entrada en el catálogo.** Se agrega al arreglo de `funciones/catalogo.ts`. `catalogoDe` lanza si la clave está mal formada o repetida.

**3. Los casos.** Cada función trae tres casos con el modelo guionado, como en `funciones/equipo-one.casos.test.ts`:

- `actua`: donde debe actuar, y lo hace.
- `no_actua`: el modelo la intenta mal y el candado la ataja.
- `rol`: desde un rol que no la tiene, la herramienta no existe o la acción es `accion_desconocida`.

La prueba exige los tres por cada función del archivo. Los casos reales del cliente van aparte, en el arnés de su rol.

**4. Si el motor es nuevo** (obras, citas): es un `Dominio` como cualquier otro. Se pasa en `componerDominio({ motores: { obras: dominioObras(...) } })`. Si su `proponer` usa propiedades distintas por acción, se pasa también `datosPorAccion`, para que el rol vea solo las de sus acciones. Así lo hace `DATOS_POR_ACCION_ONE` en `one/dominio.ts`.

## 3. Cómo se arma y se publica la ficha de un rol

El contenido del rol va en `bot_parametros` con `bot = 'rol:<clave>'`, y se publica como versión inmutable en `bot_reglamentos`. Además de las fichas de siempre (`alc.*`, `inv.*`, `g.*`, `p.*`, `rf.*`), lleva cuatro fichas.

| Ficha | Tipo | Qué lleva |
|---|---|---|
| `perfil` | `perfil` | `valores.nombre`, `audiencia`, `idioma` y el trato. |
| `rol.funciones` | `alcance` | `valores.funciones: string[]`. Es obligatoria: `asistente_publicar_rol` la exige y la RPC la lee. |
| `rol.escalamiento` | `alcance` | A quién se pasa la conversación (`chatwoot_equipo` o `wa_link`), si se ofrece o se pasa directo, y el horario. |
| `rol.saludo` | `estilo` | Saludo por hora, presentación en el primer contacto y la plantilla diaria, si la hay. |

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

## 7. Dónde está cada cosa

| Qué | Archivo |
|---|---|
| Tipo de una función | `supabase/functions/_shared/agente/funciones/tipos.ts` |
| Catálogo | `…/agente/funciones/catalogo.ts` |
| Funciones de ONE (`equipo.*`) y sus casos | `…/agente/funciones/equipo-one.ts`, `equipo-one.casos.test.ts` |
| Comunes | `…/agente/funciones/comunes.ts` |
| Componedor y reglamento del turno | `…/agente/componer.ts` |
| Mapa cargo → funciones de ONE | `…/agente/one/cargos.ts` |
| Resolución del rol, rol fijo y traza | `…/agente/roles.ts` |
| Turno de WhatsApp con roles | `…/agente/one/turno-con-rol.ts` (lo usa `_shared/wa-agente.ts`) |
| Turno de Chatwoot con roles | `…/agente/publico/turno-con-rol.ts` (lo usa `chatwoot-agente/index.ts`); compone `publico/cola.ts`, `dominioYReglamento` |
| Banco del arnés | `…/agente/arnes/banco.ts` |
| Tablas, RPC y publicación | `supabase/migrations/20261026183000_asistentes_roles.sql` |
