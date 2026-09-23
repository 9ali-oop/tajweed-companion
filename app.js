/* Tajweed companion — hub + drill engine.
   Content lives in data.js as window.UNITS. Progress lives in localStorage. */
(function () {
  "use strict";

  var UNITS = (window.UNITS || []).slice().sort(function (a, b) { return a.ep - b.ep; });
  var CATALOGUE = (window.CATALOGUE || []).slice().sort(function (a, b) { return a.ep - b.ep; });
  var KEY = "tajweed-companion-v1";
  var TONE = { stop: "stop", between: "between", flow: "flow", brand: "brand" };

  var root = document.getElementById("app");

  /* ── progress ───────────────────────────── */
  function loadProgress() {
    try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; }
    catch (e) { return {}; }
  }
  function saveProgress(p) {
    try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) {}
  }
  function record(ep, score, total, newRun) {
    var p = loadProgress();
    var prev = p[ep] || { best: 0, total: total, runs: 0 };
    p[ep] = { best: Math.max(prev.best, score), total: total,
              runs: (prev.runs || 0) + (newRun ? 1 : 0) };
    saveProgress(p);
    // sync.js pushes this to the signed-in account, if there is one.
    document.dispatchEvent(new CustomEvent("tj:progress-saved"));
  }

  // sync.js merged another device's scores into local storage: redraw the hub
  // so the new scores show, but never yank the learner out of a drill.
  document.addEventListener("tj:progress-updated", function () {
    if (!S) renderHub();
  });

  /* ── chapter families (colour + grouping) ── */
  function family(t) {
    t = t || "";
    if (t.indexOf("مخارج") > -1) return { key: "makharij", label: "Points of articulation · المخارج", color: "var(--flow)" };
    if (t.indexOf("صفات") > -1 || t.indexOf("قلقلة") > -1) return { key: "sifat", label: "Letter characteristics · الصفات", color: "var(--stop)" };
    if (t.indexOf("مقدمة") > -1) return { key: "intro", label: "Foundations · المقدمة", color: "var(--brand)" };
    return { key: "other", label: "Further topics", color: "var(--between)" };
  }

  /* ── airflow diagram (used where a unit asks for it) ── */
  function flowSVG(kind) {
    var c = kind === "stop" ? "var(--stop)" : kind === "between" ? "var(--between)" : "var(--flow)";
    var n = kind === "stop" ? 3 : kind === "between" ? 4 : 6;
    var dots = "", i, x;
    for (i = 0; i < n; i++) {
      x = 22 + i * 22;
      if (kind === "stop" && x > 96) continue;
      dots += '<circle cx="' + x + '" cy="40" r="4" fill="' + c + '" opacity="' + (kind === "between" ? 0.55 : 0.9) + '"/>';
    }
    var gate = kind === "stop"
      ? '<rect x="104" y="14" width="9" height="52" rx="3" fill="' + c + '"/>'
      : kind === "between"
        ? '<rect x="104" y="14" width="9" height="20" rx="3" fill="' + c + '"/>' +
          '<rect x="104" y="46" width="9" height="20" rx="3" fill="' + c + '"/>' +
          '<path d="M108 14 L108 5" stroke="' + c + '" stroke-width="3" stroke-linecap="round"/>' +
          '<circle cx="108" cy="4" r="3" fill="' + c + '" opacity=".6"/>'
        : "";
    var after = kind === "stop" ? "" :
      '<circle cx="132" cy="40" r="4" fill="' + c + '" opacity=".9"/>' +
      '<circle cx="154" cy="40" r="4" fill="' + c + '" opacity=".7"/>' +
      '<circle cx="176" cy="40" r="4" fill="' + c + '" opacity=".45"/>';
    return '<svg class="flow" viewBox="0 0 200 80" role="img" aria-label="airflow diagram">' +
      '<rect x="6" y="20" width="188" height="40" rx="20" fill="none" stroke="var(--line)" stroke-width="3"/>' +
      dots + gate + after + '</svg>';
  }

  /* ── hub ────────────────────────────────── */
  function renderHub() {
    var p = loadProgress();
    var byEp = {};
    UNITS.forEach(function (u) { byEp[u.ep] = u; });

    var completed = 0, totalQ = 0, gotQ = 0;
    UNITS.forEach(function (u) {
      var r = p[u.ep];
      totalQ += u.questions.length;
      if (r) { gotQ += r.best; if (r.best === u.questions.length) completed++; }
    });

    // The hub lists the whole series, so an episode without a ready unit still
    // shows up — the learner can see where they are in the course, not just
    // which drills happen to exist yet.
    var groups = [], seen = {};
    CATALOGUE.forEach(function (c) {
      var f = family(c.topic);
      if (!seen[f.key]) { seen[f.key] = { fam: f, items: [] }; groups.push(seen[f.key]); }
      seen[f.key].items.push(c);
    });

    var html =
      '<div class="hub-head">' +
        '<h1>Tajweed Companion</h1>' +
        '<p class="sub">Drills for <span class="ar">شرح كتاب التجويد المصور</span> — ' +
        'د. أيمن رشدي سويد. One short unit per episode.</p>' +
        '<div class="account" id="account"></div>' +
        '<div class="overall">' +
          '<div class="row"><span class="big">' + gotQ + ' / ' + totalQ + '</span>' +
          '<span class="cap">' + completed + ' of ' + UNITS.length + ' ready units aced</span></div>' +
          '<div class="track"><div class="fill" style="width:' +
            (totalQ ? (gotQ / totalQ * 100) : 0) + '%"></div></div>' +
          '<p style="margin:.7rem 0 0;font-size:.84rem;color:var(--ink-faint)">' +
            UNITS.length + ' of ' + CATALOGUE.length + ' units ready. More are added as the ' +
            'series goes on.</p>' +
        '</div>' +
      '</div>';

    groups.forEach(function (g) {
      html += '<div class="chapter">' + g.fam.label + '</div><div class="units">';
      g.items.forEach(function (c) {
        var u = byEp[c.ep];
        if (u) {
          var r = p[c.ep], n = u.questions.length;
          var cls = "", txt = "Start";
          if (r) {
            if (r.best === n) { cls = "done"; txt = "★ " + r.best + "/" + n; }
            else { cls = "part"; txt = r.best + "/" + n; }
          }
          html +=
            '<button class="unit" style="--fam:' + g.fam.color + '" data-ep="' + c.ep + '">' +
              '<span class="n">' + c.ep + '</span>' +
              '<span class="body"><span class="t">' + esc(u.title_en) + '</span>' +
              '<span class="t-ar ar">' + esc(c.topic) + '</span></span>' +
              '<span class="state ' + cls + '">' + txt + '</span>' +
            '</button>';
        } else {
          html +=
            '<button class="unit" style="--fam:' + g.fam.color + '" disabled>' +
              '<span class="n">' + c.ep + '</span>' +
              '<span class="body"><span class="t">' + c.minutes + ' min lesson</span>' +
              '<span class="t-ar ar">' + esc(c.topic) + '</span></span>' +
              '<span class="state">soon</span>' +
            '</button>';
        }
      });
      html += "</div>";
    });

    html += '<p class="hub-foot">A companion, not a substitute — the lessons are the Shaykh\'s.<br>' +
      'Answers are independently checked; any error here is ours, not his.</p>';

    root.innerHTML = html;
    root.querySelectorAll(".unit").forEach(function (b) {
      b.addEventListener("click", function () { location.hash = "#/u/" + b.dataset.ep; });
    });
    window.scrollTo(0, 0);
    document.dispatchEvent(new CustomEvent("tj:hub-rendered"));
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  /* ── drill ──────────────────────────────── */
  // One attempt at a unit. Answers are kept per question so the learner can
  // move back and forth freely: a revisited question shows exactly what was
  // picked and why, and cannot be re-answered — the score is the first try,
  // otherwise going back would become a way to fix answers. Option order is
  // fixed per question for the whole attempt, so going back never reshuffles
  // what the learner has already seen.
  var S = null;

  function newAttempt(unit) {
    return { unit: unit, ti: 0, qi: 0, streak: 0, best: 0, view: "",
             ans: [], orders: [], draft: [], recorded: false };
  }

  function scoreOf() {
    return S.ans.filter(function (a) { return a && a.ok; }).length;
  }

  function answeredCount() {
    return S.ans.filter(Boolean).length;
  }

  function renderUnit(ep) {
    var unit = null;
    UNITS.forEach(function (u) { if (u.ep === ep) unit = u; });
    if (!unit) { location.hash = "#/"; return; }
    S = newAttempt(unit);
    renderStart();
  }

  function shell(inner, showStreak) {
    return '<div class="bar">' +
      '<button class="back" id="btnBack">‹ All units</button>' +
      '<span class="pill">Unit ' + S.unit.ep + '</span>' +
      '<div class="track" style="flex:1"><div class="fill" id="fill"></div></div>' +
      '<span class="streak" id="streak">' + (showStreak && S.streak > 1 ? "🔥 " + S.streak : "") + '</span>' +
      '</div><div class="card">' + inner + '</div>';
  }

  function mount(inner, showStreak, keepScroll) {
    root.innerHTML = shell(inner, showStreak);
    document.getElementById("btnBack").addEventListener("click", function () { location.hash = "#/"; });
    // After answering, the feedback appears below the options; jumping to the
    // top would hide it on a phone.
    if (!keepScroll) window.scrollTo(0, 0);
  }

  function setBar(done, total) {
    var f = document.getElementById("fill");
    if (f) f.style.width = (total ? done / total * 100 : 0) + "%";
  }

  function renderStart() {
    S.view = "";
    var u = S.unit;
    mount(
      '<h1>' + esc(u.title_en) + '</h1>' +
      '<p class="ar" style="font-size:1.5rem;color:var(--ink-soft);margin:-.2rem 0 .8rem">' + esc(u.title_ar) + '</p>' +
      '<p class="lead">' + esc(u.summary) + '</p>' +
      '<p>' + u.teach.length + ' quick cards, then ' + u.questions.length + ' questions. About four minutes.</p>' +
      '<button class="cta" id="go">Start</button>' +
      '<button class="ghost" id="skip">Skip to the questions</button>', false);
    setBar(0, 1);
    document.getElementById("go").addEventListener("click", function () { S.ti = 0; renderTeach(); });
    document.getElementById("skip").addEventListener("click", function () { renderQ(); });
  }

  function renderTeach() {
    S.view = "";
    var u = S.unit, t = u.teach[S.ti];
    var tone = TONE[t.tone] || "brand";
    var cVar = tone === "brand" ? "var(--brand)" : "var(--" + tone + ")";
    var cBg = tone === "brand" ? "var(--brand-soft)" : "var(--" + tone + "-bg)";
    var diagram = (tone === "stop" || tone === "between" || tone === "flow") ? flowSVG(tone) : "";
    var last = S.ti === u.teach.length - 1;
    var fwd = !last ? "Next ›" : answeredCount() ? "Back to the questions" : "Start the drill";
    mount(
      '<div class="teach" style="--c:' + cVar + ';--c-bg:' + cBg + '">' +
        '<div class="head"><span class="badge">' + esc(t.label_en) + '</span>' +
        (t.count ? '<span class="badge">' + esc(t.count) + '</span>' : '') + '</div>' +
        '<div class="ttl-ar ar">' + esc(t.title_ar) + '</div>' +
        diagram +
        (t.mnemonic ? '<div class="mnem ar">' + esc(t.mnemonic) + '</div>' : '') +
        (t.letters ? '<div class="lets ar">' + esc(t.letters) + '</div>' : '') +
        '<p>' + t.body + '</p>' +
        '<div class="qnav">' +
          '<button class="nav-btn" id="tprev">‹ Back</button>' +
          '<button class="nav-btn primary" id="tnext">' + fwd + '</button>' +
        '</div>' +
      '</div>', false);
    setBar(S.ti, u.teach.length);
    document.getElementById("tprev").addEventListener("click", function () {
      if (S.ti > 0) { S.ti--; renderTeach(); } else renderStart();
    });
    document.getElementById("tnext").addEventListener("click", function () {
      if (!last) { S.ti++; renderTeach(); } else renderQ();
    });
  }

  function orderFor(i) {
    // Shuffled once per question per attempt. Authored units cluster their
    // correct answers near the top (one unit had 7 of 11 at position 0),
    // which makes a drill tappable without reading it. `data-i` keeps the
    // original index, so grading and the answer key are untouched. Numeric
    // option sets stay in natural order — a scrambled 0/1/2/3 reads as a bug.
    if (S.orders[i]) return S.orders[i];
    var opts = S.unit.questions[i].options || [];
    var order = opts.map(function (_, k) { return k; });
    var numeric = opts.length > 0 && opts.every(function (o) { return /^\s*\d+\s*$/.test(o); });
    if (!numeric) {
      for (var s = order.length - 1; s > 0; s--) {
        var j = Math.floor(Math.random() * (s + 1));
        var tmp = order[s]; order[s] = order[j]; order[j] = tmp;
      }
    }
    S.orders[i] = order;
    return order;
  }

  function correctText(q) {
    if (q.type === "multi") return (q.answers || []).join(" ، ");
    return (q.options || [])[q.answerIndex];
  }

  function feedbackHTML(ok, q) {
    return '<div class="fb ' + (ok ? "good" : "bad") + '">' +
      '<div class="verdict">' + (ok ? "Correct" : "Not quite — it is " + esc(correctText(q))) + '</div>' +
      '<div class="why">' + q.why + '</div></div>';
  }

  function renderQ(keepScroll) {
    S.view = "q";
    var u = S.unit, n = u.questions.length, i = S.qi, q = u.questions[i], a = S.ans[i];

    var dots = '<div class="dots" aria-label="Jump to a question">' +
      u.questions.map(function (_, k) {
        var r = S.ans[k];
        var state = r ? (r.ok ? " ok" : " bad") : "";
        var label = "Question " + (k + 1) + (r ? (r.ok ? ", correct" : ", wrong") : ", not answered yet");
        return '<button class="dot' + state + (k === i ? " cur" : "") + '" data-k="' + k +
          '" aria-label="' + label + '"' + (k === i ? ' aria-current="step"' : "") + '>' + (k + 1) + '</button>';
      }).join("") + '</div>';

    var body = dots +
      '<div class="qnum">Question ' + (i + 1) + ' of ' + n + '</div>' +
      '<p class="q">' + q.q + '</p>' +
      (q.bigArabic ? '<div class="big-letter ar">' + esc(q.bigArabic) + '</div>' : '') +
      (q.ayah ? '<div class="ayah ar">' + esc(q.ayah) + '</div>' +
                '<div class="ref">' + esc(q.ref || "") + '</div>' : '') +
      (q.verseStem ? '<div class="verse-q ar">' + esc(q.verseStem) + ' <span class="blank"></span></div>' : '');

    if (q.type === "multi") {
      var pick = a ? a.pick : (S.draft[i] || []);
      var key = q.answers || [];
      body += '<div class="tiles">' + (q.pool || []).map(function (ch) {
        var on = pick.indexOf(ch) > -1, cls = "";
        if (a) {
          var isKey = key.indexOf(ch) > -1;
          cls = on && isKey ? " right" : on ? " wrong" : isKey ? " missed" : "";
        }
        return '<button class="tile ar' + cls + '" data-ch="' + esc(ch) + '" aria-pressed="' + on + '"' +
          (a ? " disabled" : "") + '>' + esc(ch) + '</button>';
      }).join("") + '</div>' +
      (a ? "" : '<button class="cta" id="check"' + (pick.length ? "" : " disabled") + '>Check</button>');
    } else {
      var opts = q.options || [];
      body += '<div class="opts">' + orderFor(i).map(function (oi) {
        var cls = a ? (oi === q.answerIndex ? " right" : oi === a.pick ? " wrong" : "") : "";
        return '<button class="opt' + (q.arabicOptions ? " ar" : "") + cls + '" data-i="' + oi + '"' +
          (a ? " disabled" : "") + '>' + opts[oi] + '</button>';
      }).join("") + '</div>';
    }

    if (a) body += feedbackHTML(a.ok, q);

    var last = i === n - 1;
    body += '<div class="qnav">' +
      '<button class="nav-btn" id="prev"' + (i === 0 && !u.teach.length ? " disabled" : "") + '>' +
        (i === 0 ? "‹ Cards" : "‹ Back") + '</button>' +
      '<button class="nav-btn' + (a || last ? " primary" : "") + '" id="nextq">' +
        (last ? "See results" : a ? "Next ›" : "Skip ›") + '</button>' +
      '</div>';

    mount(body, true, keepScroll);
    setBar(answeredCount(), n);

    root.querySelectorAll(".dot").forEach(function (d) {
      d.addEventListener("click", function () { S.qi = parseInt(d.dataset.k, 10); renderQ(); });
    });
    document.getElementById("prev").addEventListener("click", function () {
      if (S.qi > 0) { S.qi--; renderQ(); }
      else if (u.teach.length) { S.ti = u.teach.length - 1; renderTeach(); }
    });
    document.getElementById("nextq").addEventListener("click", function () {
      if (S.qi < n - 1) { S.qi++; renderQ(); } else renderDone();
    });

    if (a) return;
    if (q.type === "multi") {
      var tiles = root.querySelectorAll(".tile");
      tiles.forEach(function (tl) {
        tl.addEventListener("click", function () {
          var on = tl.getAttribute("aria-pressed") === "true";
          tl.setAttribute("aria-pressed", String(!on));
          S.draft[i] = Array.prototype.filter.call(tiles, function (x) {
            return x.getAttribute("aria-pressed") === "true";
          }).map(function (x) { return x.dataset.ch; });
          document.getElementById("check").disabled = S.draft[i].length === 0;
        });
      });
      document.getElementById("check").addEventListener("click", function () {
        var picked = S.draft[i] || [], want = q.answers || [];
        var ok = picked.length === want.length &&
          want.every(function (w) { return picked.indexOf(w) > -1; });
        answer(i, picked.slice(), ok);
      });
    } else {
      root.querySelectorAll(".opt").forEach(function (b) {
        b.addEventListener("click", function () {
          var oi = parseInt(b.dataset.i, 10);
          answer(i, oi, oi === q.answerIndex);
        });
      });
    }
  }

  function answer(i, pick, ok) {
    if (S.ans[i]) return;
    S.ans[i] = { pick: pick, ok: ok };
    if (ok) { S.streak++; if (S.streak > S.best) S.best = S.streak; }
    else S.streak = 0;
    renderQ(true);
    var nx = document.getElementById("nextq");
    if (nx) nx.focus();
  }

  function renderDone() {
    S.view = "";
    var u = S.unit, n = u.questions.length, score = scoreOf(), skipped = n - answeredCount();
    var pct = Math.round(score / n * 100);
    var verdict = pct === 100 ? "Perfect." : pct >= 75 ? "Solid." : pct >= 50 ? "Getting there." : "Worth another pass.";
    // Returning to results after reviewing or finishing skipped questions
    // updates the best score without counting another run.
    record(u.ep, score, n, !S.recorded);
    S.recorded = true;

    var html = '<div class="score">' + score + '<small>out of ' + n + ' — ' + verdict + '</small></div>';
    if (skipped) {
      html += '<p class="skipnote">' + skipped + (skipped === 1 ? " question" : " questions") +
        ' skipped — tap one below to answer it.</p>';
    }
    if (S.best > 1) {
      html += '<p style="text-align:center;margin:.6rem 0 0;color:var(--between);font-weight:600">Best streak 🔥 ' + S.best + '</p>';
    }
    var revisit = [];
    u.questions.forEach(function (_, k) { if (!S.ans[k] || !S.ans[k].ok) revisit.push(k); });
    if (revisit.length) {
      html += '<div class="review"><h3>Worth revisiting</h3><ul>' + revisit.map(function (k) {
        var q = u.questions[k], r = S.ans[k];
        return '<li><button class="jump" data-k="' + k + '"><span class="jn">' + (k + 1) + '</span>' +
          esc(String(q.q).replace(/<[^>]+>/g, "")) + ' — ' +
          (r ? '<strong>' + esc(correctText(q)) + '</strong>' : '<em>not answered</em>') +
          '</button></li>';
      }).join("") + '</ul></div>';
    }
    html += '<button class="cta" id="again">Drill again</button>' +
      '<button class="ghost" id="review">Review your answers</button>' +
      '<button class="ghost" id="hub">Back to all units</button>' +
      '<p class="foot">Episode ' + u.ep + ' — <span class="ar">' + esc(u.title_ar) + '</span>' +
      (u.url ? ' · <a href="' + u.url + '" target="_blank" rel="noopener">watch the lesson</a>' : '') + '</p>';
    mount(html, false);
    setBar(1, 1);

    root.querySelectorAll(".jump").forEach(function (b) {
      b.addEventListener("click", function () { S.qi = parseInt(b.dataset.k, 10); renderQ(); });
    });
    document.getElementById("again").addEventListener("click", function () {
      S = newAttempt(u); renderQ();
    });
    document.getElementById("review").addEventListener("click", function () { S.qi = 0; renderQ(); });
    document.getElementById("hub").addEventListener("click", function () { location.hash = "#/"; });
  }

  // ← and → move between questions from the keyboard. Only while a question
  // is on screen, and never with a modifier held, so browser shortcuts win.
  document.addEventListener("keydown", function (e) {
    if (!S || S.view !== "q" || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    var id = e.key === "ArrowLeft" ? "prev" : e.key === "ArrowRight" ? "nextq" : null;
    if (!id) return;
    var b = document.getElementById(id);
    if (b && !b.disabled) { e.preventDefault(); b.click(); }
  });

  /* ── routing ────────────────────────────── */
  function route() {
    var m = /^#\/u\/(\d+)/.exec(location.hash || "");
    if (m) renderUnit(parseInt(m[1], 10)); else { S = null; renderHub(); }
  }
  window.addEventListener("hashchange", route);

  if (!CATALOGUE.length && !UNITS.length) {
    root.innerHTML = '<div class="card"><h1>No units loaded</h1>' +
      '<p>data.js did not define any units.</p></div>';
  } else {
    route();
  }
})();
