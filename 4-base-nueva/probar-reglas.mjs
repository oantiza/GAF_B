/**
 * probar-reglas.mjs — las reglas del proyecto nuevo, probadas contra el emulador.
 *
 *   node 4-base-nueva/probar-reglas.mjs
 *
 * Contra otro emulador -para probar las reglas de una rama sin cargarlas en el 8092-, con
 * `PROBAR_REGLAS_EMULADOR=127.0.0.1:<puerto>`. El 8092 sirve las reglas de la carpeta desde la
 * que se arrancó, que es el checkout principal: lo que se prueba ahí son esas, no las de la rama.
 *
 * Por qué hace falta y por qué no basta con leerlas: `Bearer owner`, que es el token con el
 * que todo este proyecto habla con el emulador, **salta las reglas**. Con él no se prueba
 * ninguna, y todo funciona igual de bien con las reglas abiertas que cerradas. Así que aquí
 * se forja un token SIN FIRMAR (`alg: none`), que es lo que el emulador acepta como sesión de
 * un usuario, y se comprueba cada rama con el uid de un asesor de verdad leído de la base.
 *
 * Lo que encontró el 02-11-2026, el día que se escribieron: el buscador y la pantalla de
 * salud daban **403 con sesión**. Una regla anidada dentro de `match /instruments/{id}` vale
 * para leer un documento por su ruta y NO para una consulta de grupo de colección; hacen
 * falta reglas con comodín de ruta. Eso no se ve leyendo el fichero, y con `Bearer owner`
 * tampoco: aparecería el día en que un cliente se conecte.
 *
 * Y lo que encontró el 03-11-2026, que es por qué este fichero cambió: **comprobar el código
 * de estado no era comprobar nada** en las consultas. Una consulta de grupo que devuelve los
 * objetivos de la cartera de OTRO asesor contesta 200 igual que una que no devuelve nada, así
 * que los diecisiete casos de ayer habrían pasado con una fuga dentro. Ahora los casos que
 * pueden filtrar algo comprueban **lo que vuelve**, no sólo que se permita, y para eso hay una
 * cartera de pruebas ajena que se siembra y se borra aquí mismo.
 *
 * Y lo que se añadió el 21-11-2026 (P1-10 de la auditoría integral del 20-11): que un bloque
 * `declared`, `computed` u `holdings_chunks` colgado de una cartera o de un cliente NO se lee —antes
 * lo abrían unas reglas de grupo que el navegador no usaba—, mientras los del catálogo se siguen
 * leyendo por su ruta; que una retrocesión firmada con la autoría de otro se rechaza; y que la foto
 * de una importación se rechaza con un campo del tipo equivocado o pasado de tamaño. Lo que estos
 * casos siembran (una cartera ajena con bloques, un cliente y fotos de importación) se borra al
 * final con el token de dueño, como la cartera ajena de siempre.
 *
 * Lo que este script NO puede comprobar, y hay que saberlo: **el emulador no exige índices**.
 * Una consulta filtrada que aquí contesta 200 puede fallar en la nube pidiendo un índice. Por
 * eso `firestore.indexes.json` se razona a mano y se verifica desplegando.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROYECTO = 'bdb-gestor-de-activos';
/* El emulador de la base nueva, salvo que se pida otro. Pedir otro sirve para probar unas reglas
   que no son las del checkout principal —las de una rama— contra un emulador aparte, sin cargarlas
   en el 8092. Solo se admite una dirección de este ordenador: este id es de un proyecto real. */
const EMULADOR = process.env.PROBAR_REGLAS_EMULADOR ?? '127.0.0.1:8092';
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(EMULADOR)) {
    console.error(`PROBAR_REGLAS_EMULADOR tiene que ser 127.0.0.1:<puerto>, y es ${EMULADOR}`);
    process.exit(1);
}
const BASE = `http://${EMULADOR}/v1/projects/${PROYECTO}/databases/(default)/documents`;

/* El campo por el que las reglas conceden un objetivo. Está aquí arriba y no escrito seis
   veces porque es LA decisión que E-3 puso en cuestión: si vuelve a ser `set_by` -quién lo
   puso- en vez de `advisor_id` -de quién es la cartera-, los casos de abajo se ponen rojos. */
const CAMPO_DE_ACCESO = 'advisor_id';

/* La cartera ajena que hace visible la fuga. Vive sólo mientras corre esta prueba. */
const CARTERA_AJENA = 'PRUEBA-REGLAS-E3';
const INSTRUMENTO_AJENO = 'XX0000000000';
const DUENO_AJENO = 'OTRO-ASESOR-CON-CARTERA-PROPIA';

const DUENO = { Authorization: 'Bearer owner' };

/**
 * Un token de sesión del emulador: sin firma, que es lo que acepta.
 *
 * Lleva `email_verified: true` salvo que se diga otra cosa, porque desde el 16-11-2026
 * (hallazgo 5) las reglas lo exigen y la sesión de un asesor de verdad lo trae. Para un token
 * sin el campo se pasa `email_verified: undefined`, que `JSON.stringify` deja fuera.
 */
function token(uid, claims = {}) {
    const trozo = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    return `${trozo({ alg: 'none', typ: 'JWT' })}.${trozo({
        iss: `https://securetoken.google.com/${PROYECTO}`,
        aud: PROYECTO,
        sub: uid,
        user_id: uid,
        iat: 1762100000,
        exp: 1999999999,
        firebase: { identities: {}, sign_in_provider: 'custom' },
        email_verified: true,
        ...claims
    })}.`;
}

const cabeceras = (uid, claims = {}) => (uid === null ? {} : { Authorization: `Bearer ${token(uid, claims)}` });

/* Las dos sesiones que el hallazgo 5 deja fuera: la que dice que el correo no está verificado y
   la que no lo dice. Las dos con un uid de verdad, para que lo único que falle sea el correo. */
const SIN_VERIFICAR = { email_verified: false };
const SIN_EL_CAMPO = { email_verified: undefined };

async function leer(ruta, uid, claims = {}) {
    const r = await fetch(`${BASE}/${ruta}`, { headers: cabeceras(uid, claims) });
    return String(r.status);
}

/** Devuelve el estado Y las rutas que han vuelto, que es la mitad que faltaba. */
async function consultar(coleccion, uid, filtro = null, claims = {}) {
    const query = { from: [{ collectionId: coleccion, allDescendants: true }], limit: 3000 };
    if (filtro !== null) {
        query.where = {
            fieldFilter: {
                field: { fieldPath: filtro.campo },
                op: 'EQUAL',
                value: { stringValue: filtro.valor }
            }
        };
    }
    const r = await fetch(`${BASE}:runQuery`, {
        method: 'POST',
        headers: { ...cabeceras(uid, claims), 'Content-Type': 'application/json' },
        body: JSON.stringify({ structuredQuery: query })
    });
    if (!r.ok) return { estado: String(r.status), rutas: [] };
    const filas = await r.json();
    const rutas = filas
        .filter((f) => f.document !== undefined)
        .map((f) => f.document.name.split('/documents/')[1]);
    return { estado: String(r.status), rutas };
}

/**
 * Por qué campo filtra la aplicación los objetivos, leído de su código.
 *
 * Esta comprobación no toca el emulador y es la que más falta hacía: el filtro del cliente y
 * el campo de la regla **tienen que ser el mismo**. Si la regla concede por `advisor_id` y la
 * consulta filtra por `set_by`, Firestore contesta 403 y la lista de carteras se queda vacía;
 * al revés, hay fuga. Y nada lo cazaba, porque el camino de desarrollo habla con el emulador
 * usando `Bearer owner`, que **salta las reglas**: los dos lados pueden estar en desacuerdo
 * meses sin que se note, hasta el día en que un cliente se conecte a la nube.
 */
function campoQueFiltraLaApp() {
    const aqui = dirname(fileURLToPath(import.meta.url));
    const ruta = join(aqui, '..', '3-BDB-ACTIVOS_app', 'src', 'adapters', 'baseNuevaLecturaSdk.ts');
    const codigo = readFileSync(ruta, 'utf8');
    /* Desde el 04-11-2026 (30831fba) la app no consulta `targets`: las carteras le llegan por la
       Function `list_portfolios`. Sin consulta no hay desacuerdo posible, y eso se dice con su nombre;
       si la consulta vuelve, se mira otra vez el campo. */
    if (!/collectionGroup\([^)]*"targets"\)/.test(codigo)) return `${CAMPO_DE_ACCESO} (la app no consulta targets)`;
    const encontrado = codigo.match(/collectionGroup\(db,\s*"targets"\),\s*where\("([^"]+)"/);
    return encontrado === null ? '(no se encuentra el filtro)' : encontrado[1];
}

/** Una colección raíz entera, con la sesión que se diga. */
async function consultarLista(coleccion, uid, claims) {
    const r = await fetch(`${BASE}/${coleccion}?pageSize=5`, { headers: cabecerasDe(uid, claims) });
    return { estado: String(r.status) };
}

/** Cuántos de los objetivos devueltos cuelgan de una cartera que no es del asesor. */
const deOtro = (rutas) => rutas.filter((ruta) => ruta.startsWith(`portfolios/${CARTERA_AJENA}/`)).length;

async function escribir(ruta, campos) {
    const padre = ruta.split('/').slice(0, -1).join('/');
    const id = ruta.split('/').at(-1);
    const r = await fetch(`${BASE}/${padre}?documentId=${id}`, {
        method: 'POST',
        headers: { ...DUENO, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: campos })
    });
    if (!r.ok) throw new Error(`no se pudo sembrar ${ruta}: ${r.status} ${await r.text()}`);
}

async function borrar(ruta) {
    const r = await fetch(`${BASE}/${ruta}`, { method: 'DELETE', headers: DUENO });
    if (!r.ok && r.status !== 404) console.error(`  ojo: no se pudo borrar ${ruta} (${r.status})`);
}

/**
 * Siembra una cartera de OTRO asesor con un objetivo que puso ESTE asesor.
 *
 * Es el caso que ninguno de los diecisiete de ayer cubría, y el que hace visible E-3: con la
 * regla keyed en `set_by`, el asesor no puede leer la cartera -403- y sin embargo su objetivo
 * le vuelve en la consulta de grupo. Dos respuestas que se contradicen sobre el mismo dato.
 *
 * No queda en la base: se borra en el `finally` de `main`. Y no se llama a `guardar.mjs`, que
 * es lo único que escribe el volcado en disco.
 */
async function sembrarCarteraAjena(asesor, cuando) {
    await escribir(`portfolios/${CARTERA_AJENA}`, {
        portfolio_id: { stringValue: CARTERA_AJENA },
        name: { stringValue: 'Cartera de prueba de otro asesor' },
        advisor_id: { stringValue: DUENO_AJENO },
        kind: { stringValue: 'propuesta' },
        updated_at: { stringValue: cuando }
    });
    await escribir(`portfolios/${CARTERA_AJENA}/targets/${INSTRUMENTO_AJENO}`, {
        instrument_id: { stringValue: INSTRUMENTO_AJENO },
        weight: { doubleValue: 1 },
        /* El objetivo lo puso NUESTRO asesor dentro de la cartera de otro. */
        set_by: { stringValue: asesor },
        advisor_id: { stringValue: DUENO_AJENO },
        set_at: { stringValue: cuando }
    });
}

const ADMIN = { admin: true };
/* El claim de administrador no sustituye al correo verificado: `esAdministrador()` se apoya en `esAsesor()`. */
const ADMIN_SIN_VERIFICAR = { admin: true, email_verified: false };
const ISIN_INEXISTENTE = 'XX0000000000';
/* Un administrador cuyo token lleva el correo: la app firma con él cuando lo tiene. */
const CORREO = 'asesor-de-prueba@ejemplo.com';
const CON_CORREO = { admin: true, email: CORREO };
/** Una foto con `n` filas, todas de borrado: `previous` y `applied` con las mismas claves. */
const filasDeLaFoto = (n) => {
    const claves = Array.from({ length: n }, (_, i) => `XX${String(i).padStart(10, '0')}`);
    return {
        counts: { DELETE: n },
        previous: Object.fromEntries(claves.map((c) => [c, null])),
        applied: Object.fromEntries(claves.map((c) => [c, 'DELETE']))
    };
};

const cabecerasDe = cabeceras;

async function leerRetro(ruta, uid, claims) {
    return String((await fetch(`${BASE}/${ruta}`, { headers: cabecerasDe(uid, claims) })).status);
}

/** Escribe como lo hace la app: la hora la pone el servidor, que es lo que exige la regla. La firma
    es la de la sesión salvo que se diga otra, que es lo que prueba P1-10. */
async function escribirRetro(isin, uid, claims, retro = 0.5, firma = uid ?? 'nadie') {
    const r = await fetch(`${BASE}:commit`, {
        method: 'POST',
        headers: { ...cabecerasDe(uid, claims), 'Content-Type': 'application/json' },
        body: JSON.stringify({
            writes: [
                {
                    update: {
                        name: `projects/${PROYECTO}/databases/(default)/documents/commercial_retro/${isin}`,
                        fields: {
                            isin: { stringValue: isin },
                            retro_pct: { doubleValue: retro },
                            as_of_date: { stringValue: '2026-11-03' },
                            source: { stringValue: 'PRUEBA-REGLAS' },
                            updated_by: { stringValue: firma }
                        }
                    },
                    updateTransforms: [{ fieldPath: 'updated_at', setToServerValue: 'REQUEST_TIME' }]
                }
            ]
        })
    });
    return String(r.status);
}

async function borrarComo(ruta, uid, claims) {
    return String((await fetch(`${BASE}/${ruta}`, { method: 'DELETE', headers: cabecerasDe(uid, claims) })).status);
}

/** Una lectura que las reglas dejan pasar: 200 si el documento existe y 404 si no. Las dos dicen
    «permitida»; lo que no lo dice es un 403. Así el caso vale contra cualquier base. */
const permitida = async (pendiente) => {
    const estado = await pendiente;
    return estado === '200' || estado === '404' ? 'permitida' : estado;
};

/** Un valor de JavaScript en el formato REST de Firestore. Los enteros van como enteros: la regla
    compara `schema_version == 2` y `applied_batches is int`. */
function valor(v) {
    if (v === null) return { nullValue: null };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    if (typeof v === 'string') return { stringValue: v };
    if (Array.isArray(v)) return { arrayValue: v.length ? { values: v.map(valor) } : {} };
    const fields = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, valor(x)]));
    return { mapValue: Object.keys(fields).length ? { fields } : {} };
}
const campos = (objeto) => valor(objeto).mapValue.fields ?? {};
const nombreDe = (ruta) => `projects/${PROYECTO}/databases/(default)/documents/${ruta}`;

/** Las fotos de importación que siembra esta prueba, para borrarlas al final con el token de dueño. */
const RECIBO = 'PRUEBA-REGLAS-P110';
const recibosCreados = new Set();

/** La foto de una importación como la escribe `applyCommercialRetroImport`, con lo que se quiera cambiar. */
function recibo(id, firma, cambios = {}) {
    return {
        import_id: id,
        created_by: firma,
        as_of_date: '2026-11-21',
        file_name: 'retro.xlsx',
        scale: 'porcentaje',
        replace_all: false,
        counts: { CREATE: 1 },
        previous: { [ISIN_INEXISTENTE]: null },
        applied: { [ISIN_INEXISTENTE]: { retro_pct: 0.45, status: 'CONFIRMED', as_of_date: '2026-11-21', source: 'FILE_IMPORT' } },
        schema_version: 2,
        applied_isins: [],
        undone_isins: [],
        applied_versions: {},
        status: 'partial',
        ...cambios
    };
}

/** Crea la foto como la app: con la hora del servidor en `created_at` y solo si no existe. */
async function crearRecibo(sufijo, uid, claims, cambios = {}, firma = uid) {
    const id = `${RECIBO}-${sufijo}`;
    recibosCreados.add(id);
    const r = await fetch(`${BASE}:commit`, {
        method: 'POST',
        headers: { ...cabecerasDe(uid, claims), 'Content-Type': 'application/json' },
        body: JSON.stringify({
            writes: [
                {
                    update: { name: nombreDe(`commercial_retro_imports/${id}`), fields: campos(recibo(id, firma, cambios)) },
                    updateTransforms: [{ fieldPath: 'created_at', setToServerValue: 'REQUEST_TIME' }],
                    currentDocument: { exists: false }
                }
            ]
        })
    });
    return String(r.status);
}

/** Cambia solo los campos que se digan de una foto que ya existe, como `updateDoc`. */
async function cambiarRecibo(sufijo, uid, claims, cambios) {
    const r = await fetch(`${BASE}:commit`, {
        method: 'POST',
        headers: { ...cabecerasDe(uid, claims), 'Content-Type': 'application/json' },
        body: JSON.stringify({
            writes: [
                {
                    update: { name: nombreDe(`commercial_retro_imports/${RECIBO}-${sufijo}`), fields: campos(cambios) },
                    updateMask: { fieldPaths: Object.keys(cambios) },
                    currentDocument: { exists: true }
                }
            ]
        })
    });
    return String(r.status);
}

/* Lo que no debe leerse: bloques con los nombres del catálogo colgados de una cartera ajena y de un
   cliente. Hasta el 21-11-2026 los abrían las reglas de grupo de `declared`, `computed` y
   `holdings_chunks`, aunque el bloque de carteras y el de clientes digan `if false`. */
const CLIENTE_DE_PRUEBA = 'PRUEBA-REGLAS-P110';
const BLOQUES_FUERA_DEL_CATALOGO = [
    `portfolios/${CARTERA_AJENA}/declared/profile`,
    `portfolios/${CARTERA_AJENA}/computed/metrics`,
    `portfolios/${CARTERA_AJENA}/holdings_chunks/0`,
    `clients/${CLIENTE_DE_PRUEBA}/declared/profile`
];

async function sembrarBloquesFueraDelCatalogo() {
    await escribir(`clients/${CLIENTE_DE_PRUEBA}`, {
        name: { stringValue: 'Cliente de prueba' },
        advisor_uids: { arrayValue: { values: [{ stringValue: DUENO_AJENO }] } }
    });
    for (const ruta of BLOQUES_FUERA_DEL_CATALOGO) {
        await escribir(ruta, { nota: { stringValue: 'no debe leerse' } });
    }
}

/** Una retrocesión que existe y un instrumento sin retrocesión, leídos de la base. */
async function retroDePrueba() {
    const conRetro = await (await fetch(`${BASE}/commercial_retro?pageSize=400`, { headers: DUENO })).json();
    const nombres = (conRetro.documents ?? []).map((d) => d.name.split('/').pop());
    const instrumentos = await (await fetch(`${BASE}/instruments?pageSize=400&mask.fieldPaths=instrument_type`, { headers: DUENO })).json();
    const libre = (instrumentos.documents ?? []).map((d) => d.name.split('/').pop()).find((id) => !nombres.includes(id));
    return { existente: nombres[0], libre };
}

async function main() {
    /* Un asesor y una cartera suya, leídos con el token de dueño: la prueba necesita un uid
       que exista de verdad, no uno inventado. */
    const r = await fetch(`${BASE}:runQuery`, {
        method: 'POST',
        headers: { ...DUENO, 'Content-Type': 'application/json' },
        body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'portfolios' }], limit: 1 } })
    });
    const filas = await r.json();
    const documento = filas[0]?.document;
    if (documento === undefined) {
        console.error('No hay carteras en la base: siembra con `carteras:write` antes de probar.');
        process.exit(1);
    }
    const cartera = documento.name.split('/documents/')[1];
    const asesor = documento.fields.advisor_id.stringValue;
    const otro = 'OTRO-ASESOR-QUE-NO-ES-SUYA';

    console.log('');
    console.log('=== las reglas de bdb-gestor-de-activos, contra el emulador ===');
    console.log(`cartera de prueba : ${cartera}`);
    console.log(`su asesor         : ${asesor}`);
    console.log(`campo de acceso   : ${CAMPO_DE_ACCESO}`);
    console.log('');

    await sembrarCarteraAjena(asesor, new Date().toISOString());
    await sembrarBloquesFueraDelCatalogo();

    const retro = await retroDePrueba();
    /* Un plan que exista de verdad, leído con el token de dueño. */
    const planes = await (await fetch(`${BASE}/pension_plans?pageSize=1`, { headers: DUENO })).json();
    const plan = planes.documents?.[0]?.name.split('/').pop();
    if (plan === undefined) {
        console.error('No hay planes de pensiones en la base: siembra con `planes:write` antes de probar.');
        process.exit(1);
    }
    /* Una serie de tipos de cambio y una del tipo sin riesgo que existan de verdad. */
    const unaDe = async (coleccion) =>
        (await (await fetch(`${BASE}/${coleccion}?pageSize=1`, { headers: DUENO })).json()).documents?.[0]?.name.split('/').pop();
    const cambio = await unaDe('fx_rates');
    const tipo = await unaDe('reference_rates');
    if (cambio === undefined || tipo === undefined) {
        console.error('No hay tipos de cambio o tipo sin riesgo en la base: siembra las series antes de probar.');
        process.exit(1);
    }
    const casos = [
        ['el catalogo, con sesion', () => leer('instruments/ES0105836003', asesor), '200'],
        ['el catalogo, SIN sesion', () => leer('instruments/ES0105836003', null), '403'],
        ['una tarjeta por su ruta', () => leer('instruments/ES0105836003/read/card', asesor), '200'],
        ['el indice de busqueda', () => leer('search_shards/000', asesor), '200'],
        ['el indice, SIN sesion', () => leer('search_shards/000', null), '403'],
        ['grupo de tarjetas (el buscador)', async () => (await consultar('read', asesor)).estado, '200'],
        ['grupo de tarjetas SIN sesion', async () => (await consultar('read', null)).estado, '403'],
        ['grupo de calidad (la salud)', async () => (await consultar('quality', asesor)).estado, '200'],
        /* P1-10 (21-11-2026): el navegador no consulta en grupo los bloques ni los trozos, así que esas
           consultas ya no tienen regla. Lo que lee, lo lee por su ruta, y eso sigue abierto. */
        ['grupo de bloques declarados', async () => (await consultar('declared', asesor)).estado, '403'],
        ['grupo de bloques calculados', async () => (await consultar('computed', asesor)).estado, '403'],
        ['grupo de trozos de cartera', async () => (await consultar('holdings_chunks', asesor)).estado, '403'],
        ['un bloque declarado por su ruta', () => permitida(leer('instruments/ES0105836003/declared/profile', asesor)), 'permitida'],
        ['un bloque calculado por su ruta', () => permitida(leer('instruments/ES0105836003/computed/metrics', asesor)), 'permitida'],
        ['la calidad por su ruta', () => permitida(leer('instruments/ES0105836003/quality/latest', asesor)), 'permitida'],
        ['un año de la serie de precios', () => permitida(leer('instruments/ES0105836003/price_series/2026', asesor)), 'permitida'],
        ['los trozos de cartera, la lista', async () => (await consultarLista('instruments/ES0105836003/holdings_chunks', asesor)).estado, '200'],
        ['un bloque, SIN sesion', () => leer('instruments/ES0105836003/declared/profile', null), '403'],
        /* Lo del emisor (decisión 53): hoy lo lee cualquier asesor, como el resto del catálogo. Si Óscar
           decide reservarlo al administrador, estos dos casos son los que cambian. */
        ['datos del emisor por su ruta', () => permitida(leer('instruments/ES0105836003/declared/issuer_data', asesor)), 'permitida'],
        ['trozos del emisor, la lista', async () => (await consultarLista('instruments/ES0105836003/issuer_holdings_chunks', asesor)).estado, '200'],
        /* Y lo que no es catálogo, aunque se llame igual. Ni para el dueño de la cartera o del cliente. */
        ...BLOQUES_FUERA_DEL_CATALOGO.flatMap((ruta) => [
            [`${ruta.split('/')[0]}/…/${ruta.split('/').slice(2).join('/')}`, () => leer(ruta, asesor), '403'],
            [`  y para su dueño`, () => leer(ruta, DUENO_AJENO), '403']
        ]),
        ['su propia cartera', () => leer(cartera, asesor), '200'],
        ['la cartera de otro', () => leer(cartera, otro), '403'],
        ['una cartera SIN sesion', () => leer(cartera, null), '403'],
        /* El par que define E-3. Si estas dos no dicen lo mismo sobre el mismo dato -que no es
           suyo-, las reglas se contradicen, y la que manda es la más permisiva. */
        ['la cartera ajena, por su ruta', () => leer(`portfolios/${CARTERA_AJENA}`, asesor), '403'],
        [
            'un objetivo ajeno, por su ruta',
            () => leer(`portfolios/${CARTERA_AJENA}/targets/${INSTRUMENTO_AJENO}`, asesor),
            '403'
        ],
        /* A-207 (21-11-2026): la regla de grupo de `targets` se retiró; el navegador no lanza esa
           consulta desde el 04-11 y las Functions usan la cuenta de servicio. Ahora la consulta de
           grupo se rechaza con y sin filtro, también la del dueño, y los objetivos propios se
           siguen leyendo por su ruta (la regla anidada de `portfolios`). */
        ['grupo de objetivos SIN filtro', async () => (await consultar('targets', asesor)).estado, '403'],
        [
            'grupo de objetivos CON filtro',
            async () => (await consultar('targets', asesor, { campo: CAMPO_DE_ACCESO, valor: asesor })).estado,
            '403'
        ],
        [
            'el filtro viejo por set_by',
            async () => (await consultar('targets', asesor, { campo: 'set_by', valor: asesor })).estado,
            '403'
        ],
        [
            'grupo de objetivos de otro',
            async () => (await consultar('targets', otro, { campo: CAMPO_DE_ACCESO, valor: otro })).estado,
            '403'
        ],
        [
            'un objetivo propio, por su ruta',
            async () => {
                /* Un objetivo cualquiera de su cartera, tomado con la llave del dueño del emulador. */
                const r = await fetch(`${BASE}/${cartera}/targets?pageSize=1`, { headers: DUENO });
                const doc = ((await r.json()).documents ?? [])[0];
                if (doc === undefined) return 'SIN objetivo que leer';
                return leer(doc.name.split('/documents/')[1], asesor);
            },
            '200'
        ],
        /* Lo demás de una cartera propia, aunque sea suya, sigue cerrado (`match /{otro=**}`). */
        ['posiciones de su cartera, por ruta', () => leer(`${cartera}/positions/x`, asesor), '403'],
        ['retro sin sesion', () => leerRetro(`commercial_retro/${retro.existente}`, null), '403'],
        ['retro, asesor sin claim', () => leerRetro(`commercial_retro/${retro.existente}`, asesor), '403'],
        ['retro, administrador', () => leerRetro(`commercial_retro/${retro.existente}`, asesor, ADMIN), '200'],
        ['lista de retro, sin claim', async () => (await consultarLista('commercial_retro', asesor)).estado, '403'],
        ['lista de retro, administrador', async () => (await consultarLista('commercial_retro', asesor, ADMIN)).estado, '200'],
        ['recibos, sin claim', async () => (await consultarLista('commercial_retro_imports', asesor)).estado, '403'],
        ['escribir retro, sin claim', () => escribirRetro(retro.libre, asesor), '403'],
        ['escribir retro, escala mala', () => escribirRetro(retro.libre, asesor, ADMIN, 150), '403'],
        ['escribir retro, sin instrumento', () => escribirRetro(ISIN_INEXISTENTE, asesor, ADMIN), '403'],
        ['escribir retro, administrador', () => escribirRetro(retro.libre, asesor, ADMIN), '200'],
        ['borrar retro, sin claim', () => borrarComo(`commercial_retro/${retro.libre}`, asesor), '403'],
        ['borrar retro, administrador', () => borrarComo(`commercial_retro/${retro.libre}`, asesor, ADMIN), '200'],
        /* P1-10 (21-11-2026): la retrocesión va firmada por la sesión, con su uid o con su correo, como
           la guarda la app (`user.email ?? user.uid`). La autoría de otro ya no entra. */
        ['escribir retro, firma ajena', () => escribirRetro(retro.libre, asesor, ADMIN, 0.5, 'otro@ejemplo.com'), '403'],
        ['escribir retro, con su correo', () => escribirRetro(retro.libre, asesor, CON_CORREO, 0.5, CORREO), '200'],
        ['escribir retro, correo de otro', () => escribirRetro(retro.libre, asesor, CON_CORREO, 0.5, 'otro@ejemplo.com'), '403'],
        /* Y la foto de cada importación: nace como la escribe la app, y no con otro tipo ni pasada de tamaño. */
        ['foto de importacion, como la app', () => crearRecibo('valida', asesor, ADMIN), '200'],
        ['foto, sin claim', () => crearRecibo('sin-claim', asesor, {}), '403'],
        ['foto, firmada por otro', () => crearRecibo('firma', asesor, ADMIN, {}, 'otro@ejemplo.com'), '403'],
        ['foto, sin nombre de fichero', () => crearRecibo('sin-fichero', asesor, ADMIN, { file_name: null }), '200'],
        ['foto, nombre de 255', () => crearRecibo('nombre-255', asesor, ADMIN, { file_name: 'x'.repeat(255) }), '200'],
        ['foto, nombre de 256', () => crearRecibo('nombre-256', asesor, ADMIN, { file_name: 'x'.repeat(256) }), '403'],
        ['foto, fecha sin formato', () => crearRecibo('fecha', asesor, ADMIN, { as_of_date: '21/11/2026' }), '403'],
        ['foto, escala desconocida', () => crearRecibo('escala', asesor, ADMIN, { scale: 'otra' }), '403'],
        ['foto, replace_all no booleano', () => crearRecibo('replace', asesor, ADMIN, { replace_all: 'no' }), '403'],
        ['foto, recuento con otra clave', () => crearRecibo('recuento', asesor, ADMIN, { counts: { CREATE: 1, OTRA: 1 } }), '403'],
        ['foto, previous no es un mapa', () => crearRecibo('previous', asesor, ADMIN, { previous: 'x' }), '403'],
        ['foto, applied con otra clave', () => crearRecibo('applied', asesor, ADMIN, { applied: { ES0000000000: 'DELETE' } }), '403'],
        [
            'foto, applied con una de mas',
            () => crearRecibo('applied-mas', asesor, ADMIN, { applied: { [ISIN_INEXISTENTE]: 'DELETE', ES0000000000: 'DELETE' } }),
            '403'
        ],
        ['foto, 5.000 filas', () => crearRecibo('filas-5000', asesor, ADMIN, filasDeLaFoto(5000)), '200'],
        ['foto, 5.001 filas', () => crearRecibo('filas-5001', asesor, ADMIN, filasDeLaFoto(5001)), '403'],
        ['foto, otra version del esquema', () => crearRecibo('esquema', asesor, ADMIN, { schema_version: 3 }), '403'],
        ['foto, mas aplicados que filas', () => crearRecibo('aplicados', asesor, ADMIN, { applied_isins: ['A', 'B'] }), '403'],
        ['avance de lote, como la app', () => cambiarRecibo('valida', asesor, ADMIN, { applied_isins: [ISIN_INEXISTENTE], applied_batches: 1 }), '200'],
        ['avance, mas lotes que filas', () => cambiarRecibo('valida', asesor, ADMIN, { applied_batches: 2 }), '403'],
        ['avance, lotes no enteros', () => cambiarRecibo('valida', asesor, ADMIN, { applied_batches: 1.5 }), '403'],
        ['anotar un error de 2.000', () => cambiarRecibo('valida', asesor, ADMIN, { error: 'e'.repeat(2000) }), '200'],
        ['anotar un error de 2.001', () => cambiarRecibo('valida', asesor, ADMIN, { error: 'e'.repeat(2001) }), '403'],
        ['anotar un error que no es texto', () => cambiarRecibo('valida', asesor, ADMIN, { error: 5 }), '403'],
        ['emisores, que nadie lee todavia', async () => (await consultar('issuers', asesor)).estado, '403'],
        /* Los planes de pensiones y las EPSV (D-11): catálogo aparte, con sesión y sin escritura. */
        ['la lista de planes, con sesion', async () => (await consultarLista('pension_plans', asesor)).estado, '200'],
        ['la lista de planes, SIN sesion', async () => (await consultarLista('pension_plans', null)).estado, '403'],
        ['un plan por su ruta', () => leer(`pension_plans/${plan}`, asesor), '200'],
        ['un plan, SIN sesion', () => leer(`pension_plans/${plan}`, null), '403'],
        ['la serie de un plan', () => leer(`pension_plans/${plan}/series/monthly`, asesor), '200'],
        ['la serie de un plan, SIN sesion', () => leer(`pension_plans/${plan}/series/monthly`, null), '403'],
        ['otra cosa colgando de un plan', () => leer(`pension_plans/${plan}/otra/cosa`, asesor), '403'],
        /* Sobre un id que no existe a propósito: si la regla dejara borrar, no se lleva un plan de verdad. */
        ['borrar un plan, ni el administrador', () => borrarComo('pension_plans/ZZZZZZZZZZ', asesor, ADMIN), '403'],
        /* Los tipos de cambio y el tipo sin riesgo (13-11-2026): los lee el Gestor de carteras desde
           el navegador. Con sesión y sin escritura, y solo esas dos colecciones. */
        ['un tipo de cambio, con sesion', () => leer(`fx_rates/${cambio}`, asesor), '200'],
        ['un tipo de cambio, SIN sesion', () => leer(`fx_rates/${cambio}`, null), '403'],
        ['el tipo sin riesgo, con sesion', () => leer(`reference_rates/${tipo}`, asesor), '200'],
        ['el tipo sin riesgo, SIN sesion', () => leer(`reference_rates/${tipo}`, null), '403'],
        ['algo colgando de un cambio', () => leer(`fx_rates/${cambio}/otra/cosa`, asesor), '403'],
        /* Sobre ids que no existen a propósito: si la regla dejara borrar, no se lleva una serie de verdad. */
        ['borrar un cambio, ni el administrador', () => borrarComo('fx_rates/ZZZ_0000', asesor, ADMIN), '403'],
        ['borrar un tipo, ni el administrador', () => borrarComo('reference_rates/ZZZ_0000', asesor, ADMIN), '403'],
        /* El hallazgo 5 (16-11-2026): sesión, pero sin correo verificado -o sin decirlo-. Con las reglas
           de antes todos estos daban 200, porque bastaba la sesión; ahora, al menos uno por familia. */
        ['catalogo, sin verificar', () => leer('instruments/ES0105836003', asesor, SIN_VERIFICAR), '403'],
        ['catalogo, sin el campo', () => leer('instruments/ES0105836003', asesor, SIN_EL_CAMPO), '403'],
        ['tarjeta por ruta, sin verificar', () => leer('instruments/ES0105836003/read/card', asesor, SIN_VERIFICAR), '403'],
        ['indice, sin verificar', () => leer('search_shards/000', asesor, SIN_VERIFICAR), '403'],
        ['grupo de tarjetas, sin verificar', async () => (await consultar('read', asesor, null, SIN_VERIFICAR)).estado, '403'],
        ['grupo de calidad, sin el campo', async () => (await consultar('quality', asesor, null, SIN_EL_CAMPO)).estado, '403'],
        ['grupo declarados, sin verificar', async () => (await consultar('declared', asesor, null, SIN_VERIFICAR)).estado, '403'],
        ['grupo de trozos, sin el campo', async () => (await consultar('holdings_chunks', asesor, null, SIN_EL_CAMPO)).estado, '403'],
        ['tipo de cambio, sin verificar', () => leer(`fx_rates/${cambio}`, asesor, SIN_VERIFICAR), '403'],
        ['tipo sin riesgo, sin el campo', () => leer(`reference_rates/${tipo}`, asesor, SIN_EL_CAMPO), '403'],
        ['lista de planes, sin verificar', async () => (await consultarLista('pension_plans', asesor, SIN_VERIFICAR)).estado, '403'],
        ['un plan, sin el campo', () => leer(`pension_plans/${plan}`, asesor, SIN_EL_CAMPO), '403'],
        ['serie de un plan, sin verificar', () => leer(`pension_plans/${plan}/series/monthly`, asesor, SIN_VERIFICAR), '403'],
        ['su cartera, sin verificar', () => leer(cartera, asesor, SIN_VERIFICAR), '403'],
        ['su cartera, sin el campo', () => leer(cartera, asesor, SIN_EL_CAMPO), '403'],
        ['sus objetivos, sin verificar', async () => (await consultar('targets', asesor, { campo: CAMPO_DE_ACCESO, valor: asesor }, SIN_VERIFICAR)).estado, '403'],
        ['retro, admin sin verificar', () => leerRetro(`commercial_retro/${retro.existente}`, asesor, ADMIN_SIN_VERIFICAR), '403'],
        ['lista retro, admin sin verificar', async () => (await consultarLista('commercial_retro', asesor, ADMIN_SIN_VERIFICAR)).estado, '403'],
        ['recibos, admin sin verificar', async () => (await consultarLista('commercial_retro_imports', asesor, ADMIN_SIN_VERIFICAR)).estado, '403'],
        /* Los dos sobre el instrumento sin retrocesión, que se borra al final: si la regla dejara pasar,
           no se lleva ni cambia una retrocesión de verdad. */
        ['escribir retro, admin sin verif.', () => escribirRetro(retro.libre, asesor, ADMIN_SIN_VERIFICAR), '403'],
        ['borrar retro, admin sin verif.', () => borrarComo(`commercial_retro/${retro.libre}`, asesor, ADMIN_SIN_VERIFICAR), '403'],
        /* Y la que no necesita emulador: que el cliente filtre por donde la regla concede. */
        [
            'el filtro de la app y la regla',
            async () => {
                const campo = campoQueFiltraLaApp();
                return campo === CAMPO_DE_ACCESO || campo.startsWith(`${CAMPO_DE_ACCESO} `) ? CAMPO_DE_ACCESO : campo;
            },
            CAMPO_DE_ACCESO
        ]
    ];

    let fallos = 0;
    try {
        for (const [nombre, hacer, esperado] of casos) {
            const obtenido = await hacer();
            const bien = obtenido === esperado;
            if (!bien) fallos += 1;
            console.log(
                `${nombre.padEnd(34)} esperado ${esperado.padStart(16)}  ` +
                    `obtenido ${obtenido.padStart(16)}  ${bien ? 'ok' : 'FALLA'}`
            );
        }
    } finally {
        /* Se borra pase lo que pase: la base nueva persiste en disco y una cartera de prueba
           olvidada rompería la auditoría de contratos, que es quien dice que la base está
           entera. */
        await borrar(`portfolios/${CARTERA_AJENA}/targets/${INSTRUMENTO_AJENO}`);
        await borrar(`portfolios/${CARTERA_AJENA}`);
        await borrar(`commercial_retro/${retro.libre}`);
        for (const ruta of BLOQUES_FUERA_DEL_CATALOGO) await borrar(ruta);
        await borrar(`clients/${CLIENTE_DE_PRUEBA}`);
        for (const id of recibosCreados) await borrar(`commercial_retro_imports/${id}`);
    }

    console.log('');
    console.log(fallos === 0 ? 'Las reglas hacen lo que dicen.' : `${fallos} casos no cuadran.`);
    process.exit(fallos === 0 ? 0 : 1);
}

await main();
