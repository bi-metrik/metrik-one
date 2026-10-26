---
name: project-spec-asistentes-roles
description: Spec «asistentes: roles y funciones» (26-oct) y su pieza 1 (migración 20261026183000, aplicada en prod el 26-oct); trampas de huella, llave del staff y lo que ya existe en PR abiertos
metadata:
  type: project
---

Spec `docs/specs/2026-10-26_asistentes-roles-y-funciones.md` (PR #1278). Decisión de Mauricio del 26-oct: los tres asistentes (Sabor 29-oct, Imperviun, Laura) salen sobre roles; Sabor desde el primer día, con respaldo = persona en Chatwoot.

**Pieza 1 (migración `20261026183000_asistentes_roles.sql`): aplicada en producción y en main (26-oct).** Decisiones que no se ven en la spec:
- **La huella NO se compara con `bot_reglamentos.huella`.** Medido en PGlite: `bot_publicar_reglamento` hace sha256 de `jsonb::text` y `huellaDe` usa `localeCompare` y deja nulls; dan distinto (y `rf.persona_por_que` vs `rf.persona.crisis` se ordenan al revés). Se compara `asistente_huella_fichas(fichas)` contra `huellaPublicable` (TS, `reglamento.ts`): sin nulos, `fuente:''` = sin fuente (las semillas guardan `fuente || null`), orden de bytes. El banco del arnés tiene que traer `huellaPublicable`, no `huellaDe`.
- **Llave del staff = `staff.id`**, no `profiles.id`: hay staff con WhatsApp y sin perfil. `wa_identify_user` NO devuelve `user_id` (confirmado por otra sesión el 26-oct: [[asignado-origen-y-remitente-bot]]); desde ese arreglo `WaUser.staff_id` sale resuelto por teléfono. El componedor le pasa `user.staff_id` a `asistente_resolver_rol` (acepta también el perfil). El cargo sigue roto: todo staff no principal entra como `operator`, así que una asignación por `cargo: admin` hoy no la alcanza nadie por WhatsApp.
- Inbox guardado como `cw:<cuenta>:<inbox>` o `wa:<phone_number_id>`.
- `asistente_resolver_rol` devuelve `{usa_roles, rol}`: `usa_roles=false` = enrutamiento de hoy; `true` con rol null = workspace con roles y remitente sin asignación (no caer al dominio ONE completo).
- En un trigger BEFORE la columna generada (`sujeto`) todavía es NULL: el trigger arma la expresión a mano.

Lo que ya existe: toque de plantilla en #966 y Imperviun en #1235/#1237 (abiertos; Imperviun se reutiliza partido en funciones); Sabor etapa 2 (#1234, campañas y `funcion_saldo`) ya está en main.

**Why:** la pieza 2 (componedor) y las sesiones de cada cliente construyen encima de esto.
**How to apply:** el arnés que emite el banco usa `huellaPublicable`; para staff, asignar por persona (`staff`) y no confiar en `cargo` distinto de owner/operator mientras el rol del remitente siga roto.
