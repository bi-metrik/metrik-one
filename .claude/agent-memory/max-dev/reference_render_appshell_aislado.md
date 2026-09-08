---
name: render-appshell-aislado
description: El AppShell (y los client components de (app)) SÍ se renderizan en vitest con renderToStaticMarkup; solo piden usePathname y useRouter, no Supabase
metadata:
  type: reference
---

`src/app/(app)/app-shell.tsx` —el sidebar entero, con FAB, barras de admin y los diez
grupos del nav— **se renderiza en aislamiento** con `renderToStaticMarkup` en el entorno
`node` de vitest. No hace falta DOM ni un mock de media pantalla.

Lo único que pide es **un mock de `next/navigation` con dos hooks**:

```ts
vi.mock('next/navigation', () => ({
  usePathname: () => '/negocios',
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
}))
```

- `usePathname` lo usa el propio shell para marcar el item activo.
- `useRouter` **lo pide el FAB**, que cuelga del shell. Si se omite, el render llega hasta
  `fab.tsx` y revienta ahí — el error apunta al FAB, no al shell, y se lee como si el
  componente no fuera renderizable.
- **Supabase NO se dobla:** `createClient()` solo se invoca dentro de `handleSignOut`,
  nunca al pintar. Doblarlo es ruido.

⚠️ **`children` va como tercer argumento de `React.createElement`, no dentro del objeto de
props**: la regla `react/no-children-prop` de eslint falla el check `Lint de lo que cambia`.

**How to apply:** cuando el encargo pida fijar un hecho de PANTALLA del shell o del nav
(que un item exista, que no traiga contador, que un grupo se oculte por rol o por módulo),
la prueba de render es viable y barata — no hay que caer al plan B de "probar que el layout
ya no llama al RPC". Precedentes del mismo patrón en el repo:
`conciliacion/tarjeta-retenido-render.test.ts` y
`negocios/[id]/recaudo-cambiado-banner.test.ts`.

⚠️ Una prueba que solo afirma **ausencias** ("no pinta el badge") pasa verde con la pantalla
rota. Va siempre acompañada de un caso **guard** que afirma que el elemento existe: sin él,
apagar el módulo deja las demás pruebas pasando vacías. Y la mutación se corre igual —
reintroducir a mano el JSX borrado y ver caer las pruebas, ver [[pruebas-por-mutacion]].
