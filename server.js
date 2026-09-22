// HTTP 接线层：路由与入参校验；规则在 rules.js，存档在 store.js，页面在 page.js。

import http from "node:http";
import { page } from "./src/page.js";
import { Archive, dbPath, findItem, findBatch, findRecord, addHistory } from "./src/store.js";
import {
  STATE,
  ITEM_STATUS,
  FIELD_LABELS,
  KEY_FIELDS,
  missingFields,
  evaluateRelease,
  releaseView,
  deriveItemStatus,
} from "./src/rules.js";

const port = Number(process.env.PORT || 3037);
const archive = new Archive(process.env.DATA_PATH || dbPath);

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid_json");
  }
}

class HttpError extends Error {
  constructor(status, error) {
    super(error);
    this.status = status;
  }
}

function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

function newId(prefix) {
  return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
}

function trim(v) {
  return typeof v === "string" ? v.trim() : v;
}

// 解析前端 datetime-local（无时区）或 ISO 时间；默认当前时间
function parseAt(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return new Date().toISOString();
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, "invalid_at");
  return d.toISOString();
}

// 状态列表：所有状态由规则层推算，列表 / 履历 / 刷新共用同一结果
function stateView(db) {
  const items = db.items.map((item) => {
    const status = deriveItemStatus(item.batches || []);
    return {
      id: item.id,
      code: item.code,
      smokeSource: item.smokeSource,
      glueRatio: item.glueRatio,
      ageYears: item.ageYears,
      storage: item.storage,
      status,
      legacyLogs: item.legacyLogs || [],
      batches: (item.batches || []).map((b) => ({
        id: b.id,
        batchNo: b.batchNo,
        openedAt: b.openedAt,
        endedAt: b.endedAt || null,
        state: b.state,
        records: b.records,
        history: b.history,
        release: b.state === STATE.OPEN ? releaseView(b.records) : null,
      })),
    };
  });
  const stats = Object.fromEntries(ITEM_STATUS.map((s) => [s, 0]));
  for (const item of items) stats[item.status] += 1;
  return { items, stats };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const db = await archive.load();

    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(page());
    }

    if (req.method === "GET" && url.pathname === "/api/state") {
      return send(res, 200, stateView(db));
    }

    // 墨锭建档
    if (req.method === "POST" && url.pathname === "/api/items") {
      const input = await body(req);
      const code = trim(input.code);
      if (!code) throw new HttpError(400, "code_required");
      if (db.items.some((x) => x.code === code)) throw new HttpError(409, "code_exists");
      const item = {
        id: newId("item"),
        code,
        smokeSource: trim(input.smokeSource) || "",
        glueRatio: trim(input.glueRatio) || "",
        ageYears: input.ageYears === "" || input.ageYears === undefined ? null : Number(input.ageYears),
        storage: trim(input.storage) || "",
        batches: [],
      };
      db.items.unshift(item);
      await archive.save();
      return send(res, 201, stateView(db).items.find((x) => x.id === item.id));
    }

    // 开启新批次：同一墨锭存在未结束批次时拒绝
    const openMatch = url.pathname.match(/^\/api\/items\/([^/]+)\/batches$/);
    if (openMatch && req.method === "POST") {
      await body(req);
      const item = findItem(db, decodeURIComponent(openMatch[1]));
      if (!item) throw new HttpError(404, "item_not_found");
      const open = (item.batches || []).find((b) => b.state === STATE.OPEN);
      if (open) throw new HttpError(409, "open_batch_exists:" + open.batchNo);
      item.batches ||= [];
      const batch = {
        id: newId("batch"),
        batchNo: archive.nextBatchNo(),
        openedAt: new Date().toISOString(),
        endedAt: null,
        state: STATE.OPEN,
        records: [],
        history: [],
      };
      addHistory(batch, "open", "开启批次 #" + batch.batchNo);
      item.batches.push(batch);
      await archive.save();
      return send(res, 201, stateView(db).items.find((x) => x.id === item.id));
    }

    // 登记试磨结果
    const recordMatch = url.pathname.match(
      /^\/api\/items\/([^/]+)\/batches\/([^/]+)\/records$/
    );
    if (recordMatch && req.method === "POST") {
      const input = await body(req);
      const item = findItem(db, decodeURIComponent(recordMatch[1]));
      if (!item) throw new HttpError(404, "item_not_found");
      const batch = findBatch(item, decodeURIComponent(recordMatch[2]));
      if (!batch) throw new HttpError(404, "batch_not_found");
      if (batch.state !== STATE.OPEN) throw new HttpError(409, "batch_not_open");

      const at = parseAt(input.at);
      const missing = missingFields(input);

      // 缺项：该批次作废且不占号；登记内容（原样）留档
      if (missing.length) {
        const record = {
          id: newId("rec"),
          at,
          grinder: trim(input.grinder) || "",
          mouth: trim(input.mouth) || "",
          water: trim(input.water) || "",
          paper: trim(input.paper) || "",
          temp: trim(input.temp) || "",
          humidity: trim(input.humidity) || "",
          score: missing.includes("评分") ? null : Number(input.score),
          incomplete: true,
          missing,
        };
        batch.records.push(record);
        addHistory(
          batch,
          "record",
          "缺项登记（缺：" + missing.join("、") + "），记录留档",
          { recordId: record.id }
        );
        batch.state = STATE.VOID;
        batch.endedAt = at;
        addHistory(
          batch,
          "void",
          "登记缺项（" + missing.join("、") + "），批次作废且不占号；号码 #" + batch.batchNo + " 回收"
        );
        archive.releaseBatchNo(batch.batchNo);
        batch.batchNo = null;
        await archive.save();
        return send(res, 201, {
          voided: true,
          missing,
          item: stateView(db).items.find((x) => x.id === item.id),
        });
      }

      const score = Number(input.score);
      const record = {
        id: newId("rec"),
        at,
        grinder: trim(input.grinder),
        mouth: trim(input.mouth),
        water: trim(input.water),
        paper: trim(input.paper),
        temp: trim(input.temp),
        humidity: trim(input.humidity),
        score,
      };
      batch.records.push(record);
      addHistory(
        batch,
        "record",
        `${record.grinder} 登记结果 ${score} 分${score >= 85 ? "（高分）" : "（低分，连续高分计数重置）"}`,
        { recordId: record.id }
      );

      // 自动放行判定：连续两次高分 + 换人 + 隔 4 小时
      const result = evaluateRelease(batch.records);
      if (result.releasable) {
        batch.state = STATE.RELEASED;
        batch.endedAt = at;
        const [a, b] = result.pair;
        addHistory(
          batch,
          "release",
          `两次高分（${a.grinder} ${a.score} 分 / ${b.grinder} ${b.score} 分）、换人且间隔满 4 小时，自动放行`
        );
      }
      await archive.save();
      return send(res, 201, {
        voided: false,
        release: releaseView(batch.records),
        released: result.releasable,
        item: stateView(db).items.find((x) => x.id === item.id),
      });
    }

    // 更正关键字段：已放行批次因此失效；旧值留档
    const correctMatch = url.pathname.match(
      /^\/api\/items\/([^/]+)\/batches\/([^/]+)\/records\/([^/]+)$/
    );
    if (correctMatch && req.method === "PATCH") {
      const input = await body(req);
      const item = findItem(db, decodeURIComponent(correctMatch[1]));
      if (!item) throw new HttpError(404, "item_not_found");
      const batch = findBatch(item, decodeURIComponent(correctMatch[2]));
      if (!batch) throw new HttpError(404, "batch_not_found");
      const record = findRecord(batch, decodeURIComponent(correctMatch[3]));
      if (!record) throw new HttpError(404, "record_not_found");

      const reason = trim(input.reason);
      if (!reason) throw new HttpError(400, "reason_required");

      const changes = [];
      for (const [key, label] of KEY_FIELDS) {
        if (input[key] === undefined || input[key] === null || String(input[key]).trim() === "") {
          continue; // 未填的字段保持原值，不允许通过更正清空关键字段
        }
        let next = trim(input[key]);
        if (key === "score") {
          next = Number(next);
          if (!Number.isFinite(next)) throw new HttpError(400, "invalid_score");
        }
        if (String(record[key]) !== String(next)) {
          changes.push({ key, label, from: record[key], to: next });
          record[key] = next;
        }
      }
      if (!changes.length) throw new HttpError(400, "no_changes");

      const detail = changes
        .map((c) => `${c.label}：「${c.from}」→「${c.to}」`)
        .join("；");
      addHistory(batch, "correct", `更正结果 ${record.grinder} ${record.at}：${detail}（原因：${reason}）`, {
        recordId: record.id,
        changes,
        reason,
      });

      let invalidated = false;
      if (batch.state === STATE.RELEASED) {
        batch.state = STATE.INVALID;
        batch.endedAt = new Date().toISOString();
        invalidated = true;
        addHistory(batch, "invalidate", "关键字段更正，已通过批次失效，须重开批次重新放行");
      }
      await archive.save();
      return send(res, 200, {
        invalidated,
        changes,
        item: stateView(db).items.find((x) => x.id === item.id),
      });
    }

    return send(res, 404, { error: "not_found" });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    send(res, status, { error: status === 500 ? error.message : error.message });
  }
});

server.listen(port, () =>
  console.log("墨锭试磨室 · 试磨批次与放行台 listening on http://localhost:" + port)
);
