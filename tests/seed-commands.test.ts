import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { COMMANDS, isKnownCommand } from "../src/persistence/commands.js";

/**
 * The demo seed drives the app entirely through the command registry. If it
 * ever reaches for a command that is not registered, the app boots fine in
 * memory and then loses that step on every restart — a failure that only
 * shows up in production, and quietly. This catches it here instead.
 */
const seedSource = readFileSync(new URL("../demo/seed.js", import.meta.url), "utf8");
const bootSource = readFileSync(new URL("../demo/boot.js", import.meta.url), "utf8");

const commandsUsedBy = (source: string): string[] => {
  const found = new Set<string>();
  for (const m of source.matchAll(/\bexec\(\s*"([a-zA-Z.]+)"/g)) found.add(m[1]!);
  return [...found].sort();
};

describe("the demo seed only uses registered commands", () => {
  it("finds commands in the seed at all (the regex still matches)", () => {
    expect(commandsUsedBy(seedSource).length).toBeGreaterThan(15);
  });

  it("every command the seed issues is in the registry", () => {
    const unknown = commandsUsedBy(seedSource).filter((c) => !isKnownCommand(c));
    expect(unknown).toEqual([]);
  });

  it("boot resolves the database URL rather than hardcoding a backend", () => {
    expect(bootSource).toContain("resolveDatabaseUrl");
    expect(bootSource).toContain("PostgresActionStore");
    expect(bootSource).toContain("MemoryActionStore");
  });

  it("a configured-but-unreachable database is reported, not hidden", () => {
    // Silently serving a different dataset because the database was down is
    // the worst available behaviour; boot must say so.
    expect(bootSource).toMatch(/unusable|unreachable/);
  });
});

describe("the command registry", () => {
  it("covers every engine the seed touches", () => {
    for (const prefix of ["journal.", "invoice.", "bill.", "contract.", "revrec.", "schedule.", "close.", "agents.", "connector.", "banking.", "recommendations.", "reconciliation.", "period.", "fx."]) {
      expect(Object.keys(COMMANDS).some((c) => c.startsWith(prefix))).toBe(true);
    }
  });

  it("has no command that shadows another's name", () => {
    const names = Object.keys(COMMANDS);
    expect(new Set(names).size).toBe(names.length);
  });
});
