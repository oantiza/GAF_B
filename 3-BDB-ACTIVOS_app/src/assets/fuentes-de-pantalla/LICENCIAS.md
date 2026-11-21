# Las letras de pantalla

Dos familias, IBM Plex y Source Serif 4, las dos con licencia **SIL Open Font License 1.1** (uso, copia y
redistribución libres, también comercial, sin vender la letra por separado). Son ficheros que publica Fontsource,
copiados aquí para no añadir dependencias.

| Fichero | Familia | Paquete | Autores |
|---|---|---|---|
| `ibm-plex-sans.woff2` | IBM Plex Sans (variable, eje de peso), subconjunto latino | `@fontsource-variable/ibm-plex-sans` 5.3.0 | IBM Corp. · https://github.com/IBM/plex |
| `ibm-plex-mono.woff2` | IBM Plex Mono 400 (no hay versión variable), subconjunto latino | `@fontsource/ibm-plex-mono` 5.3.0 | IBM Corp. · https://github.com/IBM/plex |
| `ibm-plex-mono-medio.woff2` | IBM Plex Mono 500, subconjunto latino | `@fontsource/ibm-plex-mono` 5.3.0 | IBM Corp. · https://github.com/IBM/plex |
| `source-serif-seminegrita.woff2` | Source Serif 4 600, subconjunto latino (`source-serif-4-latin-600-normal.woff2`) | `@fontsource/source-serif-4` 5.3.1 | Adobe · https://github.com/adobe-fonts/source-serif |
| `source-serif-seminegrita-extendida.woff2` | Source Serif 4 600, subconjunto latino extendido (`source-serif-4-latin-ext-600-normal.woff2`) | `@fontsource/source-serif-4` 5.3.1 | Adobe · https://github.com/adobe-fonts/source-serif |

IBM Plex es la letra de la aplicación de BDB. Entró el 17-11-2026 primero en las tablas de activos y, el mismo día, en
toda la pantalla, por decisión de Óscar; salieron Inter, Manrope y JetBrains Mono, que fueron la letra del 15 al
17-11-2026.

Source Serif 4 entra con la dirección A («Banca privada, puesta al día», 18-11-2026), solo en seminegrita (600) y solo
para el título de pantalla y las cifras de un indicador: el resto sigue en IBM Plex. Los nombres de fichero no llevan
el «4» de la familia porque la puerta de `tests/firebaseHostingSecurity.test.ts` admite solo `[a-z-]+.woff2`.

El texto de la licencia: https://openfontlicense.org
