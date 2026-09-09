---
name: render-tarjeta-negocio-aislada
description: NegocioCard sí se deja renderizar sin DOM con 4 dobles (dos server actions, sonner y CardLink); encontró un defecto que ninguna prueba pura veía
metadata:
  type: reference
---

`src/app/(app)/negocios/negocio-card.tsx` **se renderiza en `node` con
`renderToStaticMarkup`**, pese a ser client component con `useState`/`useTransition`.
Verificado el 2026-09-09 (PR #598, 8 casos).

**Los cuatro dobles que hacen falta**, y por qué cada uno:

```ts
vi.mock('./negocio-v2-actions', () => ({ agregarResponsable: vi.fn(), quitarResponsable: vi.fn() }))
vi.mock('./marcas-actions',     () => ({ agregarMarcaNegocio: vi.fn(), quitarMarcaNegocio: vi.fn() }))
vi.mock('sonner',               () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/components/card-link', () => ({
  CardLink: ({ children }) => React.createElement('div', null, children),
}))
const { default: NegocioCard } = await import('./negocio-card')
```

Los dos primeros son archivos `'use server'`: importarlos de verdad arrastra el
runtime de Next y no resuelve. `CardLink` usa `useRouter`. **El `await import`
después de los `vi.mock` es obligatorio**, no cosmético.

⚠️ El fixture del negocio es largo (~40 campos de `NegocioResumen`) y termina en un
`as any` — **eso no es pereza, es lo correcto aquí**: el tipo cambia seguido y una
prueba de render no debería romperse por un campo nuevo que no pinta. Distinto del
caso de `caso-listo.test.ts`, donde el cast tapaba una propiedad **inexistente** en
el tipo (ver [[pruebas-por-mutacion]]).

**Por qué vale la pena:** encontró un defecto que **ninguna prueba pura veía** —
`formatBogotaFechaCorta` imprime `26 de sept` por el patrón CLDR de `es-CO`, así que
el chip salía «Cita **26 de sept** · 09:30». Y mató la mutación «la tarjeta ignora
`negocio.atencion_cita`», que las 23 pruebas del helper dejaban pasar en verde.

⚠️ **Al afirmar sobre lo que NO se pinta, acotar al elemento.** `not.toContain('26 de sept')`
falla porque la ayuda emergente dice «26 de **sept**iembre» y eso está bien: hay que
comparar `'Cita 26 de sept'`.

Se queda en `.ts`: el `include` de `vitest.config.ts` es `src/**/*.test.ts` y
renombrar a `.tsx` saca el archivo de la suite **en silencio**.

Relacionado: [[probar-render-sin-dom]], [[render-appshell-aislado]].
