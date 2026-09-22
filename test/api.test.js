import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

async function startServer(dataPath) {
  const port = 4100 + Math.floor(Math.random() * 800);
  const child = spawn(process.execPath, [join(root, "server.js")], {
    env: { ...process.env, PORT: String(port), DATA_PATH: dataPath },
    cwd: root,
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server start timeout")), 5000);
    child.stdout.on("data", (d) => {
      if (String(d).includes("listening")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr.on("data", (d) => process.stderr.write(d));
    child.on("exit", (code) => reject(new Error("server exited " + code)));
  });
  const base = `http://localhost:${port}`;
  const api = async (path, options) => {
    const res = await fetch(base + path, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
    });
    const json = await res.json();
    return { status: res.status, json };
  };
  return {
    child,
    api,
    stop: () => child.kill("SIGTERM"),
  };
}

const fullRecord = (over = {}) => ({
  grinder: "许墨卿",
  mouth: "砚台正面中圈",
  water: "清水 20 滴",
  paper: "净皮宣纸",
  temp: "22℃",
  humidity: "58%",
  score: 90,
  ...over,
});

const isoAt = (h) => new Date(Date.UTC(2026, 8, 20, 0, 0) + h * 3600000).toISOString();
const localAt = (h) => new Date(Date.UTC(2026, 8, 20, 0, 0) + h * 3600000)
  .toISOString().slice(0, 16);

test("端到端：缺项作废不占号、换人四小时放行、低分重置、更正失效、刷新一致", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "ink-e2e-"));
  const dataPath = join(dir, "db.json");
  const server = await startServer(dataPath);
  t.after(server.stop);
  t.after(() => rm(dir, { recursive: true, force: true }));

  const { api } = server;

  // 种子：IS-001 已放行、IS-002 待试磨
  let state = (await api("/api/state")).json;
  assert.equal(state.stats["已放行"], 1);
  assert.equal(state.stats["待试磨"], 1);

  // 建档
  let r = await api("/api/items", { method: "POST", body: JSON.stringify({ code: "IS-100", smokeSource: "油烟" }) });
  assert.equal(r.status, 201);
  const itemId = r.json.id;

  // 开启批次 #3（种子占用了 #1）
  r = await api(`/api/items/${itemId}/batches`, { method: "POST", body: "{}" });
  assert.equal(r.status, 201);
  const batchId = r.json.batches[0].id;
  assert.equal(r.json.batches[0].batchNo, 3);
  assert.equal(r.json.status, "试磨中");

  // 未结束批次内不能开启新批次
  r = await api(`/api/items/${itemId}/batches`, { method: "POST", body: "{}" });
  assert.equal(r.status, 409);
  assert.match(r.json.error, /open_batch_exists/);

  // 缺项登记 → 批次作废且不占号
  r = await api(`/api/items/${itemId}/batches/${batchId}/records`, {
    method: "POST",
    body: JSON.stringify(fullRecord({ humidity: "", at: localAt(0) })),
  });
  assert.equal(r.status, 201);
  assert.equal(r.json.voided, true);
  assert.deepEqual(r.json.missing, ["湿度"]);
  let item = r.json.item;
  assert.equal(item.batches[0].state, "已作废");
  assert.equal(item.batches[0].batchNo, null); // 不占号
  assert.equal(item.batches[0].records[0].incomplete, true);
  assert.equal(item.status, "待试磨");

  // 新批次复用刚回收的号码 #3
  r = await api(`/api/items/${itemId}/batches`, { method: "POST", body: "{}" });
  assert.equal(r.status, 201);
  const batch2 = r.json.batches.find((b) => b.state === "进行中");
  assert.equal(batch2.batchNo, 3);

  // 同一试磨人连续两次高分（间隔够）→ 不可放行
  r = await api(`/api/items/${itemId}/batches/${batch2.id}/records`, {
    method: "POST",
    body: JSON.stringify(fullRecord({ grinder: "许墨卿", score: 88, at: localAt(1) })),
  });
  assert.equal(r.json.released, false);
  r = await api(`/api/items/${itemId}/batches/${batch2.id}/records`, {
    method: "POST",
    body: JSON.stringify(fullRecord({ grinder: "许墨卿", score: 92, at: localAt(6) })),
  });
  assert.equal(r.status, 201);
  assert.equal(r.json.released, false);
  assert.match(r.json.release.blockers.join(" "), /换人/);

  // 换人但不足 4 小时 → 不可放行
  r = await api(`/api/items/${itemId}/batches/${batch2.id}/records`, {
    method: "POST",
    body: JSON.stringify(fullRecord({ grinder: "沈砚农", score: 95, at: localAt(8) })),
  });
  assert.equal(r.json.released, false);
  assert.match(r.json.release.blockers.join(" "), /4 小时/);

  // 低分 → 连续高分计数重置（记录留档）
  r = await api(`/api/items/${itemId}/batches/${batch2.id}/records`, {
    method: "POST",
    body: JSON.stringify(fullRecord({ grinder: "沈砚农", score: 60, at: localAt(10) })),
  });
  assert.equal(r.json.release.streakCount, 0);
  assert.equal(r.json.released, false);
  item = (await api("/api/state")).json.items.find((x) => x.id === itemId);
  assert.equal(item.batches.find((b) => b.id === batch2.id).records.length, 4);

  // 换人 + 隔 4 小时 + 连续两次高分 → 自动放行
  r = await api(`/api/items/${itemId}/batches/${batch2.id}/records`, {
    method: "POST",
    body: JSON.stringify(fullRecord({ grinder: "许墨卿", score: 86, at: localAt(20) })),
  });
  assert.equal(r.json.released, false);
  r = await api(`/api/items/${itemId}/batches/${batch2.id}/records`, {
    method: "POST",
    body: JSON.stringify(fullRecord({ grinder: "沈砚农", score: 90, at: localAt(25) })),
  });
  assert.equal(r.status, 201);
  assert.equal(r.json.released, true);
  assert.equal(r.json.item.status, "已放行");

  // 更正放行批次的关键字段 → 失效；无原因拒绝
  const lastRecordId = r.json.item.batches
    .find((b) => b.id === batch2.id)
    .records.at(-1).id;
  r = await api(`/api/items/${itemId}/batches/${batch2.id}/records/${lastRecordId}`, {
    method: "PATCH",
    body: JSON.stringify({ score: 91 }),
  });
  assert.equal(r.status, 400);
  r = await api(`/api/items/${itemId}/batches/${batch2.id}/records/${lastRecordId}`, {
    method: "PATCH",
    body: JSON.stringify({ score: 91, reason: "誊写错误" }),
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.invalidated, true);
  const batch = r.json.item.batches.find((b) => b.id === batch2.id);
  assert.equal(batch.state, "已失效");
  assert.match(batch.history.at(-1).note, /关键字段更正/);
  assert.equal(r.json.item.status, "放行失效");

  // 已结束批次（失效）允许再开新批次；号码继续递增
  r = await api(`/api/items/${itemId}/batches`, { method: "POST", body: "{}" });
  assert.equal(r.status, 201);
  assert.equal(r.json.batches.find((b) => b.state === "进行中").batchNo, 4);

  // 刷新后状态一致：存档里没有冗余状态字段，状态全部由规则推算
  const persisted = JSON.parse(await readFile(dataPath, "utf8"));
  const persistedItem = persisted.items.find((x) => x.id === itemId);
  assert.equal(persistedItem.status, undefined);
  state = (await api("/api/state")).json;
  assert.equal(state.items.find((x) => x.id === itemId).status, "试磨中");
});

test("旧版存档自动迁移：缺登记项的旧试磨记录变作废留档批次且不占号", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "ink-migrate-"));
  const dataPath = join(dir, "ink-stick-testing.json");
  await mkdtemp(join(dirname(dataPath))); // ensure parent exists
  await writeFile(
    dataPath,
    JSON.stringify({
      items: [
        {
          code: "IS-001",
          smokeSource: "黄山松烟",
          status: "已试磨",
          logs: [{ at: "2026-06-11", step: "试磨", note: "宣纸20滴水，评分86", score: 86 }],
        },
      ],
    })
  );
  const server = await startServer(dataPath);
  t.after(server.stop);
  t.after(() => rm(dir, { recursive: true, force: true }));

  const r = await server.api("/api/state");
  const item = r.json.items[0];
  assert.equal(item.status, "待试磨");
  assert.equal(item.batches[0].state, "已作废");
  assert.equal(item.batches[0].batchNo, null);
  assert.equal(item.batches[0].records[0].score, 86);
  assert.ok(item.legacyLogs.length >= 1);
  // 迁移后新批次从 #1 开始（旧作废批次不占号）
  const opened = await server.api(`/api/items/${item.id}/batches`, {
    method: "POST",
    body: "{}",
  });
  assert.equal(opened.json.batches.find((b) => b.state === "进行中").batchNo, 1);
});
