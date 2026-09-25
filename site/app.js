/* Tajweed companion: hub and drill engine.
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

  // Which screen is up, so background updates redraw the right one and never
  // pull the learner out of a drill.
  var VIEW = "hub";

  /* ── offline and install ───────────────── */
  // sw.js keeps the page and every unit available offline after one visit.
  if ("serviceWorker" in navigator &&
      (location.protocol === "https:" || location.hostname === "localhost")) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () { /* unsupported host */ });
    });
  }
  // Chrome, Edge and Android offer an install prompt a page can trigger;
  // Safari has none (it is Share → Add to Home Screen), so the button only
  // appears where it will work. Toggled in place, so the hub never jumps.
  var installEvt = null;
  function showInstall() {
    var b = document.getElementById("btnInstall");
    if (b) b.classList.toggle("hide", !installEvt);
  }
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault(); installEvt = e; showInstall();
  });
  window.addEventListener("appinstalled", function () { installEvt = null; showInstall(); });

  // sync.js changed local scores (merged another device, or deleted an
  // account): redraw whatever page shows them.
  document.addEventListener("tj:progress-updated", function () {
    if (VIEW === "hub") renderHub(); else if (VIEW === "privacy") renderPrivacy();
  });
  // Signing in or out changes what the privacy page offers.
  document.addEventListener("tj:auth-changed", function () {
    if (VIEW === "privacy") renderPrivacy();
  });

  /* ── course sections, in playlist order ───── */
  // Every episode is listed 1..N in the order the playlist teaches it; a
  // heading only marks where the course moves to a new topic. Grouping by
  // keyword instead pulled episodes out of sequence (9 and 14 landed after 16,
  // 21 after 2), which fought anyone watching along. Ranges live in
  // catalogue_meta.json; build_data.py checks they cover every episode.
  var SECTIONS = (window.SECTIONS && window.SECTIONS.length) ? window.SECTIONS
    : [{ from: 1, to: CATALOGUE.length, en: "Episodes", ar: "", tone: "brand" }];
  var CAT_BY_EP = {};
  CATALOGUE.forEach(function (c) { CAT_BY_EP[c.ep] = c; });

  function toneColor(t) {
    return (t === "stop" || t === "between" || t === "flow") ? "var(--" + t + ")" : "var(--brand)";
  }

  // "Continue" picks up after the furthest unit this learner has finished.
  // Someone following the playlist moves forward in order, so the furthest
  // finished unit is where they are in the course.
  function nextUp(p) {
    var ready = {}, furthest = 0;
    UNITS.forEach(function (u) { ready[u.ep] = u; });
    Object.keys(p).forEach(function (k) { var e = +k; if (ready[e] && e > furthest) furthest = e; });
    for (var i = 0; i < CATALOGUE.length; i++) {
      var c = CATALOGUE[i];
      if (c.ep > furthest) return { c: c, u: ready[c.ep] || null, fresh: furthest === 0 };
    }
    return null;
  }

  function continueCard(p) {
    var n = nextUp(p);
    if (!n) {
      return '<div class="cont soon"><span class="cont-label">All done</span>' +
        '<div class="cont-title">You’ve finished every unit in the series.</div></div>';
    }
    var c = n.c, u = n.u;
    var watch = '<a class="cont-watch" href="' + c.url + '" target="_blank" rel="noopener">Watch episode ' +
      c.ep + ' ↗</a>';
    if (!u) {
      return '<div class="cont soon"><span class="cont-label">You’re up to date</span>' +
        '<div class="cont-title">Unit ' + c.ep + ' isn’t ready yet</div>' +
        '<div class="cont-sub">' + esc(c.topic_en) + '</div>' +
        '<div class="cont-actions">' + watch + '</div></div>';
    }
    return '<div class="cont"><span class="cont-label">' + (n.fresh ? "Start here" : "Continue") + '</span>' +
      '<div class="cont-title">Unit ' + c.ep + ' · ' + esc(u.title_en) + '</div>' +
      '<div class="cont-sub ar">' + esc(c.topic) + '</div>' +
      '<div class="cont-actions"><button class="cont-go" data-ep="' + c.ep + '">' +
        (n.fresh ? "Start unit " : "Go to unit ") + c.ep + '</button>' + watch + '</div></div>';
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
    VIEW = "hub";
    document.title = "Tajweed Companion";
    var p = loadProgress();
    var byEp = {};
    UNITS.forEach(function (u) { byEp[u.ep] = u; });

    var completed = 0, totalQ = 0, gotQ = 0;
    UNITS.forEach(function (u) {
      var r = p[u.ep];
      totalQ += u.questions.length;
      if (r) { gotQ += r.best; if (r.best === u.questions.length) completed++; }
    });

    var html =
      '<div class="hub-head">' +
        // sync.js fills #account (top right) and #syncNote (in the progress card).
        '<div class="hub-top"><h1>Tajweed Companion</h1><div class="account" id="account"></div></div>' +
        // The name is its own isolated Arabic run; mixed into the English
        // sentence, its full stop drifted to the wrong end.
        '<p class="sub">Drills for <span class="ar">شرح كتاب التجويد المصور</span> by ' +
        '<span class="ar">د. أيمن رشدي سويد</span>. One short unit per episode.</p>' +
        // Two ways into the course material, side by side: the videos, and
        // the terms the drills use.
        '<div class="quick">' +
          (window.PLAYLIST ? '<a class="qtile" href="' + window.PLAYLIST + '" target="_blank" rel="noopener">' +
            '<span class="qi qi-yt" aria-hidden="true"><svg viewBox="0 0 24 24" width="15" height="15"><path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/></svg></span><strong>Watch the course</strong>' +
            '<small>' + CATALOGUE.length + ' episodes on YouTube</small></a>' : '') +
          '<a class="qtile" href="#/glossary">' +
            '<span class="qi qi-gl ar" aria-hidden="true">أ ب</span><strong>Glossary</strong>' +
            '<small>' + (window.GLOSSARY || []).length + ' terms explained</small></a>' +
        '</div>' +
        continueCard(p) +
        '<div class="overall">' +
          '<div class="row"><span class="big">' + gotQ + ' / ' + totalQ + '</span>' +
          '<span class="cap">' + completed + ' of ' + UNITS.length + ' ready units aced</span></div>' +
          '<div class="track"><div class="fill" style="width:' +
            (totalQ ? (gotQ / totalQ * 100) : 0) + '%"></div></div>' +
          '<p style="margin:.7rem 0 0;font-size:.84rem;color:var(--ink-faint)">' +
            UNITS.length + ' of ' + CATALOGUE.length + ' units ready. More are added as the ' +
            'series goes on.</p>' +
          '<p class="sync-note" id="syncNote"></p>' +
        '</div>' +
      '</div>';

    // The bold line is the drill's own name; under the Arabic chapter title
    // sits a plain translation of it, so nobody mistakes one for the other.
    SECTIONS.forEach(function (s) {
      var items = CATALOGUE.filter(function (c) { return c.ep >= s.from && c.ep <= s.to; });
      if (!items.length) return;
      var color = toneColor(s.tone);
      html += '<div class="chapter"><span>' + esc(s.en) +
        (s.ar ? ' · <span class="ar">' + esc(s.ar) + '</span>' : '') + '</span>' +
        '<span class="range">' + (s.from === s.to ? s.from : s.from + '–' + s.to) + '</span></div>' +
        '<div class="units">';
      items.forEach(function (c) {
        var u = byEp[c.ep];
        if (u) {
          var r = p[c.ep], n = u.questions.length;
          var cls = "", txt = "Start";
          if (r) {
            if (r.best === n) { cls = "done"; txt = "★ " + r.best + "/" + n; }
            else { cls = "part"; txt = r.best + "/" + n; }
          }
          html +=
            '<button class="unit" style="--fam:' + color + '" data-ep="' + c.ep + '">' +
              '<span class="n">' + c.ep + '</span>' +
              '<span class="body"><span class="t">' + esc(u.title_en) + '</span>' +
              '<span class="t-ar ar">' + esc(c.topic) + '</span>' +
              '<span class="t-en">' + esc(c.topic_en) + '</span></span>' +
              '<span class="state ' + cls + '">' + txt + '</span>' +
            '</button>';
        } else {
          html +=
            '<button class="unit" style="--fam:' + color + '" disabled>' +
              '<span class="n">' + c.ep + '</span>' +
              '<span class="body"><span class="t">' + esc(c.topic_en) + '</span>' +
              '<span class="t-ar ar">' + esc(c.topic) + '</span>' +
              '<span class="t-en">' + c.minutes + ' min lesson</span></span>' +
              '<span class="state">soon</span>' +
            '</button>';
        }
      });
      html += "</div>";
    });

    html += '<button class="install' + (installEvt ? '' : ' hide') + '" id="btnInstall">' +
      '<img src="icon-192.png" alt="" width="28" height="28">Install as an app</button>';
    html += '<p class="hub-foot">The lessons are the Shaykh’s. These drills are only here to help you review them.<br>' +
      'If you find a mistake, it’s ours.<br>' +
      '<a href="#/glossary">Glossary</a> · <a href="#/privacy">About and privacy</a></p>';

    root.innerHTML = html;
    root.querySelectorAll(".unit, .cont-go").forEach(function (b) {
      b.addEventListener("click", function () { location.hash = "#/u/" + b.dataset.ep; });
    });
    document.getElementById("btnInstall").addEventListener("click", function () {
      if (!installEvt) return;
      installEvt.prompt();
      installEvt.userChoice.then(function () { installEvt = null; showInstall(); });
    });
    window.scrollTo(0, 0);
    document.dispatchEvent(new CustomEvent("tj:hub-rendered"));
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  /* ── glossary: tap a term for its meaning ── */
  // Units write every Arabic word inside <span class='ar'>. A span is linked
  // only when its whole text is a glossary form, so a verse or an āya that
  // merely contains مخرج is never touched. Same normalisation as
  // norm_term() in build_data.py.
  var GLOSS = {}, GLOSS_BY_ID = {};
  function glossKey(s) {
    return String(s || "").normalize("NFC")
      .replace(/[ً-ٰٟـۖ-ۭ]/g, "")
      .replace(/[أإآٱ]/g, "ا")
      .replace(/\s+/g, " ")
      .replace(/^[\s.,،؛:;!?()«»"']+|[\s.,،؛:;!?()«»"']+$/g, "");
  }
  (window.GLOSSARY || []).forEach(function (e) {
    GLOSS_BY_ID[e.id] = e;
    e.forms.forEach(function (f) { GLOSS[glossKey(f)] = e; });
  });
  // "plain" entries match only an unvowelled word: بيت is a line of verse,
  // while بَيْت / ٱلْبَيْتِ in an example is a house. "units" keeps a term to
  // the chapter where it has that meaning (لازم is a madd in 27+, a stop in 20).
  var HARAKAT = /[ً-ْ]/;
  function glossFor(text, ep) {
    var k = glossKey(text);
    var e = GLOSS[k] || (k.indexOf("ال") === 0 ? GLOSS[k.slice(2)] : null);
    if (!e) return null;
    if (e.plain && HARAKAT.test(text)) return null;
    if (e.units && ep && (ep < e.units[0] || ep > e.units[1])) return null;
    return e;
  }

  // First mention of each term per screen only; underlining every repeat
  // turns a paragraph into a page of links. The question's own wording is
  // linked only once it has been answered: "What is التكرير?" would
  // otherwise come with its answer attached.
  // At most four per screen, so a dense explanation never turns into a page
  // of underlines. Terms not yet shown in this unit take the places first;
  // a term met two cards ago is the one to let go.
  var GLOSS_MAX = 4;
  function linkGlossary(scope, questionOpen) {
    var seen = {}, cands = [];
    var ep = S && S.unit ? S.unit.ep : 0;
    var sel = ".teach p span.ar, .why span.ar" + (questionOpen ? "" : ", p.q span.ar");
    scope.querySelectorAll(sel).forEach(function (sp) {
      var e = glossFor(sp.textContent, ep);
      if (!e || seen[e.id]) return;
      seen[e.id] = true;
      cands.push({ sp: sp, e: e, old: !!(S && S.glossed && S.glossed[e.id]) });
    });
    var chosen = cands.filter(function (c) { return !c.old; })
      .concat(cands.filter(function (c) { return c.old; })).slice(0, GLOSS_MAX);
    chosen.forEach(function (c) {
      var sp = c.sp, e = c.e;
      if (S) { S.glossed = S.glossed || {}; S.glossed[e.id] = true; }
      sp.classList.add("gl");
      sp.dataset.g = e.id;
      sp.tabIndex = 0;
      sp.setAttribute("role", "button");
      sp.setAttribute("aria-expanded", "false");
      sp.setAttribute("aria-label", sp.textContent + ": " + e.en + ". Tap for the meaning");
    });
  }

  // Arabic inside a definition gets the Arabic face, like everywhere else.
  function glossDef(e) {
    return esc(e.def).replace(/[؀-ۿ]+(?:\s+[؀-ۿ]+)*/g, function (m) {
      return '<span class="ar">' + m + '</span>';
    });
  }

  var pop = null, popFor = null;
  function closeGloss() {
    if (pop) pop.remove();
    if (popFor) popFor.setAttribute("aria-expanded", "false");
    pop = null; popFor = null;
  }
  function openGloss(sp) {
    var e = GLOSS_BY_ID[sp.dataset.g];
    if (!e) return;
    if (popFor === sp) return closeGloss();
    closeGloss();
    var def = glossDef(e);
    // Once someone has opened a definition, the start-screen tip has done its job.
    try { localStorage.setItem("tajweed-gloss-used", "1"); } catch (err) { /* storage blocked */ }
    pop = document.createElement("div");
    pop.className = "gpop";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", e.en);
    pop.innerHTML =
      '<div class="gp-head"><span class="gp-ar ar">' + esc(e.ar) + '</span>' +
        '<span class="gp-tr">' + esc(e.tr) + '</span></div>' +
      '<div class="gp-en">' + esc(e.en) + '</div>' +
      '<p class="gp-def">' + def + '</p>';
    document.body.appendChild(pop);
    popFor = sp;
    sp.setAttribute("aria-expanded", "true");

    // Below the word, or above it when the bottom of the screen is too close;
    // always kept inside the viewport horizontally.
    var r = sp.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    var left = Math.min(Math.max(12, r.left + r.width / 2 - w / 2),
      document.documentElement.clientWidth - w - 12);
    var below = r.bottom + 8 + h <= window.innerHeight || r.top - 8 - h < 0;
    pop.style.left = (left + window.scrollX) + "px";
    pop.style.top = ((below ? r.bottom + 8 : r.top - 8 - h) + window.scrollY) + "px";
  }
  document.addEventListener("click", function (ev) {
    var sp = ev.target.closest && ev.target.closest(".gl");
    if (sp) { ev.preventDefault(); openGloss(sp); return; }
    if (pop && !pop.contains(ev.target)) closeGloss();
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && pop) { var f = popFor; closeGloss(); if (f) f.focus(); return; }
    var sp = ev.target.closest && ev.target.closest(".gl");
    if (sp && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); openGloss(sp); }
  });
  window.addEventListener("resize", closeGloss);

  /* ── recitation: al-Ḥuṣarī, one āya at a time ── */
  // EveryAyah serves each āya as SSSAAA.mp3. A question quoting part of an
  // āya plays the whole of it, which is how the Shaykh cites them too.
  var AUDIO_BASE = "https://everyayah.com/data/Husary_128kbps/";
  var player = null, playing = null;
  function ayahAudio(ref) {
    var m = /(\d+)\s*:\s*(\d+)/.exec(ref || "");
    if (!m) return "";
    var pad = function (n) { return ("00" + n).slice(-3); };
    return AUDIO_BASE + pad(m[1]) + pad(m[2]) + ".mp3";
  }
  function setPlayBtn(b, state) {
    if (!b) return;
    b.dataset.state = state;
    b.setAttribute("aria-label", state === "playing" ? "Stop the recitation" :
      "Listen to the āya, recited by al-Ḥuṣarī");
    b.textContent = state === "playing" ? "■ Stop" : state === "loading" ? "Loading…" :
      state === "error" ? "Couldn’t play. Try again" : "▶ Listen";
  }
  function stopAudio() {
    if (player) { player.pause(); player.removeAttribute("src"); player.load(); }
    setPlayBtn(playing, "idle");
    playing = null;
  }
  function togglePlay(b) {
    if (playing === b) return stopAudio();
    stopAudio();
    if (!player) {
      player = new Audio();
      player.preload = "none";
      player.addEventListener("playing", function () { setPlayBtn(playing, "playing"); });
      player.addEventListener("ended", function () { setPlayBtn(playing, "idle"); playing = null; });
      player.addEventListener("error", function () {
        if (playing && player.getAttribute("src")) { setPlayBtn(playing, "error"); playing = null; }
      });
    }
    playing = b;
    setPlayBtn(b, "loading");
    player.src = b.dataset.src;
    var p = player.play();
    if (p && p.catch) p.catch(function () { if (playing === b) { setPlayBtn(b, "error"); playing = null; } });
  }

  /* ── drill ──────────────────────────────── */
  // One attempt at a unit. Answers are kept per question so the learner can
  // move back and forth freely: a revisited question shows exactly what was
  // picked and why, and cannot be re-answered - the score is the first try,
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
    VIEW = "unit";
    document.title = "Unit " + unit.ep + ": " + unit.title_en + " · Tajweed Companion";
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
    closeGloss();
    var src = playing && playing.dataset.src;
    root.innerHTML = shell(inner, showStreak);
    document.getElementById("btnBack").addEventListener("click", function () { location.hash = "#/"; });
    linkGlossary(root, S.view === "q" && !S.ans[S.qi]);
    // Answering redraws the question; a recitation already under way carries
    // on and its button keeps showing Stop. Any other screen change ends it.
    var same = src && root.querySelector('.play[data-src="' + src + '"]');
    if (same) { playing = same; setPlayBtn(same, player && !player.paused ? "playing" : "loading"); }
    else if (src) stopAudio();
    root.querySelectorAll(".play").forEach(function (b) {
      b.addEventListener("click", function () { togglePlay(b); });
    });
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
      '<p class="ar" style="font-size:1.5rem;color:var(--ink-soft);margin:-.2rem 0 .2rem">' + esc(u.title_ar) + '</p>' +
      (CAT_BY_EP[u.ep] ? '<p class="start-en">' + esc(CAT_BY_EP[u.ep].topic_en) + '</p>' : '') +
      '<p class="lead">' + u.summary + '</p>' +
      '<p>' + u.teach.length + ' quick cards, then ' + u.questions.length + ' questions. About four minutes.</p>' +
      (u.url ? '<p><a class="watch" href="' + u.url + '" target="_blank" rel="noopener">▶ Watch episode ' +
        u.ep + ' on YouTube</a></p>' : '') +
      (glossTipNeeded() ? '<p class="gtip">Tip: tap any word with a <span class="gtip-demo">dotted underline</span> ' +
        'to see what it means, or <a href="#/glossary">browse the glossary</a>.</p>' : '') +
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
    // option sets stay in natural order - a scrambled 0/1/2/3 reads as a bug.
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

  // The key as HTML. Option text is authored unit content and may carry
  // <span class='ar'> markup, so it is inserted as-is, exactly as the option
  // buttons do; escaping it printed the raw tags in the "Not quite" line.
  function correctHTML(q) {
    if (q.type === "multi") return '<span class="ar">' + esc((q.answers || []).join(" ، ")) + '</span>';
    return (q.options || [])[q.answerIndex];
  }

  function feedbackHTML(ok, q) {
    return '<div class="fb ' + (ok ? "good" : "bad") + '">' +
      '<div class="verdict">' + (ok ? "Correct" : "Not quite. The answer is " + correctHTML(q)) + '</div>' +
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
                '<div class="ref-row"><span class="ref">' + esc(q.ref || "") + '</span>' +
                // Only once answered: hearing the āya first would answer
                // "is the rāʾ heavy here?" for the learner.
                (a && ayahAudio(q.ref) ? '<button class="play" data-src="' + ayahAudio(q.ref) + '" ' +
                  'aria-label="Listen to the āya, recited by al-Ḥuṣarī">▶ Listen</button>' : '') +
                '</div>' : '') +
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

    var html = '<div class="score">' + score + '<small>out of ' + n + '. ' + verdict + '</small></div>';
    if (skipped) {
      html += '<p class="skipnote">You skipped ' + skipped + (skipped === 1 ? " question" : " questions") +
        '. Tap one below to answer it.</p>';
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
          esc(String(q.q).replace(/<[^>]+>/g, "")) + '<br>' +
          (r ? '<strong>' + correctHTML(q) + '</strong>' : '<em>not answered</em>') +
          '</button></li>';
      }).join("") + '</ul></div>';
    }
    html += '<button class="cta" id="again">Drill again</button>' +
      '<button class="ghost" id="review">Review your answers</button>' +
      '<button class="ghost" id="hub">Back to all units</button>' +
      '<p class="foot">Episode ' + u.ep + ': <span class="ar">' + esc(u.title_ar) + '</span>' +
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
    closeGloss();
    stopAudio();
    var h = location.hash || "";
    var m = /^#\/u\/(\d+)/.exec(h);
    if (m) renderUnit(parseInt(m[1], 10));
    else if (h === "#/privacy") { S = null; renderPrivacy(); }
    else if (h === "#/glossary") { S = null; renderGlossary(); }
    else { S = null; renderHub(); }
  }

  /* ── glossary page ──────────────────────── */
  function glossTipNeeded() {
    try { return !localStorage.getItem("tajweed-gloss-used"); } catch (e) { return true; }
  }

  // Transliteration is typed a dozen ways: sifa, ṣifa, sifah, sifat; ghunna,
  // ghunnah, gunna; tajwīd, tajweed. Both sides are folded the same way:
  // accents and ʿ ʾ dropped, ee/oo read as i/u, doubled letters and a final
  // -ah collapsed, hyphens treated as spaces.
  function foldLatin(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().replace(/[ʿʾ'’‘`]/g, "").replace(/[-_]/g, " ")
      .replace(/ee/g, "i").replace(/oo/g, "u").replace(/([a-z])\1+/g, "$1")
      .replace(/ah\b/g, "a").replace(/\s+/g, " ").trim();
  }
  // A plain substring match, plus plurals and endings: "sifat" still finds
  // "sifa", because a word of the entry is the start of what was typed.
  function latinHit(key, q) {
    if (!q) return true;
    if (key.indexOf(q) > -1) return true;
    return key.split(" ").some(function (w) {
      return w.length >= 4 && q.indexOf(w) === 0 && q.length - w.length <= 2;
    });
  }

  // Every term in one place, grouped by topic as glossary.json lists them, with a
  // filter that matches English, transliteration or Arabic (vowels ignored).
  function renderGlossary() {
    VIEW = "glossary";
    document.title = "Glossary · Tajweed Companion";
    var list = window.GLOSSARY || [];
    root.innerHTML =
      '<div class="bar"><button class="back" id="btnBack">‹ All units</button></div>' +
      '<div class="card prose">' +
        '<h1>Glossary</h1>' +
        '<p class="lead">The ' + list.length + ' terms the drills link to. In a unit, tap any word ' +
          'with a dotted underline to see its entry.</p>' +
        '<input class="gsearch" id="gsearch" type="search" placeholder="Search in English or Arabic" ' +
          'aria-label="Search the glossary" autocomplete="off">' +
        '<p class="fine gcount" id="gcount"></p>' +
        '<dl class="glist" id="glist">' + list.map(function (e) {
          var latin = foldLatin(e.en + " " + e.tr + " " + (e.alt || []).join(" "));
          var arabic = e.forms.concat([e.ar]).map(glossKey).join(" ");
          return '<div class="gitem" data-k="' + esc(latin) + '" data-a="' + esc(arabic) + '">' +
            '<dt><span class="gi-ar ar">' + esc(e.ar) + '</span>' +
              '<span class="gi-en">' + esc(e.en) + '</span>' +
              '<span class="gi-tr">' + esc(e.tr) + '</span></dt>' +
            '<dd>' + glossDef(e) + '</dd></div>';
        }).join("") + '</dl>' +
      '</div>';
    document.getElementById("btnBack").addEventListener("click", function () { location.hash = "#/"; });
    var box = document.getElementById("gsearch"), items = root.querySelectorAll(".gitem");
    var count = document.getElementById("gcount");
    box.addEventListener("input", function () {
      var raw = box.value.trim(), q = foldLatin(raw), qa = glossKey(raw), shown = 0;
      var arabic = /[؀-ۿ]/.test(raw);
      items.forEach(function (it) {
        var hit = !raw || (arabic ? qa && it.dataset.a.indexOf(qa) > -1 : latinHit(it.dataset.k, q));
        it.classList.toggle("hide", !hit);
        if (hit) shown++;
      });
      count.textContent = q ? (shown ? shown + " of " + items.length : "No term matches that.") : "";
    });
    window.scrollTo(0, 0);
  }

  /* ── about and privacy ──────────────────── */
  // The data-controls block below is the signed-out version: it can only reset
  // this browser's copy. When someone is signed in, sync.js replaces it with
  // the control that deletes their account and cloud record, because only
  // sync.js holds the Firebase session.
  function renderPrivacy() {
    VIEW = "privacy";
    document.title = "About and privacy · Tajweed Companion";
    var p = loadProgress(), saved = Object.keys(p).length;
    var local = saved
      ? '<p>You’re not signed in, so your scores are saved only in this browser.</p>' +
        '<button class="danger" id="resetLocal">Reset progress on this device</button>' +
        '<div class="confirm hide" id="resetConfirm">' +
          '<p>This clears every score saved in this browser. It can’t be undone.</p>' +
          '<div class="confirm-row"><button class="danger" id="resetYes">Yes, reset</button>' +
          '<button class="nav-btn" id="resetNo">Cancel</button></div></div>'
      : '<p>No progress is saved in this browser.</p>';

    root.innerHTML =
      '<div class="bar"><button class="back" id="btnBack">‹ All units</button></div>' +
      '<div class="card prose">' +
        '<h1>About and privacy</h1>' +
        '<p class="lead">Tajweed Companion is a set of short drills to go with Dr. Ayman Rushdi ' +
          'Swaid’s video commentary on <span class="ar">التجويد المصور</span>. It is an ' +
          'independent study aid, not affiliated with Dr. Ayman or his team. The lessons are his.</p>' +

        '<h2>How accurate is it?</h2>' +
        '<p>Every question was checked twice against the text of the muṣḥaf and of ' +
          '<span class="ar">المقدمة الجزرية</span>. It has not been reviewed by a qualified teacher. ' +
          'If anything here disagrees with your teacher, follow your teacher.</p>' +

        '<h2>What is stored</h2>' +
        '<p><strong>If you don’t sign in:</strong> your scores are saved in this browser only. ' +
          'Nothing is sent anywhere.</p>' +
        '<p><strong>If you sign in with Google:</strong></p>' +
        '<ul>' +
          '<li>your Google name, email address and account ID, which Google keeps so you can ' +
            'sign in;</li>' +
          '<li>your best score and number of attempts for each unit, kept in a database in ' +
            'London so they appear on all your devices.</li>' +
        '</ul>' +
        '<p>That is all. There are no analytics, no ads and no tracking, and nothing is sold or shared.</p>' +

        '<h2>Who can see it</h2>' +
        '<p>Only you, and the person who runs this site, who can see the list of signed-in ' +
          'accounts and their scores.</p>' +
        '<p>The page also loads its fonts from Google Fonts, signs you in through Google, and ' +
          'links to YouTube for each episode. Those are Google services and follow ' +
          '<a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Google’s privacy policy</a>. ' +
          'When you tap Listen, the recitation (by Shaykh Maḥmūd Khalīl al-Ḥuṣarī) plays from ' +
          'EveryAyah, a free archive of Qur’an audio.</p>' +

        '<h2>Delete your data</h2>' +
        '<div class="data-controls" id="data-controls">' + local + '</div>' +
        '<p class="fine">Deleting takes effect straight away. Progress saved in another browser ' +
          'stays there until you reset it on that device, and signing in there would upload it again.</p>' +

        '<p class="fine">Spotted a mistake? <a href="https://github.com/9ali-oop/tajweed-companion/issues/new" ' +
          'target="_blank" rel="noopener">Report it here</a>. ' +
          'Last updated 24 September 2026.</p>' +
      '</div>';

    document.getElementById("btnBack").addEventListener("click", function () { location.hash = "#/"; });
    var reset = document.getElementById("resetLocal");
    if (reset) {
      var box = document.getElementById("resetConfirm");
      reset.addEventListener("click", function () { box.classList.remove("hide"); reset.classList.add("hide"); });
      document.getElementById("resetNo").addEventListener("click", function () {
        box.classList.add("hide"); reset.classList.remove("hide");
      });
      document.getElementById("resetYes").addEventListener("click", function () {
        try { localStorage.removeItem(KEY); } catch (e) {}
        document.getElementById("data-controls").innerHTML =
          '<p class="done-msg">Progress on this device has been reset.</p>';
      });
    }
    window.scrollTo(0, 0);
    document.dispatchEvent(new CustomEvent("tj:privacy-rendered"));
  }
  window.addEventListener("hashchange", route);

  /* ── scores carried over from the old address ── */
  // The site moved from GitHub Pages to its own address, and browsers keep
  // saved scores per address. The old page forwards them in the fragment
  // (#carry=…&to=…), which never reaches a server. Merge them the way sync.js
  // merges devices - best score wins, runs take the larger count - then put
  // the address back to the route the visitor was on.
  function importCarried() {
    var m = /^#carry=([^&]*)(?:&to=(.*))?$/.exec(location.hash);
    if (!m) return;
    try {
      var incoming = JSON.parse(decodeURIComponent(m[1])) || {}, p = loadProgress();
      Object.keys(incoming).forEach(function (k) {
        var r = incoming[k], n = function (x) { return typeof x === "number" && x >= 0 ? x : 0; };
        if (!/^\d{1,2}$/.test(k) || !r || typeof r !== "object") return;
        var l = p[k] || {};
        p[k] = { best: Math.max(n(l.best), n(r.best)), total: Math.max(n(l.total), n(r.total)),
                 runs: Math.max(n(l.runs), n(r.runs)) };
      });
      saveProgress(p);
    } catch (e) { /* malformed: nothing to carry */ }
    var to = m[2] ? decodeURIComponent(m[2]) : "/";
    history.replaceState(null, "", location.pathname + "#" + (to.charAt(0) === "/" ? to : "/"));
  }
  importCarried();

  if (!CATALOGUE.length && !UNITS.length) {
    root.innerHTML = '<div class="card"><h1>Couldn’t load the drills</h1>' +
      '<p>Refresh the page to try again.</p></div>';
  } else {
    route();
  }
})();
