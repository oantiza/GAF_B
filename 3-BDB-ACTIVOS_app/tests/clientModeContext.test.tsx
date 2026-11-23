import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { CLIENT_MODE_STORAGE_KEY, ClientModeProvider, readClientMode, useClientMode } from "../src/app/ClientModeContext";
import { ClientModeToggle } from "../src/app/BdbActivosApp";

function Probe() { return createElement("span", null, useClientMode().enabled ? "cliente" : "interno"); }

describe("ClientModeContext", () => {
  test("lee exclusivamente el flag persistido", () => {
    expect(readClientMode({ getItem: (key) => key === CLIENT_MODE_STORAGE_KEY ? "true" : null, setItem: () => undefined })).toBe(true);
    expect(readClientMode({ getItem: () => "false", setItem: () => undefined })).toBe(false);
  });
  test("propaga el modo por contexto sin atributos de datos en el DOM", () => {
    const html = renderToStaticMarkup(createElement(ClientModeProvider, { initialValue: true, children: createElement(Probe) }));
    expect(html).toContain("cliente");
    expect(html).not.toContain("data-client");
  });
  test("el toggle del topbar expone un switch activo", () => {
    const html = renderToStaticMarkup(createElement(ClientModeProvider, { initialValue: true, children: createElement(ClientModeToggle) }));
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain("Modo cliente");
  });
  test("encendido, la barra dice «Vista para el cliente» fuera del interruptor, que conserva su nombre (M3, 21-11-2026)", () => {
    const encendido = renderToStaticMarkup(createElement(ClientModeProvider, { initialValue: true, children: createElement(ClientModeToggle) }));
    const apagado = renderToStaticMarkup(createElement(ClientModeProvider, { initialValue: false, children: createElement(ClientModeToggle) }));
    expect(encendido).toContain('<span class="topbar-vista-cliente" role="status">Vista para el cliente</span>');
    expect(encendido).toMatch(/role="switch"[^>]*>.*Modo cliente<\/span><\/button>/);
    /* Apagado, la región sigue montada y vacía: así se anuncia al encenderse. */
    expect(apagado).toContain('<span class="topbar-vista-cliente" role="status"></span>');
  });
});
