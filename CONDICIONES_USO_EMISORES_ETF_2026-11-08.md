# Condiciones de uso de las webs de seis emisores de ETF

Fecha de lectura de todas las páginas: **08-11-2026**. Encargo de la directora (sesión `local_cc690180-6bb1-4dd2-bd9a-8cfe0828f919`), decisión 53 de `DECISIONES_DATOS_2026-11-07.md`. Contexto: `INFORME_FUENTES_ETF_2026-11-08.md`, §2.

## Lo esencial (leer antes de la tabla)

- **Las citas son extractos, no el texto íntegro.** Las páginas se leyeron con una herramienta de descarga que devuelve fragmentos de hasta 125 caracteres por cita y resume el resto. Lo que va entre comillas es literal de la página en el momento de la lectura; la traducción es mía. Antes de apoyar cualquier decisión, hay que leer la página viva: estas citas indican **dónde** está cada cláusula, no sustituyen su lectura completa.
- **No hay interpretación jurídica.** Ninguna cláusula se marca como permitida o prohibida. Eso lo decide Óscar.
- **Ningún aviso de inversor ni de cookies se aceptó** para llegar a una página. Una página sí lo exige: Amundi (ver abajo).
- **DWS (Xtrackers) no se pudo leer.** Su página de condiciones redirige de `etf.dws.com` a `etf.deutsche-am.com` y allí solo llega el título, sin cuerpo de texto. No hay cita verificada para DWS.
- **SPDR: el texto leído parece global o estadounidense**, no europeo, aunque la página es la de `es/en_gb`, que el buscador describe como la de Europa. Hay que confirmarlo con Óscar antes de usarlo como referencia para la UE.
- **iShares tiene dos entidades operadoras distintas** en sus propias páginas (ver «Discrepancias»).
- Las URL de §2 del informe (`varnish-api`, `/mapi/`, `/api/pdp/`, `/gpx/graphql`, `/bin/v1/ssmp/…`, `dng-api`) son de datos, no de condiciones: **no se han leído sus propias condiciones**, salvo las que cuelgan del dominio web.

## Tabla resumen

Leyenda: **E** = cláusula encontrada (ver citas) · **N** = no encontrada en las páginas revisadas · **X** = página no accesible.

| Emisor | Página revisada | Automatizado / programático | Redistribución / reutilización | Uso comercial vs. personal | Datos de índices / terceros | Destinatario (particular, profesional, país) | Fecha de versión |
|---|---|---|---|---|---|---|---|
| iShares (BlackRock) | [ishares.com/uk/individual/…/terms-and-conditions](https://www.ishares.com/uk/individual/en/compliance/terms-and-conditions) · [blackrock.com/uk/compliance/terms-and-conditions](https://www.blackrock.com/uk/compliance/terms-and-conditions) | **N** | **E** | **E** | **E** | **E** | 17-10-2016 (la página de iShares) |
| Amundi | [amundietf.fr/fr/professionnels/mentions-legales](https://www.amundietf.fr/fr/professionnels/mentions-legales) | **N** | **E** | **E** | **E** (genérico) | **E** (parcial) | 21-11-2025 |
| Xtrackers (DWS) | [etf.dws.com/en-gb/footer/terms-of-use](https://etf.dws.com/en-gb/footer/terms-of-use) → [etf.deutsche-am.com/en-gb/footer/terms-of-use](https://etf.deutsche-am.com/en-gb/footer/terms-of-use); [etf.deutsche-am.com/es-es/footer/condiciones-de-uso/](https://etf.deutsche-am.com/es-es/footer/condiciones-de-uso/) | **X** | **X** | **X** | **X** | **X** | **X** |
| Vanguard | [vanguard.co.uk/professional/terms-and-conditions](https://www.vanguard.co.uk/professional/terms-and-conditions) · [vanguard.co.uk/uk-fund-directory/terms-and-conditions](https://www.vanguard.co.uk/uk-fund-directory/terms-and-conditions) | **E** | **E** | **E** | **E** (MSCI, S&P, FTSE; STOXX **N**) | **N** (profesional/particular); país **E** | **N** (solo copyright) |
| SPDR (State Street) | [ssga.com/es/en_gb/institutional/etfs/footer/terms-and-conditions](https://www.ssga.com/es/en_gb/institutional/etfs/footer/terms-and-conditions) | **N** | **E** | **E** | **N** (genérico **E**) | **E** (parcial) | **N** |
| Invesco | [invesco.com/uk/en/global-footer/terms-and-conditions.html](https://www.invesco.com/uk/en/global-footer/terms-and-conditions.html) | **N** | **E** | **E** | **N** | **E** | 24-11-2021 |

Notas de la tabla:
- «Automatizado» de Vanguard es **E** por una cláusula sobre «accesos automatizados repetidos» (no menciona scraping, bots ni APIs por nombre). Es la única celda de automatizado con cita.
- SPDR «Datos de índices» es **N** para MSCI, S&P, FTSE y STOXX por nombre; hay una cláusula general sobre datos de terceros (ver cita).
- Invesco ETF (`etf.invesco.com`) figura en un resultado de búsqueda como página de condiciones «para el Reino Unido», pero **no se pudo abrir**: el enlace redirige a la web estadounidense. No está en la tabla; queda pendiente.

## Citas por emisor

### 1. iShares (BlackRock)

**Páginas:**
- A: <https://www.ishares.com/uk/individual/en/compliance/terms-and-conditions> · fecha de versión: «These Terms and Conditions are dated 17 October 2016». Leída: 08-11-2026.
- B: <https://www.blackrock.com/uk/compliance/terms-and-conditions>. Sin fecha de versión. Leída: 08-11-2026.

**Reproducción / reutilización** (sección «Content and use of this website», página A):
- «you may not sell, copy, publish, distribute, transfer, modify, display, reproduce, and/or create any derivative works» → *no puede vender, copiar, publicar, distribuir, transferir, modificar, mostrar, reproducir ni crear obras derivadas*.
- «Any copying of information or data, especially the use of texts and graphics requires the prior approval of BAUL» → *Cualquier copia de información o datos, en especial de textos y gráficos, requiere la aprobación previa de BAUL*.
- «You may not redeliver any of the pages, text, images, or content of this website» → *No puede volver a entregar ninguna página, texto, imagen o contenido de este sitio*.

**Uso comercial frente a personal** (página A):
- «This website is for your personal and internal use and is not to be used for any commercial purposes» → *Este sitio es para su uso personal e interno y no debe usarse con fines comerciales*.
- «unless and to the extent you are a financial adviser seeking information about iShares products» → *salvo que, y en la medida en que, sea un asesor financiero que busca información sobre productos iShares*.

**Datos de índices** (sección «Index disclaimers», página A):
- «the trademarks used in the index names are the intellectual property of STOXX Limited» → *las marcas de los nombres de índice son propiedad intelectual de STOXX Limited*.
- «All copyright and database rights within the index values and constituent list vest in FTSE.» → *Todos los derechos de autor y de base de datos sobre los valores del índice y su lista de componentes corresponden a FTSE*.
- «Index data source: S&P Dow Jones Indices LLC.» → *Fuente de datos del índice: S&P Dow Jones Indices LLC*.
- «The fund is not sponsored, endorsed, or promoted by MSCI or Barclays» → *El fondo no está patrocinado, avalado ni promovido por MSCI ni por Barclays*.

**Destinatarios** (página A):
- Selector de cabecera: «I manage my own money» (inversor particular) y «I consult with, or represent, organisations, beneficiaries or institutions» (profesional).
- «Access to information displayed on this website may be restricted to certain persons in certain countries.» → *El acceso a la información puede restringirse a determinadas personas en determinados países*.
- «This website has been issued for access in the United Kingdom» → *Este sitio se ha publicado para acceso desde el Reino Unido*.
- «Users of this website must ensure that they are legally permitted to log on to this website» → *Los usuarios deben asegurarse de que tienen permiso legal para acceder al sitio*.

**Automatizado / programático:** **N** en ambas páginas.

**Discrepancia de entidad** (página B): «This site is operated and issued by BlackRock Investment Management (UK) Limited». La página A dice que el sitio lo emite BlackRock Advisors (UK) Limited (BAUL). Ver «Discrepancias».

### 2. Amundi

**Página:** <https://www.amundietf.fr/fr/professionnels/mentions-legales>. Fecha de versión: «La dernière mise à jour des termes et conditions» = **21/11/2025**. Leída: 08-11-2026.

**Aviso de acceso:** la página muestra la pregunta «Do you accept the above conditions and understand them?» con botones «INSTIT» y «RETAIL». **No se ha pulsado nada.** La herramienta sí obtuvo el texto legal, pero no está verificado que se vea sin aceptar en un navegador real: Óscar debe comprobarlo.

**Reproducción / reutilización:**
- «La reproduction ou représentation de tout ou partie du présent site internet, par quelque moyen que ce soit» → *La reproducción o representación total o parcial de este sitio, por cualquier medio*.
- «vous ne pouvez pas reproduire (en tout ou en partie), transmettre» → *no puede reproducir (en todo o en parte) ni transmitir*.

**Uso comercial frente a personal:**
- «strictement pour votre usage personnel» → *estrictamente para su uso personal* (sobre impresión y descarga de páginas).
- «à des fins publiques ou autres fins commerciales» → *con fines públicos u otros fines comerciales*.

**Datos de índices / terceros:**
- «Les Fonds et les ETC ne sont ni sponsorisés, approuvés, vendus ou promus par les fournisseurs d'indices.» → *Los fondos y ETC no están patrocinados, aprobados, vendidos ni promovidos por los proveedores de índices*. **Genérico**: no nombra MSCI, S&P, FTSE ni STOXX.
- «Les informations contenues ici : (1) appartiennent à Morningstar» → *La información aquí contenida pertenece a Morningstar*.

**Destinatarios:**
- «Le présent site internet n'est pas destiné et ne vise pas des personnes qui seraient soumises…» → *Este sitio no está destinado ni dirigido a personas que estén sujetas…* (la frase continúa; la lectura no devolvió el final).
- «si vous venez d'un pays ayant un site internet « Amundi ETF» dédié» → *si procede de un país que tiene un sitio «Amundi ETF» propio*.
- El menú distingue «Investisseurs professionnels» e «Investisseurs particuliers»; el texto legal no detalla a quién va dirigida cada sección.

**Automatizado / programático:** **N**.

### 3. Xtrackers (DWS)

**Resultado: no verificado.** Las dos rutas probadas no devuelven el texto:
- <https://etf.dws.com/en-gb/footer/terms-of-use> redirige (302) a <https://etf.deutsche-am.com/en-gb/footer/terms-of-use>, que devuelve solo el título «Terms of Use | Xtrackers by Deutsche AM».
- <https://etf.dws.com/es-es/footer/condiciones-de-uso/> redirige a <https://etf.deutsche-am.com/es-es/footer/condiciones-de-uso/>, que devuelve solo el título «Condiciones de uso | Xtrackers by Deutsche AM».

Probablemente el texto se carga con JavaScript; no lo he podido confirmar. **No hay cita verificada para ningún tema.**

**Solo como pista, no verificado en la página** (fragmentos del buscador, que no leí en la página): las condiciones de `etf.dws.com/en-gb` dicen que se rigen por la ley de Inglaterra y Gales, y que los sitios pueden tener condiciones específicas por país o sector que prevalecen. Hay además una versión belga que indica que los sitios los opera la entidad que figura en cada aviso legal. Estas frases **no son citas verificadas**: no pueden usarse para decidir.

**Pendiente para Óscar:** leer directamente `etf.deutsche-am.com/en-gb/footer/terms-of-use` o `etf.dws.com/en-gb/footer/terms-of-use` en el navegador.

### 4. Vanguard

**Páginas:**
- A: <https://www.vanguard.co.uk/professional/terms-and-conditions>. Fecha: no figura; aparece «© 2026» en el pie (copyright, no versión). Leída: 08-11-2026.
- B: <https://www.vanguard.co.uk/uk-fund-directory/terms-and-conditions>. Fecha: no figura; «© 2021» en el pie (copyright). Leída: 08-11-2026.

**Automatizado / programático** (página A):
- «using devices or software that provide repeated automated access to this website, other than those made generally available by Vanguard» → *usar dispositivos o software que den acceso automatizado repetido a este sitio, distinto de los que Vanguard pone a disposición en general*. Dentro de una prohibición de conductas que «could damage, disable, or overburden» el sitio.
- Se prohíbe también sondear, escanear o probar vulnerabilidades.
- **No se mencionan scraping, bots ni APIs por nombre.**

**Reproducción / reutilización** (A y B):
- Licencia «limitada, revocable, no exclusiva e intransferible» solo para uso «personal, informational and non-commercial» → *uso personal, informativo y no comercial*. Vanguard se reserva los derechos no concedidos.
- Prohibido «Modify, copy, screen capture, distribute, forward, transmit, post, display, perform, reproduce, publish, broadcast» → *Modificar, copiar, capturar pantalla, distribuir, reenviar, transmitir, publicar, mostrar, reproducir, difundir*. (Página B.)
- Se prohíbe el «framing» sin autorización (página A).
- Los enlaces solo pueden llevar a la portada, con un texto concreto; «Vanguard may withdraw linking permission at any time, without notice» → *Vanguard puede retirar el permiso de enlace en cualquier momento, sin aviso* (página A).

**Uso comercial frente a personal:**
- «may use the data and information provided on this website for certain commercial uses with Vanguard's prior approval» → *puede usar los datos para ciertos usos comerciales con aprobación previa de Vanguard*. Se refiere a intermediarios (asesores, gestores de patrimonio) (página B).

**Datos de índices / terceros** (página B):
- MSCI: «The funds or securities referred to herein are not sponsored, endorsed, or promoted by MSCI» → *Los fondos o valores aquí mencionados no están patrocinados, avalados ni promovidos por MSCI*.
- S&P: «The S&P Index is a product of S&P Dow Jones Indices LLC and has been licensed for use by Vanguard.» → *El índice S&P es un producto de S&P Dow Jones Indices LLC y Vanguard tiene licencia para su uso*.
- FTSE: «All information is provided for information purposes only.» → *Toda la información se ofrece solo a efectos informativos* (cláusula general; no nombra FTSE en la cita).
- STOXX: **N**.
- Terceros (página A): hay una cláusula general según la cual Vanguard no garantiza ni responde por el contenido de terceros.

**Destinatarios:**
- Página A: el encabezado muestra «Professional investors». El texto no dice expresamente a quién va dirigido el sitio: **N**.
- Página B: «This website provides general information about Vanguard Asset Management, Limited and its business» → *Este sitio ofrece información general sobre Vanguard Asset Management, Limited y su negocio*. Público: **N**.
- País: «The distribution of the information contained in this website in certain countries may be restricted by law» → *La distribución de la información puede estar restringida por ley en determinados países*. Ley aplicable: «governed by and shall be construed in accordance with the laws of England and Wales» → *se rige por la ley de Inglaterra y Gales* (página A).

### 5. SPDR (State Street)

**Página:** <https://www.ssga.com/es/en_gb/institutional/etfs/footer/terms-and-conditions>. Fecha de versión: **N**. Leída: 08-11-2026.

**Advertencia:** el texto parece global o de EE. UU. («Unauthorized access, use or distribution is in violation of state and/or federal statutes» → *El acceso, uso o distribución no autorizados infringen la normativa estatal o federal*). Ver «Discrepancias».

**Automatizado / programático:** **N**. Solo hay una cláusula de acceso no autorizado (cita anterior).

**Reproducción / reutilización:**
- «You may not copy, reproduce, duplicate, modify, adopt or lend, sell, disseminate or otherwise transfer» → *No puede copiar, reproducir, duplicar, modificar, adaptar o prestar, vender, difundir ni transferir de otro modo*.
- Sobre datos de bases de State Street, la restricción (iv) prohíbe que se publique o redistribuya «to be published, redistributed or retransmitted for other than use for or on behalf of yourself» → *publicar, redistribuir o retransmitir para otro uso que no sea el propio o en nombre propio*.
- Se permite imprimir «for your own personal use» → *para su uso personal*; se prohíbe usar el sitio «in the operation of a service bureau» → *en la explotación de un servicio de tipo agencia de servicios*.

**Uso comercial frente a personal:**
- «All equipment, systems, services and software are to be used for your business purposes only» → *Todo el equipo, sistemas, servicios y software se usarán solo para fines empresariales propios*.
- Se prohíbe usar el sitio «for any fund or investment vehicle» → *para cualquier fondo o vehículo de inversión* sin consentimiento previo y por escrito de State Street.

**Datos de índices / terceros:**
- MSCI, S&P, FTSE, STOXX: **N** por nombre.
- Cláusula general: «In no event may you use the data and information on the Site in lieu of obtaining appropriate licenses» → *En ningún caso puede usar los datos y la información del sitio en lugar de obtener las licencias adecuadas*.

**Destinatarios:**
- «designed specifically for various categories of investors in various countries and regions» → *diseñados específicamente para distintas categorías de inversores en distintos países y regiones*.
- «Access to non-U.S. pages in this site is not permitted by U.S. residents.» → *Los residentes en EE. UU. no pueden acceder a las páginas no estadounidenses de este sitio*.
- Profesional o particular: **N**.

### 6. Invesco

**Página:** <https://www.invesco.com/uk/en/global-footer/terms-and-conditions.html>. Fecha de versión: «These Terms & Conditions were updated 24 November 2021» → *Estas condiciones se actualizaron el 24 de noviembre de 2021*. El «©2026» del pie es copyright, no versión. Leída: 08-11-2026.

**Automatizado / programático:** **N**. Solo hay una prohibición general de transmitir virus u otros elementos destructivos.

**Reproducción / reutilización:**
- «The entire content of the site is subject to copyright, with all rights reserved.» → *Todo el contenido del sitio está protegido por derechos de autor, con todos los derechos reservados*.
- «You may download or print individual sections of the site for personal use and information purposes only» → *Puede descargar o imprimir secciones individuales del sitio solo para uso personal e informativo*, conservando los avisos de copyright.
- «You may not reproduce (in whole or in part), transmit (by electronic means or otherwise)» → *No puede reproducir (en todo o en parte) ni transmitir (por medios electrónicos u otros)*.

**Uso comercial frente a personal:**
- «use for any public or commercial purpose the site without the prior written permission» → *usar el sitio con cualquier fin público o comercial sin permiso previo por escrito*.

**Datos de índices / terceros:** **N**. Solo hay un descargo sobre enlaces externos («we do not accept any responsibility for the content of such a site» → *no aceptamos responsabilidad por el contenido de esos sitios*).

**Destinatarios:**
- Inversor particular: quien «is making their own investment decisions for themselves» → *toma sus propias decisiones de inversión*.
- Profesional: «a financial adviser who gives advice to clients on our range of funds» → *un asesor financiero que aconseja a sus clientes sobre nuestra gama de fondos*.
- País: hay una sección «Users based in the UK» y los usuarios deben confirmar su país de residencia y su tipo de inversor.
- Los productos SICAV y ETF de ese sitio están «autorizados en el extranjero, no en el Reino Unido» (sección «Users based in the UK», según la lectura).

**Pendiente:** existe una página de condiciones de ETF para el Reino Unido en `etf.invesco.com` según un resultado de búsqueda, pero el enlace redirige a la web de EE. UU. y **no está verificada**.

## Discrepancias y límites

1. **iShares: dos entidades operadoras.** `ishares.com/uk/individual/…` dice que lo emite BlackRock Advisors (UK) Limited (BAUL). `blackrock.com/uk/compliance/…` dice que lo opera BlackRock Investment Management (UK) Limited. No puedo saber cuál rige el sitio de iShares; hay que verlo en la página viva.
2. **SPDR: texto posiblemente no europeo.** La página es la de `es/en_gb`, pero el texto leído tiene referencias a EE. UU. Un resultado de búsqueda la describe como la de Europa. Sin confirmar, no sirve como referencia para la UE.
3. **Amundi: aviso de aceptación** en la página de mentions légales. El texto se obtuvo sin pulsar nada; no está verificado que se vea así en navegador.
4. **DWS: sin texto legible** en ninguna ruta probada.
5. **Fechas de versión:** iShares es de 2016 (la página puede estar desactualizada, como indica el propio sitio); Invesco es de 2021; Amundi es de 2025; Vanguard y SPDR no la dan. Los «© 2026» de los pies son copyright, no versión.
6. **Las URL de datos de §2 del informe no tienen condiciones propias leídas.** Por ejemplo, `dng-api.invesco.com` (Invesco) y `vanguard.co.uk/gpx/graphql` (Vanguard) son dominios de API; no se ha comprobado si tienen condiciones separadas.
7. **Aparte del texto:** la lectura se hizo sin cuenta ni sesión, sin aceptar nada y sin enviar más peticiones que las necesarias. No se usó EODHD ni ningún token.

## Páginas revisadas sin texto relevante

- `ssga.com/uk/en_gb/institutional/etfs/footer/legal`: redirige a contenido de Australia («This Site is only intended to be available for access by persons in Australia»). **Descartada** para este encargo.
- `https://www.invesco.com/us/en/financial-products/etfs.html` (redirección de `etf.invesco.com`): web de EE. UU. **No leída**.
- `https://www.amundietf.fr` (portada): solo se usó para localizar los enlaces legales; el pie contiene «Mentions légales», «Informations réglementaires» y «Tentatives d'escroquerie», este último no legal.
