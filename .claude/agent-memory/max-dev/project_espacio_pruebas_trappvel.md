---
name: project-espacio-pruebas-trappvel
description: trappvel-pruebas (2026-10-13) — dos --apply fallidos (FK circular, rubros.valor_total GENERATED); restos 90226eac en prod hasta --borrar --apply; ensayo PGlite antes del próximo --apply; listUsers caído en prod (banned_until infinity), se busca por ?filter=; sin almacén propio no guarda fotos ni pantallazos; el preview sin GEMINI no lee pantallazos
metadata:
  type: project
---

`scripts/clonar-config-workspace.ts trappvel trappvel-pruebas` (PR feat/workspace-pruebas-trappvel, 2026-10-13) crea el
espacio donde Vera (etapa D) y Sofía (etapa E) prueban la cotización por pasos. Escrito y probado solo contra el doble:
el simulacro y el `--apply` contra producción los corre la sesión principal.

**Why:** Mauricio aprobó el 2026-10-12 un workspace de prueba en vez de encender el interruptor en Trappvel.

**How to apply:**
- ⚠️ Sin `storage_provider` (no se copia: es el Supabase propio de la cliente) la imagen del pantallazo y la foto del
  hotel NO se guardan (`imagen-captura.ts`, `foto-hotel-almacen.ts`): el PDF sale sin foto de hotel. Para la prueba de
  Sofía («ve las fotos») hace falta un almacén propio de pruebas + `WS_STORAGE_SECRET_TRAPPVEL_PRUEBAS` en Vercel.
- ⚠️ El preview no tiene `GEMINI_API_KEY` ([[project-preview-abre-workspace]]): sin ella no se leen pantallazos; con el
  «✎ Escríbelo a mano» sí se arma el caso.
- `modelo_destino` queda apagado (solo `{activo: true}`): M4 de Vera sigue mandando.
- Entrar: `<preview>/?__ws=trappvel-pruebas` o `trappvel-pruebas.metrikone.co`; login por código a los alias
  `mauricio.moreno+trappvel-pruebas-dueno|asesora@metrik.com.co`.
- Una tabla nueva de configuración hay que clasificarla en `src/lib/espacio-pruebas/clasificacion.ts`: si tiene filas de
  la cliente y no está, `--apply` se niega.
- ⚠️ `auth.admin.listUsers` está CAÍDO en producción (2026-10-14): una fila de otro cliente con
  `banned_until = 'infinity'` rompe el escáner de GoTrue en cualquier página. Mauricio decidió no tocar el dato. El
  clonador busca por `GET /auth/v1/admin/users?filter=<correo>` (`src/lib/espacio-pruebas/auth.ts`, PR
  fix/clonar-workspace-sin-listusers) — la vía `filter` NO se pudo probar contra prod desde el subagente (clasificador
  negó la lectura): la valida el primer simulacro. `getUserById` no lee la fila rota.
- ⚠️⚠️ Dos `--apply` reales fallaron (2026-10-14): FK circular `workspaces.linea_activa_id` (#1156) y
  `rubros.valor_total` GENERATED (PR fix/clonar-workspace-generadas-y-deshacer). Tras el segundo quedaron RESTOS en
  prod: workspace `90226eac-6e94-4d82-92af-f41df99f4493` (marcado de prueba, sin `clon_completo`), 2 profiles y 2 alias.
  Con el PR, `--borrar --apply` o un `--apply` nuevo los purgan solos.
- El doble no ve reglas de la base: antes de un `--apply`, correr
  `src/lib/espacio-pruebas/ensayo-postgres.test.ts` con `ESPACIO_PRUEBAS_ESQUEMA=<DDL>` (DDL por
  `scripts/espacio-pruebas-esquema-produccion.sql`, ~300 KB: la saca la sesión con MCP). La vía
  `ESPACIO_PRUEBAS_MIGRACIONES=1` es aproximada (las migraciones no rehacen prod) pero sí reprodujo las dos caídas.
- Un `--apply` sin `.env.local` en el worktree no tiene llaves: `tsx` sí está en el npx de la torre (`--no-install`).
