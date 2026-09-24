---
name: casilla26-testigo-casilla5
description: PR #918 (2026-09-24) — la casilla 5 del RUT es TESTIGO de la 26 en el voto; dígitos de más ya no son «el mismo número»; migración 20260925050000 SIN aplicar (no mergear antes)
metadata:
  type: project
---

V0326 (520238523/52023852), V0354 y V0361 salían en «acuerdo» porque `mismoValor` usaba
`mismoDocumento`, que acepta que un número empiece por el otro. #918: en el voto, dígitos
de más solo cuentan como el mismo número si lo que sobra es el DV (módulo 11).

**Why:** Mauricio pidió «es mejor la seguridad»: marcar dudoso, nunca corregir en silencio
(el único arreglo automático sigue siendo el «13» del #908).

**How to apply:**
- `FuenteVoto.testigo` (casilla 5): vota solo si su número es igual a otra fuente o la
  contiene con 1-2 dígitos de más, y entonces gana un empate de DOS grupos. Número del
  todo distinto → estado `distinta` + `ResultadoVoto.avisos` (ámbar, no frena, no niega).
  V0012 dejó de negar DIAN por esto (antes lo negaba con #896).
- La guarda `guarda-prefijo-formulario` también niega si 26 y 5 difieren por 1-2 dígitos
  (incluido el DV pegado en la 26), sin mirar tipo de documento.
- Efecto lateral medido: la factura de V0232 (101913942161) pasa a dudosa (no frena).
- Simulación reutilizable: script tsx `.mts` (ESM, top-level await) que importa los módulos
  del worktree por ruta absoluta; para comparar con producción, `git show origin/main:<f>`
  a un archivo temporal dentro de `src/` y borrarlo después.

Relacionado: [[voto-entre-fuentes]], [[rut-prefijo-tipo-documento]].
