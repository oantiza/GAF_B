# -*- coding: utf-8 -*-
"""C-1 (auditoria 03-11-2026): el proyecto de la maestra no se resuelve en silencio.

La barrera 7 del clon era la unica que no estaba en codigo: el id del proyecto se
resolvia con un defecto en doce ficheros, y en ocho de ellos ese defecto era
`bbdd-activos-financieros`, el proyecto real de BDB. Medido corriendo estas pruebas
contra el arbol de HEAD: las dos ultimas fallan alli y nombran a los doce y a los ocho. La pregunta de este proyecto
-que tendria que pasar para que esta comprobacion fallara- no tenia respuesta: nada.

Estas pruebas tienen respuesta. La ultima es la que importa a largo plazo: falla si
alguien vuelve a escribir un defecto para esta variable en cualquier fichero del
paquete, que es como entro el defecto la primera vez.
"""
import ast
import io
import os
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest  # noqa: E402

import master_project  # noqa: E402

RAIZ = Path(__file__).resolve().parents[1]


def _dotenv(tmp_path, contenido):
    ruta = tmp_path / ".env"
    ruta.write_text(contenido, encoding="utf-8")
    return str(ruta)


def test_sin_la_variable_aborta_nombrando_lo_que_falta(monkeypatch, tmp_path):
    monkeypatch.delenv(master_project.VARIABLE, raising=False)
    monkeypatch.setattr(master_project, "RUTA_DOTENV", _dotenv(tmp_path, "# vacio\n"))
    with pytest.raises(RuntimeError) as exc:
        master_project.master_project_id()
    mensaje = str(exc.value)
    assert master_project.VARIABLE in mensaje
    assert "no esta declarado" in mensaje
    # Y nombra donde declararlo, que es la mitad util de un error.
    assert ".env" in mensaje


def test_una_variable_vacia_cuenta_como_ausente(monkeypatch, tmp_path):
    monkeypatch.setenv(master_project.VARIABLE, "   ")
    monkeypatch.setattr(master_project, "RUTA_DOTENV", _dotenv(tmp_path, "# vacio\n"))
    with pytest.raises(RuntimeError):
        master_project.master_project_id()


def test_con_la_variable_resuelve_lo_declarado(monkeypatch):
    monkeypatch.setenv(master_project.VARIABLE, "gestor-activos-local")
    assert master_project.master_project_id() == "gestor-activos-local"


def test_lee_el_dotenv_de_al_lado_cuando_la_variable_falta(monkeypatch, tmp_path):
    monkeypatch.delenv(master_project.VARIABLE, raising=False)
    monkeypatch.setattr(
        master_project, "RUTA_DOTENV",
        _dotenv(tmp_path, "# comentario\nMASTER_PROJECT_ID=gestor-activos-local\n"),
    )
    assert master_project.master_project_id() == "gestor-activos-local"


def test_el_entorno_manda_sobre_el_dotenv(monkeypatch, tmp_path):
    monkeypatch.setenv(master_project.VARIABLE, "bdb-gestor-de-activos")
    monkeypatch.setattr(
        master_project, "RUTA_DOTENV",
        _dotenv(tmp_path, "MASTER_PROJECT_ID=gestor-activos-local\n"),
    )
    assert master_project.master_project_id() == "bdb-gestor-de-activos"


# --- Decision 106 (05-11-2026): las dos direcciones. Los dos de aqui pasan y nadie mas. ----

# Escrito a mano y no leido del modulo: si alguien cambia la constante, esto tiene que fallar.
BDB = "bbdd-activos-financieros"


@pytest.mark.parametrize("proyecto", ["gestor-activos-local", "bdb-gestor-de-activos"])
def test_los_dos_de_este_proyecto_pasan(monkeypatch, proyecto):
    monkeypatch.setenv(master_project.VARIABLE, proyecto)
    assert master_project.master_project_id() == proyecto


def test_los_permitidos_son_exactamente_dos_y_bdb_no_esta():
    assert set(master_project.PROYECTOS_PERMITIDOS) == {"gestor-activos-local", "bdb-gestor-de-activos"}
    assert BDB not in master_project.PROYECTOS_PERMITIDOS


@pytest.mark.parametrize("declarado", [BDB, "  %s  " % BDB, BDB.upper(), "projects/%s" % BDB])
def test_el_id_de_bdb_se_rechaza_aunque_lo_declare_el_entorno(monkeypatch, tmp_path, declarado):
    monkeypatch.setenv(master_project.VARIABLE, declarado)
    # Con un .env bueno al lado: el entorno manda, y aqui el entorno es lo que esta mal.
    monkeypatch.setattr(
        master_project, "RUTA_DOTENV", _dotenv(tmp_path, "MASTER_PROJECT_ID=gestor-activos-local\n"),
    )
    with pytest.raises(RuntimeError) as exc:
        master_project.master_project_id()
    mensaje = str(exc.value)
    assert "BDB" in mensaje and master_project.VARIABLE in mensaje
    # Y dice cuales valen, que es la mitad util de un error.
    assert "gestor-activos-local" in mensaje and "bdb-gestor-de-activos" in mensaje


def test_un_env_de_bdb_colado_por_accidente_no_abre_nada(monkeypatch, tmp_path):
    """Un .env copiado de BDB, con su proyecto y sus puertas abiertas."""
    monkeypatch.delenv(master_project.VARIABLE, raising=False)
    monkeypatch.delenv("BDB_ACTIVOS_ENABLE_MASTER_WRITES", raising=False)
    monkeypatch.setattr(
        master_project, "RUTA_DOTENV",
        _dotenv(
            tmp_path,
            "MASTER_PROJECT_ID=%s\nBDB_ACTIVOS_ENABLE_MASTER_WRITES=YES_I_UNDERSTAND_MASTER_DB_WRITES\n" % BDB,
        ),
    )
    with pytest.raises(RuntimeError, match="se ha colado"):
        master_project.master_project_id()
    # La puerta de ese .env no ha entrado en el proceso: solo se lee la clave de la barrera.
    assert "BDB_ACTIVOS_ENABLE_MASTER_WRITES" not in os.environ
    # cargar_dotenv deja la variable puesta: la siguiente llamada tiene que seguir negandose.
    with pytest.raises(RuntimeError, match="se ha colado"):
        master_project.master_project_id()


@pytest.mark.parametrize("otro", ["otro-proyecto", "del-entorno", "demo-bdb-audit", "gestor-activos-local2"])
def test_un_tercer_proyecto_tampoco_pasa(monkeypatch, otro):
    monkeypatch.setenv(master_project.VARIABLE, otro)
    with pytest.raises(RuntimeError) as exc:
        master_project.master_project_id()
    assert "solo valen" in str(exc.value) and otro in str(exc.value)


def test_el_numero_de_proyecto_de_bdb_tampoco_pasa(monkeypatch):
    monkeypatch.setenv(master_project.VARIABLE, "6247" + "47123295")
    with pytest.raises(RuntimeError, match="solo valen"):
        master_project.master_project_id()


def test_exigir_proyecto_nombra_de_donde_viene_el_valor():
    assert master_project.exigir_proyecto_permitido("bdb-gestor-de-activos", "--project") == "bdb-gestor-de-activos"
    with pytest.raises(RuntimeError, match="--project"):
        master_project.exigir_proyecto_permitido(BDB, "--project")
    with pytest.raises(RuntimeError, match="--project"):
        master_project.exigir_proyecto_permitido("", "--project")


@pytest.mark.parametrize("variable", master_project.VARIABLES_DEL_ARRANQUE)
def test_el_arranque_se_niega_si_algo_nombra_a_bdb(variable):
    valor = "bdb-functions-reader@%s.iam.gserviceaccount.com" % BDB
    with pytest.raises(RuntimeError) as exc:
        master_project.exigir_arranque_sin_bdb({variable: valor})
    assert variable in str(exc.value) and "BDB" in str(exc.value)


def test_el_arranque_no_cambia_con_el_proyecto_de_hoy_ni_sin_nada():
    master_project.exigir_arranque_sin_bdb({})
    master_project.exigir_arranque_sin_bdb({
        "GCLOUD_PROJECT": "bdb-gestor-de-activos",
        "GOOGLE_CLOUD_PROJECT": "bdb-gestor-de-activos",
        "FIREBASE_CONFIG": '{"projectId":"bdb-gestor-de-activos"}',
        "MASTER_PROJECT_ID": "bdb-gestor-de-activos",
    })
    master_project.exigir_arranque_sin_bdb({
        "GCLOUD_PROJECT": "gestor-activos-local",
        "MASTER_PROJECT_ID": "gestor-activos-local",
    })


def _importar_main(proyecto):
    entorno = {k: v for k, v in os.environ.items() if k not in master_project.VARIABLES_DEL_ARRANQUE}
    entorno["GCLOUD_PROJECT"] = proyecto
    return subprocess.run(
        [sys.executable, "-c", "import main"],
        cwd=str(RAIZ), env=entorno, capture_output=True, text=True, timeout=120,
    )


def test_las_functions_no_arrancan_con_el_proyecto_de_bdb_y_si_con_el_de_hoy():
    """Por la puerta real: importar `main.py`, como hacen el emulador y el despliegue."""
    con_bdb = _importar_main(BDB)
    assert con_bdb.returncode != 0
    assert "GCLOUD_PROJECT nombra el proyecto de BDB" in con_bdb.stderr
    con_el_de_hoy = _importar_main("bdb-gestor-de-activos")
    assert con_el_de_hoy.returncode == 0, con_el_de_hoy.stderr


def test_main_se_niega_antes_de_inicializar_la_app():
    fuente = (RAIZ / "main.py").read_text(encoding="utf-8")
    assert fuente.index("exigir_arranque_sin_bdb()") < fuente.index("initialize_app()")
    assert fuente.index("exigir_emulador_en_local()") < fuente.index("initialize_app()")


def test_en_el_emulador_sin_firestore_emulado_no_arranca():
    """21-11-2026: el proyecto local es el real; sin el emulador de Firestore, la nube."""
    with pytest.raises(RuntimeError) as exc:
        master_project.exigir_emulador_en_local({"FUNCTIONS_EMULATOR": "true"})
    assert "FIRESTORE_EMULATOR_HOST" in str(exc.value)
    with pytest.raises(RuntimeError):
        master_project.exigir_emulador_en_local({"FUNCTIONS_EMULATOR": "true", "FIRESTORE_EMULATOR_HOST": "  "})


def test_en_el_emulador_con_firestore_emulado_y_en_la_nube_arranca():
    master_project.exigir_emulador_en_local({"FUNCTIONS_EMULATOR": "true", "FIRESTORE_EMULATOR_HOST": "127.0.0.1:8092"})
    master_project.exigir_emulador_en_local({})
    master_project.exigir_emulador_en_local({"FUNCTIONS_EMULATOR": "false"})


def test_main_no_arranca_en_el_emulador_sin_firestore_emulado():
    """Por la puerta real: importar `main.py` como el emulador, sin `FIRESTORE_EMULATOR_HOST`."""
    entorno = {k: v for k, v in os.environ.items() if k not in master_project.VARIABLES_DEL_ARRANQUE}
    entorno.pop("FIRESTORE_EMULATOR_HOST", None)
    entorno["GCLOUD_PROJECT"] = "bdb-gestor-de-activos"
    entorno["FUNCTIONS_EMULATOR"] = "true"
    sin = subprocess.run([sys.executable, "-c", "import main"], cwd=str(RAIZ), env=entorno,
                         capture_output=True, text=True, timeout=120)
    assert sin.returncode != 0 and "FIRESTORE_EMULATOR_HOST" in sin.stderr
    entorno["FIRESTORE_EMULATOR_HOST"] = "127.0.0.1:8092"
    con = subprocess.run([sys.executable, "-c", "import main"], cwd=str(RAIZ), env=entorno,
                         capture_output=True, text=True, timeout=120)
    assert con.returncode == 0, con.stderr


def test_el_lector_solo_carga_la_clave_de_la_barrera(monkeypatch, tmp_path):
    """Decision 03-11: el lector no inyecta el .env entero en el proceso.

    Si lo hiciera, el comportamiento de cualquier script dependeria de claves que
    nadie revisa con ese criterio -gates y destinos incluidos-, que es la misma
    clase de defecto que este modulo elimina.
    """
    monkeypatch.delenv(master_project.VARIABLE, raising=False)
    monkeypatch.delenv("FIRESTORE_EMULATOR_HOST", raising=False)
    monkeypatch.delenv("PRICES_WRITE_ENABLED", raising=False)
    ruta = _dotenv(
        tmp_path,
        "MASTER_PROJECT_ID=gestor-activos-local\n"
        "FIRESTORE_EMULATOR_HOST=127.0.0.1:8082\n"
        "PRICES_WRITE_ENABLED=true\n",
    )
    puestas = master_project.cargar_dotenv(ruta)
    assert puestas == ["MASTER_PROJECT_ID"]
    assert "FIRESTORE_EMULATOR_HOST" not in os.environ
    assert "PRICES_WRITE_ENABLED" not in os.environ


def test_un_dotenv_ausente_no_es_un_error_por_si_mismo(tmp_path):
    assert master_project.cargar_dotenv(str(tmp_path / "no-existe")) == []


def _fuentes():
    for ruta in RAIZ.rglob("*.py"):
        partes = set(ruta.parts)
        if "venv" in partes or "__pycache__" in partes:
            continue
        yield ruta, io.open(ruta, encoding="utf-8").read()


def test_ningun_fichero_vuelve_a_resolver_el_proyecto_con_un_defecto():
    """La que caza una reincidencia: un defecto para esta variable en cualquier sitio."""
    patron = re.compile(
        r"""environ(?:\.get\(|\[)\s*["']MASTER_PROJECT_ID["']\s*,\s*["']"""
    )
    culpables = [str(r.relative_to(RAIZ)) for r, txt in _fuentes() if patron.search(txt)]
    assert culpables == [], (
        "resuelven MASTER_PROJECT_ID con un defecto: %s. El id del proyecto de la "
        "maestra sale solo de master_project.master_project_id(), que no tiene "
        "defecto a proposito." % culpables
    )


PROYECTO_DE_BDB = "bbdd-activos-financieros"

# Este fichero nombra el literal en cada valor declarado abajo, asi que barrerse a si
# mismo obligaria a declarar dos veces cada cadena de esta lista. Es el unico exento, y
# es el que define la prohibicion.
EXENTO = "tests/test_master_project.py"

# Donde el literal puede aparecer, declarado uno a uno: fichero y valor exacto. Ninguno
# es un id de proyecto con el que se conecte nada. Un valor nuevo, aunque sea en un
# fichero ya declarado, hace fallar la prueba y obliga a declararlo, que es el momento
# de mirarlo.
APARICIONES_DECLARADAS = {
    # La barrera misma: el id se nombra una vez, en la constante, para rechazarlo.
    ("master_project.py", "bbdd-activos-financieros"),
}


def _textos_que_son_valor(arbol):
    """Las cadenas que son VALOR, no docstring. Los comentarios no estan en el AST."""
    docstrings = set()
    for nodo in ast.walk(arbol):
        cuerpo = getattr(nodo, "body", None)
        if isinstance(cuerpo, list) and cuerpo:
            primero = cuerpo[0]
            if (
                isinstance(primero, ast.Expr)
                and isinstance(primero.value, ast.Constant)
                and isinstance(primero.value.value, str)
            ):
                docstrings.add(id(primero.value))
    for nodo in ast.walk(arbol):
        if (
            isinstance(nodo, ast.Constant)
            and isinstance(nodo.value, str)
            and id(nodo) not in docstrings
        ):
            yield nodo


def test_el_proyecto_de_bdb_no_se_cuela_como_valor_en_ningun_sitio():
    """La que no se esquiva reescribiendo la expresion.

    La version anterior buscaba la FORMA `environ.get("X", <el proyecto de BDB>)`, y por
    eso no veia la forma `or <el proyecto de BDB>`, que es exactamente como estaba
    escrito en main.py: una comprobacion que no podia fallar donde mas falta, que es el
    defecto caracteristico de este proyecto. Esta busca el LITERAL como valor, parsea el
    AST para no confundirlo con un comentario ni con un docstring, y exige que cada
    aparicion este declarada con su razon. Reescribir la expresion no la esquiva.
    """
    sin_declarar = []
    no_parsean = []
    for ruta, texto in _fuentes():
        relativa = ruta.relative_to(RAIZ).as_posix()
        if relativa == EXENTO or PROYECTO_DE_BDB not in texto:
            continue
        try:
            arbol = ast.parse(texto)
        except SyntaxError as exc:
            no_parsean.append("%s (%s)" % (relativa, exc))
            continue
        for nodo in _textos_que_son_valor(arbol):
            if PROYECTO_DE_BDB not in nodo.value:
                continue
            if (relativa, nodo.value) not in APARICIONES_DECLARADAS:
                sin_declarar.append("%s:%d -> %r" % (relativa, nodo.lineno, nodo.value))
    # Un fichero que no se puede revisar no puede dar la prueba por buena: seria el
    # mismo defecto una capa mas arriba.
    assert no_parsean == [], "no se pudieron revisar: %s" % no_parsean
    assert sin_declarar == [], (
        "nombran el proyecto real de BDB en un valor y no esta declarado: %s. Si la "
        "aparicion es legitima, declarala arriba con su razon; si es un destino, no va "
        "aqui." % sin_declarar
    )


def test_el_dotenv_de_esta_copia_apunta_al_clon():
    """El .env esta en .gitignore: esta prueba solo corre donde existe."""
    ruta = Path(master_project.RUTA_DOTENV)
    if not ruta.is_file():
        pytest.skip("no hay .env en esta copia (esta en .gitignore)")
    declarado = {}
    for linea in ruta.read_text(encoding="utf-8").splitlines():
        linea = linea.strip()
        if linea and not linea.startswith("#") and "=" in linea:
            k, v = linea.split("=", 1)
            declarado[k.strip()] = v.strip()
    assert declarado.get("MASTER_PROJECT_ID") == "gestor-activos-local", (
        "el .env del clon debe apuntar al clon, no a la maestra de BDB"
    )
