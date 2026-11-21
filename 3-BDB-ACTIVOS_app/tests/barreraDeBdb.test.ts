// @vitest-environment node
/**
 * La prueba que barre los repositorios (decisión 106, 05-11-2026). Es la regla que no se rompe de
 * `AGENTS.md`: no se escribe nunca en BDB, ni en su carpeta ni en su proyecto Firebase.
 *
 * Hasta hoy la vigilaban dos pruebas, una por paquete, y ninguna miraba `scripts/` de la app, `sites/`,
 * `ops/`, `4-base-nueva` ni `1-extractor`. Medido el 05-11: quedaban 11 programas que escribirían en BDB
 * con su opción de escribir, y 4 de ellos sin nombrarlo: dos lo heredaban de otro programa, y dos de la
 * clave de servicio que encontrasen. Así que esta prueba no busca solo el nombre. Busca cuatro cosas, con
 * `git grep` sobre lo versionado y lo nuevo sin ignorar:
 *
 *   1. El id y el número del proyecto de BDB, en código y configuración: solo en la lista de abajo, con su
 *      razón y con cuántas líneas. Una línea de más en un fichero declarado también falla, y una entrada
 *      que ya no aparece, igual: la lista no puede quedarse con restos.
 *   2. Todo cliente de base en código recibe el proyecto de la constante: `master_project.py` en Python y
 *      `projectAllowlist.ts` en TypeScript. Lo que no, declarado y con la marca que lo hace seguro.
 *   3. Las órdenes contra BDB (su proyecto en una línea de órdenes, o un `cd` a su carpeta), solo dentro
 *      de `docs/historico-bdb/` de cada repositorio. Allí, cada documento dice arriba que no se ejecuta.
 *   4. Ningún repositorio anidado: un repositorio dentro de otro no lo ve ningún `git grep`.
 *
 * No hace falta que el fichero esté en un commit para que lo vea. No lee lo ignorado por Git, como los
 * `.env`: de eso se ocupan `master_project.py`, que rechaza el id venga de donde venga, y
 * `functions_python/tests/test_master_project.py`.
 *
 * Los dos ids se montan por trozos para que este fichero no se encuentre a sí mismo.
 *
 * Desde el 10-11-2026 los cuatro repositorios son uno (`PLAN_UNIFICAR_REPOSITORIOS_2026-11-10.md`). Se
 * siguen barriendo cuatro partes, con los mismos nombres, porque las listas de abajo declaran por parte: la
 * raíz sin las tres carpetas, y cada carpeta con sus rutas relativas a ella.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 60_000 });

const ID_DE_BDB = ["bbdd", "activos", "financieros"].join("-");
const NUMERO_DE_BDB = ["6247", "4712", "3295"].join("");
const HISTORICO = "docs/historico-bdb/";
const LINEA_DEL_HISTORICO = "> **Histórico de BDB: no se ejecuta.**";

const APP = process.cwd();
const RAIZ = resolve(APP, "..");

const REPOSITORIOS: Record<string, string> = {
  raiz: RAIZ,
  "1-extractor": join(RAIZ, "1-extractor"),
  "2-plataforma-datos": join(RAIZ, "2-plataforma-datos"),
  "3-BDB-ACTIVOS_app": APP,
};

const CARPETAS = ["1-extractor", "2-plataforma-datos", "3-BDB-ACTIVOS_app"];
/** La raíz se barre sin las tres carpetas: cada una se barre por su cuenta. */
const SIN_LAS_CARPETAS = CARPETAS.map((carpeta) => `:(exclude,top)${carpeta}`);
const acotar = (repo: string, rutas: string[]) => (repo === "raiz" ? [...rutas, ...SIN_LAS_CARPETAS] : rutas);

/**
 * Cuántos ficheros ve Git en cada parte. Antes se miraba si cada carpeta tenía su `.git`; con un solo
 * repositorio eso dejaba la lista vacía, y las pruebas que la recorren pasaban sin mirar nada.
 */
function ficherosQueVeGit(repo: string): number {
  if (!existsSync(REPOSITORIOS[repo])) return 0;
  try {
    const salida = execFileSync("git", ["-C", REPOSITORIOS[repo], "ls-files", "--", ...acotar(repo, ["."])], {
      encoding: "utf8",
      maxBuffer: 1 << 28,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return salida.split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}
const VISTOS: Record<string, number> = Object.fromEntries(Object.keys(REPOSITORIOS).map((nombre) => [nombre, ficherosQueVeGit(nombre)]));
const PRESENTES = Object.keys(REPOSITORIOS).filter((nombre) => VISTOS[nombre] > 0);
/**
 * Lo mínimo que tiene que ver en cada parte. Medido el 10-11-2026: raíz 61, extractor 320, plataforma 687, app 1.257.
 * Medido otra vez el 17-11-2026, después de borrar el código heredado (decisión A-160): raíz 268, extractor 341,
 * plataforma 396, app 1.751. La plataforma bajó de 400 por el borrado, no porque el barrido dejara de verla, y su
 * mínimo pasa a 250, como los demás por debajo de dos tercios de lo medido.
 */
const MINIMO_VISTO: Record<string, number> = { raiz: 30, "1-extractor": 200, "2-plataforma-datos": 250, "3-BDB-ACTIVOS_app": 800 };

interface Aparicion {
  repo: string;
  fichero: string;
  numero: number;
  texto: string;
}

function barre(repo: string, patron: string, rutas: string[] = ["."]): Aparicion[] {
  let salida: string;
  try {
    salida = execFileSync(
      "git",
      ["-C", REPOSITORIOS[repo], "-c", "core.quotepath=off", "grep", "--untracked", "-I", "-n", "-E", "-e", patron, "--", ...acotar(repo, rutas)],
      { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (error) {
    if ((error as { status?: number }).status === 1) return []; // git grep: sin coincidencias.
    throw error;
  }
  return salida
    .split("\n")
    .filter(Boolean)
    .map((linea) => {
      const fin = linea.indexOf(":");
      const finNumero = linea.indexOf(":", fin + 1);
      return { repo, fichero: linea.slice(0, fin), numero: Number(linea.slice(fin + 1, finNumero)), texto: linea.slice(finNumero + 1) };
    });
}

const barreTodos = (patron: string, rutas?: string[]) => PRESENTES.flatMap((repo) => barre(repo, patron, rutas));
const clave = (repo: string, fichero: string) => `${repo}/${fichero}`;
const esHistorico = (fichero: string) => fichero.startsWith(HISTORICO) || fichero.includes(`/${HISTORICO}`);
const leer = (repo: string, fichero: string) => readFileSync(join(REPOSITORIOS[repo], fichero), "utf8");

/** Código y configuración donde el id de BDB puede aparecer: cuántas líneas, y por qué. */
const ID_DECLARADO: Array<{ repo: string; fichero: string; lineas: number; razon: string }> = [
  // La barrera: lo nombran para negarlo.
  { repo: "3-BDB-ACTIVOS_app", fichero: "functions_python/master_project.py", lineas: 2, razon: "La constante que lo rechaza, y su historia en la cabecera." },
  { repo: "2-plataforma-datos", fichero: "src/config/projectAllowlist.ts", lineas: 1, razon: "La cabecera de la allowlist explica de dónde viene la barrera." },
  { repo: "3-BDB-ACTIVOS_app", fichero: "src/firebaseEnv.ts", lineas: 1, razon: "La app no arranca si su configuración web apunta a BDB." },
  { repo: "3-BDB-ACTIVOS_app", fichero: "scripts/requireFirebaseDeployApproval.mjs", lineas: 1, razon: "La puerta del despliegue, para decir que ese destino es BDB." },
  { repo: "3-BDB-ACTIVOS_app", fichero: "scripts/smokeFirestoreRulesNoAuth.mjs", lineas: 1, razon: "Su proyecto sale de los .env: se niega si es el de BDB." },
  { repo: "raiz", fichero: "4-base-nueva/puerta-despliegue.mjs", lineas: 1, razon: "La puerta del despliegue de la base nueva, igual." },
  { repo: "2-plataforma-datos", fichero: "scripts/restoreBackupToEmulator.ts", lineas: 1, razon: "Prohibido en un ensayo de restauración." },
  { repo: "2-plataforma-datos", fichero: "scripts/runBackupExport.ts", lineas: 1, razon: "Prohibido en una copia." },
  { repo: "2-plataforma-datos", fichero: "scripts/subirALaNube.ts", lineas: 1, razon: "Niega una clave de servicio de BDB antes de subir." },
  { repo: "2-plataforma-datos", fichero: "scripts/verReglasDesplegadas.ts", lineas: 1, razon: "Niega una clave de servicio de BDB antes de leer." },
  { repo: "1-extractor", fichero: "tools/sync_historicos.py", lineas: 1, razon: "Abre el proyecto de la clave que le pasen: niega una de BDB." },
  // Ejemplos que dicen que no.
  { repo: "3-BDB-ACTIVOS_app", fichero: ".env.example", lineas: 2, razon: "Avisa de que no se pongan aquí sus credenciales ni su configuración." },
  { repo: "2-plataforma-datos", fichero: ".env.example", lineas: 1, razon: "Avisa de que ese proyecto se rechaza." },
  // Sin efecto.
  { repo: "3-BDB-ACTIVOS_app", fichero: "firebase.json", lineas: 1, razon: "La CSP de una carpeta que no despliega: la puerta lo rechaza todo, y `4-base-nueva` la copia cambiando ese dominio." },
  { repo: "2-plataforma-datos", fichero: "src/config/baseNueva/asesores.ts", lineas: 1, razon: "Comentario: de qué proyecto venía el uid de origen de las carteras." },
  // Las pruebas de la barrera.
  { repo: "3-BDB-ACTIVOS_app", fichero: "functions_python/tests/test_master_project.py", lineas: 4, razon: "Prueba de la constante, con el id escrito a mano." },
  { repo: "3-BDB-ACTIVOS_app", fichero: "tests/authGateApuntaABdb.test.tsx", lineas: 1, razon: "Prueba de que el portón no deja pasar." },
  { repo: "3-BDB-ACTIVOS_app", fichero: "tests/firebaseHostingSecurity.test.ts", lineas: 4, razon: "Prueba de la puerta y de la CSP." },
  { repo: "raiz", fichero: "4-base-nueva/probar-puerta.mjs", lineas: 3, razon: "Prueba de la puerta de la base nueva." },
  { repo: "2-plataforma-datos", fichero: "tests/baseNuevaWriter.test.ts", lineas: 1, razon: "Prueba de que el escritor lo rechaza." },
  { repo: "2-plataforma-datos", fichero: "tests/projectAllowlist.test.ts", lineas: 1, razon: "Prueba de la allowlist." },
  { repo: "1-extractor", fichero: "tests/test_sync_historicos_barrera.py", lineas: 1, razon: "Prueba de la negativa de `sync_historicos`." },
];

/**
 * Clientes que no pueden tomar el proyecto de la constante. `marca` es lo que los hace seguros, y tiene que
 * estar en el fichero: si alguien la quita, la prueba falla.
 */
const CLIENTE_DECLARADO: Array<{ repo: string; fichero: string; marca: string; razon: string }> = [
  { repo: "3-BDB-ACTIVOS_app", fichero: "functions_python/main.py", marca: "exigir_arranque_sin_bdb()", razon: "La app del proyecto propio, en el runtime de Functions. Se niega antes de inicializarla si algo nombra a BDB." },
  { repo: "3-BDB-ACTIVOS_app", fichero: "functions_python/portfolios/store.py", marca: "firestore.client()", razon: "Cliente por defecto de esa app: `main.py` ya se ha negado." },
  { repo: "3-BDB-ACTIVOS_app", fichero: "functions_python/weekly_report.py", marca: "firestore.client()", razon: "Cliente por defecto de esa app: `main.py` ya se ha negado." },
  { repo: "3-BDB-ACTIVOS_app", fichero: "scripts/set_admin.py", marca: "exigir_proyecto_permitido(proj", razon: "El proyecto de Auth llega por `--project`: pasa por la misma comprobación." },
  { repo: "3-BDB-ACTIVOS_app", fichero: "scripts/smokeCommercialRetroRules.mjs", marca: 'projectId.startsWith("demo-")', razon: "Solo arranca con un proyecto `demo-` y emuladores en local." },
  { repo: "3-BDB-ACTIVOS_app", fichero: "scripts/smokeFirestoreRulesNoAuth.mjs", marca: "firebaseConfig.projectId === PROYECTO_DE_BDB", razon: "Su proyecto sale de los .env, y niega el de BDB." },
  { repo: "3-BDB-ACTIVOS_app", fichero: "src/firebase.ts", marca: "FIREBASE_CONFIGURED", razon: "El navegador: `firebaseEnv.ts` da por no configurado el proyecto de BDB." },
  { repo: "raiz", fichero: "4-base-nueva/quien_entra.py", marca: "AnonymousCredentials()", razon: "Solo lee, de la base nueva en el emulador, y con credenciales anónimas." },
  { repo: "1-extractor", fichero: "tools/sync_historicos.py", marca: "cred.project_id == PROYECTO_DE_BDB", razon: "Abre el proyecto de la clave que le pasen, de otra base y solo para leer: niega una de BDB." },
  { repo: "2-plataforma-datos", fichero: "scripts/restoreBackupToEmulator.ts", marca: "FIRESTORE_EMULATOR_HOST debe apuntar a localhost", razon: "Solo contra un emulador local, y con el proyecto de BDB prohibido." },
];

/** Citan una orden para negarla. Ninguna se puede seguir: dicen «nunca». */
const ORDEN_NEGADA: Array<{ repo: string; fichero: string; lineas: number }> = [
  { repo: "raiz", fichero: ".claude/skills/pipeline-extractor/SKILL.md", lineas: 1 },
  { repo: "raiz", fichero: "ENCARGO_SIN_METRICAS_2026-11-03.md", lineas: 1 },
  { repo: "raiz", fichero: "ENCARGO_TERCER_ESTIMADOR_2026-11-03.md", lineas: 1 },
];

/** Decisión 107: la web de estudio ya no vive aquí. Esta lista se queda vacía. */
const ANIDADOS_PENDIENTES_DE_MOVER: string[] = [];

const noEsPrueba = (fichero: string) => !/(^|\/)tests?\//.test(fichero) && !/\.test\.[a-z]+$/.test(fichero) && !/(^|\/)test_[^/]*$/.test(fichero);

/**
 * SEG-5 (auditoría del 16-11-2026): el código de un fichero de TypeScript o JavaScript sin sus comentarios. Antes bastaba con
 * que el fichero nombrase la allowlist dos veces, aunque fuese en un comentario. Recorre las cadenas ('', "" y ``) sin mirar
 * dentro, para que el `//` de una URL no se tome por comentario. No es un analizador completo: una expresión regular con
 * `//` sin escapar (que no es válida) o un `${`…`}` con comillas invertidas dentro lo engañarían, y ninguna de las dos aparece.
 */
function sinComentarios(fuente: string): string {
  let codigo = "";
  let i = 0;
  while (i < fuente.length) {
    const c = fuente[i];
    const siguiente = fuente[i + 1];
    if (c === "/" && siguiente === "/") {
      const fin = fuente.indexOf("\n", i);
      i = fin < 0 ? fuente.length : fin;
    } else if (c === "/" && siguiente === "*") {
      const fin = fuente.indexOf("*/", i + 2);
      i = fin < 0 ? fuente.length : fin + 2;
      codigo += " ";
    } else if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      while (j < fuente.length && fuente[j] !== c && !(c !== "`" && fuente[j] === "\n")) j += fuente[j] === "\\" ? 2 : 1;
      codigo += fuente.slice(i, j + 1);
      i = j + 1;
    } else {
      codigo += c;
      i += 1;
    }
  }
  return codigo;
}

describe("la barrera de BDB barre los repositorios", () => {
  it("están las cuatro partes del repositorio, y Git ve ficheros en cada una", () => {
    if (process.env.CI) return;
    expect(PRESENTES).toEqual(Object.keys(REPOSITORIOS));
    /* Un barrido que no ve nada no protege: cada parte tiene que traer sus ficheros. */
    const pocos = Object.keys(REPOSITORIOS).filter((nombre) => VISTOS[nombre] <= MINIMO_VISTO[nombre]);
    expect(pocos.map((nombre) => `${nombre}: ${VISTOS[nombre]}`)).toEqual([]);
  });

  it("la raíz se barre sin las tres carpetas, y ninguna parte ve los ficheros de otra", () => {
    const deLaRaiz = barre("raiz", ".", ["*.md", "*.mjs", "*.json"]).map(({ fichero }) => fichero);
    expect(deLaRaiz.length).toBeGreaterThan(0);
    expect(deLaRaiz.filter((fichero) => CARPETAS.some((carpeta) => fichero.startsWith(`${carpeta}/`)))).toEqual([]);
    /* Dentro de una carpeta, las rutas son relativas a ella: así las declaran las listas. */
    const deLaApp = barre("3-BDB-ACTIVOS_app", "exigir_arranque_sin_bdb", ["functions_python/main.py"]).map(({ fichero }) => fichero);
    expect(new Set(deLaApp)).toEqual(new Set(["functions_python/main.py"]));
  });

  it("el id de BDB solo aparece en código y configuración donde está declarado, con su razón", () => {
    const aparecen = new Map<string, number>();
    for (const { repo, fichero } of barreTodos(ID_DE_BDB)) {
      if (fichero.endsWith(".md") || esHistorico(fichero)) continue;
      aparecen.set(clave(repo, fichero), (aparecen.get(clave(repo, fichero)) ?? 0) + 1);
    }
    const declarado = new Map(
      ID_DECLARADO.filter(({ repo }) => PRESENTES.includes(repo)).map(({ repo, fichero, lineas }) => [clave(repo, fichero), lineas]),
    );
    expect(Object.fromEntries([...aparecen].sort())).toEqual(Object.fromEntries([...declarado].sort()));
  });

  it("el número de proyecto de BDB no aparece en ningún sitio fuera del histórico", () => {
    const fuera = barreTodos(NUMERO_DE_BDB).filter(({ fichero }) => !esHistorico(fichero));
    expect(fuera.map(({ repo, fichero, numero }) => `${clave(repo, fichero)}:${numero}`)).toEqual([]);
  });

  it("cada declaración da su razón", () => {
    const sinRazon = [...ID_DECLARADO, ...CLIENTE_DECLARADO].filter(({ razon }) => razon.trim().length < 10);
    expect(sinRazon).toEqual([]);
  });

  it("todo cliente de base en Python recibe el proyecto de la constante, o está declarado con lo que lo hace seguro", () => {
    /* SEG-5 (auditoría del 16-11-2026): faltaban el cliente asíncrono, el de `firestore_v1` y el `Client(` importado suelto
       (`from google.cloud.firestore import Client`). Ninguno aparece hoy; si apareciera, tendría que pasar por la constante. */
    const CLIENTES = "firestore\\.Client\\(|gcf\\.Client\\(|firestore\\.client\\(|initialize_app\\(|(^|[^.A-Za-z_])(Async)?Client\\(|firestore\\.AsyncClient\\(|firestore_v1\\.(Async)?Client\\(";
    const culpables = new Set<string>();
    const vistos = new Set<string>();
    for (const { repo, fichero, texto } of barreTodos(CLIENTES, ["*.py"])) {
      if (!noEsPrueba(fichero) || esHistorico(fichero)) continue;
      vistos.add(clave(repo, fichero));
      if (CLIENTE_DECLARADO.some((c) => c.repo === repo && c.fichero === fichero)) continue;
      const fuente = leer(repo, fichero);
      const conConstante = /Client\(|initialize_app\(/.test(texto)
        ? texto.includes("master_project_id()")
        : fuente.includes('initialize_app(options={"projectId": master_project_id()})');
      if (!conConstante) culpables.add(`${clave(repo, fichero)} -> ${texto.trim()}`);
    }
    expect([...culpables]).toEqual([]);
    expect(vistos.size).toBeGreaterThan(0);
  });

  it("todo cliente de base en TypeScript y JavaScript comprueba el proyecto contra la allowlist, o está declarado", () => {
    const culpables = new Set<string>();
    const vistos = new Set<string>();
    /* SEG-5: también `initializeFirestore(`, que crea el cliente sin pasar por `getFirestore`. */
    for (const { repo, fichero, texto } of barreTodos("initializeApp\\(|new Firestore\\(|getFirestore\\(|initializeFirestore\\(", ["*.ts", "*.tsx", "*.mjs", "*.js", "*.cjs"])) {
      if (!noEsPrueba(fichero) || esHistorico(fichero)) continue;
      vistos.add(clave(repo, fichero));
      if (CLIENTE_DECLARADO.some((c) => c.repo === repo && c.fichero === fichero)) continue;
      // SEG-5: se cuenta en el código, no en los comentarios. Nombrarla en un comentario no comprueba nada.
      const codigo = sinComentarios(leer(repo, fichero));
      const usos = codigo.match(/\b(isAllowedProjectId|ALLOWED_PROJECT_IDS?|PROYECTO_BASE_NUEVA)\b/g) ?? [];
      // Una vez es el import. Importarla y no usarla no protege nada.
      if (!codigo.includes("projectAllowlist") || usos.length < 2) culpables.add(`${clave(repo, fichero)} -> ${texto.trim()}`);
    }
    expect([...culpables]).toEqual([]);
    expect(vistos.size).toBeGreaterThan(0);
  });

  it("SEG-5: la allowlist nombrada solo en comentarios no cuenta, y en cadenas y URLs no se confunde con un comentario", () => {
    const soloEnComentarios = [
      "// importa projectAllowlist y llama a isAllowedProjectId",
      "/* isAllowedProjectId(proyecto) y ALLOWED_PROJECT_ID */",
      "import { getFirestore } from 'firebase-admin/firestore';",
      "export const db = getFirestore();",
    ].join("\n");
    expect(sinComentarios(soloEnComentarios)).not.toMatch(/projectAllowlist|isAllowedProjectId|ALLOWED_PROJECT_ID/);
    const enCodigo = [
      "import { isAllowedProjectId } from '../src/config/projectAllowlist'; // el import",
      "const url = 'http://localhost:8092'; /* una URL no abre un comentario */",
      'if (!isAllowedProjectId(proyecto)) throw new Error("// tampoco esto");',
    ].join("\n");
    const codigo = sinComentarios(enCodigo);
    expect(codigo.match(/\bisAllowedProjectId\b/g)).toHaveLength(2);
    expect(codigo).toContain("projectAllowlist");
    expect(codigo).toContain("'http://localhost:8092'");
    expect(codigo).toContain('"// tampoco esto"');
    expect(codigo).not.toContain("el import");
    expect(codigo).not.toContain("una URL no abre");
  });

  it("los clientes declarados siguen existiendo y conservan lo que los hace seguros", () => {
    const fallan: string[] = [];
    for (const { repo, fichero, marca } of CLIENTE_DECLARADO) {
      if (!PRESENTES.includes(repo)) continue;
      const ruta = join(REPOSITORIOS[repo], fichero);
      if (!existsSync(ruta)) fallan.push(`${clave(repo, fichero)}: ya no existe, quítalo de la lista`);
      else if (!readFileSync(ruta, "utf8").includes(marca)) fallan.push(`${clave(repo, fichero)}: ya no dice ${marca}`);
    }
    expect(fallan).toEqual([]);
  });

  it("una orden contra BDB solo está dentro del histórico", () => {
    const ORDENES = [
      `--project[= ]+["']?${ID_DE_BDB}`,
      `FIREBASE_PROJECT_ID *[=:] *["']?${ID_DE_BDB}`,
      `(gcloud|firebase) .*${ID_DE_BDB}`,
      "(^|[^a-zA-Z])(cd|Set-Location|git -C|Move-Item|New-Item|mkdir) .*Proyectos[\\/]+BDB",
    ].join("|");
    const fuera = new Map<string, number>();
    for (const { repo, fichero } of barreTodos(ORDENES)) {
      if (esHistorico(fichero)) continue;
      fuera.set(clave(repo, fichero), (fuera.get(clave(repo, fichero)) ?? 0) + 1);
    }
    const negadas = new Map(
      ORDEN_NEGADA.filter(({ repo }) => PRESENTES.includes(repo)).map(({ repo, fichero, lineas }) => [clave(repo, fichero), lineas]),
    );
    expect(Object.fromEntries([...fuera].sort())).toEqual(Object.fromEntries([...negadas].sort()));
  });

  it("cada documento del histórico dice arriba que no se ejecuta", () => {
    const sinLinea: string[] = [];
    let documentos = 0;
    for (const repo of PRESENTES) {
      const salida = execFileSync("git", ["-C", REPOSITORIOS[repo], "-c", "core.quotepath=off", "ls-files", "--cached", "--others", "--exclude-standard", "--", ...acotar(repo, ["*.md"])], {
        encoding: "utf8",
        maxBuffer: 1 << 28,
      });
      for (const fichero of salida.split("\n").filter((f) => f && esHistorico(f))) {
        if (!existsSync(join(REPOSITORIOS[repo], fichero))) continue;
        documentos += 1;
        if (!leer(repo, fichero).startsWith(LINEA_DEL_HISTORICO)) sinLinea.push(clave(repo, fichero));
      }
    }
    expect(sinLinea).toEqual([]);
    expect(documentos).toBeGreaterThan(0);
  });

  it("ningún repositorio lleva otro dentro, y en sites/ no queda nada más", () => {
    const anidados = PRESENTES.flatMap((repo) =>
      execFileSync("git", ["-C", REPOSITORIOS[repo], "ls-files", "-s", "--", ...acotar(repo, ["."])], { encoding: "utf8", maxBuffer: 1 << 28 })
        .split("\n")
        .filter((linea) => linea.startsWith("160000 "))
        .map((linea) => `${repo}/${linea.split("\t")[1]}`),
    );
    expect(anidados).toEqual(ANIDADOS_PENDIENTES_DE_MOVER.map((ruta) => `3-BDB-ACTIVOS_app/${ruta}`));
    /* Una carpeta con su propio `.git` volvería a ser un repositorio dentro de otro: Git dejaría de ver sus ficheros, y el barrido con él. */
    expect(CARPETAS.filter((carpeta) => existsSync(join(RAIZ, carpeta, ".git")))).toEqual([]);

    const sites = join(APP, "sites");
    const enSites = existsSync(sites) ? readdirSync(sites).map((nombre) => `sites/${nombre}`) : [];
    expect(enSites).toEqual(ANIDADOS_PENDIENTES_DE_MOVER);
  });

  it("los dos proyectos permitidos son los mismos en Python, en TypeScript y en los dos .firebaserc", () => {
    const python = readFileSync(join(APP, "functions_python", "master_project.py"), "utf8");
    const baseDeSiempre = /^PROYECTO_BASE_DE_SIEMPRE = "([^"]+)"/m.exec(python)?.[1];
    const baseNueva = /^PROYECTO_BASE_NUEVA = "([^"]+)"/m.exec(python)?.[1];
    expect(/^PROYECTOS_PERMITIDOS = \(PROYECTO_BASE_DE_SIEMPRE, PROYECTO_BASE_NUEVA\)$/m.test(python)).toBe(true);
    expect(baseDeSiempre).toBe("gestor-activos-local");
    expect(baseNueva).toBe("bdb-gestor-de-activos");
    expect(baseNueva).not.toBe(ID_DE_BDB);

    const firebaserc = JSON.parse(readFileSync(join(APP, ".firebaserc"), "utf8")) as { projects: { default: string } };
    expect(firebaserc.projects.default).toBe(baseDeSiempre);
    expect(/export const PROYECTO = "([^"]+)"/.exec(readFileSync(join(APP, "scripts", "desplegarFunciones.mjs"), "utf8"))?.[1]).toBe(baseNueva);

    if (PRESENTES.includes("2-plataforma-datos")) {
      const ts = readFileSync(join(REPOSITORIOS["2-plataforma-datos"], "src", "config", "projectAllowlist.ts"), "utf8");
      expect(/export const ALLOWED_PROJECT_ID = '([^']+)'/.exec(ts)?.[1]).toBe(baseDeSiempre);
      expect(/export const PROYECTO_BASE_NUEVA = '([^']+)'/.exec(ts)?.[1]).toBe(baseNueva);
    }
    if (PRESENTES.includes("raiz")) {
      const nueva = JSON.parse(readFileSync(join(RAIZ, "4-base-nueva", ".firebaserc"), "utf8")) as { projects: { default: string } };
      expect(nueva.projects.default).toBe(baseNueva);
    }
  });
});
