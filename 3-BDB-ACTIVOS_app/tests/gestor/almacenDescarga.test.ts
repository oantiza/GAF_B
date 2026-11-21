// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { hayAccesoACarpetas, carpetaRecordada, olvidarCarpeta, recordarCarpeta } from "../../src/gestor/almacen/acceso";
import { abrirFichero, descargarCartera, nombreDeFichero } from "../../src/gestor/almacen/descarga";
import { ErrorDeFormato, serializar } from "../../src/gestor/almacen/formato";
import { cartera } from "./ayudas";
import { crearCarpetaFalsa } from "./carpetaFalsa";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("la alternativa sin carpeta", () => {
  it("abre una cartera desde un fichero elegido", async () => {
    const c = cartera([], [], { nombre: "Familia García" });
    const fichero = new File([serializar(c)], "Familia García.cartera.json", { type: "application/json" });
    expect((await abrirFichero(fichero)).cartera).toEqual(c);
    await expect(abrirFichero(new File(["hola"], "x.txt"))).rejects.toBeInstanceOf(ErrorDeFormato);
  });

  it("descarga la cartera con su nombre de fichero y el texto del formato", async () => {
    const c = cartera([], [], { nombre: "Cartera: 60/40" });
    let blob: Blob | undefined;
    vi.spyOn(URL, "createObjectURL").mockImplementation((objeto) => {
      blob = objeto as Blob;
      return "blob:prueba";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    let descargado: string | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      descargado = this.download;
    });
    const nombre = descargarCartera(c);
    expect(nombre).toBe("Cartera 60 40.cartera.json");
    expect(nombre).toBe(nombreDeFichero(c));
    expect(descargado).toBe(nombre);
    expect(document.querySelectorAll("a")).toHaveLength(0);
    const texto = await blob!.text();
    expect(JSON.parse(texto).cartera).toEqual(JSON.parse(serializar(c)).cartera);
  });
});

describe("acceso a carpetas", () => {
  it("sin la API (happy-dom no la tiene), no hay acceso a carpetas", () => {
    expect(hayAccesoACarpetas()).toBe(false);
  });

  it("sin IndexedDB, recordar y olvidar no lanzan y no hay carpeta recordada", async () => {
    const { carpeta } = crearCarpetaFalsa();
    await expect(recordarCarpeta(carpeta)).resolves.toBeUndefined();
    await expect(carpetaRecordada()).resolves.toBeUndefined();
    await expect(olvidarCarpeta()).resolves.toBeUndefined();
  });
});
