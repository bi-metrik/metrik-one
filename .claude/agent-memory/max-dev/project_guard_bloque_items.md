---
name: guard-bloque-items
description: Guards de bloque_items, del cronograma, del cierre por tipo y de la aprobación. #676-#687 mergeados; la regla de quién aprueba es puedeSerAprobador y metrik no tiene candidatos
metadata:
  type: project
---

**#676** (squash `28705dc1`): `agregarBloqueItem`, `actualizarBloqueItem` y `eliminarBloqueItem` pasan por
`guardEditarBloque` con el mismo patrón que `marcarBloqueItem`.

**#677** (squash `11b783df`): `reevaluarBloqueCronograma` con guard de editar; `inicializarBloqueItems` con
**`guardVerNegocio`** y la plantilla leída en el servidor.

**#678** (squash `f5b59615`): regla `require_all_dates` desde la config, `leerVersionCronograma` con guard de ver,
revert optimista en `BloqueCronograma`.

**#680** (squash `1107286f`): `src/lib/negocios/cierre-bloque.ts` → `modoCierre` clasifica
`manual | criterio | accion_propia`. El criterio se evalúa sobre lo GUARDADO. Tipo desconocido = manual.

**#683** (squash `53e3a28c`, mergeado): cierra la puerta que esquivaba #680.
- La regla NO se inventó: estaba en la pantalla (`getBloqueMode` 'aprobacion' = owner/admin) y en cerebro
  `bloques-permisos-por-rol.md`. Ahora vive en `src/lib/negocios/aprobacion-bloque.ts`.
- Decide solo el designado; una vez decidido no se reasigna ni se vuelve a decidir.
- Prod: las 3 `completo` perdieron `aprobador_id` por el reemplazo viejo del `data` (no se tocan).

**#687** (squash `8221eb04`, mergeado 2026-09-14). Las cuatro reglas del ciclo quedaron como gotchas en `CLAUDE.md`:
- `puedeSerAprobador` = owner/admin **y** activo. La usan la lista (`opcionesAprobador`), la designación y la decisión.
- Fuente del rol: `profiles.role` en el workspace, igual en lista y servidor; faltaba el filtro, no había dos orígenes.
- Activo: solo una fila de `staff` de ESTE workspace con `is_active=false` excluye; sin fila = activo (el platform_admin
  en workspace ajeno no tiene fila). Lista vía `perfilesConEstadoEnEquipo`, servidor vía `activoEnEquipo`.
- Designado inválido: opción deshabilitada "(no puede aprobar)" + aviso con motivo; no se borra.
- Prod 2026-09-14: 0 bloques pendientes con designado (ninguno tiene); **metrik 0 candidatos** (0 profiles propios);
  exigir activo no cambia a nadie hoy.

**Why:** una server action exportada es un endpoint. Y una lista que ofrece a quien el servidor no deja decidir crea
un bloque que nadie puede cerrar, sin error visible.

**How to apply:**
- Abiertos sin dueño: las `opciones` de afi y de metrik Cierre no están implementadas; un `rechazado` no tiene salida
  en la pantalla; metrik no tiene a quién designar si abre un negocio nuevo de esa línea.
- Al agregar un tipo de bloque, decidir su `modoCierre`; si no, queda manual en silencio.
- En un optimista, el revert NUNCA es la foto del clic: se devuelve solo lo que tocó ese gesto, con `prev =>`.
- `data.aprobador_id` es profile.id; el `currentUserId` de la UI es el auth user id (coinciden). Distinto de
  `activity_log.autor_id`, que es staff.id.
- `node_modules` del repo principal trae un symlink `node_modules/node_modules` que rompe `next build` en una copia
  (`cp -a`): borrarlo solo en la copia.
- Pruebas: `actualizar-aprobacion-guard.test.ts` (action), `bloque-aprobacion-render.test.ts` (render),
  `marcar-bloque-completo-por-tipo.test.ts` (cierre). Relacionado: [[project_worktree_git_bloqueado]],
  [[feedback_pruebas_por_mutacion]], [[arbol-limpio-por-tarball]].
