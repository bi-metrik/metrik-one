---
name: loading-app-no-cubre-ficha
description: El loading.tsx de (app) NO se pinta al ir de /negocios a /negocios/[id] (ni con precarga) — Next llavea el Suspense por el segmento hijo, que es el mismo
metadata:
  type: project
---

Verificado el 2026-10-03 en `node_modules/next/dist/client/components/layout-router.js` (Next 16.1):
el `LoadingBoundary` de un nivel se monta dentro de un `TemplateContext.Provider` con `key = stateKey`
del segmento HIJO. El único `loading.tsx` de ONE está en `src/app/(app)/`, y su hijo para `/negocios` y
`/negocios/[id]` es el mismo segmento `negocios`: el Suspense no se remonta, la navegación es transición y
React deja la lista vieja visible hasta que llega la ficha entera. La animación SÍ sale entre secciones
del menú (negocios → contactos), donde el hijo cambia.

**Why:** el coordinador diagnosticó «sin precarga el loading.tsx no puede pintarse»; el mecanismo real es
otro y la precarga por sí sola no lo arregla. Se reportó antes de construir el PR de respuesta al tocar.

**How to apply:** para señal instantánea al abrir una tarjeta: estado pendiente en el cliente
(`useTransition` + animación propia en el área de contenido), o un `loading.tsx` en `negocios/` (su hijo
sí cambia: `__PAGE__` → `[id]`) más precarga para que el fallback esté en el cliente.
Relacionado: [[recuperacion-red-iphone]], [[lista-negocios-paginada]].
