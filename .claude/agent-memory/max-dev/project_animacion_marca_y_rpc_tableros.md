---
name: animacion-marca-y-rpc-tableros
description: Plan de velocidad de ONE tras la caída de Supabase del 2026-10-03 — dónde volvió la animación de marca (login + loading de (app)) y cómo se disparan las RPC de Tableros SOENA
metadata:
  type: project
---

El 2026-10-03 la base (Micro) se saturó a la 1:33 p. m. y ONE se cayó para SOENA. Plan
aprobado por Mauricio: #994 quitó el splash del layout raíz; el PR `perf/animacion-sin-friccion`
la devuelve solo donde hay espera real.

**Dónde vive la animación:** `src/components/marca/animacion-marca.tsx` (CSS puro, sin
`'use client'`, aparece a los 300 ms) en (1) `(app)/loading.tsx`, versión liviana, y (2) el
login al enviar el código, intro una vez por sesión (`intro-de-sesion.ts`, sessionStorage;
se marca solo al validar). El enlace mágico pasa por `/auth/callback`, que es route handler
y no puede pintar: esa entrada solo ve la liviana del loading.

**Why:** el overlay viejo retenía 2,8 s cada carga completa.
**How to apply:** ⚠️ el loading de `(app)` se monta por segmento hijo (`equipo`, `tableros`),
no por search params: `/equipo?mes=` no lo re-muestra (verificado en `layout-router.js`,
`parentCacheNode.loading`). Un `loading.tsx` más profundo SÍ cambiaría eso.

**Mapa de RPC (para la 2ª vuelta):** abrir `/tableros` como gerencial SOENA dispara 12 RPC
caras EN PARALELO en un solo request (10 de `cargarComercialNegocios` + directivo + bono),
más las demás pestañas. Cambiar de pestaña NO consulta (estado de cliente, props
iniciales); cambiar de mes o de vendedor sí (5 o 3 RPC por clic). `revalidatePath('/tableros')`
de metas y config del bono re-dispara las 12. Todas son SECURITY DEFINER con guarda
`p_workspace_id = current_user_workspace_id()`: el resultado depende SOLO de workspace y
parámetros (el recorte por rol del bono se hace en TS) → cacheables por (ws, params).
Relacionado: [[perf-fence-venta-mes-soena]].
