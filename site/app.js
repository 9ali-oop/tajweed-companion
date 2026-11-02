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
    else if (VIEW === "letters") renderLetters();
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
    // A drill left half-way comes first: that is where the learner actually is.
    var open = latestAttempt();
    if (open) {
      var ou = open.u, done = open.a.ans.filter(Boolean).length, total = ou.questions.length;
      var right = open.a.ans.filter(function (a) { return a && a.ok; }).length;
      return '<div class="cont"><span class="cont-label">Pick up where you left off</span>' +
        '<div class="cont-title">Unit ' + ou.ep + ' · ' + esc(ou.title_en) + '</div>' +
        '<div class="cont-sub">' + done + ' of ' + total + ' answered, ' + right + ' correct</div>' +
        '<div class="cont-actions"><button class="cont-go" data-ep="' + ou.ep + '" data-resume="1">' +
          'Resume unit ' + ou.ep + '</button></div></div>';
    }
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
    document.title = "Tajweed Companion - drills for Dr. Ayman Swaid's التجويد المصور";
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
          (LT.cards.length ? '<a class="qtile qtile-wide" href="#/letters">' +
            '<span class="qi qi-lt ar" aria-hidden="true">ض</span><span class="qt-text"><strong>Letters</strong>' +
            '<small>The 17 makhārij by heart, and ' + LT.cards.length + ' letter flashcards</small></span></a>' : '') +
        '</div>' +
        continueCard(p) +
        '<div class="overall">' +
          '<div class="row"><span class="big">' + gotQ + ' / ' + totalQ + '</span>' +
          '<span class="cap">' + completed + ' of ' + UNITS.length + ' ready units aced</span></div>' +
          '<div class="track"><div class="fill" style="width:' +
            (totalQ ? (gotQ / totalQ * 100) : 0) + '%"></div></div>' +
          '<p style="margin:.7rem 0 0;font-size:.84rem;color:var(--ink-faint)">' +
            (UNITS.length >= CATALOGUE.length
              ? 'All ' + CATALOGUE.length + ' units are ready, one for every episode.'
              : UNITS.length + ' of ' + CATALOGUE.length + ' units ready. More are added as the series goes on.') +
            '</p>' +
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
      b.addEventListener("click", function () {
        location.hash = "#/u/" + b.dataset.ep + (b.dataset.resume ? "/resume" : "");
      });
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

  /* ── an attempt in progress survives leaving ── */
  // Closing the tab or tapping away mid-drill used to lose every answer,
  // because nothing was saved until the results screen. Each answer now
  // updates the unit's score straight away (record), and the attempt itself
  // is kept on this device so the learner can resume where they stopped.
  // A saved attempt is dropped once its results are shown, and ignored if
  // the unit's questions have changed since (sig).
  var ATTEMPTS = "tajweed-companion-attempts-v1";
  function unitSig(u) {
    return u.questions.length + ":" + u.questions.reduce(function (n, q) { return n + String(q.q).length; }, 0);
  }
  function loadAttempts() {
    try { return JSON.parse(localStorage.getItem(ATTEMPTS) || "{}") || {}; } catch (e) { return {}; }
  }
  function saveAttempts(all) {
    try { localStorage.setItem(ATTEMPTS, JSON.stringify(all)); } catch (e) { /* storage blocked */ }
  }
  function savedAttempt(u) {
    var a = loadAttempts()[u.ep];
    if (!a || a.sig !== unitSig(u) || !a.ans || !a.ans.some(Boolean)) return null;
    return a;
  }
  function keepAttempt() {
    if (!S || !S.ans.some(Boolean)) return;
    var all = loadAttempts();
    all[S.unit.ep] = { sig: unitSig(S.unit), ans: S.ans, orders: S.orders, qi: S.qi,
                       streak: S.streak, best: S.best, recorded: S.recorded, ts: Date.now() };
    saveAttempts(all);
  }
  function dropAttempt(ep) {
    var all = loadAttempts();
    if (all[ep]) { delete all[ep]; saveAttempts(all); }
  }
  function resumeAttempt(u, a) {
    S = newAttempt(u);
    S.ans = a.ans; S.orders = a.orders || []; S.streak = a.streak || 0;
    S.best = a.best || 0; S.recorded = !!a.recorded;
    var next = -1;
    for (var i = 0; i < u.questions.length; i++) { if (!S.ans[i]) { next = i; break; } }
    if (next < 0) return renderDone();
    S.qi = next;
    renderQ();
  }
  // The most recent unfinished attempt, for the hub's Continue card.
  function latestAttempt() {
    var all = loadAttempts(), best = null;
    UNITS.forEach(function (u) {
      var a = all[u.ep];
      if (a && a.sig === unitSig(u) && a.ans && a.ans.some(Boolean) && (!best || a.ts > best.a.ts)) {
        best = { u: u, a: a };
      }
    });
    return best;
  }

  function renderUnit(ep, resume) {
    var unit = null;
    UNITS.forEach(function (u) { if (u.ep === ep) unit = u; });
    if (!unit) { location.hash = "#/"; return; }
    VIEW = "unit";
    document.title = "Unit " + unit.ep + ": " + unit.title_en + " · Tajweed Companion";
    var saved = savedAttempt(unit);
    if (resume && saved) {
      history.replaceState(null, "", location.pathname + location.search + "#/u/" + ep);
      return resumeAttempt(unit, saved);
    }
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
    // An attempt left part-way through: offer to carry on, or start fresh.
    var saved = !S.ans.some(Boolean) ? savedAttempt(u) : null;
    var resumeBox = "";
    if (saved) {
      var done = saved.ans.filter(Boolean).length;
      var right = saved.ans.filter(function (a) { return a && a.ok; }).length;
      resumeBox = '<div class="resume"><p><strong>You were part-way through this unit.</strong> ' +
        done + ' of ' + u.questions.length + ' answered, ' + right + ' correct.</p>' +
        '<div class="resume-row"><button class="cta" id="resume">Resume</button>' +
        '<button class="nav-btn" id="fresh">Start over</button></div></div>';
    }
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
      resumeBox +
      (saved ? '' : '<button class="cta" id="go">Start</button>' +
        '<button class="ghost" id="skip">Skip to the questions</button>'), false);
    setBar(0, 1);
    if (saved) {
      document.getElementById("resume").addEventListener("click", function () { resumeAttempt(u, saved); });
      document.getElementById("fresh").addEventListener("click", function () {
        dropAttempt(u.ep); S = newAttempt(u); renderStart();
      });
      return;
    }
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
    // Score and attempt are saved on every answer, so leaving mid-drill
    // loses nothing. The first answer of an attempt counts it as a run.
    record(S.unit.ep, scoreOf(), S.unit.questions.length, !S.recorded);
    S.recorded = true;
    S.qi = i;
    keepAttempt();
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
    // Results seen: the attempt is complete, so there is nothing to resume.
    dropAttempt(u.ep);

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
    var m = /^#\/u\/(\d+)(\/resume)?/.exec(h);
    if (m) renderUnit(parseInt(m[1], 10), !!m[2]);
    else if (h === "#/privacy") { S = null; renderPrivacy(); }
    else if (h === "#/glossary") { S = null; renderGlossary(); }
    else if (h === "#/letters") renderLetters();
    else if (h === "#/letters/memo" && MEMO.length) { S = null; startMemo(false); }
    else if (h === "#/letters/build" && MEMO.length) { S = null; startBuild(); }
    else if (/^#\/letters\/(study|test)\/(\w+)$/.test(h)) {
      var lm = /^#\/letters\/(study|test)\/(\w+)$/.exec(h);
      S = null;
      if (lm[2] !== "all" && !LT.regions[lm[2]]) { location.hash = "#/letters"; return; }
      if (lm[1] === "study") startStudy(lm[2]); else startTest(lm[2]);
    }
    else { S = null; renderHub(); }
  }

  /* ── letters: the makhraj deck ─────────── */
  // 32 cards (28 letters, the three madd letters, the ghunna) in the
  // Shaykh's wording from episodes 3 to 6. Study is flip and self-grade with
  // a small box per card: "Got it" moves it up, "Again" sends it back to the
  // start and shows it again a few cards later. A card is known at box 2.
  // The box lives on this device; the best box reached is saved with the
  // unit scores under "L_<id>", so it syncs like everything else.
  var LT = window.LETTERS || { regions: {}, makharij: {}, cards: [] };
  var LBOX = "tajweed-companion-letters-v1";
  var REG_ORDER = ["jawf", "halq", "lisan", "shafatan", "khayshum"];
  var REG_TONE = { jawf: "flow", halq: "stop", lisan: "brand", shafatan: "between", khayshum: "flow" };
  var LS = null;

  function loadBoxes() {
    try { return JSON.parse(localStorage.getItem(LBOX) || "{}") || {}; } catch (e) { return {}; }
  }
  function saveBoxes(b) {
    try { localStorage.setItem(LBOX, JSON.stringify(b)); } catch (e) { /* storage blocked */ }
  }
  function letterKnown(id, p, boxes) {
    if (id in boxes) return boxes[id] >= 2;
    var r = p["L_" + id];
    return !!(r && r.best >= 2);
  }
  function gradeLetter(id, ok) {
    var boxes = loadBoxes(), b = ok ? Math.min((boxes[id] || 0) + 1, 3) : 0;
    boxes[id] = b;
    saveBoxes(boxes);
    var p = loadProgress(), prev = p["L_" + id] || { best: 0, total: 3, runs: 0 };
    p["L_" + id] = { best: Math.max(prev.best || 0, b), total: 3, runs: (prev.runs || 0) + 1 };
    saveProgress(p);
    document.dispatchEvent(new CustomEvent("tj:progress-saved"));
  }
  function cardsIn(region) {
    return LT.cards.filter(function (c) { return region === "all" || c.region === region; });
  }
  function cardById(id) {
    for (var i = 0; i < LT.cards.length; i++) if (LT.cards[i].id === id) return LT.cards[i];
    return null;
  }
  function arWrap(html) {
    return html.replace(/[؀-ۿ]+(?:\s+[؀-ۿ]+)*/g, function (m) { return '<span class="ar">' + m + '</span>'; });
  }
  function mmss(t) { return Math.floor(t / 60) + ":" + ("0" + (t % 60)).slice(-2); }
  function shuffled(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function regionLabel(r) {
    var reg = LT.regions[r] || ["", ""];
    return esc(reg[1]) + ' · <span class="ar">' + esc(reg[0]) + '</span>';
  }

  function lshell(inner, done, total) {
    return '<div class="bar"><button class="back" id="btnBack">‹ Letters</button>' +
      '<div class="track" style="flex:1"><div class="fill" style="width:' + (total ? done / total * 100 : 0) + '%"></div></div>' +
      '</div><div class="card">' + inner + '</div>';
  }
  function lmount(inner, done, total) {
    closeGloss(); stopAudio();
    root.innerHTML = lshell(inner, done, total);
    document.getElementById("btnBack").addEventListener("click", function () { location.hash = "#/letters"; });
    window.scrollTo(0, 0);
  }

  // The deck page: five regions in the order of episodes 3 to 6.
  function renderLetters() {
    VIEW = "letters"; S = null; LS = null;
    document.title = "Letters · Tajweed Companion";
    var p = loadProgress(), boxes = loadBoxes();
    var known = LT.cards.filter(function (c) { return letterKnown(c.id, p, boxes); }).length;
    var rows = REG_ORDER.map(function (r) {
      var cs = cardsIn(r), k = cs.filter(function (c) { return letterKnown(c.id, p, boxes); }).length;
      var glyphs = cs.map(function (c) { return c.letter; }).join(" ");
      return '<div class="lreg" style="--fam:var(--' + REG_TONE[r] + ')">' +
        '<div class="lreg-head"><span class="lreg-name">' + regionLabel(r) + '</span>' +
          '<span class="lreg-count">' + k + ' / ' + cs.length + ' known</span></div>' +
        '<div class="lreg-glyphs ar">' + esc(glyphs) + '</div>' +
        '<div class="lreg-actions"><a class="nav-btn primary" href="#/letters/study/' + r + '">Study</a>' +
          '<a class="nav-btn" href="#/letters/test/' + r + '">Test</a></div></div>';
    }).join("");
    root.innerHTML =
      '<div class="bar"><button class="back" id="btnBack">‹ All units</button></div>' +
      '<div class="card prose">' +
        '<h1>Letters and their makhārij</h1>' +
        '<p class="lead">Where each letter comes from, in the Shaykh’s own words.</p>' +
        memoBlock() +
        '<h2 class="lt-h2">Letter by letter</h2>' +
        '<p>Go region by region, in the order of episodes 3 to 6, and say each practice syllable aloud: ' +
          'with a sukūn, the sound stops exactly at the letter’s makhraj.</p>' +
        '<div class="overall lt-overall"><div class="row"><span class="big">' + known + ' / ' + LT.cards.length + '</span>' +
          '<span class="cap">cards known</span></div>' +
          '<div class="track"><div class="fill" style="width:' + (known / Math.max(1, LT.cards.length) * 100) + '%"></div></div></div>' +
        rows +
        '<div class="lreg-all"><a class="nav-btn primary" href="#/letters/study/all">Study all 32</a>' +
          '<a class="nav-btn" href="#/letters/test/all">Test all 17 makhārij</a></div>' +
      '</div>';
    document.getElementById("btnBack").addEventListener("click", function () { location.hash = "#/"; });
    window.scrollTo(0, 0);
  }

  // Study: unseen and weak cards first, otherwise in the course's order.
  function startStudy(region, onlyIds) {
    var boxes = loadBoxes();
    var cs = cardsIn(region).filter(function (c) { return !onlyIds || onlyIds.indexOf(c.id) > -1; });
    cs.sort(function (a, b) { return (boxes[a.id] || 0) - (boxes[b.id] || 0) || a.makhraj_no - b.makhraj_no; });
    flipStart("study", cs.map(function (c) { return { id: c.id }; }), { region: region });
  }

  // Flip decks (letter Study, makhārij Review) work like a Quizlet deck: a
  // fixed list for the round, ‹ › or ← → to move through it freely, Space or
  // a tap to turn a card (a tap turns it back too). "Again" (1) and "Got it"
  // (2, or Space on the back) mark the card and move on. Marking a card again
  // after going back first undoes the old mark, so its box is as it was. At
  // the end of a round, the cards not marked "Got it" can go round again; the
  // first round's marks give the summary.
  var FLIP = {
    study: {
      render: function () { renderStudy(); }, done: function () { renderLettersDone(); },
      key: function (q) { return q.id; },
      grade: function (q, ok) { gradeLetter(q.id, ok); },
      snap: function (q) { return { b: loadBoxes()[q.id], p: loadProgress()["L_" + q.id] }; },
      restore: function (q, s) {
        var b = loadBoxes(), p = loadProgress();
        put(b, q.id, s.b); saveBoxes(b); put(p, "L_" + q.id, s.p); saveProgress(p);
      }
    },
    memo: {
      render: function () { renderMemo(); }, done: function () { renderMemoDone(); },
      key: function (q) { return q.no + ":" + q.dir; },
      grade: function (q, ok) { gradeMemo(q.no, q.dir, ok); },
      snap: function (q) { return { r: loadMemo()[q.no + ":" + q.dir], p: loadProgress()["M_" + q.no] }; },
      restore: function (q, s) {
        var m = loadMemo(), p = loadProgress();
        put(m, q.no + ":" + q.dir, s.r); saveMemo(m); put(p, "M_" + q.no, s.p); saveProgress(p);
      }
    }
  };
  function put(o, k, v) { if (v === undefined) delete o[k]; else o[k] = v; }
  function flipOn() { return !!(LS && FLIP[LS.mode]); }
  function flipStart(mode, list, extra) {
    LS = { mode: mode, list: list, i: 0, marks: [], round: 1, flipped: false, total: list.length, missed: {} };
    for (var k in extra || {}) LS[k] = extra[k];
    FLIP[mode].render();
  }
  function flipMarked() { return LS.marks.filter(Boolean).length; }
  function flipTurn() {
    if (!flipOn() || LS.i >= LS.list.length) return;
    LS.flipped = !LS.flipped; FLIP[LS.mode].render();
  }
  function flipGo(d) {
    if (!flipOn()) return;
    var j = LS.i + d;
    if (j < 0 || j > LS.list.length) return;
    LS.i = j; LS.flipped = false;
    if (j === LS.list.length) flipRoundEnd(); else FLIP[LS.mode].render();
  }
  function flipMark(ok) {
    if (!flipOn() || !LS.flipped || LS.i >= LS.list.length) return;
    var F = FLIP[LS.mode], q = LS.list[LS.i], old = LS.marks[LS.i];
    if (old) F.restore(q, old.snap);
    var snap = old ? old.snap : F.snap(q);
    F.grade(q, ok);
    q.isNew = false;
    LS.marks[LS.i] = { ok: ok, snap: snap };
    flipGo(1);
  }
  function flipNav() {
    var m = LS.marks[LS.i];
    return '<div class="fnav">' +
      '<button class="fnav-btn" id="fprev" aria-label="Previous card"' + (LS.i ? "" : " disabled") + '>‹</button>' +
      '<span class="fnav-count">' + (LS.round > 1 ? "Round " + LS.round + " · " : "") + (LS.i + 1) + ' / ' + LS.list.length +
        (m ? '<span class="fnav-mark ' + (m.ok ? "ok" : "again") + '">' + (m.ok ? "Got it" : "Again") + '</span>' : '') + '</span>' +
      '<button class="fnav-btn" id="fnext" aria-label="Next card">›</button></div>';
  }
  function flipGrades() {
    var m = LS.marks[LS.i];
    return '<div class="qnav"><button class="nav-btn' + (m && !m.ok ? " marked" : "") + '" id="lagain">Again<span class="kbd"> 1</span></button>' +
      '<button class="nav-btn primary' + (m && m.ok ? " marked" : "") + '" id="lgot">Got it<span class="kbd"> Space</span></button></div>';
  }
  function flipBind() {
    document.getElementById("fc").addEventListener("click", flipTurn);
    document.getElementById("fprev").addEventListener("click", function () { flipGo(-1); });
    document.getElementById("fnext").addEventListener("click", function () { flipGo(1); });
    var a = document.getElementById("lagain"), g = document.getElementById("lgot");
    if (a) a.addEventListener("click", function () { flipMark(false); });
    if (g) g.addEventListener("click", function () { flipMark(true); });
  }
  function flipRoundEnd() {
    var F = FLIP[LS.mode], n = LS.list.length, ok = 0, again = 0;
    LS.marks.forEach(function (m) { if (m && m.ok) ok++; else if (m) again++; });
    var rest = LS.list.filter(function (q, k) { return !(LS.marks[k] && LS.marks[k].ok); });
    if (LS.round === 1) {
      LS.missed = {};
      rest.forEach(function (q) { LS.missed[F.key(q)] = true; });
    }
    if (!rest.length) return F.done();
    var skipped = n - ok - again, parts = [];
    if (again) parts.push(again + " marked Again");
    if (skipped) parts.push(skipped + " not marked");
    lmount('<div class="score">' + ok + '<small>of ' + n + ' marked Got it</small></div>' +
      '<p class="skipnote">' + parts.join(", ") + '.</p>' +
      '<button class="cta" id="fround">Go over ' + (rest.length === 1 ? "that card" : "those " + rest.length + " cards") + ' again</button>' +
      '<button class="ghost" id="flast">‹ Back to the last card</button>' +
      '<button class="ghost" id="fdone">Finish</button>', ok, n);
    document.getElementById("fround").addEventListener("click", function () {
      LS.list = rest; LS.i = 0; LS.marks = []; LS.round++; LS.flipped = false; F.render();
    });
    document.getElementById("flast").addEventListener("click", function () { flipGo(-1); });
    document.getElementById("fdone").addEventListener("click", function () { F.done(); });
  }

  // The letter card: tap it or press Space to turn it. The answer is the
  // essentials only (the makhraj's short name and the letters sharing it);
  // everything else sits under "More", which stays open once opened.
  var MORE = "tajweed-letters-more";
  function moreOpen() { try { return localStorage.getItem(MORE) === "1"; } catch (e) { return false; } }
  function letterMore(c) {
    return '<details class="fc-more" id="fcmore"' + (moreOpen() ? " open" : "") + '>' +
      '<summary>More about <span class="ar">' + esc(c.letter) + '</span></summary>' +
      '<div class="lc-meta"><span class="lc-reg">' + regionLabel(c.region) + '</span>' +
        '<span class="lc-no">Makhraj ' + c.makhraj_no + ' of 17</span></div>' +
      (c.makhraj_ar !== c.short[0] || c.makhraj_en !== c.short[1]
        ? '<div class="lc-full"><span class="lc-jz-label">In detail</span>' +
            (c.makhraj_ar !== c.short[0] ? '<div class="lc-mar ar">' + esc(c.makhraj_ar) + '</div>' : '') +
            (c.makhraj_en !== c.short[1] ? '<p class="lc-men">' + esc(c.makhraj_en) + '</p>' : '') +
          '</div>'
        : '') +
      '<p class="lc-row">' + arWrap(esc(c.diff)) + '</p>' +
      '<p class="lc-feel"><strong>Feel it:</strong> ' + arWrap(esc(c.feel)) + '</p>' +
      '<div class="lc-jz"><span class="lc-jz-label">Ibn al-Jazarī</span><span class="ar">' + esc(c.jazariyyah) + '</span>' +
        (c.note ? '<p class="lc-note">' + arWrap(esc(c.note)) + '</p>' : '') + '</div>' +
      '<p><a class="watch" href="' + c.video.url + '" target="_blank" rel="noopener">Hear the Shaykh explain it ' +
        '(episode ' + c.video.ep + ', ' + mmss(c.video.t) + ') ↗</a></p>' +
    '</details>';
  }
  function renderStudy() {
    VIEW = "lsession";
    if (!LS.list.length) return renderLettersDone();
    var c = cardById(LS.list[LS.i].id);
    document.title = "Letters · " + c.letter + " · Tajweed Companion";
    var same = c.id === "ghunna" ? "Carried by" : "Same point";
    var html =
      '<div class="fc' + (LS.flipped ? " fc-flipped" : "") + '" id="fc" role="button" tabindex="0" aria-label="' +
        (LS.flipped ? "Turn the card back" : "Show the makhraj") + '">' +
        '<div class="fc-letter ar">' + esc(c.letter) + '</div>' +
        '<div class="fc-say">Say <span class="ar">' + esc(c.say) + '</span>' +
          '<span class="fc-ex"><span class="ar">' + esc(c.example.text) + '</span> ' + esc(c.example.ref) + '</span></div>' +
        (LS.flipped
          ? '<div class="fc-answer">' +
              '<div class="fc-mar ar">' + esc(c.short[0]) + '</div>' +
              '<p class="fc-men">' + esc(c.short[1]) + '</p>' +
              '<p class="fc-same">' + (c.shares.length
                ? same + ': <span class="ar">' + c.shares.map(esc).join(" ، ") + '</span>'
                : 'No other letter comes from here.') + '</p>' +
            '</div>'
          : '<div class="fc-hint">Tap to turn<span class="kbd"> or press Space · ← → to move</span></div>') +
      '</div>' +
      flipNav() +
      (LS.flipped ? flipGrades() + letterMore(c) : '');
    lmount(html, flipMarked(), LS.list.length);
    flipBind();
    if (LS.flipped) document.getElementById("fcmore").addEventListener("toggle", function (e) {
      try { localStorage.setItem(MORE, e.target.open ? "1" : "0"); } catch (err) { /* storage blocked */ }
    });
  }
  document.addEventListener("keydown", function (e) {
    if (VIEW !== "lsession" || !LS || e.altKey || e.ctrlKey || e.metaKey) return;
    var t = e.target && e.target.tagName;
    if (t === "INPUT" || t === "TEXTAREA" || t === "SUMMARY" || (t === "A" && e.key === "Enter")) return;
    var k = e.key;
    if (flipOn()) {
      // A focused button keeps its own Enter and Space.
      if ((k === " " || k === "Enter") && t === "BUTTON") return;
      if (k === "ArrowLeft") { e.preventDefault(); flipGo(-1); }
      else if (LS.i >= LS.list.length) {
        var cta = root.querySelector(".cta");
        if (cta && (k === " " || k === "Enter")) { e.preventDefault(); cta.click(); }
      }
      else if (k === "ArrowRight") { e.preventDefault(); flipGo(1); }
      else if (k === " " || k === "Enter") { e.preventDefault(); if (LS.flipped) flipMark(true); else flipTurn(); }
      else if (LS.flipped && k === "1") { e.preventDefault(); flipMark(false); }
      else if (LS.flipped && k === "2") { e.preventDefault(); flipMark(true); }
    } else if (LS.mode === "build") {
      // Enter checks, then moves on; Space also moves on; Backspace takes back the last word.
      if (k === "Backspace") { e.preventDefault(); unplace(LS.placed.length - 1); }
      else if (k === "Enter" || (k === " " && LS.checked)) {
        var nb = document.getElementById("bcheck") || document.getElementById("bnext");
        if (nb && !nb.disabled && !(t === "BUTTON" && e.target.classList.contains("wchip"))) { e.preventDefault(); nb.click(); }
      }
    } else if (LS.mode === "test" && (k === "Enter" || k === " ")) {
      var b = document.getElementById("lcheck") || document.getElementById("lnext");
      if (b && !b.disabled && !(t === "BUTTON" && e.target.classList.contains("tile"))) { e.preventDefault(); b.click(); }
    }
  });

  // Test: one question per makhraj. The prompt is the makhraj's neutral name;
  // tap every letter that comes from it. Distractors come from the same
  // region first, so the choice is between real neighbours.
  function startTest(region) {
    var cs = cardsIn(region), groups = {};
    cs.forEach(function (c) { (groups[c.makhraj_no] = groups[c.makhraj_no] || []).push(c); });
    var others = LT.cards.filter(function (c) { return c.id !== "ghunna"; });
    var qs = Object.keys(groups).map(Number).map(function (no) {
      var g = groups[no];
      var answers = g[0].id === "ghunna" ? g[0].shares.slice()
        : g.map(function (c) { return c.letter; }).filter(function (x, i, a) { return a.indexOf(x) === i; });
      var near = shuffled(others.filter(function (c) {
        return c.makhraj_no !== no && answers.indexOf(c.letter) < 0 && (c.region === g[0].region || Math.abs(c.makhraj_no - no) <= 3);
      }).map(function (c) { return c.letter; }).filter(function (x, i, a) { return a.indexOf(x) === i; }));
      return { no: no, name: LT.makharij[no], answers: answers, ids: g.map(function (c) { return c.id; }),
               pool: shuffled(answers.concat(near.slice(0, Math.max(3, 6 - answers.length)))) };
    });
    LS = { mode: "test", region: region, qs: shuffled(qs), i: 0, pick: [], checked: false, right: 0, missed: [] };
    renderTest();
  }
  function renderTest() {
    VIEW = "lsession";
    if (LS.i >= LS.qs.length) return renderLettersDone();
    var q = LS.qs[LS.i], ok = null;
    if (LS.checked) {
      ok = LS.pick.length === q.answers.length && q.answers.every(function (a) { return LS.pick.indexOf(a) > -1; });
    }
    document.title = "Letters test · Tajweed Companion";
    var html =
      '<div class="qnum">Makhraj ' + (LS.i + 1) + ' of ' + LS.qs.length + '</div>' +
      '<p class="q">Which letters come from here?</p>' +
      '<div class="lt-q"><div class="lc-mar ar">' + esc(q.name[0]) + '</div><p class="lc-men">' + esc(q.name[1]) + '</p></div>' +
      '<div class="tiles">' + q.pool.map(function (ch) {
        var on = LS.pick.indexOf(ch) > -1, cls = "";
        if (LS.checked) {
          var key = q.answers.indexOf(ch) > -1;
          cls = on && key ? " right" : on ? " wrong" : key ? " missed" : "";
        }
        return '<button class="tile ar' + cls + '" data-ch="' + esc(ch) + '" aria-pressed="' + on + '"' +
          (LS.checked ? " disabled" : "") + '>' + esc(ch) + '</button>';
      }).join("") + '</div>' +
      (LS.checked
        ? '<div class="fb ' + (ok ? "good" : "bad") + '"><div class="verdict">' +
            (ok ? "Correct" : 'Not quite. The answer is <span class="ar">' + esc(q.answers.join(" ، ")) + '</span>') +
            '</div></div><button class="cta" id="lnext">' + (LS.i === LS.qs.length - 1 ? "See results" : "Next") + '</button>'
        : '<button class="cta" id="lcheck"' + (LS.pick.length ? "" : " disabled") + '>Check</button>');
    lmount(html, LS.i + (LS.checked ? 1 : 0), LS.qs.length);
    if (LS.checked) {
      document.getElementById("lnext").addEventListener("click", function () {
        LS.i++; LS.pick = []; LS.checked = false; renderTest();
      });
      return;
    }
    root.querySelectorAll(".tile").forEach(function (t) {
      t.addEventListener("click", function () {
        var ch = t.dataset.ch, k = LS.pick.indexOf(ch);
        if (k > -1) LS.pick.splice(k, 1); else LS.pick.push(ch);
        t.setAttribute("aria-pressed", String(k < 0));
        document.getElementById("lcheck").disabled = LS.pick.length === 0;
      });
    });
    document.getElementById("lcheck").addEventListener("click", function () {
      var good = LS.pick.length === q.answers.length && q.answers.every(function (a) { return LS.pick.indexOf(a) > -1; });
      q.ids.forEach(function (id) { gradeLetter(id, good); });
      if (good) LS.right++;
      else q.ids.forEach(function (id) { if (LS.missed.indexOf(id) < 0) LS.missed.push(id); });
      LS.checked = true; renderTest();
    });
  }
  function renderLettersDone() {
    var missedIds = LS.mode === "study" ? Object.keys(LS.missed) : LS.missed;
    var head = LS.mode === "study"
      ? '<div class="score">' + (LS.total - missedIds.length) + '<small>of ' + LS.total + ' known first time</small></div>'
      : '<div class="score">' + LS.right + '<small>of ' + LS.qs.length + ' makhārij right</small></div>';
    var missedGlyphs = missedIds.map(function (id) { var c = cardById(id); return c ? c.letter : ""; });
    var html = head +
      (missedIds.length ? '<p class="skipnote">Worth another look: <span class="ar">' + esc(missedGlyphs.join(" ، ")) + '</span></p>' : '') +
      (missedIds.length ? '<button class="cta" id="lmissed">Study those again</button>' : '') +
      (LS.mode === "study" ? '<a class="ghost" href="#/letters/test/' + LS.region + '">Test yourself on these</a>'
                           : '<a class="ghost" href="#/letters/study/' + LS.region + '">Study these cards</a>') +
      '<a class="ghost" href="#/letters">Back to letters</a>';
    lmount(html, 1, 1);
    var again = document.getElementById("lmissed");
    if (again) again.addEventListener("click", function () { startStudy("all", missedIds); });
  }

  /* ── the 17 makhārij by heart ───────────── */
  // One card per makhraj, its short name both ways round: English → Arabic
  // ("ea") and Arabic → English ("ae"). Each direction has its own box and due
  // day on this device. "Got it" on a due card moves it up a box and away for
  // 1, 3, 7, 16 or 35 days; early practice moves nothing. "Again" drops it to
  // box 0 and back into the session a few cards later. A makhraj is known both
  // ways once both directions reach box 2, which takes two different days.
  // The lower box of the two is saved with the scores under "M_<no>", so a
  // second device starts from there.
  var MEMO = LT.memo || [];
  var MBOX = "tajweed-companion-makharij-v1";
  var MDAYS = [0, 1, 3, 7, 16, 35];
  var MNEW = 5;       // new makhārij brought in per session
  var MCAP = 20;      // cards per review session
  var BUILD_CAP = 8;  // makhārij per exact-wording round

  function today() {
    var d = new Date();
    return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5);
  }
  function loadMemo() {
    try { return JSON.parse(localStorage.getItem(MBOX) || "{}") || {}; } catch (e) { return {}; }
  }
  function saveMemo(m) {
    try { localStorage.setItem(MBOX, JSON.stringify(m)); } catch (e) { /* storage blocked */ }
  }
  function memoByNo(no) {
    for (var i = 0; i < MEMO.length; i++) if (MEMO[i].no === no) return MEMO[i];
    return null;
  }
  function memoRec(m, p, no, dir) {
    var r = m[no + ":" + dir];
    if (r) return r;
    var s = p["M_" + no];
    return s && s.best > 0 ? { b: s.best, d: today() } : null;
  }
  function memoKnown(no, m, p) {
    var a = memoRec(m, p, no, "ea"), b = memoRec(m, p, no, "ae");
    return !!(a && b && a.b >= 2 && b.b >= 2);
  }
  function memoDue(m, p) {
    var t = today(), n = 0;
    MEMO.forEach(function (x) {
      ["ea", "ae"].forEach(function (dir) { var r = memoRec(m, p, x.no, dir); if (r && r.d <= t) n++; });
    });
    return n;
  }
  function memoFresh(m, p) {
    return MEMO.filter(function (x) { return !memoRec(m, p, x.no, "ea") || !memoRec(m, p, x.no, "ae"); }).length;
  }
  function gradeMemo(no, dir, ok) {
    var m = loadMemo(), p = loadProgress(), t = today();
    var r = memoRec(m, p, no, dir) || { b: 0, d: t }, early = r.d > t;
    var b = !ok ? 0 : early ? r.b : Math.min(r.b + 1, MDAYS.length - 1);
    m[no + ":" + dir] = { b: b, d: !ok ? t : early ? r.d : t + MDAYS[b] };
    saveMemo(m);
    var other = memoRec(m, p, no, dir === "ea" ? "ae" : "ea");
    var low = Math.min(b, other ? other.b : 0), prev = p["M_" + no] || { best: 0, total: 5, runs: 0 };
    p["M_" + no] = { best: Math.max(prev.best || 0, low), total: 5, runs: (prev.runs || 0) + 1 };
    saveProgress(p);
    document.dispatchEvent(new CustomEvent("tj:progress-saved"));
  }

  // The block at the top of the letters page.
  function memoBlock() {
    if (!MEMO.length) return "";
    var m = loadMemo(), p = loadProgress();
    var known = MEMO.filter(function (x) { return memoKnown(x.no, m, p); }).length;
    var due = memoDue(m, p), fresh = memoFresh(m, p);
    var dueTxt = due + (due === 1 ? " card" : " cards") + " due today";
    var freshTxt = fresh + (fresh === 1 ? " makhraj" : " makhārij") + " still new";
    var status = due && fresh ? dueTxt + ", " + freshTxt : due ? dueTxt : fresh ? freshTxt : "Nothing due today";
    return '<div class="memo">' +
      '<div class="lreg-head"><span class="lreg-name">The 17 makhārij by heart</span>' +
        '<span class="lreg-count">' + known + ' / ' + MEMO.length + ' known both ways</span></div>' +
      '<p class="memo-sub">Each makhraj in the Shaykh’s words and in English, both ways round. Missed cards ' +
        'come back sooner, known ones later. A makhraj counts as known when you have it both ways on two different days.</p>' +
      '<div class="track"><div class="fill" style="width:' + (known / MEMO.length * 100) + '%"></div></div>' +
      '<p class="memo-due">' + status + '</p>' +
      '<div class="lreg-actions"><a class="nav-btn primary" href="#/letters/memo">Review</a>' +
        '<a class="nav-btn" href="#/letters/build">Exact wording</a></div>' +
    '</div>';
  }

  // Review: due cards first, weakest first, then a few new makhārij in the
  // course's order. All their Arabic → English cards come before their
  // English → Arabic ones, so the two sides of one makhraj never sit together.
  function startMemo(practise) {
    var m = loadMemo(), p = loadProgress(), t = today(), due = [], fresh = [];
    MEMO.forEach(function (x) {
      ["ea", "ae"].forEach(function (dir) {
        var r = memoRec(m, p, x.no, dir);
        if (!r) fresh.push({ no: x.no, dir: dir, isNew: true });
        else if (practise || r.d <= t) due.push({ no: x.no, dir: dir, b: r.b });
      });
    });
    due = shuffled(due).sort(function (a, b) { return a.b - b.b; }).slice(0, MCAP);
    var room = Math.min(MNEW, Math.floor((MCAP - due.length) / 2));
    var nos = fresh.map(function (q) { return q.no; })
      .filter(function (x, i, a) { return a.indexOf(x) === i; }).slice(0, Math.max(0, room));
    var intro = fresh.filter(function (q) { return nos.indexOf(q.no) > -1; }).sort(function (a, b) {
      return (a.dir === "ae" ? 0 : 1) - (b.dir === "ae" ? 0 : 1) || a.no - b.no;
    });
    flipStart("memo", due.concat(intro));
  }
  function renderMemo() {
    VIEW = "lsession";
    if (!LS.list.length) return renderMemoDone();
    var q = LS.list[LS.i], x = memoByNo(q.no), ea = q.dir === "ea";
    var ar = '<div class="mc-ar ar">' + esc(x.ar) + '</div>', en = '<p class="mc-en">' + esc(x.en) + '</p>';
    document.title = "Makhārij by heart · Tajweed Companion";
    var html =
      '<div class="fc mc' + (LS.flipped ? " fc-flipped" : "") + '" id="fc" role="button" tabindex="0" aria-label="' +
        (LS.flipped ? "Turn the card back" : "Show the answer") + '">' +
        '<div class="mc-dir">' + (ea ? "English → Arabic" : "Arabic → English") +
          (q.isNew ? '<span class="mc-new">New</span>' : '') + '</div>' +
        (ea ? en : ar) +
        (LS.flipped
          ? '<div class="fc-answer">' + (ea ? ar : en) +
              '<p class="mc-meta">Makhraj ' + x.no + ' of 17 · ' + (x.no === 17 ? "carried by" : "letters") +
                ' <span class="ar">' + x.letters.map(esc).join(" ، ") + '</span></p></div>'
          : '<div class="fc-hint">' + (ea ? "Say the Shaykh’s wording" : "Say what it means") +
              ', then tap to turn<span class="kbd"> or press Space · ← → to move</span></div>') +
      '</div>' +
      flipNav() +
      (LS.flipped ? flipGrades() : '');
    lmount(html, flipMarked(), LS.list.length);
    flipBind();
  }

  // Exact wording: build the Arabic from its words, shuffled with two or three
  // look-alikes (أقصى for أدنى, العليا for السفلى…). Checked word for word; a
  // result counts for the English → Arabic card.
  var LOOKALIKE = [["أقصى", "وسط", "أدنى"], ["العليا", "السفلى"], ["أصول", "أطراف"], ["اللحمي", "والعظمي"],
                   ["طرف", "منتهى", "حافة"], ["للثنايا", "للأضراس"], ["الحلق", "اللسان"], ["اللثة", "الحنك"]];
  function arWords(s) { return s.replace(/[،:]/g, " ").split(/\s+/).filter(Boolean); }
  function decoysFor(x) {
    var have = arWords(x.ar), pick = [];
    var add = function (w) { if (have.indexOf(w) < 0 && pick.indexOf(w) < 0) pick.push(w); };
    LOOKALIKE.forEach(function (set) {
      if (set.some(function (w) { return have.indexOf(w) > -1; })) set.forEach(add);
    });
    pick = shuffled(pick);
    // Too few look-alikes: borrow words from neighbouring makhārij.
    if (pick.length < 2) [true, false].forEach(function (near) {
      shuffled(MEMO).forEach(function (y) {
        if (y.no !== x.no && (y.region === x.region) === near) shuffled(arWords(y.ar)).forEach(add);
      });
    });
    return pick.slice(0, 3);
  }
  function startBuild() {
    var m = loadMemo(), p = loadProgress();
    var order = MEMO.map(function (x) { var r = memoRec(m, p, x.no, "ea"); return { no: x.no, b: r ? r.b : -1 }; })
      .sort(function (a, b) { return a.b - b.b || a.no - b.no; }).slice(0, BUILD_CAP)
      .map(function (o) { return o.no; });
    LS = { mode: "build", queue: order, total: order.length, done: 0, missed: {} };
    setupBuild(); renderBuild();
  }
  function setupBuild() {
    var x = memoByNo(LS.queue[0]);
    LS.answer = arWords(x.ar);
    LS.pool = shuffled(LS.answer.concat(decoysFor(x))).map(function (w) { return { w: w, used: false }; });
    LS.placed = []; LS.checked = false; LS.ok = false;
  }
  function renderBuild(keepScroll) {
    VIEW = "lsession";
    if (!LS.queue.length) return renderMemoDone();
    var x = memoByNo(LS.queue[0]), y = window.scrollY;
    document.title = "Exact wording · Tajweed Companion";
    var line = LS.placed.map(function (i, k) {
      var cls = LS.checked ? (LS.pool[i].w === LS.answer[k] ? " right" : " wrong") : "";
      return '<button class="wchip' + cls + '" data-k="' + k + '"' + (LS.checked ? " disabled" : "") + '>' + esc(LS.pool[i].w) + '</button>';
    }).join("");
    var html =
      '<div class="qnum">Exact wording</div>' +
      '<p class="q">Build the Shaykh’s wording for:</p>' +
      '<p class="mc-en bq">' + esc(x.en) + '</p>' +
      '<div class="bline" dir="rtl">' + (line || '<span class="bline-ph">Tap the words in order</span>') + '</div>' +
      (LS.checked
        ? '<div class="fb ' + (LS.ok ? "good" : "bad") + '"><div class="verdict">' +
            (LS.ok ? "Word for word" : "Not quite. The Shaykh’s wording is:") + '</div>' +
            '<div class="mc-ar ar">' + esc(x.ar) + '</div>' +
            '<p class="mc-meta">Makhraj ' + x.no + ' of 17 · ' + (x.no === 17 ? "carried by" : "letters") +
              ' <span class="ar">' + x.letters.map(esc).join(" ، ") + '</span></p></div>' +
          '<button class="cta" id="bnext">' + (LS.ok && LS.queue.length === 1 ? "See results" : "Next") + '</button>'
        : '<div class="bpool" dir="rtl">' + LS.pool.map(function (t, i) {
            return '<button class="wchip' + (t.used ? " used" : "") + '" data-i="' + i + '"' + (t.used ? " disabled" : "") + '>' + esc(t.w) + '</button>';
          }).join("") + '</div>' +
          '<button class="cta" id="bcheck"' + (LS.placed.length ? "" : " disabled") + '>Check</button>');
    lmount(html, LS.done, LS.total);
    if (keepScroll) window.scrollTo(0, y);
    if (LS.checked) {
      document.getElementById("bnext").addEventListener("click", nextBuild);
      return;
    }
    root.querySelectorAll(".bpool .wchip").forEach(function (b) {
      b.addEventListener("click", function () {
        var i = +b.dataset.i;
        if (LS.pool[i].used) return;
        LS.pool[i].used = true; LS.placed.push(i); renderBuild(true);
      });
    });
    root.querySelectorAll(".bline .wchip").forEach(function (b) {
      b.addEventListener("click", function () { unplace(+b.dataset.k); });
    });
    document.getElementById("bcheck").addEventListener("click", checkBuild);
  }
  function unplace(k) {
    if (!LS || LS.mode !== "build" || LS.checked || k < 0 || k >= LS.placed.length) return;
    LS.pool[LS.placed[k]].used = false; LS.placed.splice(k, 1); renderBuild(true);
  }
  function checkBuild() {
    if (!LS || LS.mode !== "build" || LS.checked || !LS.placed.length) return;
    var got = LS.placed.map(function (i) { return LS.pool[i].w; });
    LS.ok = got.length === LS.answer.length && got.every(function (w, k) { return w === LS.answer[k]; });
    gradeMemo(LS.queue[0], "ea", LS.ok);
    if (LS.ok) LS.done++; else LS.missed[LS.queue[0]] = true;
    LS.checked = true; renderBuild(true);
  }
  function nextBuild() {
    var no = LS.queue.shift();
    if (!LS.ok) LS.queue.splice(Math.min(3, LS.queue.length), 0, no);
    if (LS.queue.length) setupBuild();
    renderBuild();
  }

  function renderMemoDone() {
    var m = loadMemo(), p = loadProgress(), t = today(), next = Infinity;
    var known = MEMO.filter(function (x) { return memoKnown(x.no, m, p); }).length;
    Object.keys(m).forEach(function (k) { if (m[k].d > t && m[k].d < next) next = m[k].d; });
    var dueLeft = memoDue(m, p), fresh = memoFresh(m, p), missed = Object.keys(LS.missed).length;
    var when = next === Infinity ? "" : next - t === 1 ? "tomorrow" : "in " + (next - t) + " days";
    var build = LS.mode === "build";
    var head = !LS.total ? '<h2 class="lt-h2">Nothing due today</h2>'
      : '<div class="score">' + (LS.total - missed) + '<small>of ' + LS.total +
          (build ? ' built word for word first time' : ' right first time') + '</small></div>';
    var html = head +
      '<p class="skipnote">' + known + ' of ' + MEMO.length + ' known both ways.' +
        (dueLeft ? ' ' + dueLeft + (dueLeft === 1 ? ' card is' : ' cards are') + ' still due today.'
          : when ? ' The next cards are due ' + when + '.' : '') + '</p>' +
      (build
        ? '<button class="cta" id="mgo">Another round</button><a class="ghost" href="#/letters/memo">Review</a>'
        : '<button class="cta" id="mgo">' + (dueLeft ? "Keep going" : fresh ? "Learn " + Math.min(MNEW, fresh) + " more" : "Practise anyway") +
            '</button><a class="ghost" href="#/letters/build">Exact wording</a>') +
      '<a class="ghost" href="#/letters">Back to letters</a>';
    lmount(html, 1, 1);
    document.getElementById("mgo").addEventListener("click", function () {
      if (build) startBuild(); else startMemo(!dueLeft && !fresh);
    });
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
        try { [KEY, ATTEMPTS, LBOX, MBOX].forEach(function (k) { localStorage.removeItem(k); }); } catch (e) {}
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
