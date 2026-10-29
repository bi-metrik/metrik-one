---
name: bloqueo-prueba-real-1029
description: 4 defectos de la prueba real del bloqueo Trappvel tras #1324 (INF, barra «Todo listo», edad del niño, PDF sin marca); PDF recibe porPasos del llamador
metadata:
  type: project
---

Arreglo de los 4 defectos de la prueba real del bloqueo de Trappvel (2026-10-29), sin migración.

- La marca de borrador del PDF ahora sigue a «Enviar»: autorización de datos, paquete incompleto y P12 (`frenos-de-paquete-y-pasajero.ts`, compartido con `enviarPorPasos`). La autorización faltaba en el PDF desde #1257 (2026-10-25); el defecto es heredado, no del #1324.
- **Why:** el criterio N4 (`por-pasos-lectura-guard.test.ts`) prohíbe que el PDF importe el interruptor por pasos. Por eso P12 entra solo si el llamador pasa `generateCotizacionPDF(id, { porPasos })`: el editor y la ruta vista-previa lo hacen. La opción solo AGREGA la marca.
- La edad del niño se precarga en la tarjeta del paquete desde `edades_menores` (texto libre: «8 años», «7, 1.5»; bajo 2 años = infante si hay infantes). Entra a la cuenta solo con niños en el paquete. El freno del servidor lee el paquete GUARDADO, así que «Falta la edad» sigue frenando hasta que la asesora pulse Guardar.
- El doble `test/cotizacion-pdf-doble.ts` reconoce el embed `lineas_negocio(config_extra, etapas_negocio(...))` del PDF.

**How to apply:** si se agrega un freno nuevo a «Enviar», sumarlo también a `motivosDeBorrador` y al PDF, y a `primerImpide` de la barra, que ya lo toma de la lista única.
