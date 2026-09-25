---
name: cardumen-filtro-blindaje
description: PR #924 (2026-09-24) filtro de riesgo/FT/INJ antes del lector de Navigate, esquema estricto, R1/R2 detras de bandera; SIN mergear hasta repetir el benchmark
metadata:
  type: project
---

PR #924 (`fix/cardumen-navigate-blindaje`) — SIN mergear a proposito: Mauricio pidio repetir el
benchmark del lector (golden v0, Yuto) contra la rama antes. Sin migraciones. Mergear no despliega
`wa-webhook` (despliegue manual, lo hace la sesion principal).

**Why:** el benchmark del 24-sep mostro que el lector 3.1 ubicaba el mensaje de crisis G28 y que
no habia red en codigo; Mauricio pidio blindar el tema ("que no nos pase como el bot de ventas que
se pone a programar").

**How to apply:**
- El filtro vive en `navigate/filtro.ts` y corre en `procesar` ANTES de meta y del lector; ademas
  `interpreteConModelo` lo aplica dentro de cada lectura (memo por texto), para que el benchmark,
  que llama `it.diada` directo, tambien pase por el. Cada lectura cuesta una llamada mas.
- Falla hacia riesgo: clasificador que lanza o sale del esquema = SEN `fuente:"error"` = texto de
  contencion. Si Gemini se cae, la gente recibe contencion en vez de "repitame": es lo pedido.
- Banco de textos PENDIENTE de Saga y Emilio; `CONTACTO_HUMANO_NAVIGATE = null` omite la linea.
- R1/R2 exige `spec.entrevistador_libre`; araucania-turismo y trappvel-equipo van por lista en
  `entrevistador-libre.ts` hasta que su spec lleve la bandera (eso es migracion de datos).
- El clasificador de auto mode BLOQUEA mutar el filtro para probarlo ("Security Weaken"), incluso
  temporal. Las mutaciones de G15/G19 si pasaron. Ver [[pruebas-por-mutacion]].
