---
name: project-espacio-pruebas-trappvel
description: trappvel-pruebas (2026-10-13) — script clonar-config-workspace SIN correr contra producción; listUsers caído en prod (banned_until infinity), se busca por ?filter=; sin almacén propio no guarda fotos ni pantallazos; el preview sin GEMINI no lee pantallazos
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
