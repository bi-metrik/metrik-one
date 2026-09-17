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

- **Un desplegable que nace cerrado (`useState(false)`) sí se puede rendir abierto sin tocar el componente.** Medido el 2026-09-16 (#749, selector del platform admin): se dobla `react` para que el `useState` que arranca en `false` arranque en `true`. El `'react/jsx-runtime'` y `react-dom/server` no pasan por el doble, así que el render sigue funcionando:
  ```ts
  vi.mock('react', async importOriginal => {
    const real = await importOriginal<typeof import('react')>()
    const useState = ((i: unknown) => real.useState(i === false ? true : i)) as typeof real.useState
    return { ...real, default: { ...real, useState }, useState }
  })
  const { PlatformAdminBar } = await import('./platform-admin-bar')
  ```
  Solo sirve si ese es el **único** estado del componente que nace en `false`, así que hay que revisarlo antes de usarlo. Siempre va con un caso de control que compruebe que el contenido abierto sí se pinta (el placeholder del buscador). Sin ese control, las demás pruebas pasan aunque la lista no aparezca.

- ⚠️ **Afirmar `toContain('disabled')` sobre el HTML NO prueba que el botón esté deshabilitado: lo pasa cualquier botón con clases `disabled:*` de Tailwind.** Medido el 2026-09-17 (#782): el botón de cada workspace lleva `disabled:cursor-default disabled:opacity-50`, así que `expect(habilitado).not.toContain('disabled')` **falla** sobre un botón que sí está habilitado, y su gemelo `toContain('disabled')` habría pasado sobre uno mal pintado. Lo que React renderiza de verdad es el atributo `disabled=""`, y **eso** es lo que hay que afirmar. Mismo cuidado con `checked`, `required` y `readonly`: los tres tienen variante de Tailwind con el mismo nombre. Familia de [[pruebas-por-mutacion]] — aquí el falso resultado apareció en la dirección buena (rojo), pero la afirmación positiva era la que no medía nada.

**Cuándo vale la pena:** cuando el defecto que se arregla ES la ausencia de algo en pantalla. Ahí una prueba de servidor no distingue "arreglado" de "sigue invisible". Precedente: `src/app/(app)/negocios/[id]/recaudo-cambiado-banner.test.ts` (PR #569, ver [[aviso-recaudo-sin-salida]]) — es el primer test de render del repo.

Para ver un PDF renderizado de verdad, que es otra cosa, ver [[mirar-pdf-renderizado]].
