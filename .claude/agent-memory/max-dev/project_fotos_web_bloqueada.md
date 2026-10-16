---
name: project-fotos-web-bloqueada
description: REEMPLAZADA por fotos-perfiles (2026-10-16): Fotos de la página oficial cuando la web bloquea (Hilton 403) o arma la galería con JS; aviso, galerías extra y Ctrl+V por documento (feat/fotos-web-bloqueada, 2026-10-16)
metadata:
  type: project
---

PR feat/fotos-web-bloqueada (sobre #1200, sin migración, SIN mergear al cierre).

- La falla de lectura se clasifica en `src/lib/fotos/falla-pagina.ts`; `traerSeguro` ahora envuelve a `traerConMotivo`. `leerPagina` devuelve `{ok,falla}` y no `null`.
- El UA del servidor sigue siendo el de Commons (honesto): no se disfraza de navegador. Por eso Hilton/Marriott/Accor van a caer en «bloqueada» y la salida real es pegar la foto.
- Ctrl+V: hook en el documento en captura (`usar-imagen-pegada.ts`); corta la propagación por el `paste` del riel de cobro en la ficha.

**Why:** Mauricio vio la galería vacía al pegar la web de Hilton Cartagena.
**How to apply:** si se toca la extracción, recordar que `bajarFotoDeSitio` vuelve a leer con `leerPagina` (incluye las subpáginas de galería) para validar la imagen elegida; cambiar una sin la otra rompe «la foto ya no está en la página». No medido contra webs reales desde Vercel.
