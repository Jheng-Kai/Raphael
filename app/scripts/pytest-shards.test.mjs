import { describe, expect, it } from "vitest";
import { shareCount, summary } from "./pytest-shards.mjs";

describe("pytest-shards", () => {
  it("runs half the cores in shares, at most eight, or what RAPHAEL_VERIFY_SHARES says", () => {
    expect(shareCount({}, 20)).toBe(8);
    expect(shareCount({}, 6)).toBe(3);
    expect(shareCount({}, 1)).toBe(1);
    expect(shareCount({ RAPHAEL_VERIFY_SHARES: "1" }, 20)).toBe(1);
    expect(shareCount({ RAPHAEL_VERIFY_SHARES: "12" }, 4)).toBe(12);
    expect(shareCount({ RAPHAEL_VERIFY_SHARES: "many" }, 8)).toBe(4);
  });

  it("names each share's failures and its summary line", () => {
    const log = ["....F..", "FAILED tests/agent/test_a.py::test_one - AssertionError", "ERROR tests/agent/test_b.py::test_two",
      "=========== 1 failed, 5 passed, 1 error in 12.34s ===========", ""].join("\n");
    expect(summary(log)).toEqual({ failures: ["FAILED tests/agent/test_a.py::test_one - AssertionError", "ERROR tests/agent/test_b.py::test_two"],
      last: "1 failed, 5 passed, 1 error in 12.34s" });
    expect(summary("....\n4 passed in 1.00s\n").last).toBe("4 passed in 1.00s");
  });
});
