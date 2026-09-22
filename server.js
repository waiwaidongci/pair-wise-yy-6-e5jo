import http from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Archive, STATUS_COUNTS } from "./archive.js";
import {
  openBatch,
  addResult,
  closeBatch,
  correctResult,
  stickView,
  stickStatus,
  batchView,
  nowIso,
} from "./rules.js";
import { page } from "./page.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "data", "ink-stick-testing.json");
const port = Number(process.env.PORT || 3037);
const archive = new Archive(dbPath);

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw { status: 400, error: "bad_json", message: "请求体不是合法 JSON" };
  }
}
function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}
function html(res, text) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(text);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const p = url.pathname;
    const at = nowIso();
    await archive.load();

    if (req.method === "GET" && p === "/") return html(res, page());

    if (req.method === "GET" && p === "/api/sticks") {
      return send(res, 200, archive.listSticks().map(stickView));
    }

    if (req.method === "GET" && p === "/api/stats") {
      const stats = Object.fromEntries(STATUS_COUNTS.map((label) => [label, 0]));
      for (const stick of archive.listSticks()) stats[stickStatus(stick)] += 1;
      return send(res, 200, stats);
    }

    if (req.method === "POST" && p === "/api/sticks") {
      const input = await body(req);
      const stick = archive.addStick(input);
      await archive.save();
      return send(res, 201, stickView(stick));
    }

    const profile = p.match(/^\/api\/sticks\/([^/]+)$/);
    if (profile && req.method === "PATCH") {
      const stick = archive.updateProfile(decodeURIComponent(profile[1]), await body(req));
      if (!stick) return send(res, 404, { error: "stick_not_found", message: "墨锭不存在" });
      await archive.save();
      return send(res, 200, stickView(stick));
    }

    // 开启批次（首次登记）：缺项作废不占号；有未结束批次时拒绝
    const open = p.match(/^\/api\/sticks\/([^/]+)\/batches$/);
    if (open && req.method === "POST") {
      const stick = archive.findStick(decodeURIComponent(open[1]));
      if (!stick) return send(res, 404, { error: "stick_not_found", message: "墨锭不存在" });
      const out = openBatch(stick, await body(req), at);
      if (out.conflict) {
        return send(res, 409, { error: "batch_open_exists", message: "该墨锭存在未结束批次，不能开启新批次" });
      }
      await archive.save();
      if (out.voided) {
        return send(res, 200, { voided: true, missing: out.missing });
      }
      return send(res, 201, { batch: batchView(stick, out.batch) });
    }

    const resultPost = p.match(/^\/api\/sticks\/([^/]+)\/batches\/(\d+)\/results$/);
    if (resultPost && req.method === "POST") {
      const found = archive.findBatch(decodeURIComponent(resultPost[1]), resultPost[2]);
      if (found.error) return send(res, 404, { error: found.error });
      const out = addResult(found.batch, await body(req), at);
      if (out.closed) return send(res, 409, { error: "batch_not_open", message: "该批次已结束，不能再登记结果" });
      await archive.save();
      if (out.invalid) return send(res, 200, { invalid: true, missing: out.missing });
      return send(res, 201, {
        batch: batchView(found.stick, found.batch),
        released: Boolean(out.released),
        streak: out.streak,
        reasons: out.reasons || [],
      });
    }

    const close = p.match(/^\/api\/sticks\/([^/]+)\/batches\/(\d+)\/close$/);
    if (close && req.method === "POST") {
      const found = archive.findBatch(decodeURIComponent(close[1]), close[2]);
      if (found.error) return send(res, 404, { error: found.error });
      const out = closeBatch(found.batch, at);
      if (out.closed) return send(res, 409, { error: "batch_not_open", message: "该批次不在进行中" });
      await archive.save();
      return send(res, 200, { batch: batchView(found.stick, found.batch) });
    }

    const resultPatch = p.match(/^\/api\/sticks\/([^/]+)\/batches\/(\d+)\/results\/([^/]+)$/);
    if (resultPatch && req.method === "PATCH") {
      const found = archive.findBatch(decodeURIComponent(resultPatch[1]), resultPatch[2]);
      if (found.error) return send(res, 404, { error: found.error });
      const input = await body(req);
      const out = correctResult(found.batch, decodeURIComponent(resultPatch[3]), input.patch || {}, at, input.by || "");
      if (out.error === "result_not_found") return send(res, 404, out);
      if (out.error) return send(res, 400, out);
      await archive.save();
      return send(res, 200, {
        batch: batchView(found.stick, found.batch),
        changed: Boolean(out.changed),
        revoked: Boolean(out.revoked),
      });
    }

    return send(res, 404, { error: "not_found" });
  } catch (error) {
    if (error && error.status) return send(res, error.status, { error: error.error, message: error.message });
    return send(res, 500, { error: error.message });
  }
});

server.listen(port, () => console.log("墨锭试磨批次与放行台 listening on http://localhost:" + port));
