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
  function record(ep, score, total) {
    var p = loadProgress();
    var prev = p[ep] || { best: 0, total: total, runs: 0 };
    p[ep] = { best: Math.max(prev.best, score), total: total, runs: (prev.runs || 0) + 1 };
    saveProgress(p);
  }

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
        '<div class="overall">' +
          '<div class="row"><span class="big">' + gotQ + ' / ' + totalQ + '</span>' +
          '<span class="cap">' + completed + ' of ' + UNITS.length + ' ready units aced</span></div>' +
          '<div class="track"><div class="fill" style="width:' +
            (totalQ ? (gotQ / totalQ * 100) : 0) + '%"></div></div>' +
          '<p style="margin:.7rem 0 0;font-size:.84rem;color:var(--ink-faint)">' +
            UNITS.length + ' of ' + CATALOGUE.length + ' units ready. The rest are written and ' +
            'being checked for accuracy before they go live.</p>' +
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
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  /* ── drill ──────────────────────────────── */
  var S = null;

  function renderUnit(ep) {
    var unit = null;
    UNITS.forEach(function (u) { if (u.ep === ep) unit = u; });
    if (!unit) { location.hash = "#/"; return; }
    S = { unit: unit, ti: 0, qi: 0, score: 0, streak: 0, best: 0, missed: [], answered: false, picked: [] };
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

  function mount(inner, showStreak) {
    root.innerHTML = shell(inner, showStreak);
    document.getElementById("btnBack").addEventListener("click", function () { location.hash = "#/"; });
    window.scrollTo(0, 0);
  }

  function setBar(done, total) {
    var f = document.getElementById("fill");
    if (f) f.style.width = (total ? done / total * 100 : 0) + "%";
  }

  function renderStart() {
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
    document.getElementById("skip").addEventListener("click", function () { S.qi = 0; renderQ(); });
  }

  function renderTeach() {
    var u = S.unit, t = u.teach[S.ti];
    var tone = TONE[t.tone] || "brand";
    var cVar = tone === "brand" ? "var(--brand)" : "var(--" + tone + ")";
    var cBg = tone === "brand" ? "var(--brand-soft)" : "var(--" + tone + "-bg)";
    var diagram = (tone === "stop" || tone === "between" || tone === "flow") ? flowSVG(tone) : "";
    mount(
      '<div class="teach" style="--c:' + cVar + ';--c-bg:' + cBg + '">' +
        '<div class="head"><span class="badge">' + esc(t.label_en) + '</span>' +
        (t.count ? '<span class="badge">' + esc(t.count) + '</span>' : '') + '</div>' +
        '<div class="ttl-ar ar">' + esc(t.title_ar) + '</div>' +
        diagram +
        (t.mnemonic ? '<div class="mnem ar">' + esc(t.mnemonic) + '</div>' : '') +
        (t.letters ? '<div class="lets ar">' + esc(t.letters) + '</div>' : '') +
        '<p>' + t.body + '</p>' +
        '<button class="cta" id="next">' +
          (S.ti < u.teach.length - 1 ? "Next" : "Start the drill") + '</button>' +
      '</div>', false);
    setBar(S.ti, u.teach.length);
    document.getElementById("next").addEventListener("click", function () {
      S.ti++;
      if (S.ti < u.teach.length) renderTeach();
      else { S.qi = 0; renderQ(); }
    });
  }

  function renderQ() {
    var u = S.unit, q = u.questions[S.qi];
    S.answered = false; S.picked = [];
    var body = '<div class="qnum">Question ' + (S.qi + 1) + ' of ' + u.questions.length + '</div>' +
      '<p class="q">' + q.q + '</p>' +
      (q.bigArabic ? '<div class="big-letter ar">' + esc(q.bigArabic) + '</div>' : '') +
      (q.ayah ? '<div class="ayah ar">' + esc(q.ayah) + '</div>' +
                '<div class="ref">' + esc(q.ref || "") + '</div>' : '') +
      (q.verseStem ? '<div class="verse-q ar">' + esc(q.verseStem) + ' <span class="blank"></span></div>' : '');

    if (q.type === "multi") {
      body += '<div class="tiles">' + (q.pool || []).map(function (ch) {
        return '<button class="tile ar" data-ch="' + esc(ch) + '" aria-pressed="false">' + esc(ch) + '</button>';
      }).join("") + '</div><button class="cta" id="check" disabled>Check</button>';
    } else {
      // Option order is shuffled at render time. Authored units cluster their
      // correct answers near the top (one unit had 7 of 11 at position 0),
      // which makes a drill tappable without reading it. `data-i` keeps the
      // original index, so grading and the answer key are untouched. Numeric
      // option sets stay in their natural order — a scrambled 0/1/2/3 reads as
      // a bug, not a challenge.
      var opts = q.options || [];
      var order = opts.map(function (_, i) { return i; });
      var numeric = opts.length > 0 && opts.every(function (o) { return /^\s*\d+\s*$/.test(o); });
      if (!numeric) {
        for (var s = order.length - 1; s > 0; s--) {
          var j = Math.floor(Math.random() * (s + 1));
          var tmp = order[s]; order[s] = order[j]; order[j] = tmp;
        }
      }
      body += '<div class="opts">' + order.map(function (oi) {
        return '<button class="opt' + (q.arabicOptions ? " ar" : "") + '" data-i="' + oi + '">' +
          opts[oi] + '</button>';
      }).join("") + '</div>';
    }
    mount(body, true);
    setBar(S.qi, u.questions.length);

    if (q.type === "multi") {
      var tiles = root.querySelectorAll(".tile");
      tiles.forEach(function (tl) {
        tl.addEventListener("click", function () {
          if (S.answered) return;
          var on = tl.getAttribute("aria-pressed") === "true";
          tl.setAttribute("aria-pressed", String(!on));
          S.picked = Array.prototype.filter.call(tiles, function (x) {
            return x.getAttribute("aria-pressed") === "true";
          }).map(function (x) { return x.dataset.ch; });
          document.getElementById("check").disabled = S.picked.length === 0;
        });
      });
      document.getElementById("check").addEventListener("click", function () { gradeMulti(q, tiles); });
    } else {
      root.querySelectorAll(".opt").forEach(function (b) {
        b.addEventListener("click", function () { gradeChoice(q, b); });
      });
    }
  }

  function correctText(q) {
    if (q.type === "multi") return (q.answers || []).join(" ، ");
    return (q.options || [])[q.answerIndex];
  }

  function finish(ok, q) {
    S.answered = true;
    if (ok) { S.score++; S.streak++; if (S.streak > S.best) S.best = S.streak; }
    else { S.streak = 0; S.missed.push(q); }
    var card = root.querySelector(".card");
    var fb = document.createElement("div");
    fb.className = "fb " + (ok ? "good" : "bad");
    fb.innerHTML = '<div class="verdict">' +
      (ok ? "Correct" : "Not quite — it is " + esc(correctText(q))) + '</div>' +
      '<div class="why">' + q.why + '</div>';
    card.appendChild(fb);
    var nxt = document.createElement("button");
    nxt.className = "cta";
    nxt.textContent = S.qi < S.unit.questions.length - 1 ? "Next question" : "See results";
    nxt.addEventListener("click", function () {
      S.qi++;
      if (S.qi < S.unit.questions.length) renderQ(); else renderDone();
    });
    card.appendChild(nxt);
    setBar(S.qi + 1, S.unit.questions.length);
    var st = document.getElementById("streak");
    if (st) st.textContent = S.streak > 1 ? "🔥 " + S.streak : "";
    nxt.focus();
  }

  function gradeChoice(q, btn) {
    if (S.answered) return;
    var i = parseInt(btn.dataset.i, 10);
    var ok = i === q.answerIndex;
    root.querySelectorAll(".opt").forEach(function (b) {
      b.disabled = true;
      var bi = parseInt(b.dataset.i, 10);
      if (bi === q.answerIndex) b.classList.add("right");
      else if (bi === i) b.classList.add("wrong");
    });
    finish(ok, q);
  }

  function gradeMulti(q, tiles) {
    if (S.answered) return;
    var ans = q.answers || [];
    var ok = S.picked.length === ans.length && ans.every(function (a) { return S.picked.indexOf(a) > -1; });
    tiles.forEach(function (tl) {
      tl.disabled = true;
      var ch = tl.dataset.ch, on = tl.getAttribute("aria-pressed") === "true", isAns = ans.indexOf(ch) > -1;
      if (on && isAns) tl.classList.add("right");
      else if (on && !isAns) tl.classList.add("wrong");
      else if (!on && isAns) tl.classList.add("missed");
    });
    var chk = document.getElementById("check");
    if (chk) chk.remove();
    finish(ok, q);
  }

  function renderDone() {
    var u = S.unit, n = u.questions.length, pct = Math.round(S.score / n * 100);
    var verdict = pct === 100 ? "Perfect." : pct >= 75 ? "Solid." : pct >= 50 ? "Getting there." : "Worth another pass.";
    record(u.ep, S.score, n);
    var html = '<div class="score">' + S.score + '<small>out of ' + n + ' — ' + verdict + '</small></div>';
    if (S.best > 1) {
      html += '<p style="text-align:center;margin:.6rem 0 0;color:var(--between);font-weight:600">Best streak 🔥 ' + S.best + '</p>';
    }
    if (S.missed.length) {
      html += '<div class="review"><h3>Worth revisiting</h3><ul>' + S.missed.map(function (m) {
        return '<li>' + esc(String(m.q).replace(/<[^>]+>/g, "")) + ' — <strong>' + esc(correctText(m)) + '</strong></li>';
      }).join("") + '</ul></div>';
    }
    html += '<button class="cta" id="again">Drill again</button>' +
      '<button class="ghost" id="hub">Back to all units</button>' +
      '<p class="foot">Episode ' + u.ep + ' — <span class="ar">' + esc(u.title_ar) + '</span>' +
      (u.url ? ' · <a href="' + u.url + '" target="_blank" rel="noopener">watch the lesson</a>' : '') + '</p>';
    mount(html, false);
    setBar(1, 1);
    document.getElementById("again").addEventListener("click", function () {
      S.qi = 0; S.score = 0; S.streak = 0; S.best = 0; S.missed = []; renderQ();
    });
    document.getElementById("hub").addEventListener("click", function () { location.hash = "#/"; });
  }

  /* ── routing ────────────────────────────── */
  function route() {
    var m = /^#\/u\/(\d+)/.exec(location.hash || "");
    if (m) renderUnit(parseInt(m[1], 10)); else renderHub();
  }
  window.addEventListener("hashchange", route);

  if (!CATALOGUE.length && !UNITS.length) {
    root.innerHTML = '<div class="card"><h1>No units loaded</h1>' +
      '<p>data.js did not define any units.</p></div>';
  } else {
    route();
  }
})();
