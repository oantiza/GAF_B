# Escrituras sueltas en la nube

Lo que se ha escrito en producción fuera de una subida normal del catálogo, con la orden de Óscar. Una subida normal no deja
rastro, así que esto es lo único que dirá dentro de un año qué se tocó a mano, cuándo y por qué.

## 5 de noviembre de 2026: cinco bajas falsas

**Qué pasaba.** Un re-mapeo sin red del 04-11 leyó el «no lo tengo» de un proveedor como una baja, y esa pasada se subió a las 18:20
de ese día. Cinco instrumentos con precio de mercado del 2 de noviembre salían en la web como «Dejó de cotizar», no se podían
añadir a una cartera y, según el código, tampoco entraban en una simulación. Lo vio Óscar en la ficha de DIGI Spain. El fallo del
extractor ya estaba corregido en local (`1-extractor` 87cd6b2).

**Qué se escribió.** Solo `availability` en la raíz de cada uno, con `subirALaNube.ts --deshaz-bajas`, que no toca nada que en la
nube no conste como baja, y que nunca escribe una baja (`2-plataforma-datos` 0d16ccc). Óscar vio la tabla antes y dijo «Sí, escríbelos».

| Instrumento | ISIN | Antes | Después |
|---|---|---|---|
| Árima Real Estate | ES0105376059 | DELISTED desde 2026-11-04 | UNDETERMINED, 2026-11-05 |
| DIGI Spain Telecom | ES0106043005 | DELISTED desde 2026-11-04 | UNDETERMINED, 2026-11-05 |
| Desarrollos Especiales de Sistemas de Anclaje | ES0126251018 | DELISTED desde 2026-11-04 | UNDETERMINED, 2026-11-05 |
| Promotora de Informaciones (Prisa) | ES01717430J3 | DELISTED desde 2026-11-04 | UNDETERMINED, 2026-11-05 |
| iShares Energy Storage & Hydrogen | IE000DR59CI3 | DELISTED desde 2026-11-02 | TRADING, comprobado 2026-11-02 |

**Por qué «Sin medir» en cuatro.** No se pudo consultar al proveedor desde la sesión que lo escribió, y un precio del 2 de noviembre
no prueba que sigan cotizando hoy. Pasan a «Cotizando» con la pasada con red prevista antes de publicar, si el proveedor lo confirma.

**Comprobado.** Leído de la nube antes y después: en los cinco solo cambió `availability`, y su precio y el resto de los campos siguen
igual. Quedan 4 bajas, las reales: ES0125140A14, ES0143416115, ES0158300410 y ES0161560018. Óscar confirma que el ETF cotiza. Las
carteras, las retrocesiones, el resto del catálogo, el sitio y las Functions no se tocaron.

**Lo que esto no arregla.** Ninguno de los cinco tiene `price_series` en la base nueva, ni en la nube ni en local, así que siguen fuera
de las simulaciones, ahora por ese motivo. Se pueden añadir a una cartera, pero no se miden. Prisa, Desa y Árima tienen serie en el
extractor, leída de Yahoo, que `core/export_series.py` no exporta porque Yahoo no pasa por la caché HTTP. El ETF no tiene
`historial_precios` en su ficha. DIGI no tiene serie en ningún sitio. La base vieja local sí trae series de EODHD para cuatro de ellos
(`PRS.MC`, `DESA.MC`, `ARM.MC`, `STOR.AS`), hasta finales de octubre de 2026, así que el proveedor los cubre.
