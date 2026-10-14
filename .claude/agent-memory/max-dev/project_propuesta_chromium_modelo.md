---
name: propuesta-chromium-modelo
description: Propuesta de viaje nueva de Trappvel, PR 0 (#1161, ensayo Chromium en Vercel) y PR 1 (#1162, modelo del documento); trampas de versiones, fuentes, fixture y medición en preview
metadata:
  type: project
---

Plan en `proyectos/trappvel/clarity/diseno/propuesta-emocional/max.md` §3 (orden 0 → 1 → 3 → 2 → 4 → 6 → 5 → 7 → 8).
Abiertos el 2026-10-14, SIN mergear (los mergea la sesión principal):

- **#1161 (PR 0):**
  - `src/lib/pdf/chromium/` y la ruta `/api/interno/ensayo-chromium`. El GET queda abierto solo en preview; en producción y para el POST, solo platform admin.
  - Medido en la torre: 3,2 s en frío y 1,1 s tibio, unos 300 MB de Chromium, PDF de 1,8 MB y 12 páginas. La función pesa 79 MB y el preview desplegó.
- **#1162 (PR 1):** `src/lib/cotizaciones/propuesta/modelo-documento.ts`.
  - La entrada es `CotizacionPDFProps` más `servicios` opcional. Las props de hoy no traen traslados ni trenes: los tiene que pasar la acción en el PR 2.
  - `lineasDelDocumento` copia `lineasImpresas` de la plantilla; la prueba de paridad, que imprime el PDF de react-pdf, vigila que sigan iguales.

**Why:** los números se volvieron a medir porque el plan los marcaba [sin verificar]. Los gotchas de abajo costaron una vuelta cada uno.

**How to apply:**
- **Versiones:** `puppeteer-core` va fijado a la versión de Chrome de `@sparticuz/chromium` (25.11.0 ↔ 153). `puppeteer.defaultArgs()` es async: sin `await`, el error es `options.filter is not a function`.
- **Montserrat:** se embebe la de `/usr/share/fonts/opentype/montserrat/*.otf`. Los `.ttf` de truetype son otra versión, más delgada, y no se parecen al prototipo aprobado.
- **Fixtures:** uno copiado de `proyectos/<cliente>/` se sanea ANTES del commit (NIT, cuentas, teléfonos, firma, logo). El push del 14-oct lo negó el clasificador [Out-of-Place Publication] por las cuentas bancarias de Trappvel. Ver [[fixture-de-produccion-bloquea-push]].
- **Medir en preview:**
  - El proyecto no tiene «Protection Bypass for Automation» (`protectionBypass: {}`).
  - `vercel curl` lo crea solo con `PATCH /v1/projects/<id>/protection-bypass`, o sea que cambia la config del proyecto: no correrlo sin OK.
  - La salida es que Mauricio abra la URL del preview con su sesión de Vercel.
- **Vercel de ONE:** Pro, Fluid, 2 GB `standard`, timeout de 300 s, iad1 y Node 24.
