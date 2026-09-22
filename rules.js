// 试磨批次与放行规则（纯规则模块：不读写文件、不发请求，时间由参数传入）

// 高分线：评分 >= 85 视为高分
export const HIGH_SCORE = 85;
// 换人复核的最小间隔：4 小时（可用环境变量 REVIEW_GAP_MS 覆盖为 0，便于联调）
export const REVIEW_GAP_MS = process.env.REVIEW_GAP_MS === undefined
  ? 4 * 60 * 60 * 1000
  : Number(process.env.REVIEW_GAP_MS);

// 每次试磨必须登记的字段：磨口、用水、纸样、室温、湿度、试磨人
export const REGISTER_FIELDS = [
  ["grinder", "试磨人"],
  ["edge", "磨口"],
  ["water", "用水"],
  ["paper", "纸样"],
  ["roomTemp", "室温"],
  ["humidity", "湿度"],
];

export const FIELD_LABELS = Object.fromEntries(REGISTER_FIELDS);
FIELD_LABELS.score = "评分";
FIELD_LABELS.note = "备注";

// 更正即失效的关键字段：六项登记字段 + 评分
export const KEY_FIELDS = [...REGISTER_FIELDS.map(([key]) => key), "score"];

// 批次状态：进行中 / 已放行 / 未放行（已结束但未通过）/ 已失效（放行后被更正）
export const BATCH_OPEN = "进行中";
export const BATCH_RELEASED = "已放行";
export const BATCH_CLOSED = "未放行";
export const BATCH_REVOKED = "已失效";

// 墨锭状态由批次履历推导，不单独存储
export const STICK_PENDING = "待试磨";
export const STICK_TESTING = "试磨中";
export const STICK_RELEASED = "已放行";
export const STICK_BLOCKED = "未放行";

export function nowIso() {
  return new Date().toISOString();
}

export function isBlank(value) {
  return value === undefined || value === null ||
    (typeof value === "string" && value.trim() === "");
}

export function isHigh(score) {
  return Number(score) >= HIGH_SCORE;
}

// 找出登记缺项（六项登记字段任一为空，或评分不是数字，即缺项）
export function missingFields(input = {}) {
  const missing = [];
  for (const [key, label] of REGISTER_FIELDS) {
    if (isBlank(input[key])) missing.push(label);
  }
  if (!Number.isFinite(Number(input.score))) missing.push("评分");
  return missing;
}

function resultId(batch, index) {
  return `r${batch.no}-${index}`;
}

export function batchLabel(stick, batch) {
  return `${stick.code}-B${String(batch.no).padStart(2, "0")}`;
}

export function normalizeResult(input, id, at) {
  return {
    id,
    at,
    grinder: String(input.grinder).trim(),
    edge: String(input.edge).trim(),
    water: String(input.water).trim(),
    paper: String(input.paper).trim(),
    roomTemp: String(input.roomTemp).trim(),
    humidity: String(input.humidity).trim(),
    score: Number(input.score),
    note: input.note ? String(input.note) : "",
  };
}

export function isOpen(batch) {
  return !batch.releasedAt && !batch.revokedAt && !batch.closedAt;
}

export function isReleased(batch) {
  return Boolean(batch.releasedAt) && !batch.revokedAt;
}

export function batchStatus(batch) {
  if (batch.revokedAt) return BATCH_REVOKED;
  if (batch.releasedAt) return BATCH_RELEASED;
  if (batch.closedAt) return BATCH_CLOSED;
  return BATCH_OPEN;
}

// 连续高分计数：任一低分立即重置为 0（结果本身全部留档，不删除）
export function streakOf(batch) {
  let streak = 0;
  for (const result of batch.results) {
    streak = isHigh(result.score) ? streak + 1 : 0;
  }
  return streak;
}

// 放行复核条件：
// 1) 最近两次结果均为高分（任一低分已在计数中重置）；
// 2) 同一试磨人连续两次不能放行——本次试磨人不得与当前连续高分链的首条试磨人相同
//    （即不得与"上一次被接受的高分起点"同人；前一次若同人会被拦下，本次换人仍可放行）；
// 3) 两次高分间隔不少于 4 小时。
export function reviewCheck(chain, next) {
  const reasons = [];
  if (chain.length < 1) reasons.push("该批次还没有首次试磨结果");
  const pairStart = chain[0] || null;
  const prev = chain[chain.length - 1] || null;
  if (!isHigh(next.score)) reasons.push("本次结果为低分");
  if (pairStart && String(pairStart.grinder).trim() === String(next.grinder).trim()) {
    reasons.push("同一试磨人连续两次结果不能放行，须换人复核");
  }
  if (prev && new Date(next.at).getTime() - new Date(prev.at).getTime() < REVIEW_GAP_MS) {
    reasons.push("复核距上一次试磨不足 4 小时");
  }
  return { pass: reasons.length === 0, reasons };
}

export function createStick(input = {}) {
  const code = String(input.code || "").trim();
  if (!code) throw { error: "code_required", message: "墨锭编号必填" };
  return {
    code,
    smokeSource: String(input.smokeSource || "").trim(),
    glueRatio: String(input.glueRatio || "").trim(),
    ageYears: input.ageYears === undefined || input.ageYears === "" ? null : Number(input.ageYears),
    storage: String(input.storage || "").trim(),
    batchSeq: 0,
    batches: [],
    voids: [],
    legacy: [],
  };
}

function sanitizePayload(input) {
  const out = {};
  for (const [key] of [...REGISTER_FIELDS, ["score"], ["note"]]) {
    if (input[key] !== undefined) out[key] = String(input[key]);
  }
  return out;
}

// 开启批次 = 首次登记。缺项 -> 批次作废、不占号（作废记录留档）
export function openBatch(stick, input = {}, at = nowIso()) {
  if (stick.batches.some(isOpen)) return { conflict: true };

  const missing = missingFields(input);
  if (missing.length) {
    stick.voids.push({ at, missing, payload: sanitizePayload(input) });
    return { voided: true, missing };
  }

  stick.batchSeq += 1;
  const batch = {
    no: stick.batchSeq,
    openedAt: at,
    closedAt: null,
    releasedAt: null,
    revokedAt: null,
    results: [],
    history: [],
  };
  const result = normalizeResult(input, resultId(batch, 1), at);
  batch.results.push(result);
  const label = batchLabel(stick, batch);
  batch.history.push({ at, type: "open", detail: `批次 ${label} 开启，六项登记与评分齐全，占号成功` });
  if (isHigh(result.score)) {
    batch.history.push({
      at,
      type: "result",
      detail: `${result.grinder} 首次试磨评分 ${result.score}（高分），连续高分计数 1/2；须换人并间隔 4 小时复核`,
    });
  } else {
    batch.history.push({
      at,
      type: "reset",
      detail: `${result.grinder} 首次试磨评分 ${result.score}（低分），连续高分计数 0/2；旧记录留档`,
    });
  }
  stick.batches.push(batch);
  return { batch };
}

// 在进行中批次内追加一次试磨/复核结果
export function addResult(batch, input = {}, at = nowIso()) {
  if (!isOpen(batch)) return { closed: true };
  const missing = missingFields(input);
  if (missing.length) return { invalid: true, missing };

  const result = normalizeResult(input, resultId(batch, batch.results.length + 1), at);
  batch.results.push(result);
  const streak = streakOf(batch);

  if (!isHigh(result.score)) {
    batch.history.push({
      at,
      type: "reset",
      detail: `${result.grinder} 评分 ${result.score} 为低分，连续高分计数重置为 0/2；旧记录留档`,
    });
    return { added: true, released: false, streak };
  }

  // 当前连续高分链（不含本次）：本次放行人不得与链首试磨人相同
  const chain = [];
  for (let i = batch.results.length - 2; i >= 0; i--) {
    if (!isHigh(batch.results[i].score)) break;
    chain.unshift(batch.results[i]);
  }
  const check = reviewCheck(chain, result);
  if (check.pass) {
    const pairStart = chain[0];
    batch.releasedAt = at;
    batch.closedAt = at;
    batch.history.push({
      at,
      type: "result",
      detail: `复核人 ${result.grinder} 评分 ${result.score}，与 ${pairStart.grinder}（评分 ${pairStart.score}）换人且间隔满 4 小时，连续两次高分`,
    });
    batch.history.push({
      at,
      type: "release",
      detail: `批次放行通过：${pairStart.grinder}、${result.grinder} 连续两次高分`,
    });
    return { added: true, released: true, streak };
  }

  batch.history.push({
    at,
    type: "result",
    detail: `${result.grinder} 评分 ${result.score}（高分），连续高分计数 ${streak}/2；暂不放行：${check.reasons.join("；")}`,
  });
  return { added: true, released: false, streak, reasons: check.reasons };
}

// 主动结束批次（未放行），结束后该墨锭才能开启新批次
export function closeBatch(batch, at = nowIso()) {
  if (!isOpen(batch)) return { closed: true };
  batch.closedAt = at;
  batch.history.push({ at, type: "close", detail: "批次结束，未放行；可重新开启新批次" });
  return { closed: false };
}

// 更正登记内容。已放行批次的关键字段被更正 -> 放行失效，履历留档
export function correctResult(batch, resultIdValue, patch = {}, at = nowIso(), by = "") {
  const result = batch.results.find((item) => item.id === resultIdValue);
  if (!result) return { error: "result_not_found", message: "结果不存在" };

  const changes = [];
  for (const key of KEY_FIELDS) {
    if (!(key in patch)) continue;
    let next = patch[key];
    if (key === "score") {
      next = Number(next);
      if (!Number.isFinite(next)) return { error: "score_invalid", message: "评分必须是数字" };
    } else {
      if (isBlank(next)) return { error: "field_blank", message: `${FIELD_LABELS[key]}不能为空` };
      next = String(next).trim();
    }
    if (String(next) !== String(result[key])) changes.push({ key, from: result[key], to: next });
  }

  let noteChanged = false;
  if ("note" in patch && String(patch.note ?? "") !== String(result.note ?? "")) {
    noteChanged = true;
  }

  if (!changes.length && !noteChanged) return { changed: false };

  const wasReleased = isReleased(batch);
  for (const change of changes) result[change.key] = change.to;
  if (noteChanged) result.note = String(patch.note ?? "");

  const changeText = changes
    .map((change) => `${FIELD_LABELS[change.key]}：${change.from} → ${change.to}`)
    .join("；");
  const actor = by ? `（更正人：${by}）` : "";

  if (changes.length) {
    batch.history.push({
      at,
      type: wasReleased ? "revoke" : "correct",
      detail: `更正结果 ${result.id}${actor}：${changeText}${wasReleased ? "。关键字段变更，已放行批次失效" : "，已记入履历"}`,
      changes,
    });
  }
  if (noteChanged) {
    batch.history.push({ at, type: "correct", detail: `更正结果 ${result.id} 的备注${actor}，已记入履历` });
  }
  // 只有关键字段实际变更才使已放行批次失效；仅更正备注不影响放行
  if (wasReleased && changes.length) {
    batch.revokedAt = at;
    if (!batch.closedAt) batch.closedAt = at;
    batch.history.push({ at, type: "revoke", detail: "原放行判定失效，须重新走批次试磨与复核" });
  }
  return { changed: true, revoked: Boolean(wasReleased && changes.length), changes, noteChanged };
}

// 墨锭状态：完全由批次履历推导，保证列表/履历/刷新后一致
export function stickStatus(stick) {
  if (stick.batches.some(isOpen)) return STICK_TESTING;
  const last = stick.batches[stick.batches.length - 1];
  if (last && isReleased(last)) return STICK_RELEASED;
  if (stick.batches.length || stick.voids.length) return STICK_BLOCKED;
  return STICK_PENDING;
}

export function batchView(stick, batch) {
  const last = batch.results[batch.results.length - 1] || null;
  let nextReview = null;
  if (isOpen(batch) && last) {
    // 当前连续高分链首条试磨人，才是换人约束的真正对象
    let chainStart = last;
    for (let i = batch.results.length - 2; i >= 0; i--) {
      if (!isHigh(batch.results[i].score)) break;
      chainStart = batch.results[i];
    }
    nextReview = {
      notBefore: new Date(new Date(last.at).getTime() + REVIEW_GAP_MS).toISOString(),
      otherThanGrinder: chainStart.grinder,
    };
  }
  return {
    ...batch,
    label: batchLabel(stick, batch),
    status: batchStatus(batch),
    open: isOpen(batch),
    released: isReleased(batch),
    streak: streakOf(batch),
    streakDisplay: Math.min(streakOf(batch), 2),
    highScore: HIGH_SCORE,
    nextReview,
  };
}

export function stickView(stick) {
  return {
    ...stick,
    status: stickStatus(stick),
    batches: [...stick.batches].reverse().map((batch) => batchView(stick, batch)),
  };
}
