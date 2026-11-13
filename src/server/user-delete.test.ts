// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { USER_REFERENCES } from "./user-delete";

/**
 * NUD-206 guard: every column that points at `User` is handled by `deleteUser`. A relation added
 * later would otherwise make the delete fail with a foreign-key error for exactly the accounts
 * that used the new feature.
 */
describe("deleteUser covers every reference to User", () => {
  it("USER_REFERENCES equals the relations in prisma/schema.prisma", () => {
    const schema = readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf8");
    const found: string[] = [];
    let model: string | null = null;
    for (const line of schema.split(/\r?\n/)) {
      const start = /^model\s+(\w+)\s*\{/.exec(line);
      if (start) model = start[1] ?? null;
      else if (/^\}/.test(line)) model = null;
      const relation = /^\s+\w+\s+User\??\s+@relation\(.*fields:\s*\[(\w+)\]/.exec(line);
      if (model && relation) found.push(`${model}.${relation[1]}`);
    }
    expect(found.length).toBeGreaterThan(0);
    expect([...found].sort()).toEqual([...USER_REFERENCES].sort());
  });
});
