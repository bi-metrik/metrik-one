---
name: probar-render-sin-dom
description: Cómo probar un componente de React en metrik-one, donde vitest corre en entorno node y el include solo recoge .test.ts
metadata:
  type: reference
---

`vitest.config.ts` de metrik-one usa `environment: 'node'` y su `include` es `src/**/*.test.ts` — **sin `.tsx`**. No hay `@testing-library` ni jsdom instalados.

Se puede probar el primer render igual:

- `renderToStaticMarkup` de `react-dom/server` corre sin DOM. Sirve para "¿se pinta?", "¿qué texto sale?" y "¿aparece este botón según el permiso?". No sirve para clics ni estado.
- **El archivo va con extensión `.test.ts`, no `.test.tsx`**, o el `include` no lo recoge — y `--include` no existe como opción del CLI de vitest. Como entonces no puede llevar JSX, se construye con `React.createElement(Componente, props)`.
- Hay que `vi.mock` de las server actions que importe el componente (un archivo `'use server'`) y de `sonner`.

**Cuándo vale la pena:** cuando el defecto que se arregla ES la ausencia de algo en pantalla. Ahí una prueba de servidor no distingue "arreglado" de "sigue invisible". Precedente: `src/app/(app)/negocios/[id]/recaudo-cambiado-banner.test.ts` (PR #569, ver [[aviso-recaudo-sin-salida]]) — es el primer test de render del repo.

Para ver un PDF renderizado de verdad, que es otra cosa, ver [[mirar-pdf-renderizado]].
