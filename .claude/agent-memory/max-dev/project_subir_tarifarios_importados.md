---
name: subir-tarifarios-importados
description: Script que sube los archivos de los tarifarios importados de Airtable (Trappvel); nombres en disco saneados ≠ origen_ref; lo corre la sesión principal, no Max
metadata:
  type: project
---

`scripts/proveedores/subir-tarifarios-importados.ts` (PR feat/subir-tarifarios-importados, 2026-10-19). SIN correr contra
producción: el brief lo prohíbe a Max incluso en modo prueba; lo corre la sesión principal.

- Los adjuntos bajados de Airtable (`~/datos-clientes/trappvel/proveedores-2026-10-18/adjuntos/`) tienen el nombre
  SANEADO: `( ) , % +` y marcas combinadas de tilde → `_`. 55 de 212 no coinciden literal con `origen_ref`; se compara
  `claveDeNombre` (NFD + no `[A-Za-z0-9 .-]` → `_`, minúsculas). Validado local: 212/212, 0 ambiguos.
- 10 tarifarios pasan de 20 MB decimales (el brief decía 9). Se comprimen con gs; lo que siga grande queda sin archivo.
- `docN` (10) no se suben: pueden ser certificados bancarios (clase `cuentas`, otro permiso).

**Why:** «Extraer con el motor» necesita `ref`; las 214 filas importadas lo tienen null.
**How to apply:** si piden subir los documentos `docN` o partir PDFs grandes, es trabajo nuevo; el script es reutilizable
para cualquier workspace con `origen = 'importacion'`. Ver [[proveedores-ficha]].
