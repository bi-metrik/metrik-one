---
name: recuperacion-red-iphone
description: PR fix/recuperacion-red-iphone (2026-10-02) — auto-recarga del boundary, useTransitionTolerante, bloques dinámicos de la ficha, perfil de sesión compartido; qué quedó fuera y cómo se midió
metadata:
  type: project
---

«Algo se rompió en esta pantalla» en iPhone de SOENA (2-oct) era la red del teléfono, no deploys
viejos (`version == versionServidor`). Rama `fix/recuperacion-red-iphone`, sin migración.

**Decisiones no obvias:**
- `useTransitionTolerante` NO reintenta escrituras aunque el brief pedía «un reintento corto»: un
  `Load failed` en iOS sale también cuando la respuesta se pierde al mandar la app al fondo; reintentar
  duplicaría marcas/pagos. Solo las lecturas al montar usan `conReintentoDeRed`.
- Solo se adoptó en `/negocios`, la ficha y 3 componentes compartidos (activity-log, modales de pago).
  El resto de la app (~220 `startTransition(async`) sigue con `useTransition`: adopción pendiente.
- Lo que más pesaba no era la ficha: el boundary cargaba Zod entero (378 KB) en TODAS las páginas por un
  import de #988.

**Why:** el aprendizaje sirve si vuelve a aparecer el error en otra pantalla o con otro cliente.

**How to apply:** si un log `[error-cliente]` muestra `autoRecarga:false` con error de red, la guarda ya
se gastó (2 fallas en 60 s) o la pantalla no usa el hook tolerante. OJO (3-oct, PR fix/guarda-auto-recarga):
hasta ese PR el `false` era SIEMPRE, porque la marca se reclamaba en el inicializador de `useState` y React
renderiza el boundary 2 veces (render concurrente descartado + reintento síncrono): el render descartado la
gastaba. Nada que escriba en sessionStorage/estado externo va en render; se reclama en el `useEffect`. La
prueba con React real está en `src/app/auto-recarga-boundaries.test.ts` (happy-dom registrado a mano: el
`@vitest-environment` no resuelve el paquete desde un worktree con node_modules de symlinks). Para medir bundles: `next
experimental-analyze -o` escribe `.next/diagnostics/analyze/data/<ruta>/analyze.data` (4 bytes de largo +
JSON con `chunk_parts`/`sources`/`output_files`); se lee con un script de 30 líneas.
Pendiente medido y NO hecho: middleware y render resuelven Auth por separado (2 por petición), y en
server actions el `cache()` no memoiza (sin `enPeticionDeRuta`). Ver [[techo-postgrest-1000-filas]] para otros
patrones de lectura.
