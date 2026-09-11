---
name: probar-route-handler-vitest
description: Cómo probar un route handler de Next (app router) con vitest — el doble de Supabase tiene que APLICAR los `.eq()`, un route.ts no puede exportar helpers, y un .test.ts dentro de src/app/**/[param]/ sí lo recoge el glob
metadata:
  type: reference
---

Medido el 2026-09-11 en el PR #631 (`src/app/api/compliance/listas/soporte/[consulta_id]/route.test.ts`,
12 casos). Antes de esto no había en el repo **ni una** prueba de route handler: el patrón entero
estaba por inventar.

## Los cuatro puntos que cuestan un intento cada uno

**1. ⚠️⚠️ Un `route.ts` de Next NO puede exportar nada más que sus métodos HTTP y la config de
segmento** (`dynamic`, `maxDuration`, `revalidate`, `runtime`…). Un helper exportado ahí lo rechaza
la validación de tipos que Next genera en `.next/types` («is not a valid Route export field»), y eso
**solo se ve en `next build`**, no en un `tsc --noEmit` con tipos viejos. Consecuencia práctica: toda
lógica pura que se quiera probar aparte **va a un módulo hermano** (`src/lib/<area>/<x>.ts`), no al
route. El route se prueba entero, por su `Response`.

**2. ⚠️⚠️ El doble del query builder de Supabase tiene que RECORDAR y APLICAR los `.eq()`.** Con un
doble que ignora los filtros y devuelve siempre la fila, el caso «una consulta de otro workspace
devuelve 404» **pasa siempre**: el filtro de la ruta no tiene contra qué fallar, y la prueba mide
cero. La forma que sirve:

```ts
function constructor(tabla: string) {
  const filtros: Record<string, unknown> = {}
  const resolver = () => {
    if (tabla === 'consultas_listas_dual') {
      const coincide = filtros.id === FILA.id && filtros.workspace_id === FILA.workspace_id
      return { data: coincide ? FILA : null }
    }
    …
    throw new Error(`tabla inesperada en el doble: ${tabla}`)   // <- delata un select nuevo
  }
  const q = {
    select: () => q,
    eq: (columna: string, valor: unknown) => { filtros[columna] = valor; return q },
    single: async () => resolver(),
    maybeSingle: async () => resolver(),
  }
  return q
}
```

El `throw` del default no es adorno: si alguien agrega un `from('otra_tabla')` a la ruta, la prueba
falla con el nombre de la tabla en vez de devolver `undefined` y romper diez líneas más abajo.

**3. Invocar el handler sin importar `next/server`.** `NextRequest` se usa solo en posición de tipo,
así que esbuild lo elimina y la prueba no arrastra el runtime de Next. Un `Request` normal alcanza si
la ruta lee la query con `new URL(req.url).searchParams` (preferir eso a `req.nextUrl`, justo por
esto). El cast sin nombrar el tipo:

```ts
GET(req as unknown as Parameters<typeof GET>[0], { params: Promise.resolve({ consulta_id: id }) })
```

⚠️ `params` es una **Promise** en el App Router actual; pasarlo plano compila y falla en ejecución.

**4. Un `.test.ts` dentro de `src/app/api/<...>/[param]/` SÍ lo recoge el glob `src/**/*.test.ts`**
pese a los corchetes del directorio, y **`next build` lo acepta** (solo `route.ts`/`page.tsx` son
nombres reservados; el resto es un módulo colocado más). Verificado con el build completo, no
deducido. Aun así conviene correr `npx next build` cuando se agrega el primer archivo a una carpeta
de `src/app/`: es el único que ejercita la validación de exports del punto 1.

## Estado que ajusta cada caso

`vi.mock` se iza, así que **la fábrica no puede capturar constantes del cuerpo del archivo**. El
patrón: un objeto `escenario` mutable declarado arriba, que los mocks leen y cada `it` ajusta, con un
`beforeEach` que lo devuelve al default. Los mocks que hicieron falta: `@/lib/supabase/auth-user`
(`getCachedUser` → `{ user: { id } }`), `@/lib/supabase/server` (`createServiceClient`) y el
generador del PDF (evita arrastrar `@react-pdf/renderer`: aquí no se prueba el documento, se prueba
quién puede pedirlo y con qué cabecera sale).

## Qué mutaciones valen la pena en un gate por rol

Quitar el rol que se acaba de agregar tumba media suite y **no prueba nada interesante** (es el rol
por defecto de los casos). La que importa es la **inversa**: *agregar* un rol que debe quedar fuera
(`contador`). Sin ese caso, «operator entra» y «entra cualquiera» se ven exactamente igual desde el
archivo de pruebas. Familia de [[pruebas-por-mutacion]].

Relacionado: [[soporte-listas-operator]], [[probar-render-sin-dom]], [[worktree-git-bloqueado]].
