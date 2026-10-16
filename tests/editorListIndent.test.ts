import assert from "node:assert/strict";
import { childListLineAfterSpace } from "../src/editorListIndent";

describe("Space + Enter for Markdown lists", () => {
  it("creates a nested bullet and removes the trigger space", () => {
    assert.deepEqual(childListLineAfterSpace("- Parent ", 9), {
      fromCh: 8,
      insertion: "\n  - ",
    });
    assert.deepEqual(childListLineAfterSpace("  * Parent  ", 12), {
      fromCh: 10,
      insertion: "\n    * ",
    });
  });

  it("starts a nested numbered item at one", () => {
    assert.deepEqual(childListLineAfterSpace("3. Parent ", 10), {
      fromCh: 9,
      insertion: "\n   1. ",
    });
    assert.deepEqual(childListLineAfterSpace("10. Parent ", 11), {
      fromCh: 10,
      insertion: "\n    1. ",
    });
  });

  it("creates an unchecked bullet below a checkbox item", () => {
    assert.deepEqual(childListLineAfterSpace("- [x] Done ", 11), {
      fromCh: 10,
      insertion: "\n  - ",
    });
  });

  it("leaves ordinary Enter, plain text, and empty items alone", () => {
    assert.equal(childListLineAfterSpace("- Parent", 8), null);
    assert.equal(childListLineAfterSpace("- Parent ", 5), null);
    assert.equal(childListLineAfterSpace("Plain text ", 11), null);
    assert.equal(childListLineAfterSpace("- ", 2), null);
  });
});
