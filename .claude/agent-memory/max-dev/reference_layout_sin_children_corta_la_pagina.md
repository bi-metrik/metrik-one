---
name: layout-sin-children-corta-la-pagina
description: Un layout de App Router que no renderiza {children} hace que la página NI SE EJECUTE, así que su redirect() no se dispara; medido con next dev y su control
metadata:
  type: reference
---

**Un layout que devuelve JSX sin `{children}` impide que la página se ejecute.** El
`children` de un layout es un elemento que React solo renderiza si el layout lo incluye en
su salida; si no lo incluye, el cuerpo del server component de la página **nunca corre**, y
por tanto su `redirect()` no se dispara.

**Por qué importa en ONE:** casi todas las páginas de `(app)` empiezan con
`if (error || !workspaceId) redirect('/login')`. Cualquier gate que el layout quiera pintar
(pestaña desincronizada, suscripción, sin espacio) competiría con ese redirect si la página
se ejecutara: un `redirect()` lanzado durante el render gana sobre el JSX del layout.

**Medido el 2026-09-18** con `next dev -p 3117` sobre una ruta desechable
(`src/app/qa-desync/` con un layout y una página que solo hace `redirect()`):

| Layout | Resultado |
|---|---|
| `return <div>PANTALLA</div>` (sin children) | **HTTP 200** con la pantalla del layout |
| `return <div>PANTALLA{children}</div>` | **HTTP 307** al destino del `redirect()` |

El segundo caso es el **control**: sin él, el 200 no probaría nada (podría ser que el
redirect nunca funcionara). Los dos archivos se borran al terminar.

**How to apply:** un gate de layout que tenga que GANARLE a las páginas se implementa
devolviendo la pantalla **en lugar de** `{children}`, no con un `redirect()` del propio
layout (dos redirects lanzados en el mismo render compiten) ni confiando en que la página
"se porte bien". Y si el gate necesita que la página SÍ corra, hay que asumir que su
redirect manda.

⚠️ El experimento deja basura en `.next/dev/types/validator.ts`: tras borrar la ruta,
`npx tsc --noEmit` sigue reclamando el módulo hasta que se borra `.next/dev/types`.

Relacionado: [[pestana-desincronizada]], [[qa-pantalla-viva-cdp]].
