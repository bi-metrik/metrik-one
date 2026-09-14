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
- **`next/link` NO necesita doble.** Medido el 2026-09-09 (#597, la hoja por persona de `/equipo`): `renderToStaticMarkup` de un componente que envuelve todo en `<Link href=…>` pinta el `<a href>` sin contexto de router y sin un solo mock. Los iconos de `lucide-react` también. Lo que sí pide doble sigue siendo lo que toca el servidor.

- **`recharts` tampoco necesita doble, y una pantalla entera puede rendirse de una.** Medido el 2026-09-10 (#626, el perfil de comercial de `/equipo`): un componente con `ResponsiveContainer` + `BarChart` + `LineChart` pinta `<div class="recharts-responsive-container">` vacío (ancho 0) y **no lanza**. Con eso se pudo probar la pantalla completa (KPIs, embudo, leaderboard y tabla) mockeando **solo `next/navigation`** (`useRouter`, `usePathname`, `useSearchParams`). Antes de partir un componente para poder probarlo, intentar renderizarlo entero: suele salir.
- **Para afirmar sobre el texto, quitar el marcado**: `html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')`. Deja afirmar `'Ventas 2 Septiembre 2026'` de corrido, que es lo que la persona lee, en vez de pelear con las clases de cada `<span>`.

**Cuándo vale la pena:** cuando el defecto que se arregla ES la ausencia de algo en pantalla. Ahí una prueba de servidor no distingue "arreglado" de "sigue invisible". Precedente: `src/app/(app)/negocios/[id]/recaudo-cambiado-banner.test.ts` (PR #569, ver [[aviso-recaudo-sin-salida]]) — es el primer test de render del repo.

Para ver un PDF renderizado de verdad, que es otra cosa, ver [[mirar-pdf-renderizado]].
