import test from "node:test";
import assert from "node:assert/strict";
import {
  missingFields,
  highStreak,
  evaluateRelease,
  deriveItemStatus,
  STATE,
} from "../src/rules.js";

const rec = (overrides) => ({
  id: Math.random().toString(36).slice(2),
  grinder: "甲",
  mouth: "中圈",
  water: "20滴",
  paper: "宣纸",
  temp: "22℃",
  humidity: "55%",
  score: 90,
  at: new Date().toISOString(),
  ...overrides,
});

test("缺项检测：六项登记 + 评分齐全才算完整", () => {
  assert.deepEqual(missingFields(rec()), []);
  assert.deepEqual(
    missingFields(rec({ grinder: "  ", humidity: "", score: "x" })),
    ["试磨人", "湿度", "评分"]
  );
  assert.deepEqual(missingFields(rec({ score: 84 })), []);
});

test("连续高分：任一低分截断计数，旧记录不删除", () => {
  const records = [
    rec({ score: 90 }),
    rec({ score: 70 }),
    rec({ score: 88 }),
    rec({ score: 91 }),
  ];
  assert.equal(highStreak(records).length, 2);
  assert.equal(records.length, 4);
  assert.equal(highStreak([rec({ score: 50 })]).length, 0);
});

test("放行：两个高分但同一试磨人 → 不可放行，提示换人", () => {
  const t0 = new Date("2026-09-01T00:00:00Z");
  const records = [
    rec({ grinder: "甲", score: 90, at: t0.toISOString() }),
    rec({ grinder: "甲", score: 92, at: new Date(t0.getTime() + 5 * 3600000).toISOString() }),
  ];
  const r = evaluateRelease(records);
  assert.equal(r.releasable, false);
  assert.match(r.blockers.join(" "), /换人/);
});

test("放行：换人但不足 4 小时 → 不可放行", () => {
  const t0 = new Date("2026-09-01T00:00:00Z");
  const records = [
    rec({ grinder: "甲", score: 90, at: t0.toISOString() }),
    rec({ grinder: "乙", score: 92, at: new Date(t0.getTime() + 3 * 3600000).toISOString() }),
  ];
  const r = evaluateRelease(records);
  assert.equal(r.releasable, false);
  assert.match(r.blockers.join(" "), /4 小时/);
});

test("放行：换人且间隔满 4 小时的连续两次高分 → 放行", () => {
  const t0 = new Date("2026-09-01T00:00:00Z");
  const records = [
    rec({ grinder: "甲", score: 90, at: t0.toISOString() }),
    rec({ grinder: "乙", score: 92, at: new Date(t0.getTime() + 4 * 3600000).toISOString() }),
  ];
  const r = evaluateRelease(records);
  assert.deepEqual(r.blockers, []);
  assert.equal(r.releasable, true);
});

test("低分重置：即使末两次高分可放行，只要中间夹过低分，计数从低分后重算", () => {
  const t0 = new Date("2026-09-01T00:00:00Z");
  const at = (h) => new Date(t0.getTime() + h * 3600000).toISOString();
  // 甲高分、甲低分、甲高分、乙高分：连续段是后两条，换人、隔 4 小时 → 放行
  const records = [
    rec({ grinder: "甲", score: 90, at: at(0) }),
    rec({ grinder: "甲", score: 60, at: at(1) }),
    rec({ grinder: "甲", score: 86, at: at(2) }),
    rec({ grinder: "乙", score: 87, at: at(7) }),
  ];
  assert.equal(evaluateRelease(records).releasable, true);
});

test("墨锭状态由批次履历推算", () => {
  assert.equal(deriveItemStatus([]), "待试磨");
  assert.equal(
    deriveItemStatus([{ state: STATE.OPEN, batchNo: 1, openedAt: "2026-09-01", records: [] }]),
    "试磨中"
  );
  assert.equal(
    deriveItemStatus([
      { state: STATE.VOID, batchNo: null, openedAt: "2026-09-01", endedAt: "2026-09-01", records: [] },
    ]),
    "待试磨"
  );
  assert.equal(
    deriveItemStatus([
      { state: STATE.RELEASED, batchNo: 1, openedAt: "2026-09-01", endedAt: "2026-09-01", records: [] },
    ]),
    "已放行"
  );
  assert.equal(
    deriveItemStatus([
      { state: STATE.RELEASED, batchNo: 1, openedAt: "2026-09-01", endedAt: "2026-09-01", records: [] },
      { state: STATE.INVALID, batchNo: 2, openedAt: "2026-09-02", endedAt: "2026-09-02", records: [] },
    ]),
    "放行失效"
  );
});
