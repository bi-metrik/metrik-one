---
name: capturas-componente-sin-servidor
description: Capturas escritorio/375 de un componente cliente de ONE sin levantar Next ni tocar producción (vitest temporal + Tailwind por postcss + Playwright del caché de npx)
metadata:
  type: reference
---

Receta probada el 2026-10-22 (campana con link de WhatsApp, PR feat/campana-link-whatsapp):

1. Test temporal en `src/components/zz-*.test.ts` (NO se commitea): `vi.mock` de react para que el
   primer `useState(false)` nazca `true` (abre paneles), mocks de server actions / `next/navigation` /
   `sonner`, `renderToStaticMarkup` con datos ficticios y `writeFileSync` del HTML al scratchpad.
2. Script en el scratchpad con `createRequire(<worktree>/package.json)` para `postcss` +
   `@tailwindcss/postcss`, compilando `src/app/globals.css` + `@source "<scratchpad>/x.html"` con `base` = scratchpad.
3. Playwright NO está en `node_modules` de ONE: usar el del caché `~/.npm/_npx/*/node_modules/playwright`
   (chromium ya en `~/.cache/ms-playwright`). Medir alturas con `getBoundingClientRect` para el mínimo de 44 px.
4. Las capturas van en `docs/capturas/<fecha>-<tema>/` y el PR las enlaza con
   `https://github.com/bi-metrik/metrik-one/raw/<rama>/docs/capturas/...` (patrón de #1236).

Gotcha: el `node_modules` del repo principal va atrasado (faltan `happy-dom`, `ai`, `@ai-sdk/anthropic`):
~51 archivos de prueba y ~35 errores de tsc fallan en local por eso; CI es la lectura que manda.
En el worktree aislado, `git checkout -- <archivo>` no restaura un archivo sin trackear (la mutación queda puesta).
