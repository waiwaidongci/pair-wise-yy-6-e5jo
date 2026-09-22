// 试磨批次与放行规则（纯函数，不碰文件与 HTTP）
// 页面、存档都以这里的推算结果为准，保证列表 / 履历 / 刷新后状态一致。

export const HIGH_SCORE = 85; // 高分线：>=85 为高分，其余为低分
export const REVIEW_GAP_MS = 4 * 60 * 60 * 1000; // 换人复核至少间隔 4 小时
export const PASS_STREAK = 2; // 连续两次高分才放行

// 登记结果时缺一不可的关键字段：磨口、用水、纸样、室温、湿度、试磨人（评分另计）
export const RECORD_FIELDS = [
  ["grinder", "试磨人"],
  ["mouth", "磨口"],
  ["water", "用水"],
  ["paper", "纸样"],
  ["temp", "室温"],
  ["humidity", "湿度"],
];
export const SCORE_FIELD = ["score", "评分"];
export const KEY_FIELDS = [...RECORD_FIELDS, SCORE_FIELD];

export const FIELD_LABELS = Object.fromEntries(KEY_FIELDS);

export const STATE = {
  OPEN: "进行中",
  RELEASED: "已放行",
  VOID: "已作废", // 登记缺项：作废且不占号
  INVALID: "已失效", // 已放行批次被更正关键字段
};
export const ENDED_STATES = new Set([STATE.RELEASED, STATE.VOID, STATE.INVALID]);
export const ITEM_STATUS = ["待试磨", "试磨中", "已放行", "放行失效"];

export function isHighScore(score) {
  return Number(score) >= HIGH_SCORE;
}

// 返回登记内容里缺失的字段中文名；评分必须是 0-100 的数字
export function missingFields(input = {}) {
  const missing = [];
  for (const [key, label] of RECORD_FIELDS) {
    if (input[key] === undefined || input[key] === null || String(input[key]).trim() === "") {
      missing.push(label);
    }
  }
  const raw = input.score;
  const score = Number(raw);
  if (
    raw === undefined ||
    raw === null ||
    String(raw).trim() === "" ||
    !Number.isFinite(score)
  ) {
    missing.push("评分");
  }
  return missing;
}

// 从最新结果向前数的一段连续高分；遇到任一低分即截断（计数重置，旧记录仍留档）
export function highStreak(records = []) {
  const streak = [];
  for (let i = records.length - 1; i >= 0; i -= 1) {
    if (isHighScore(records[i].score)) streak.unshift(records[i]);
    else break;
  }
  return streak;
}

// 放行判定：连续两次高分 + 试磨人不同 + 间隔满 4 小时
export function evaluateRelease(records = []) {
  const streak = highStreak(records);
  const blockers = [];
  let pair = null;

  if (streak.length === 0) {
    blockers.push(`尚无高分结果（高分线 ${HIGH_SCORE} 分）`);
  } else if (streak.length < PASS_STREAK) {
    blockers.push(
      `仅有 ${streak.length} 次高分（${streak[0].grinder} ${streak[0].score} 分），` +
        "须换人并间隔满 4 小时复核"
    );
  } else {
    const a = streak[streak.length - 2];
    const b = streak[streak.length - 1];
    pair = [a, b];
    if (a.grinder === b.grinder) {
      blockers.push(`连续两次高分为同一试磨人「${a.grinder}」，须换人复核`);
    }
    const gapHours = (new Date(b.at) - new Date(a.at)) / 3600000;
    if (new Date(b.at) - new Date(a.at) < REVIEW_GAP_MS) {
      blockers.push(
        `与上次高分仅间隔 ${gapHours.toFixed(1)} 小时，复核须间隔满 4 小时`
      );
    }
  }

  return { releasable: blockers.length === 0, streak, pair, blockers };
}

// 给存档 / 页面用的精简结论（只含原始值，避免重复整条记录）
export function releaseView(records = []) {
  const result = evaluateRelease(records);
  return {
    releasable: result.releasable,
    streakCount: result.streak.length,
    blockers: result.blockers,
    pair: result.pair
      ? [
          { id: result.pair[0].id, grinder: result.pair[0].grinder, at: result.pair[0].at },
          { id: result.pair[1].id, grinder: result.pair[1].grinder, at: result.pair[1].at },
        ]
      : null,
  };
}

function lastActivityAt(batch) {
  if (batch.endedAt) return batch.endedAt;
  if (batch.records.length) return batch.records[batch.records.length - 1].at;
  return batch.openedAt;
}

// 墨锭状态完全由批次履历推算，不单独落库
export function deriveItemStatus(batches = []) {
  if (batches.some((b) => b.state === STATE.OPEN)) return "试磨中";
  const numbered = batches.filter((b) => b.batchNo); // 作废且不占号的批次不计入试磨履历
  if (numbered.length === 0) return "待试磨";
  const latest = [...numbered].sort(
    (a, b) => new Date(lastActivityAt(b)) - new Date(lastActivityAt(a))
  )[0];
  if (latest.state === STATE.RELEASED) return "已放行";
  if (latest.state === STATE.INVALID) return "放行失效";
  return "试磨中";
}
