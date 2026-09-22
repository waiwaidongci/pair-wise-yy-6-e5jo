// 纯规则自测：node test-rules.js
import assert from "node:assert/strict";
import {
  createStick,
  openBatch,
  addResult,
  closeBatch,
  correctResult,
  stickStatus,
  isReleased,
  isOpen,
  streakOf,
  missingFields,
  batchView,
  STICK_PENDING,
  STICK_TESTING,
  STICK_RELEASED,
  STICK_BLOCKED,
} from "./rules.js";

const H = 60 * 60 * 1000;
const base = Date.parse("2026-09-22T00:00:00Z");
const t = (n) => new Date(base + n * H).toISOString();

let passed = 0;
function ok(name, fn) {
  fn();
  passed += 1;
  console.log("  ✓ " + name);
}

// 1. 建档初始为待试磨
ok("新墨锭为待试磨", () => {
  const s = createStick({ code: "T-1" });
  assert.equal(stickStatus(s), STICK_PENDING);
});

// 2. 缺项作废、不占号
ok("首次登记缺项 -> 作废且不占号", () => {
  const s = createStick({ code: "T-2" });
  const out = openBatch(s, { grinder: "甲", edge: "圆口" }, t(0));
  assert.equal(out.voided, true);
  assert.ok(out.missing.includes("用水") && out.missing.includes("评分"));
  assert.equal(s.batchSeq, 0);
  assert.equal(s.batches.length, 0);
  assert.equal(s.voids.length, 1);
});

// 3. 缺项后仍可重新开启，占号为 1
ok("作废不占号：下一个有效批次仍是 B01", () => {
  const s = createStick({ code: "T-3" });
  openBatch(s, {}, t(0));
  const out = openBatch(s, full({ score: 88 }), t(1));
  assert.equal(out.batch.no, 1);
  assert.equal(stickStatus(s), STICK_TESTING);
});

// 4. 未结束批次内不能开启新批次
ok("未结束批次内开启新批次 -> conflict", () => {
  const s = createStick({ code: "T-4" });
  openBatch(s, full({ score: 88 }), t(0));
  const out = openBatch(s, full({ score: 90 }), t(1));
  assert.equal(out.conflict, true);
  assert.equal(s.batches.length, 1);
});

// 5. 同一试磨人连续两次高分不放行
ok("同一试磨人连续两次高分不放行", () => {
  const s = createStick({ code: "T-5" });
  const { batch } = openBatch(s, full({ grinder: "甲", score: 88 }), t(0));
  const out = addResult(batch, full({ grinder: "甲", score: 90 }), t(5));
  assert.equal(out.released, false);
  assert.ok(out.reasons.some((r) => r.includes("换人")));
  assert.equal(isReleased(batch), false);
});

// 6. 换人但不足 4 小时不放行
ok("换人但间隔不足 4 小时不放行", () => {
  const s = createStick({ code: "T-6" });
  const { batch } = openBatch(s, full({ grinder: "甲", score: 88 }), t(0));
  const out = addResult(batch, full({ grinder: "乙", score: 92 }), t(3.9));
  assert.equal(out.released, false);
  assert.ok(out.reasons.some((r) => r.includes("4 小时")));
  assert.equal(streakOf(batch), 2); // 计数照常累加
});

// 7. 换人 + 满 4 小时 + 两次高分 -> 放行
ok("换人且间隔满 4 小时且两次高分 -> 放行", () => {
  const s = createStick({ code: "T-7" });
  const { batch } = openBatch(s, full({ grinder: "甲", score: 88 }), t(0));
  const out = addResult(batch, full({ grinder: "乙", score: 91 }), t(4.5));
  assert.equal(out.released, true);
  assert.equal(isReleased(batch), true);
  assert.equal(isOpen(batch), false);
  assert.equal(stickStatus(s), STICK_RELEASED);
});

// 8. 低分重置计数；之后换人高分+4小时也不能放行（需要两次连续高分）
ok("任一低分重置计数，且旧记录留档", () => {
  const s = createStick({ code: "T-8" });
  const { batch } = openBatch(s, full({ grinder: "甲", score: 90 }), t(0));
  addResult(batch, full({ grinder: "乙", score: 60 }), t(5)); // 低分：计数清零
  assert.equal(streakOf(batch), 0);
  assert.equal(batch.results.length, 2); // 记录不删
  const out = addResult(batch, full({ grinder: "丙", score: 95 }), t(10)); // 仅 1 连高分
  assert.equal(out.released, false);
  assert.equal(streakOf(batch), 1);
  assert.equal(batch.results.length, 3); // 旧记录仍在
});

// 9. 低分后需重新累计两次换人高分
ok("低分重置后：再两次换人高分且间隔 4 小时才放行", () => {
  const s = createStick({ code: "T-9" });
  const { batch } = openBatch(s, full({ grinder: "甲", score: 90 }), t(0));
  addResult(batch, full({ grinder: "乙", score: 55 }), t(5));
  addResult(batch, full({ grinder: "丙", score: 86 }), t(10));
  const out = addResult(batch, full({ grinder: "丁", score: 87 }), t(15));
  assert.equal(out.released, true);
});

// 10. 高分线边界：85 算高分
ok("评分 85 算高分", () => {
  const s = createStick({ code: "T-10" });
  const { batch } = openBatch(s, full({ grinder: "甲", score: 85 }), t(0));
  const out = addResult(batch, full({ grinder: "乙", score: 85 }), t(5));
  assert.equal(out.released, true);
});

// 11. 结束未放行批次后可开新批次，状态为未放行
ok("结束批次后可开新批次；旧批次为未放行", () => {
  const s = createStick({ code: "T-11" });
  const { batch } = openBatch(s, full({ grinder: "甲", score: 90 }), t(0));
  closeBatch(batch, t(6));
  assert.equal(isOpen(batch), false);
  assert.equal(stickStatus(s), STICK_BLOCKED);
  const again = openBatch(s, full({ grinder: "乙", score: 88 }), t(7));
  assert.equal(again.batch.no, 2); // 新批次占下一号
  assert.equal(stickStatus(s), STICK_TESTING);
});

// 12. 进行中批次追加结果缺项 -> 拒绝记入，批次不废
ok("进行中批次结果缺项 -> 不记入，批次仍进行", () => {
  const s = createStick({ code: "T-12" });
  const { batch } = openBatch(s, full({ score: 90 }), t(0));
  const out = addResult(batch, { grinder: "乙" }, t(5));
  assert.equal(out.invalid, true);
  assert.equal(batch.results.length, 1);
  assert.equal(isOpen(batch), true);
});

// 13. 已放行批次更正关键字段 -> 失效
ok("更正已放行批次的评分 -> 放行失效且留档", () => {
  const s = createStick({ code: "T-13" });
  const { batch } = openBatch(s, full({ grinder: "甲", score: 88 }), t(0));
  addResult(batch, full({ grinder: "乙", score: 91 }), t(5));
  assert.equal(isReleased(batch), true);
  const out = correctResult(batch, batch.results[1].id, { score: 70 }, t(20), "丙");
  assert.equal(out.changed, true);
  assert.equal(out.revoked, true);
  assert.equal(isReleased(batch), false);
  assert.equal(stickStatus(s), STICK_BLOCKED);
  assert.ok(batch.history.some((h) => h.type === "revoke"));
  assert.equal(batch.results[1].score, 70);
});

// 14. 失效后可开启新批次，履历编号延续
ok("失效批次算结束：可开新批次（B02），旧履历保留", () => {
  const s = createStick({ code: "T-14" });
  const { batch } = openBatch(s, full({ grinder: "甲", score: 88 }), t(0));
  addResult(batch, full({ grinder: "乙", score: 91 }), t(5));
  correctResult(batch, batch.results[0].id, { humidity: "60%" }, t(20));
  const again = openBatch(s, full({ grinder: "甲", score: 89 }), t(25));
  assert.equal(again.batch.no, 2);
  assert.equal(stickStatus(s), STICK_TESTING);
  assert.equal(s.batches[0].history.length >= 4, true);
});

// 15. 更正已放行批次的非关键字段（备注）不失效
ok("仅更正备注 -> 不失效", () => {
  const s = createStick({ code: "T-15" });
  const { batch } = openBatch(s, full({ grinder: "甲", score: 88 }), t(0));
  addResult(batch, full({ grinder: "乙", score: 91 }), t(5));
  const out = correctResult(batch, batch.results[0].id, { note: "补注" }, t(10));
  assert.equal(out.revoked, false);
  assert.equal(isReleased(batch), true);
});

// 16. 更正未放行批次关键字段不产生失效标记，但履历记录
ok("未放行批次更正关键字段 -> 履历留档，无失效", () => {
  const s = createStick({ code: "T-16" });
  const { batch } = openBatch(s, full({ grinder: "甲", score: 88 }), t(0));
  const out = correctResult(batch, batch.results[0].id, { edge: "斜口" }, t(5));
  assert.equal(out.revoked, false);
  assert.equal(batch.results[0].edge, "斜口");
  assert.ok(batch.history.some((h) => h.detail.includes("磨口")));
});

// 17. 放行后再改回原值仍然失效（以更正动作为准）
ok("关键字段任意更正都触发失效（即使数值再改回）", () => {
  const s = createStick({ code: "T-17" });
  const { batch } = openBatch(s, full({ grinder: "甲", score: 88 }), t(0));
  addResult(batch, full({ grinder: "乙", score: 91 }), t(5));
  const id = batch.results[0].id;
  correctResult(batch, id, { score: 99 }, t(10));
  assert.equal(isReleased(batch), false);
  correctResult(batch, id, { score: 88 }, t(15));
  assert.equal(isReleased(batch), false);
});

// 18. 缺项检测覆盖六个登记字段与评分
ok("missingFields 覆盖六项登记+评分", () => {
  assert.equal(missingFields({}).length, 7);
  assert.equal(missingFields(full({})).length, 0);
});

// 19. 甲高分 -> 甲高分被拦（同人）-> 乙高分放行：换人判定看连续高分链首条
ok("同人首次被拦后换人即可放行（不要求上一条就是换人对象）", () => {
  const s = createStick({ code: "T-19" });
  const { batch } = openBatch(s, full({ grinder: "甲", score: 88 }), t(0));
  const blocked = addResult(batch, full({ grinder: "甲", score: 90 }), t(5));
  assert.equal(blocked.released, false);
  const pass = addResult(batch, full({ grinder: "乙", score: 86 }), t(10));
  assert.equal(pass.released, true);
  assert.equal(isReleased(batch), true);
});

// 20. 低分后旧高分不能和新高分组成放行对（链被低分截断）
ok("低分截断后，新链首条必须与本次试磨人不同", () => {
  const s = createStick({ code: "T-20" });
  const { batch } = openBatch(s, full({ grinder: "甲", score: 88 }), t(0));
  addResult(batch, full({ grinder: "乙", score: 50 }), t(5)); // 低
  addResult(batch, full({ grinder: "丙", score: 90 }), t(10));
  const out = addResult(batch, full({ grinder: "甲", score: 91 }), t(15));
  assert.equal(out.released, true); // 链首是丙，甲与之不同
});

// 21. 下次复核的换人对象取连续高分链首条，而非最近一条
ok("甲→甲被拦→乙时间不足被拦后，复核换人对象仍为甲", () => {
  const s = createStick({ code: "T-21" });
  const { batch } = openBatch(s, full({ grinder: "甲", score: 88 }), t(0));
  addResult(batch, full({ grinder: "甲", score: 90 }), t(0.1)); // 同人被拦
  addResult(batch, full({ grinder: "乙", score: 90 }), t(0.2)); // 换人但不足4h
  const view = batchView(s, batch);
  assert.equal(view.nextReview.otherThanGrinder, "甲"); // 链首是甲，不是最近的乙
  assert.equal(view.streak, 3);
  assert.equal(view.streakDisplay, 2); // 显示封顶 2/2
});

function full(patch) {
  return Object.assign({
    grinder: "甲",
    edge: "圆口",
    water: "20滴",
    paper: "宣纸",
    roomTemp: "22℃",
    humidity: "55%",
    score: 90,
  }, patch);
}

console.log(`\n规则自测全部通过（${passed} 项）`);
