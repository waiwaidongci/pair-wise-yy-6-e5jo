// 页面模块：只负责 HTML 与浏览器端交互，不含业务判定（状态一律取服务端推导结果）
import {
  REGISTER_FIELDS,
  HIGH_SCORE,
  REVIEW_GAP_MS,
  STICK_PENDING,
  STICK_TESTING,
  STICK_RELEASED,
  STICK_BLOCKED,
} from "./rules.js";

const STATUSES = [STICK_PENDING, STICK_TESTING, STICK_RELEASED, STICK_BLOCKED];

function registerInputs() {
  return REGISTER_FIELDS.map(([key, label]) =>
    `<label>${label}<span class="req">*</span></label><input name="${key}" required autocomplete="off" placeholder="${label}">`
  ).join("")
    + `<label>评分<span class="req">*</span>（≥ ${HIGH_SCORE} 为高分）</label><input name="score" type="number" min="0" max="100" step="1" required>`
    + `<label>备注</label><input name="note" autocomplete="off" placeholder="选填">`;
}

export function page() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>墨锭试磨批次与放行台</title>
  <style>
    :root { --bg:#f1f3ef; --panel:#fff; --ink:#20241f; --muted:#687066; --line:#d4ddd0; --accent:#526f43; --good:#3d7a4f; --warn:#9b4937; --hold:#8a6d2b; }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:20px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; }
    h1 { margin:0; font-size:24px; } h2 { margin:0 0 10px; font-size:17px; } h3 { margin:0; font-size:18px; }
    main { display:grid; grid-template-columns:400px 1fr; gap:20px; padding:20px 28px; align-items:start; }
    form,.panel,.card { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:15px; }
    label { display:block; margin:9px 0 4px; color:var(--muted); font-size:13px; }
    input,select { width:100%; border:1px solid var(--line); border-radius:6px; padding:8px; font:inherit; background:#fff; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:8px 12px; font-weight:700; cursor:pointer; margin-top:10px; }
    button.secondary { background:#69736a; } button.danger { background:var(--warn); } button.mini { padding:4px 9px; font-size:12px; margin-top:4px; }
    .stack > * + * { margin-top:14px; }
    .req { color:var(--warn); margin-left:2px; }
    .stats { display:grid; grid-template-columns:repeat(4,minmax(110px,1fr)); gap:10px; margin-bottom:14px; }
    .stat { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:12px 14px; }
    .stat strong { display:block; font-size:24px; margin-top:2px; }
    .toolbar { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px; }
    .toolbar select,.toolbar input { width:auto; min-width:160px; }
    .cards { display:grid; grid-template-columns:repeat(auto-fill,minmax(360px,1fr)); gap:12px; }
    .card { display:grid; gap:8px; }
    .meta { color:var(--muted); font-size:13px; }
    .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:2px 9px; font-size:12px; }
    .pill.testing { color:var(--accent); border-color:var(--accent); }
    .pill.good { color:#fff; background:var(--good); border-color:var(--good); }
    .pill.bad { color:var(--warn); border-color:var(--warn); }
    .pill.hold { color:var(--hold); border-color:var(--hold); }
    .profile { display:grid; grid-template-columns:1fr 1fr; gap:2px 12px; font-size:13px; }
    .batch { border:1px solid var(--line); border-radius:8px; padding:10px 12px; display:grid; gap:8px; background:#fafcf8; }
    .batch-head { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
    .result { border-left:3px solid var(--line); padding:6px 10px; background:#fff; border-radius:0 6px 6px 0; font-size:13px; display:grid; gap:3px; }
    .result.high { border-left-color:var(--good); } .result.low { border-left-color:var(--warn); }
    .score-tag { font-weight:700; } .score-tag.high { color:var(--good); } .score-tag.low { color:var(--warn); }
    .history { border-top:1px dashed var(--line); padding-top:6px; max-height:150px; overflow:auto; display:grid; gap:3px; font-size:12px; }
    .void-item,.legacy-item { font-size:12px; color:var(--warn); }
    .legacy-item { color:var(--muted); }
    .correctForm { border-top:1px dashed var(--line); padding-top:8px; margin-top:6px; display:grid; grid-template-columns:1fr 1fr; gap:0 10px; }
    .correctForm .wide { grid-column:1 / -1; } .correctForm .actions { grid-column:1 / -1; display:flex; gap:8px; }
    .warnbox { grid-column:1 / -1; border:1px solid var(--warn); color:var(--warn); border-radius:6px; padding:7px 9px; font-size:12px; }
    .streak { font-weight:700; color:var(--hold); }
    .rules li { margin:4px 0; font-size:13px; }
    #toast { position:fixed; right:18px; bottom:18px; display:grid; gap:8px; z-index:10; }
    .toast { background:#2c332a; color:#fff; padding:10px 14px; border-radius:8px; max-width:360px; font-size:13px; box-shadow:0 4px 14px rgba(0,0,0,.2); }
    .toast.err { background:var(--warn); } .toast.warn { background:var(--hold); } .toast.ok { background:var(--good); }
    .empty { color:var(--muted); font-size:13px; padding:8px 0; }
    @media (max-width:960px){ header{display:block;padding:16px;} main{grid-template-columns:1fr;padding:14px;} }
  </style>
</head>
<body>
  <header>
    <div><h1>墨锭试磨批次与放行台</h1><div class="meta">批次开启 · 换人四小时复核 · 两次高分放行 · 更正失效留档</div></div>
    <button id="reload">刷新</button>
  </header>
  <main>
    <section class="stack">
      <form id="createForm">
        <h2>新增墨锭</h2>
        <label>墨锭编号<span class="req">*</span></label><input name="code" required autocomplete="off">
        <label>烟料来源</label><input name="smokeSource" autocomplete="off">
        <label>胶料比例</label><input name="glueRatio" autocomplete="off">
        <label>存放年限</label><input name="ageYears" type="number" min="0" step="1">
        <label>存放位置</label><input name="storage" autocomplete="off">
        <button>保存墨锭</button>
      </form>

      <form id="openForm">
        <h2>开启试磨批次（首次登记）</h2>
        <label>墨锭<span class="req">*</span></label><select name="code" id="openStick"></select>
        <div class="meta">每锭同一时间只能有一个未结束批次；下列六项与评分缺任一项，本批次作废且不占号。</div>
        ${registerInputs()}
        <button>开启批次</button>
      </form>

      <form id="reviewForm">
        <h2>试磨 / 复核登记</h2>
        <label>进行中批次<span class="req">*</span></label><select name="batch" id="reviewBatch"><option value="">（无进行中批次）</option></select>
        <div class="meta" id="reviewHint">同一试磨人连续两次不能放行；须换人且间隔满 4 小时，连续两次高分（≥ ${HIGH_SCORE}）才放行；任一低分计数清零，记录留档。</div>
        ${registerInputs()}
        <button>提交结果</button>
      </form>

      <div class="panel rules">
        <h2>放行规则</h2>
        <ul>
          <li>每锭在未结束批次内不能开启新批次。</li>
          <li>必须登记：磨口、用水、纸样、室温、湿度、试磨人，并给出评分；缺项即作废、不占号。</li>
          <li>评分 ≥ ${HIGH_SCORE} 为高分；连续两次高分才通过。</li>
          <li>同一试磨人连续两次结果不能放行，须换人、间隔满 4 小时复核。</li>
          <li>任一低分立即重置连续高分计数；旧记录全部留档。</li>
          <li>更正已通过批次的关键字段（六项登记或评分）会使放行失效，履历留档。</li>
        </ul>
      </div>
    </section>

    <section>
      <div class="stats" id="stats"></div>
      <div class="toolbar">
        <select id="statusFilter"><option value="">全部状态</option>${STATUSES.map((s) => `<option>${s}</option>`).join("")}</select>
        <input id="search" placeholder="搜索编号、试磨人或关键词">
      </div>
      <div class="cards" id="cards"></div>
    </section>
  </main>
  <div id="toast"></div>

  <script>
    var REGISTER_FIELDS = ${JSON.stringify(REGISTER_FIELDS)};
    var HIGH_SCORE = ${HIGH_SCORE};
    var REVIEW_GAP_HOURS = ${REVIEW_GAP_MS / 3600000};
    var STATUSES = ${JSON.stringify(STATUSES)};
    var sticks = [];

    function $(sel, root) { return (root || document).querySelector(sel); }
    function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
    function esc(v) {
      if (v === null || v === undefined) return "";
      return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }
    function fmt(at) {
      if (!at) return "—";
      var d = new Date(at);
      return isNaN(d.getTime()) ? esc(at) : esc(d.toLocaleString("zh-CN", { hour12: false }));
    }
    function toast(msg, kind) {
      var el = document.createElement("div");
      el.className = "toast " + (kind || "");
      el.textContent = msg;
      $("#toast").appendChild(el);
      setTimeout(function () { el.remove(); }, 6000);
    }
    async function api(path, options) {
      var res = await fetch(path, options && options.body
        ? Object.assign({}, options, { headers: { "Content-Type": "application/json" } })
        : options);
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        var err = new Error(data.message || data.error || "请求失败");
        err.data = data;
        throw err;
      }
      return data;
    }

    function pillClass(status) {
      if (status === "试磨中" || status === "进行中") return "testing";
      if (status === "已放行") return "good";
      if (status === "已失效") return "bad";
      if (status === "未放行") return "hold";
      return "";
    }

    function renderStats() {
      $("#stats").innerHTML = STATUSES.map(function (status) {
        var n = sticks.filter(function (s) { return s.status === status; }).length;
        return '<div class="stat"><span>' + status + '</span><strong>' + n + '</strong></div>';
      }).join("");
    }

    function renderReviewSelect() {
      var sel = $("#reviewBatch");
      var prev = sel.value;
      var opts = ['<option value="">（选择进行中批次）</option>'];
      sticks.forEach(function (stick) {
        stick.batches.filter(function (b) { return b.open; }).forEach(function (b) {
          opts.push('<option value="' + esc(stick.code) + '/' + b.no + '">' + esc(b.label) + ' · ' + esc(stick.code) + ' · 连续高分 ' + b.streakDisplay + '/2</option>');
        });
      });
      sel.innerHTML = opts.join("");
      if (prev) sel.value = prev;
    }

    function renderOpenSelect() {
      $("#openStick").innerHTML = sticks.map(function (s) {
        var open = s.batches.some(function (b) { return b.open; });
        return '<option value="' + esc(s.code) + '"' + (open ? " disabled" : "") + ">"
          + esc(s.code) + (open ? "（有未结束批次，不可开启）" : " · " + esc(s.status)) + "</option>";
      }).join("");
    }

    function resultHtml(stick, batch, r, index) {
      var high = r.score >= HIGH_SCORE;
      var formFields = REGISTER_FIELDS.map(function (pair) {
        var key = pair[0], label = pair[1];
        return '<label class="wide" style="grid-column:1 / -1">' + label + '</label>'
          + '<input class="wide" style="grid-column:1 / -1" data-k="' + key + '" value="' + esc(r[key]) + '">';
      }).join("");
      var warn = batch.released
        ? '<div class="warnbox">该批次已放行：更正任意关键字段（六项登记或评分）将使放行失效；履历仍完整留档。</div>'
        : "";
      return '<div class="result ' + (high ? "high" : "low") + '" id="res-' + esc(stick.code) + "-" + batch.no + "-" + esc(r.id) + '">'
        + '<div><b>#' + (index + 1) + '</b> · ' + fmt(r.at) + ' · 试磨人 <b>' + esc(r.grinder) + '</b>'
        + ' · <span class="score-tag ' + (high ? "high" : "low") + '">评分 ' + esc(r.score) + (high ? " 高分" : " 低分") + '</span></div>'
        + '<div class="meta">磨口：' + esc(r.edge) + ' ｜ 用水：' + esc(r.water) + ' ｜ 纸样：' + esc(r.paper) + '</div>'
        + '<div class="meta">室温：' + esc(r.roomTemp) + ' ｜ 湿度：' + esc(r.humidity) + (r.note ? ' ｜ 备注：' + esc(r.note) : "") + '</div>'
        + '<div><button type="button" class="mini secondary" data-toggle-correct="' + esc(stick.code) + "/" + batch.no + "/" + esc(r.id) + '">更正</button></div>'
        + '<form class="correctForm" hidden data-correct="' + esc(stick.code) + "/" + batch.no + "/" + esc(r.id) + '">'
        + warn + formFields
        + '<label class="wide" style="grid-column:1 / -1">评分</label><input class="wide" style="grid-column:1 / -1" data-k="score" type="number" min="0" max="100" value="' + esc(r.score) + '">'
        + '<label class="wide" style="grid-column:1 / -1">备注</label><input class="wide" style="grid-column:1 / -1" data-k="note" value="' + esc(r.note) + '">'
        + '<label class="wide" style="grid-column:1 / -1">更正人（选填）</label><input class="wide" style="grid-column:1 / -1" data-k="by" autocomplete="off">'
        + '<div class="actions"><button type="submit" class="danger">提交更正</button><button type="button" class="secondary" data-cancel-correct>取消</button></div>'
        + "</form></div>";
    }

    function historyHtml(batch) {
      if (!batch.history.length) return '<div class="empty">暂无履历</div>';
      return batch.history.map(function (h) {
        return '<div><span class="meta">' + fmt(h.at) + "</span> " + esc(h.detail) + "</div>";
      }).join("");
    }

    function batchHtml(stick, batch) {
      var head = '<div class="batch-head"><b>' + esc(batch.label) + '</b>'
        + '<span class="pill ' + pillClass(batch.status) + '">' + batch.status + "</span>"
        + '<span class="meta">开启 ' + fmt(batch.openedAt);
      if (batch.releasedAt) head += " · 放行 " + fmt(batch.releasedAt);
      else if (batch.revokedAt) head += " · 失效 " + fmt(batch.revokedAt);
      else if (batch.closedAt) head += " · 结束 " + fmt(batch.closedAt);
      head += "</span></div>";

      var streakLine = batch.open
        ? '<div class="meta">连续高分计数 <span class="streak">' + batch.streakDisplay + "/2</span>（高分线 " + HIGH_SCORE + "）</div>"
        : "";
      var reviewLine = "";
      if (batch.open && batch.nextReview) {
        reviewLine = '<div class="meta">下次复核：须换人（不得为 ' + esc(batch.nextReview.otherThanGrinder) + "），时间不早于 "
          + fmt(batch.nextReview.notBefore) + "（间隔满 " + REVIEW_GAP_HOURS + " 小时）</div>";
      }
      var results = batch.results.map(function (r, i) { return resultHtml(stick, batch, r, i); }).join("")
        || '<div class="empty">暂无试磨结果</div>';

      var actions = "";
      if (batch.open) {
        actions = '<div><button type="button" class="mini" data-review-go="' + esc(stick.code) + "/" + batch.no + '">到此批次复核</button> '
          + '<button type="button" class="mini secondary" data-close="' + esc(stick.code) + "/" + batch.no + '">结束批次（未放行）</button></div>';
      }

      return '<div class="batch">' + head + streakLine + reviewLine + results + actions
        + '<details class="history"><summary class="meta">批次履历（' + batch.history.length + " 条）</summary>"
        + historyHtml(batch) + "</details></div>";
    }

    function cardHtml(stick) {
      var profile = '<div class="profile">'
        + "<div>烟料：" + esc(stick.smokeSource || "—") + "</div>"
        + "<div>胶比：" + esc(stick.glueRatio || "—") + "</div>"
        + "<div>年限：" + esc(stick.ageYears === null || stick.ageYears === undefined ? "—" : stick.ageYears) + "</div>"
        + "<div>位置：" + esc(stick.storage || "—") + "</div></div>";

      var batches = stick.batches.map(function (b) { return batchHtml(stick, b); }).join("")
        || '<div class="empty">尚无批次</div>';

      var voids = "";
      if (stick.voids.length) {
        voids = '<div class="void-item">作废未占号 ' + stick.voids.length + " 次："
          + stick.voids.map(function (v) {
            return fmt(v.at) + "（缺项：" + esc(v.missing.join("、")) + "）";
          }).join("；") + "</div>";
      }
      var legacy = "";
      if (stick.legacy.length) {
        legacy = '<details class="legacy-item"><summary>旧档记录（' + stick.legacy.length + " 条，不计入批次）</summary>"
          + stick.legacy.map(function (l) {
            return "<div>" + fmt(l.at) + " · " + esc(l.step) + " · " + esc(l.note) + "</div>";
          }).join("") + "</details>";
      }

      return '<article class="card"><div class="batch-head"><h3>' + esc(stick.code) + '</h3>'
        + '<span class="pill ' + pillClass(stick.status) + '">' + stick.status + "</span></div>"
        + profile + batches + voids + legacy + "</article>";
    }

    function render() {
      renderStats();
      renderOpenSelect();
      renderReviewSelect();
      var status = $("#statusFilter").value;
      var q = $("#search").value.trim();
      var visible = sticks.filter(function (s) {
        if (status && s.status !== status) return false;
        if (q && JSON.stringify(s).indexOf(q) === -1) return false;
        return true;
      });
      $("#cards").innerHTML = visible.length
        ? visible.map(cardHtml).join("")
        : '<div class="empty">没有符合条件的墨锭</div>';
      bindCardEvents();
    }

    async function load() {
      sticks = await api("/api/sticks");
      render();
    }

    function formData(form) {
      var data = {};
      $all("input,select,textarea", form).forEach(function (el) {
        if (el.name) data[el.name] = el.value;
      });
      return data;
    }

    async function submitOpen(evt) {
      evt.preventDefault();
      var data = formData($("#openForm"));
      if (!data.code) return toast("请选择墨锭", "err");
      try {
        var out = await api("/api/sticks/" + encodeURIComponent(data.code) + "/batches", {
          method: "POST",
          body: JSON.stringify(data),
        });
        $("#openForm").reset();
        if (out.voided) {
          toast("登记缺项（" + out.missing.join("、") + "），该批次作废且不占号，已留档", "warn");
        } else {
          toast("批次 " + out.batch.label + " 已开启并占号", "ok");
        }
      } catch (err) { toast(err.message, "err"); }
      await load();
    }

    async function submitReview(evt) {
      evt.preventDefault();
      var ref = $("#reviewBatch").value;
      if (!ref) return toast("请选择进行中批次", "err");
      var parts = ref.split("/");
      var data = formData($("#reviewForm"));
      delete data.batch;
      try {
        var out = await api("/api/sticks/" + encodeURIComponent(parts[0]) + "/batches/" + parts[1] + "/results", {
          method: "POST",
          body: JSON.stringify(data),
        });
        $("#reviewForm").reset();
        if (out.invalid) {
          toast("登记缺项（" + out.missing.join("、") + "），结果未记入；请补全六项登记与评分", "err");
        } else if (out.released) {
          toast("两次换人高分且间隔满 " + REVIEW_GAP_HOURS + " 小时，批次放行通过", "ok");
        } else if (out.reasons && out.reasons.length) {
          toast("已记录（连续高分 " + Math.min(out.streak, 2) + "/2），暂不放行：" + out.reasons.join("；"), "warn");
        } else {
          toast("已记录，低分使连续高分计数清零，旧记录留档", "warn");
        }
      } catch (err) { toast(err.message, "err"); }
      await load();
    }

    function bindCardEvents() {
      $all("[data-review-go]").forEach(function (btn) {
        btn.onclick = function () {
          $("#reviewBatch").value = btn.getAttribute("data-review-go");
          $("#reviewForm").scrollIntoView({ behavior: "smooth", block: "center" });
        };
      });
      $all("[data-close]").forEach(function (btn) {
        btn.onclick = async function () {
          var parts = btn.getAttribute("data-close").split("/");
          if (!confirm("结束该批次？结束后未放行，墨锭可开启新批次，全部记录留档。")) return;
          try {
            await api("/api/sticks/" + encodeURIComponent(parts[0]) + "/batches/" + parts[1] + "/close", { method: "POST" });
            toast("批次已结束（未放行）", "ok");
          } catch (err) { toast(err.message, "err"); }
          await load();
        };
      });
      $all("[data-toggle-correct]").forEach(function (btn) {
        btn.onclick = function () {
          var id = btn.getAttribute("data-toggle-correct");
          var form = $('form[data-correct="' + id + '"]');
          if (form) form.hidden = !form.hidden;
        };
      });
      $all("[data-cancel-correct]").forEach(function (btn) {
        btn.onclick = function () { btn.closest("form").hidden = true; };
      });
      $all("form[data-correct]").forEach(function (form) {
        form.onsubmit = async function (evt) {
          evt.preventDefault();
          var parts = form.getAttribute("data-correct").split("/");
          var patch = {};
          $all("[data-k]", form).forEach(function (input) {
            patch[input.getAttribute("data-k")] = input.value;
          });
          var by = patch.by;
          delete patch.by;
          try {
            var out = await api("/api/sticks/" + encodeURIComponent(parts[0]) + "/batches/" + parts[1] + "/results/" + encodeURIComponent(parts[2]), {
              method: "PATCH",
              body: JSON.stringify({ patch: patch, by: by }),
            });
            if (out.revoked) {
              toast("已更正，关键字段变更使原放行批次失效；履历已留档", "warn");
            } else {
              toast("更正已记入批次履历", "ok");
            }
          } catch (err) { toast(err.message, "err"); }
          await load();
        };
      });
    }

    $("#createForm").onsubmit = async function (evt) {
      evt.preventDefault();
      try {
        await api("/api/sticks", { method: "POST", body: JSON.stringify(formData($("#createForm"))) });
        $("#createForm").reset();
        toast("墨锭已建档", "ok");
      } catch (err) { toast(err.message, "err"); }
      await load();
    };
    $("#openForm").onsubmit = submitOpen;
    $("#reviewForm").onsubmit = submitReview;
    $("#statusFilter").onchange = render;
    $("#search").oninput = render;
    $("#reload").onclick = function () { load().then(function () { toast("已刷新", "ok"); }); };
    load();
  </script>
</body>
</html>`;
}
