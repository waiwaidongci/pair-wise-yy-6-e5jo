// 存档模块：只负责批次/墨锭数据的持久化、编号唯一性与旧版数据迁移
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import {
  createStick,
  STICK_PENDING,
  STICK_TESTING,
  STICK_RELEASED,
  STICK_BLOCKED,
} from "./rules.js";

export const SCHEMA_VERSION = 2;

const seed = {
  version: SCHEMA_VERSION,
  sticks: [
    createStick({
      code: "IS-001",
      smokeSource: "黄山松烟",
      glueRatio: "7.5%",
      ageYears: 8,
      storage: "恒湿柜B",
    }),
    createStick({
      code: "IS-002",
      smokeSource: "桐油烟",
      glueRatio: "8%",
      ageYears: 3,
      storage: "试样盒C",
    }),
  ],
};

// 旧版（v1：墨锭 + logs + tests）迁移为 v2。
// 旧记录无法还原"换人+4小时"的复核链，一律转存 legacy 只读留档，不占用批次号。
function migrate(db) {
  const migrated = { version: SCHEMA_VERSION, sticks: [] };
  for (const oldItem of db.items || []) {
    const stick = createStick({
      code: oldItem.code,
      smokeSource: oldItem.smokeSource,
      glueRatio: oldItem.glueRatio,
      ageYears: oldItem.ageYears,
      storage: oldItem.storage,
    });
    stick.legacy = [
      ...(oldItem.logs || []).map((entry) => ({
        at: entry.at || "",
        step: entry.step || "记录",
        note: entry.note || "",
        score: entry.score === undefined ? null : Number(entry.score),
      })),
      ...(oldItem.tests || []).map((test) => ({
        at: test.at || "",
        step: "试磨",
        note: `纸样 ${test.paper || "未登记"} / 用水 ${test.water || "未登记"}，评分 ${test.score ?? "未登记"}`,
        score: test.score === undefined ? null : Number(test.score),
      })),
    ];
    migrated.sticks.push(stick);
  }
  return migrated;
}

export class Archive {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
  }

  async load() {
    if (!existsSync(this.dbPath)) {
      await mkdir(dirname(this.dbPath), { recursive: true });
      this.db = seed;
      await this.save();
      return this.db;
    }
    const raw = JSON.parse(await readFile(this.dbPath, "utf8"));
    this.db = raw.version === SCHEMA_VERSION ? raw : migrate(raw);
    await this.save();
    return this.db;
  }

  async save() {
    await writeFile(this.dbPath, JSON.stringify(this.db, null, 2));
  }

  listSticks() {
    return this.db.sticks;
  }

  findStick(code) {
    return this.db.sticks.find((stick) => stick.code === code);
  }

  addStick(input) {
    const code = String(input.code || "").trim();
    if (this.findStick(code)) {
      throw { status: 409, error: "code_exists", message: "墨锭编号已存在" };
    }
    const stick = createStick(input);
    this.db.sticks.unshift(stick);
    return stick;
  }

  updateProfile(code, patch = {}) {
    const stick = this.findStick(code);
    if (!stick) return null;
    for (const key of ["smokeSource", "glueRatio", "storage"]) {
      if (key in patch) stick[key] = String(patch[key] ?? "").trim();
    }
    if ("ageYears" in patch) {
      stick.ageYears = isBlankValue(patch.ageYears) ? null : Number(patch.ageYears);
    }
    return stick;
  }

  findBatch(code, no) {
    const stick = this.findStick(code);
    if (!stick) return { error: "stick_not_found" };
    const batch = stick.batches.find((item) => item.no === Number(no));
    if (!batch) return { error: "batch_not_found" };
    return { stick, batch };
  }
}

function isBlankValue(value) {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

export const STATUS_COUNTS = [STICK_PENDING, STICK_TESTING, STICK_RELEASED, STICK_BLOCKED];
