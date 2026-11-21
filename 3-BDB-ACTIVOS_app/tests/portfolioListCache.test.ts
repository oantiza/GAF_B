import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: { currentUser: { uid: "one" } }, call: vi.fn() }));
vi.mock("../src/firebase", () => ({ auth: mocks.auth, functions: {} }));
vi.mock("../src/adapters/callableBackend", () => ({ callBackend: mocks.call }));
import { backendDeletePortfolio, backendListPortfolioResult } from "../src/adapters/portfolioBackend";
import { clearSessionCaches } from "../src/core/sessionCaches";

beforeEach(() => { clearSessionCaches(); mocks.call.mockReset(); mocks.auth.currentUser = { uid: "one" }; });
const empty = { portfolios: [], count: 0 };

it("coalesces concurrent reads and reuses them when navigating back", async () => {
  mocks.call.mockResolvedValue(empty);
  await Promise.all([backendListPortfolioResult(), backendListPortfolioResult()]);
  await backendListPortfolioResult();
  expect(mocks.call).toHaveBeenCalledTimes(1);
});

it("does not share portfolio lists between accounts or sessions", async () => {
  mocks.call.mockResolvedValue(empty);
  await backendListPortfolioResult();
  mocks.auth.currentUser = { uid: "two" }; await backendListPortfolioResult();
  clearSessionCaches(); await backendListPortfolioResult();
  expect(mocks.call).toHaveBeenCalledTimes(3);
});

it("a failed write still invalidates the list because its remote outcome may be uncertain", async () => {
  mocks.call.mockResolvedValueOnce(empty).mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce(empty);
  await backendListPortfolioResult();
  await expect(backendDeletePortfolio("example")).rejects.toThrow("network");
  await backendListPortfolioResult();
  expect(mocks.call).toHaveBeenCalledTimes(3);
});

it("late responses from a previous session are rejected", async () => {
  let finish!: (value: unknown) => void;
  mocks.call.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const old = backendListPortfolioResult();
  clearSessionCaches(); finish(empty);
  await expect(old).rejects.toThrow("La sesión ha cambiado");
});
