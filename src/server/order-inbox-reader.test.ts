// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { createInboxReader } from "./order-inbox-reader";

function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => (open = resolve));
  return { promise, open };
}

describe("createInboxReader", () => {
  it("runs one drain at a time and once more for requests that came in meanwhile", async () => {
    const gates = [gate(), gate()];
    let calls = 0;
    const read = createInboxReader(async () => {
      await gates[calls++]!.promise;
    });
    const first = read();
    await read();
    await read();
    expect(calls).toBe(1);
    gates[0]!.open();
    await vi.waitFor(() => expect(calls).toBe(2));
    gates[1]!.open();
    await first;
    expect(calls).toBe(2);
  });

  it("can be started again after a drain failed", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let calls = 0;
    const read = createInboxReader(async () => {
      calls += 1;
      if (calls === 1) throw new Error("database away");
    });
    await read();
    await read();
    expect(calls).toBe(2);
    expect(error).toHaveBeenCalledWith("[order-inbox] reading stopped:", "database away");
    error.mockRestore();
  });
});
