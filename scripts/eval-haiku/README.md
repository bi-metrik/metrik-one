# Eval de Claude Haiku 5.5 con casos reales

Mide el cambio de Gemini a `claude-haiku-5-5` (Mauricio, 2026-10-20) con la función real de cada sitio: mismo prompt,
mismo esquema y mismo manejo de errores, con el modelo puesto por `fetchModelo`
(`supabase/functions/_shared/llm-anthropic.ts`). El oráculo es lo que quedó guardado en producción. No llama a
Gemini y no escribe en la base: `entorno.ts` lo bloquea.

## 1. Casos (solo SELECT)

Correr cada bloque de `consultas.sql` por el MCP de Supabase y guardar cada resultado como arreglo JSON en
`casos/<familia>.json`. La carpeta `casos/` está en `.gitignore`: trae datos de clientes y no se commitea.

## 2. Llave

`ANTHROPIC_API_KEY=<llave>` en `.env.local` del worktree (gitignored). Para `documento`, `rut` y `acta` hacen falta
además `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y las credenciales de Drive de la app, solo para leer
archivos: el arnés también lee el `.env.local` del repo principal.

## 3. Correr

```bash
# Prueba en seco: modelo simulado, casos de demostración, sin llave ni gasto
npx tsx --conditions=react-server scripts/eval-haiku/correr.ts --mock --demo

# De verdad: todos los casos de casos/*.json
npx tsx --conditions=react-server scripts/eval-haiku/correr.ts

# Una familia, con tope de casos
npx tsx --conditions=react-server scripts/eval-haiku/correr.ts --familia gastos,intencion_wa --limite 20
```

`--conditions=react-server` hace que `import 'server-only'` resuelva al módulo vacío fuera de Next.

Sale una tabla por familia (casos, aciertos por campo, aciertos en campos corregidos por una persona, JSON válido,
errores, latencia p50/p95 y costo con USD 0,10 / 0,50 por MTok) y la lista de fallos. El detalle con los valores
queda en `resultados/` (gitignored).

## Bot conversacional

El núcleo con herramientas tiene su arnés propio (Deno), que ya pasa por `fetchModelo`:

```bash
LLM_PROVEEDOR=anthropic ANTHROPIC_API_KEY=… deno run -A --node-modules-dir=none \
  supabase/functions/_shared/agente/arnes/correr.ts --salida /tmp/arnes-haiku --conjunto todo
```

Ojo: ese arnés calcula el gasto con los precios de Gemini de su tabla `PRECIOS_312`; para Haiku hay que recalcular
con los tokens que reporta.

## Familias sin casos de la base

- `decidir-destino`: la decisión del modelo no se guarda.
- capturas (`detectar-tipo-captura`, `extraer-ranura`): la imagen llega como data URL y no se guarda. Las de
  Trappvel se miden con el banco de la QA (abajo).

## Trappvel: el banco de la QA punta a punta (2026-11-04)

`trappvel_conversacion` y `trappvel_captura` NO leen `casos/`: leen los 10 viajes ficticios de la QA del 2026-10-29
(`proyectos/trappvel/clarity/qa/2026-10-29_punta-a-punta-10-viajes/viajes/NN-*/`, o la ruta de `TRAPPVEL_QA_DIR`).
Nada de eso se copia al repo. El oráculo sale de cada `clave.md` (`trappvel.ts` lo lee); la vara de Gemini en
«campos llenados» sale de las bitácoras de la misma carpeta.

- `trappvel_conversacion`: el `conversacion.txt` por `leerChatConModelo` + `cargarChatEnBloque` (lo mismo que el
  server action de «Pegar conversación»), con los campos de «Condiciones del viaje» de Trappvel leídos de la config
  viva (solo GET con la llave de servicio). Hoy = 2026-10-29, el día de la QA.
- `trappvel_captura`: cada PNG de la clave. Bloqueo → `leerPantallazoDeBloqueo('detectar')` (si la detección no da
  la casilla, se lee otra vez con la casilla correcta: la detección y la lectura se califican aparte). A medida →
  `detectarTipoDeCaptura` y `leerImagenDeCaptura` con el tipo de la clave.

```bash
npx tsx --conditions=react-server scripts/eval-haiku/correr.ts --familia trappvel_conversacion,trappvel_captura --paralelo 4
```

Los fallos de estas dos familias sí muestran los valores (los casos son ficticios).

En los pantallazos de bloqueo se mide además (2026-11-04): `bandeja_general` (lo que hace la bandeja general de un
viaje en Bloqueo; `EVAL_BANDEJA_COMO_ANTES=1` mide el comportamiento de antes), `compra_antes_de` leída
`EVAL_REPETIR_COMPRA` veces (3 por defecto; vale solo si todas la traen), `directo` e `iconos_sin_identificar`. Lo que
la clave no anota sale del HTML del que se generó cada PNG (`_build/html/<viaje>/<png>.html`).

## Documentos de SOENA (SOE-038)

`soena-documentos.ts` corre `extractFieldsFromDocument` (con las normalizaciones y el reintento de producción) sobre
`casos/soena-documentos.json`: 40 documentos reales de SOENA (14 facturas, 8 RUT, 6 certificados bancarios, 6 conceptos
UPME y 6 comprobantes UPME), sacados con el bloque 3 de `consultas.sql`. Guarda la respuesta cruda del modelo por caso.

```bash
# Haiku 5.5
npx tsx --tsconfig tsconfig.json --conditions=react-server scripts/eval-haiku/soena-documentos.ts --salida haiku
# Gemini, SOLO con la llave de pruebas (archivo aparte; cualquier otra llave de Gemini lanza)
GEMINI_LLAVE_PRUEBAS_ARCHIVO=<archivo> npx tsx --tsconfig tsconfig.json --conditions=react-server \
  scripts/eval-haiku/soena-documentos.ts --proveedor gemini --modelo-gemini gemini-3.8-flash --salida gemini-38
```

- `--descripciones soena-descripciones.json` mide un `descripcion_ai` distinto del de producción (el texto vive en
  `bloque_configs.config_extra`) antes de proponer el cambio.
- El proyecto de la llave de pruebas ya no tiene `gemini-2.5-flash` (404 «no longer available to new users»): se compara
  contra 3.8-flash y 3.5-flash-lite, y contra lo que 2.5 guardó en producción sin corrección humana.
