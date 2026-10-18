import { strict as assert } from "node:assert";
import { findListSubtree, findNarrowRange } from "../src/listSubtree";

describe("narrow list editing", () => {
  const lines = [
    "# Tasks",
    "- [ ] Parent",
    "  - [ ] Child",
    "    continuation",
    "",
    "  - [ ] Another child",
    "- [ ] Sibling",
    "after list",
  ];
  const range = (line: number) => findListSubtree(lines.length, (at) => lines[at], line);

  it("keeps the selected task and its descendants, stopping at the next sibling", () => {
    assert.deepEqual(range(1), { firstLine: 1, lastLine: 5 });
    assert.deepEqual(range(2), { firstLine: 2, lastLine: 3 });
    assert.deepEqual(range(6), { firstLine: 6, lastLine: 6 });
  });

  it("does not treat a heading or plain paragraph as a list item", () => {
    assert.equal(range(0), null);
    assert.equal(range(7), null);
  });

  it("focuses a heading through its checklist and stops at the next same or higher heading", () => {
    const section = [
      "### 家庭",
      "#### 房子情况 · 打扫选项（勾选要做的）",
      "- [ ] 打扫客厅",
      "- [ ] 打扫厨房",
      "##### 备注",
      "整理杂物",
      "",
      "#### 其他安排",
      "- [ ] 买菜",
      "## 每日固定",
    ];
    const focused = (line: number) =>
      findNarrowRange(section.length, (at) => section[at], line);
    assert.deepEqual(focused(1), { firstLine: 1, lastLine: 5 });
    assert.deepEqual(focused(0), { firstLine: 0, lastLine: 8 });
    assert.deepEqual(focused(2), { firstLine: 2, lastLine: 2 });
  });
});
