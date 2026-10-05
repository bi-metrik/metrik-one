---
name: rum-y-lecturas-sin-actions
description: Fases C y D de baja conectividad (2026-10-05) — RUM `[rum]` + cola de `[error-cliente]` (#1018) y lecturas al montar fuera de server actions; cómo medir actions por nombre
metadata:
  type: project
---

**C (#1018, feat/rum-red):** `RumRed` en `(app)/layout.tsx` manda UN beacon `[rum]` por ciclo de
página (vitals + navegación suave). `[error-cliente]` lleva `id` y pasa por una cola en
localStorage: **puede llegar dos veces, contar por `id` distinto**. Muestreo 100 %.

**D (perf/lecturas-sin-server-actions):** el shell ya no lee con actions al montar. «Ver como» y el
timer los resuelve el layout; el FAB sabe si el negocio está cerrado porque la ficha lo anuncia
(`lib/negocios/negocio-en-pantalla.ts`); la actividad llega del servidor; la campana y el bloque
formulario leen por GET (`/api/notificaciones` con ETag, `/api/negocios/[id]/formulario/[bloqueId]`).

**Why:** Next pone las server actions en fila: una lectura al montar retrasa la acción real.
Medido 2026-10-05: de 20.438 actions en 7 días, ~10.300 eran estas lecturas
(getNotificaciones 6.136, getActivityLog 876, negocioDeContextoCerrado 871, impersonation 696,
timer 628+623, formulario 484).

**How to apply:**
- Contar actions por nombre: `vercel metrics vercel.function_invocation.count --prod -s 7d -g 7d -f
  "request_method eq 'POST'" --group-by server_action_name -l 300 --json`. La campana no hacía
  polling: leía al volver a la pestaña (ahora máx. 1/min).
- `vercel logs --query` NO acepta corchetes (`"[rum]"` da vacío): `--query rum` y filtrar el
  prefijo (`scripts/rum-p75.mjs`). Retención de logs de runtime: 30 días.
- Componente que importa una action y se monta en un test de render del shell: el mock de
  `next/navigation` de esos tests solo trae `usePathname`/`useRouter`; algo que use `useParams`
  va en el layout, no en el shell.
- Quedan lecturas al montar de bajo volumen (≤17/7 días): pagos externos de conciliación,
  bloques Contacto/Cronograma/PropuestaEconomica. Los drawers de Tableros leen al abrirse (acción
  del usuario).

Relacionado: [[epoca-no-recargar-por-deploy]], [[respuesta-al-tocar]], [[recuperacion-red-iphone]].
