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

⚠️⚠️ **`children` enfrenta a eslint contra tsc, y las dos salidas obvias fallan.**
`AppShellProps` **exige** `children`, pero escribirlo dentro del literal de
`React.createElement` dispara `react/no-children-prop`. Sacarlo a tercer argumento calla a
eslint y **rompe `tsc`** (`TS2769: Property 'children' is missing`). La salida es poner las
props en **una constante** y pasar esa constante:

```ts
const props = { fullName: '…', role: 'owner', modules: { … }, children: null }
const pintar = () => renderToStaticMarkup(React.createElement(AppShell, props))
```

⚠️ **El archivo tiene que seguir siendo `.ts`.** Renombrarlo a `.tsx` para escribir JSX
resuelve el conflicto, pero el `include` de `vitest.config.ts` es `src/**/*.test.ts`: el
archivo **sale de la suite en silencio** y el verde deja de significar nada.

**How to apply:** cuando el encargo pida fijar un hecho de PANTALLA del shell o del nav
(que un item exista, que no traiga contador, que un grupo se oculte por rol o por módulo),
la prueba de render es viable y barata — no hay que caer al plan B de "probar que el layout
ya no llama al RPC". Precedentes del mismo patrón en el repo:
`conciliacion/tarjeta-retenido-render.test.ts` y
`negocios/[id]/recaudo-cambiado-banner.test.ts`.

⚠️ **Los checks se corren DESPUÉS del último cambio, no antes.** En el PR #585 se corrió
`tsc` (verde), luego `eslint` (rojo), luego se editó el archivo para callar a eslint — y
nunca se volvió a correr `tsc`. El rojo salió en CI, no en local. Un check verde solo
certifica el árbol que existía cuando corrió; cualquier edición posterior lo caduca.

⚠️ Una prueba que solo afirma **ausencias** ("no pinta el badge") pasa verde con la pantalla
rota. Va siempre acompañada de un caso **guard** que afirma que el elemento existe: sin él,
apagar el módulo deja las demás pruebas pasando vacías. Y la mutación se corre igual —
reintroducir a mano el JSX borrado y ver caer las pruebas, ver [[pruebas-por-mutacion]].

## ⚠️ Un client component que importa un VALOR de un `'use server'` hay que doblarlo

Medido el 2026-09-10 rindiendo `numeros/numeros-v2-client.tsx` (PR #619). Lo que decide si
el render es viable **no es qué componente es, sino qué tipo de import hace**:

- `import type { X } from './actions'` → **se borra al compilar, no hace falta nada**. Por
  eso `numeros/drill-down-sheet.tsx` se renderiza sin un solo mock, aunque su tipo viva en
  un archivo `'use server'`.
- `import { getNumeros } from './actions'` (un **valor**) → al importar el componente se
  evalúa el módulo entero, y con él `get-workspace`, `createServiceClient` y la cadena de
  Supabase. Se dobla el módulo completo, no la función:

```ts
vi.mock('./actions-v2', () => ({
  getNumeros: async () => null,
  actualizarSaldo: async () => ({ success: true }),
}))
const { default: Cliente } = await import('./numeros-v2-client')
```

El `await import` **después** del `vi.mock` es obligatorio: un `import` estático arriba se
iza por encima del mock. En ese archivo el doble nunca llega a ejecutarse —el cliente solo
llama a `getNumeros` al navegar de mes— pero sin él el import ni arranca.

⚠️ Esa pantalla pide **`useSearchParams` además de `useRouter`** (el `useEffect` que lee
`?saldo=1`). Devolver `new URLSearchParams()` alcanza.

⚠️ Para fijar copy que vive en ramas condicionales, el fixture se diseña para **encender
todas** las ramas, y lo que no cabe en uno solo va en renders aparte (`regimenFiscal` es un
enum: `null` y `'simple'` son dos llamadas). Y conviene una **lista negra** de las formas
malas afirmada sobre CADA render: atrapa la regresión escrita en una rama que ese día no se
estaba pintando, que es justo lo que una prueba de casos positivos no ve.
