---
name: project-spec-asistentes-roles
description: Spec «asistentes: roles y funciones» (26-oct), pieza 1 (migración 20261026183000) y pieza 2 (componedor, dominio ONE por cargo); trampas de huella, staff.id, rol fijo y qué cambia para el modelo
metadata:
  type: project
---

Spec `docs/specs/2026-10-26_asistentes-roles-y-funciones.md` (PR #1278). Decisión de Mauricio del 26-oct: los tres asistentes (Sabor 29-oct, Imperviun, Laura) salen sobre roles; Sabor desde el primer día, con respaldo = persona en Chatwoot.

**Pieza 1 (migración `20261026183000_asistentes_roles.sql`, #1282): mergeada a main el 26-oct por la sesión principal (que la aplica antes del merge; verificar en el ledger si hay duda).** Decisiones que no se ven en la spec:
- **La huella NO se compara con `bot_reglamentos.huella`.** Medido en PGlite: `bot_publicar_reglamento` hace sha256 de `jsonb::text` y `huellaDe` usa `localeCompare` y deja nulls; dan distinto (y `rf.persona_por_que` vs `rf.persona.crisis` se ordenan al revés). Se compara `asistente_huella_fichas(fichas)` contra `huellaPublicable` (TS, `reglamento.ts`): sin nulos, `fuente:''` = sin fuente (las semillas guardan `fuente || null`), orden de bytes. El banco del arnés tiene que traer `huellaPublicable`, no `huellaDe`.
- **Llave del staff = `staff.id`**, no `profiles.id`: hay staff con WhatsApp y sin perfil. `wa_identify_user` NO devuelve `user_id` (confirmado por otra sesión el 26-oct: [[asignado-origen-y-remitente-bot]]); desde ese arreglo `WaUser.staff_id` sale resuelto por teléfono. El componedor le pasa `user.staff_id` a `asistente_resolver_rol` (acepta también el perfil). El cargo sigue roto: todo staff no principal entra como `operator`, así que una asignación por `cargo: admin` hoy no la alcanza nadie por WhatsApp.
- Inbox guardado como `cw:<cuenta>:<inbox>` o `wa:<phone_number_id>`.
- `asistente_resolver_rol` devuelve `{usa_roles, rol}`: `usa_roles=false` = enrutamiento de hoy; `true` con rol null = workspace con roles y remitente sin asignación (no caer al dominio ONE completo).
- En un trigger BEFORE la columna generada (`sujeto`) todavía es NULL: el trigger arma la expresión a mano.

Lo que ya existe: toque de plantilla en #966 y Imperviun en #1235/#1237 (abiertos; Imperviun se reutiliza partido en funciones); Sabor etapa 2 (#1234, campañas y `funcion_saldo`) ya está en main.

**Pieza 2 (componedor, rama `feat/asistentes-componedor`, sin migración, mergea #1282 adentro):** lo no obvio:
- Las funciones NO implementan herramientas: reclaman por nombre las de un motor (`Dominio` de hoy). El dominio ONE se partió en 7 funciones (más finas que §2.2: consulta de gastos aparte, `equipo.ver_plata` sin herramientas) para reproducir `permisosDe` exacto.
- El dueño/admin ve EXACTAMENTE lo de antes (mismas declaraciones y fichas salvo `rf.fuera_de_tema`, que no va al prompt): la eval de Haiku del 21-oct sigue valiendo para él; cambian los casos con `rol: operator` (i-operador-contacto, g-ingreso-sin-permiso).
- Un rol sin acciones no recibe `proponer` (enum vacío); el núcleo filtra los forzados a lo declarado.
- Propiedad de fichas por motor del canal: una ficha de Sabor con la misma clave que una de ONE no se toca.
- `rolFijo` solo fija el MISMO rol: si la asignación cambió, manda la de ahora (el interruptor del rol viejo no se puede saltar).
- La eval real de ONE no corrió (sin ANTHROPIC_API_KEY en la sesión del subagente).

**Why:** la pieza 2 (componedor) y las sesiones de cada cliente construyen encima de esto.
**How to apply:** el arnés que emite el banco usa `huellaPublicable`; para staff, asignar por persona (`staff`) y no confiar en `cargo` distinto de owner/operator mientras el rol del remitente siga roto.
