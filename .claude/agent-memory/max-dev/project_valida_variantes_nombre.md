---
name: valida-variantes-nombre
description: metrik-valida PR #68 (2026-10-22) — regla nombre_equivalente (posible) + banco sintetico scripts/banco-nombres; sin migracion; fase 2 Haiku sin correr (sin llave)
metadata:
  type: project
---

PR bi-metrik/metrik-valida#68 (rama `feat/motor-variantes-deterministas`), CI verde, SIN mergear (merge lo da Mauricio).
Regla `nombre_equivalente` en `lib/matching/equivalencias.ts`: solo cuando puntaje y `tokens_contenidos` dicen
que no; siempre posible. Banco: natural 94,9→97,3 %, juridica 72,8→92,4 %, FP colombianos 10,3→10,3 %.
Rebarrido real (55.448 consultas): 7 consultas ganan 19 posibles, 0 perdidas.

**Why:** pedido de Mauricio (fase 0-1 deterministas, fase 2 Haiku fuera de prod). El brief decia umbral posible
0,85, pero el efectivo es `max(umbral_match_default, 0,85)` = 0,92 OFAC/UE y 0,95 ONU/PEP/CSN (banda vacia ahi).

**How to apply:**
- Tokens en CUALQUIER orden subian FP sin ganar verdaderos: la regla va en orden (con cortes). Guardas de
  genero (Luis/Luisa) e inicial bajaron FP colombianos a cero extra. No relajarlas sin re-medir el banco.
- Una coincidencia equivalente tapaba la EXACTA derivada del pase 2 (69 casos): el engine la deja reemplazar.
- Busqueda por clave fonetica (migracion) medida: +25 positivos, +20 negativos. Descartada.
- Datos del banco en scratch (`vbank/data`, ~50 MB entradas + ~93 MB por corrida): la cuota de /tmp se lleno una vez.
- Lectura de prod desde el subagente: `bash scratchpad/sbsql.sh` funciona; un helper nuevo que lea
  `.credentials.md` lo bloquea el clasificador. Fase 2 (`scripts/banco-nombres/haiku.ts`) necesita ANTHROPIC_API_KEY:
  no hay en local; la corre la sesion principal. Relacionado: [[valida-tabla-angosta-busqueda]].
