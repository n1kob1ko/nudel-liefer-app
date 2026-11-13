// @vitest-environment node
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createLocalBackupStore } from "./store";

describe("local backup store (a folder on the server)", () => {
  let root: string;
  let source: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "nudel-store-"));
    source = path.join(root, "source.dump");
    writeFileSync(source, "dump-bytes");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("stores a file below the folder, creating the sub-folder, readable by the owner only", async () => {
    const dir = path.join(root, "backups");
    const store = createLocalBackupStore(dir);
    await store.put("db/nudel-20261113T022300Z.dump", source, 10, "sha");

    const stored = path.join(dir, "db", "nudel-20261113T022300Z.dump");
    expect(readFileSync(stored, "utf8")).toBe("dump-bytes");
    expect(statSync(stored).mode & 0o777).toBe(0o600);
    expect(statSync(path.join(dir, "db")).mode & 0o077).toBe(0);
    expect(await store.head("db/nudel-20261113T022300Z.dump")).toEqual({ bytes: 10 });
    expect(await store.head("db/missing.dump")).toBeNull();
    // No half-written file may be left behind under a name that looks like a backup.
    expect(readdirSync(path.join(dir, "db"))).toEqual(["nudel-20261113T022300Z.dump"]);
  });

  it("lists the keys below a prefix, copies one out and deletes one", async () => {
    const store = createLocalBackupStore(root);
    await store.put("db/a.dump", source, 10, "sha");
    await store.put("db/b.dump", source, 10, "sha");
    await store.put("other/c.dump", source, 10, "sha");

    expect((await store.list("db/")).map((o) => o.key).sort()).toEqual(["db/a.dump", "db/b.dump"]);
    expect((await store.list("db/"))[0]!.bytes).toBe(10);
    expect(await store.list("nothing-here/")).toEqual([]);

    const copy = path.join(root, "copy.dump");
    await store.get("db/a.dump", copy);
    expect(readFileSync(copy, "utf8")).toBe("dump-bytes");

    await store.delete("db/a.dump");
    expect((await store.list("db/")).map((o) => o.key)).toEqual(["db/b.dump"]);
    await store.delete("db/a.dump"); // already gone: not an error
  });

  it("never reads or writes outside its folder", async () => {
    const store = createLocalBackupStore(path.join(root, "backups"));
    await expect(store.put("../escape.dump", source, 10, "sha")).rejects.toThrow(/outside/);
    await expect(store.get("../source.dump", path.join(root, "x"))).rejects.toThrow(/outside/);
    await expect(store.delete("/etc/passwd")).rejects.toThrow(/outside/);
  });
});
