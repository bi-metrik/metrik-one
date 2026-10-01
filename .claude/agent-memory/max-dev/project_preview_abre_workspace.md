---
name: project-preview-abre-workspace
description: PR #968 (2026-10-01): el preview de Vercel abre el workspace de un cliente con ?__ws=<slug>; usa la base de produccion; sin GEMINI_API_KEY no lee pantallazos; login por codigo
metadata:
  type: project
---

Mecanismo (PR #968, SIN mergear al escribir esto): con `VERCEL_ENV === 'preview'`, `?__ws=<slug>`
fija la cookie `__preview_ws` y el middleware trata la peticion como `<slug>.metrikone.co` (misma
rama de inquilino, misma cabecera `x-tenant-slug`, mismo guard de pestaña desincronizada). Link:
`https://metrik-one-git-<rama-con-guiones>-metrik-one.vercel.app/?__ws=trappvel`.

**Why:** regla `qa-antes-de-lanzar-one` (C3): recorrer en pantalla ANTES del merge, que despliega a
produccion. Hasta aqui el preview no tenia inquilino y cambiar de workspace saltaba a produccion.

**How to apply:**
- Verificado 2026-10-01 con `vercel env pull --environment=preview` (solo lectura): el preview
  apunta a `yfjqscvvxetobiidnepa` (produccion) con la MISMA service role (sha256 igual). Todo lo
  creado en el preview es real: negocio «PRUEBA» y borrado por la sesion principal.
- Scope Preview tiene 9 variables: faltan `GEMINI_API_KEY` (pantallazos), `METRIK_PDF_RENDER_*`,
  `RESEND_API_KEY`, `CRON_SECRET`, `NEXT_PUBLIC_BASE_DOMAIN` (esta a proposito).
- Login en el preview: por el CODIGO del correo. Las Redirect URLs de Supabase Auth no se pudieron
  leer (sin token de Management API); si no incluyen `*.vercel.app`, el enlace cae en produccion.
- Un PR cuyo preview deba abrir un workspace necesita #968 en `main` (o rebasado encima).
- Un `switchWorkspace` en el preview mueve `profiles.workspace_id` EN PRODUCCION: las pestañas de
  produccion en otro workspace muestran el aviso de pestaña desincronizada.

Relacionado: [[project-pestana-desincronizada]], [[project-tarjeta-relee-sin-recargar]].
