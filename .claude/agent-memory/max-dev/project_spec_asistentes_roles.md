---
name: project-spec-asistentes-roles
description: Spec «asistentes: roles y funciones» (26-oct) y su pieza 1 (migración 20261026183000 SIN aplicar); trampas de huella, llave del staff y lo que ya existe en PR abiertos
metadata:
  type: project
---

Spec `docs/specs/2026-10-26_asistentes-roles-y-funciones.md` (PR #1278). Decisión de Mauricio del 26-oct: los tres asistentes (Sabor 29-oct, Imperviun, Laura) salen sobre roles; Sabor desde el primer día, con respaldo = persona en Chatwoot.

**Pieza 1 (migración `20261026183000_asistentes_roles.sql`, rama `feat/asistentes-roles-migracion`): SIN aplicar; la aplica y mergea la sesión principal.** Decisiones que no se ven en la spec:
- **La huella NO se compara con `bot_reglamentos.huella`.** Medido en PGlite: `bot_publicar_reglamento` hace sha256 de `jsonb::text` y `huellaDe` usa `localeCompare` y deja nulls; dan distinto (y `rf.persona_por_que` vs `rf.persona.crisis` se ordenan al revés). Se compara `asistente_huella_fichas(fichas)` contra `huellaPublicable` (TS, `reglamento.ts`): sin nulos, `fuente:''` = sin fuente (las semillas guardan `fuente || null`), orden de bytes. El banco del arnés tiene que traer `huellaPublicable`, no `huellaDe`.
- **Llave del staff = `staff.id`**, no `profiles.id`: hay staff con WhatsApp y sin perfil. `database.ts` dice que `wa_identify_user` NO devuelve `user_id` ni `role` (tipos del 27-sep), pero `wa-identificar.ts` los lee: sin verificar en prod. La RPC `asistente_resolver_rol` acepta perfil o staff.id dentro del workspace.
- Inbox guardado como `cw:<cuenta>:<inbox>` o `wa:<phone_number_id>`.
- `asistente_resolver_rol` devuelve `{usa_roles, rol}`: `usa_roles=false` = enrutamiento de hoy; `true` con rol null = workspace con roles y remitente sin asignación (no caer al dominio ONE completo).
- En un trigger BEFORE la columna generada (`sujeto`) todavía es NULL: el trigger arma la expresión a mano.

Lo que ya existe en PR abiertos: toque de plantilla en #966; Imperviun en #1235/#1237 (se reutiliza partido en funciones); Sabor etapa 2 en #1234 (campañas, `funcion_saldo`).

**Why:** la pieza 2 (componedor) y las sesiones de cada cliente construyen encima de esto.
**How to apply:** antes de la pieza 2, verificar en prod qué devuelve `wa_identify_user` (`pg_get_function_result`); el arnés que emite el banco usa `huellaPublicable`.
