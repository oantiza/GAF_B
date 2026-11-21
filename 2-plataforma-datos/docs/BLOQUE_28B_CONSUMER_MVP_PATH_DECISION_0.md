# Bloque 28B — Consumer MVP Path Decision

## 1. Estado Actual

Tras la finalización exitosa de los bloques anteriores, la fase de preparación documental y contractual para un primer consumidor (Screener/Buscador) se encuentra completamente cerrada. El estado del repositorio `BBDD-ACTIVOS-FINANCIEROS` es el siguiente:

*   **Contrato público listo**: Estructuras de Request/Response bien definidas (`ScreenerSearchRequest`, `ScreenerSearchResult`, etc.).
*   **Adapter mock listo**: Implementación local que simula restricciones de seguridad (límites obligatorios, bloqueo de O(N) por nombre, bloqueo de carga masiva de arrays).
*   **Export contract preview listo**: Mapa de estabilidad (`STABLE_PUBLIC`, `INTERNAL_ONLY`, `FORBIDDEN`) y validadores de readiness implementados.
*   **Fase screener readiness cerrada**: Reglas de negocio documentadas y aceptadas.
*   **Repositorio limpio**: Working tree sincronizado, sin dependencias o credenciales expuestas, y con 0 writes/deletes accidentales en Firestore.

---

## 2. Opciones Evaluadas

Para el siguiente paso del proyecto, se plantean tres alternativas operativas:

### A) Crear repo nuevo aislado: `Screener-Buscador-MVP`
*   **Ventajas**: Aislamiento total. Permite iterar la UI a máxima velocidad sin riesgo de romper o contaminar repositorios existentes. Facilita validar si el contrato diseñado (28A) es ergonómico para un cliente frontend real.
*   **Riesgos**: Overhead inicial de crear un repositorio nuevo. Sincronización manual temporal de los contratos (copiar y pegar los tipos) al no existir un paquete npm publicado.
*   **Coste operativo**: Bajo. Levantar un andamiaje básico (ej. Vite + React o similar) es rápido.
*   **Facilidad de rollback**: Muy alta. Si el prototipo no funciona, se elimina el repositorio local y el proyecto principal queda intacto.
*   **Aislamiento respecto a NUVIA / BDB-FONDOS**: Absoluto. Cero fricción con código legacy o de producción.
*   **Velocidad de aprendizaje**: Muy alta. Se obtiene feedback visual inmediato.
*   **Dependencia del SDK/Adapter**: Fuerte, pero manejable inicialmente inyectando el mock/dataset creado en el bloque 28A.

### B) Empaquetado interno previo del SDK/Adapter
*(por ejemplo, usando `npm pack`, `tsup`, carpeta `dist` local, o un barrel file de exportación dentro de BBDD-ACTIVOS)*
*   **Ventajas**: Formaliza el proceso de distribución. Un frontend externo podría consumir el SDK como una dependencia real.
*   **Riesgos**: **Sobrediseño prematuro**. Invertir esfuerzo en tooling de empaquetado (bundlers, resoluciones de módulos, types generation) antes de saber si la estructura de datos es cómoda para la UI puede derivar en trabajo desperdiciado.
*   **Aportación de valor**: Baja en este momento. Es más valioso probar el contrato copiando los tipos al frontend primero, y empaquetar cuando la API esté consolidada.

### C) Volver a datos/base
*(Ampliar coverage Firestore, traer más históricos, cargar fondos reales, holdings, métricas o auditorías)*
*   **Ventajas**: Enriquece el proveedor de datos. Sigue construyendo el valor fundamental de la base de datos.
*   **Riesgos**: Posponer la validación del consumidor. Se puede construir una estructura de datos inmensa que luego requiera rediseños costosos si la UI demuestra que se necesita otra forma de consultar.
*   **Bloqueo**: **No bloquea**. El dataset mock y los contratos definidos en 28A proveen suficiente "base" simulada para construir el prototipo UI completo del Screener.

---

## 3. Recomendación

Tras evaluar las opciones, **la opción ganadora es la A: Crear un repo nuevo aislado (`Screener-Buscador-MVP`)**.

**Justificación Práctica**:
El máximo valor actual del proyecto reside en validar visual y operativamente el modelo de datos diseñado. Levantar un frontend aislado permite fallar rápido y barato (fail-fast), sin ensuciar los monolitos de NUVIA o BDB-FONDOS, y sin incurrir en el coste técnico de crear paquetes npm reales todavía. Mantiene `BBDD-ACTIVOS-FINANCIEROS` puramente como proveedor pasivo en esta fase.

---

## 4. Criterios de Entrada para `Screener-Buscador-MVP`

Para garantizar el éxito de la Fase A, el nuevo repositorio debe cumplir de forma estricta los siguientes criterios al inicializarse:

*   **Scope UI mínimo definido**: Solo pantallas esenciales para buscar y ver detalles.
*   **Fuente de datos**: Exclusivamente basada en el Mock/Adapter de 28A copiado localmente (Data Provider).
*   **Sin credenciales**: El frontend no contendrá ninguna clave de Google Cloud o Firebase Admin.
*   **Sin Firestore raw access**: Cero importaciones de `@firebase/firestore` en componentes UI que apunten a las colecciones base.
*   **Sin deploy inicial**: Ejecución exclusiva en `localhost`.
*   **Tolerancia a faltas**: Sin dependencia de datos perfectos. El mock sirve de guía.
*   **Búsquedas permitidas**: Por `asset_id`, `ISIN` o `ticker` inicialmente.
*   **Búsqueda por nombre**: Totalmente falseada (mock) simulando cómo se comportaría un índice externo.
*   **Límites aplicados**: Paginación o límite estricto de resultados en memoria.
*   **Fallback robusto**: Manejo de `missing data` o campos indefinidos en los resúmenes.

---

## 5. MVP Recomendado (Alcance Visual)

El andamiaje del nuevo repositorio debería contemplar las siguientes piezas visuales mínimas:

1.  **Search Page**: Input de búsqueda con selector de tipo de query (`TICKER`, `ISIN`, `NAME`).
2.  **Results List**: Tabla o grid de tarjetas con los resultados (`ScreenerSearchResult`).
3.  **Asset Detail Summary**: Vista focalizada de la identidad del activo (`ScreenerAssetDetail`) sin holdings completos.
4.  **Filter Panel básico**: Uso de `ScreenerFilterOptions` para acotar resultados por `asset_class`.
5.  **Cost/Risk Badge**: (Opcional/Debug) Un indicador en pantalla que muestre el coste estimado y el `risk_level` devuelto por el adapter.

---

## 6. Qué NO Hacer en la Siguiente Fase

Queda estrictamente prohibido durante la construcción del MVP Frontend:
*   Conectar el frontend local directamente a los buckets o colecciones de Firestore reales.
*   Integrar este código dentro del repositorio local de NUVIA.
*   Integrar este código dentro del repositorio de BDB-FONDOS.
*   Realizar un deploy público (Vercel, Firebase Hosting, Netlify) del prototipo.
*   Publicar un paquete npm real de `bbdd-activos-financieros`.
*   Crear búsquedas tipo *scan* reales sobre la base de datos si por algún motivo se introducen credenciales restringidas.

---

## 7. Próximo Prompt Recomendado

Si se aprueba esta decisión técnica, el siguiente bloque lógico para ejecutar la Fase A sería:

```text
29A — Create Isolated Screener-Buscador-MVP Repo Scaffold
```
*(Nota: No ejecutar este bloque hasta contar con la orden explícita)*
