---
name: modulo-valida-api-c2
description: PR #747 (C2, módulo /valida-api) mergeado; 4d-soft ya existe (medido 2026-09-16); por qué el módulo exige la llave valida_api además del cliente, por qué la Política es 1.4; los huecos del riesgo 11 los cierra el #752
metadata:
  type: project
---

Entrega **C2** de `proyectos/metrik/one/2026-09-15_spec-modulos-servicios-cobro.md` (§5.2-§5.4),
abierta el 2026-09-16 como **PR #747**, rama `feat/modulo-valida-api-c2`. ⚠️ CADUCÓ el «sin
mergear»: el 2026-09-16 ya estaba en `main` (`2181fb91`), con la migración todavía sin aplicar. Sin suscripción (C4) y sin tocar el portal v1 (C3).

**Estado que no se ve en el código:**
- `20260916180000_modulo_valida_api.sql` **SIN aplicar** (DDL puro). Sin ella el módulo no pasa
  de la pantalla de la Política (la tabla de aceptaciones no existe) y Documentos/Pagos dicen
  «no disponible». Mergear antes es inocuo: nadie tiene el módulo todavía.
- ⚠️ CADUCÓ (medido 2026-09-16 por PostgREST): `4d-soft` existe con `modules.valida_api`, fila en
  `workspace_modulos`, `servicios_contratados` y la versión v1.0 de términos. Lo que decía:
  **El workspace `4d-soft` no existe.** Faltan, como datos de producción: el workspace, su fila
  `workspace_modulos` (`valida_api`, origen `servicio`), `modules.valida_api=true`,
  `config_extra.valida_cliente_id='8c211c68-6c25-4beb-b364-c91c284d6379'`, sus usuarios, su
  `servicios_contratados` (+ beneficiario) y una fila de `documentos_contractuales_versiones`
  con el PDF de términos v1.0 (huella `85e6d157…5ccd`, el PDF está en
  `proyectos/4d-soft/valida/docs/entrega/`). Sin contrato, Documentos y Pagos salen vacíos.
- `cargarReciboManual` **no tiene botón**: metrik no tiene `modules.conciliacion` y `BloqueCobros`
  es compartido (un botón manual ahí deja a SOENA saltarse el consecutivo de Siigo).

**Why:** dos premisas de la spec que la medición cambió.
1. **7 workspaces ya traen `config_extra.valida_cliente_id`** (afi, alma-afi, metrik, maxitec,
   3 CDA), todos de integración. Con solo el cliente, su owner alcanzaría las acciones de llaves.
   `clienteOperable` exige además `modules.valida_api === true`.
2. **La Política publicada en Valida es la 1.4**, no la 1.5 que cita la spec (es parte de B5).
   Se guarda la huella del TEXTO del aviso, porque la Política es una página y su PDF se genera
   al vuelo: no hay archivo estable que hashear.

**How to apply:**
- Correr la migración en PGlite destapó **dos defectos que la lectura no mostraba**: un boolean
  `a = b` sale NULL cuando `a` es NULL (usar `coalesce(..., false)` también en columnas de
  salida, no solo en CHECK), y un join contra un CTE sin `distinct` duplica filas.
- ⚠️ **`check:migraciones` confía en la marca** (`-- ejecutable-por-cliente:`, `-- server-only:`)
  y no verifica que el `revoke` exista: quitarlo pasa la guarda. Lo atrapa PGlite con los
  default privileges de producción encendidos.
- Las RPC `mis_*` se llaman con el cliente de SESIÓN (`getWorkspace().supabase`): con el de
  servicio `current_user_workspace_id()` no tiene de dónde leer y devuelven nada.
- **Riesgo 11:** ⚠️ CADUCÓ el «sin corregir»: los cuatro los cierra el **PR #752**
  ([[huecos-tenant-riesgo11]]), que además deja reportados otros abiertos. Lo que se había visto:
  las rutas `/api/afi/generar` y
  `/api/afi/contrato` validan que el negocio sea de AFI pero no que la sesión lo sea;
  `crearV1Automatica` (`'use server'`, sin sesión) reescribe `negocio_bloques.data` de cualquier
  bloque (951 propuestas aprobadas); `guardarDatosSarlaft`/`recalcularScoreNegocio` hacen UPSERT
  `onConflict: negocio_id` sin comprobar pertenencia (latente: 0 filas). No existe `exigirModulo`.

Relacionado: [[one-api-directa-c1]], [[catalogo-servicios-a2]], [[modulos-gate-ruta-a1]],
[[pglite-version-de-ci]], [[pruebas-por-mutacion]].
