import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { OFFLINE_LEDGER } from "../src/device/ledger.js";

test("offline ledger keeps browser sync outstanding and does not depend on ts-fsrs", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const names = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
  expect(names).not.toContain("ts-fsrs");
  expect(names).not.toContain("katex");
  expect(names).not.toContain("next");
  expect(names).not.toContain("react");
  expect(OFFLINE_LEDGER.find((row) => row.id === "browser-reload-offline")?.impl).toBe("not_implemented");
  expect(OFFLINE_LEDGER.find((row) => row.id === "sync-ack-required")?.impl).toBe("tested");
  expect(process.version.startsWith("v22.")).toBe(true);
});
