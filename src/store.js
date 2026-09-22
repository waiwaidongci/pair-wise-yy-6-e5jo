// JSON 存档层：只负责数据读写、占号和迁移，业务规则由 rules.js / server.js 决定。

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { STATE } from "./rules.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const dbPath = join(__dirname, "..", "data", "ink-stick-testing.json");

// 全新环境的种子数据：一锭已放行（连续两次高分、换人、隔 4 小时），一锭待试磨
function seedDb() {
  return {
    seq: 3,
    freeNos: [],
    items: [
      {
        id: "item-1",
        code: "IS-001",
        smokeSource: "黄山松烟",
        glueRatio: "7.5%",
        ageYears: 8,
        storage: "恒湿柜B",
        batches: [
          {
            id: "batch-1",
            batchNo: 1,
            openedAt: "2026-06-11T01:00:00.000Z",
            endedAt: "2026-06-11T05:30:00.000Z",
            state: STATE.RELEASED,
            records: [
              {
                id: "rec-1",
                at: "2026-06-11T01:00:00.000Z",
                grinder: "许墨卿",
                mouth: "砚台正面中圈，顺时针磨口",
                water: "清水 20 滴",
                paper: "净皮宣纸",
                temp: "22℃",
                humidity: "58%",
                score: 86,
              },
              {
                id: "rec-2",
                at: "2026-06-11T05:30:00.000Z",
                grinder: "沈砚农",
                mouth: "砚台正面中圈，顺时针磨口",
                water: "清水 20 滴",
                paper: "净皮宣纸",
                temp: "22℃",
                humidity: "57%",
                score: 88,
              },
            ],
            history: [
              { at: "2026-06-11T01:00:00.000Z", type: "open", note: "开启批次 #1" },
              {
                at: "2026-06-11T01:00:00.000Z",
                type: "record",
                note: "许墨卿 登记结果 86 分",
                recordId: "rec-1",
              },
              {
                at: "2026-06-11T05:30:00.000Z",
                type: "record",
                note: "沈砚农 登记结果 88 分",
                recordId: "rec-2",
              },
              { at: "2026-06-11T05:30:00.000Z", type: "release", note: "两次高分、换人且间隔满 4 小时，自动放行" },
            ],
          },
        ],
      },
      {
        id: "item-2",
        code: "IS-002",
        smokeSource: "桐油烟",
        glueRatio: "8%",
        ageYears: 3,
        storage: "试样盒C",
        batches: [],
      },
    ],
  };
}

export class Archive {
  constructor(path = dbPath) {
    this.path = path;
  }

  async load() {
    if (!existsSync(this.path)) {
      await mkdir(dirname(this.path), { recursive: true });
      this.db = seedDb();
      await this.save();
      return this.db;
    }
    const raw = JSON.parse(await readFile(this.path, "utf8"));
    const alreadyMigrated =
      Array.isArray(raw.items) && raw.items.some((x) => Array.isArray(x.batches));
    this.db = this.#migrate(raw);
    if (!alreadyMigrated) await this.save();
    return this.db;
  }

  async save() {
    await writeFile(this.path, JSON.stringify(this.db, null, 2));
  }

  // 旧版墨锭试磨室（item.logs / item.tests）一次性迁入批次存档
  #migrate(raw) {
    if (Array.isArray(raw.items) && raw.items.some((x) => Array.isArray(x.batches))) {
      raw.seq ||= raw.items.reduce((max, item) => {
        const nos = (item.batches || []).map((b) => b.batchNo || 0);
        return Math.max(max, ...nos);
      }, 0) + 1;
      raw.freeNos ||= [];
      return raw;
    }
    const items = (raw.items || []).map((item, itemIdx) => {
      const batches = [];
      const tests = item.tests || item.logs?.filter((l) => l.step === "试磨") || [];      if (tests.length) {
        const records = tests.map((t, i) => ({
          id: `legacy-rec-${itemIdx + 1}-${i + 1}`,
          at: t.at,
          grinder: t.grinder || "旧档试磨人",
          mouth: t.mouth || "（旧档未登记）",
          water: t.water || "（旧档未登记）",
          paper: t.paper || t.note || "（旧档未登记）",
          temp: t.temp || "（旧档未登记）",
          humidity: t.humidity || "（旧档未登记）",
          score: Number(t.score) || 0,
          legacy: true,
        }));
        batches.push({
          id: `legacy-batch-${itemIdx + 1}`,
          batchNo: null, // 作废批次不占号
          openedAt: records[0].at,
          endedAt: records[records.length - 1].at,
          state: STATE.VOID,
          records,
          history: [
            { at: records[0].at, type: "open", note: "旧档迁移为留档批次" },
            {
              at: new Date().toISOString(),
              type: "void",
              note: "旧版试磨记录缺少磨口 / 室温 / 湿度 / 试磨人等登记项，迁移为作废留档批次（不占号）",
            },
          ],
        });
      }
      const { id, logs, tests: _tests, status, ...rest } = item;
      return {
        id: id || `legacy-item-${itemIdx + 1}`,
        ...rest,
        batches,
        legacyLogs: logs || [],
      };
    });
    return { seq: 1, freeNos: [], items };
  }

  // 占号：作废批次会把号放回号码池，之后开启的批次优先复用，故“不占号”
  nextBatchNo() {
    if (this.db.freeNos.length) return this.db.freeNos.sort((a, b) => a - b).shift();
    return this.db.seq++;
  }

  // 作废且不占号：号码回到池中等待复用
  releaseBatchNo(no) {
    if (no == null) return;
    if (!this.db.freeNos.includes(no)) this.db.freeNos.push(no);
  }
}

export function findItem(db, idOrCode) {
  return db.items.find((x) => x.id === idOrCode || x.code === idOrCode) || null;
}

export function findBatch(item, batchId) {
  return (item?.batches || []).find((b) => b.id === batchId || String(b.batchNo) === String(batchId)) || null;
}

export function findRecord(batch, recordId) {
  return (batch?.records || []).find((r) => r.id === recordId) || null;
}

export function addHistory(batch, type, note, extra = {}) {
  batch.history.push({ at: new Date().toISOString(), type, note, ...extra });
}
