/* Cross-device progress: Google sign-in through Firebase, and one Firestore
   document per learner at progress/{uid}.

   localStorage stays the working copy. Signed out, offline, or with Firebase
   unreachable, the site behaves exactly as it did before this file existed.
   Signing in merges this device's scores with the account's, and after that
   every saved result is pushed, and the account is re-read whenever the page
   comes back into view, so a phone and a laptop stay in step.

   app.js talks to this file only through events:
     tj:progress-saved    app.js saved a result locally  -> push it
     tj:hub-rendered      the hub was drawn              -> draw the account bar
     tj:progress-updated  this file changed local scores -> app.js redraws */

const SDK = "https://www.gstatic.com/firebasejs/12.19.0/";
const KEY = "tajweed-companion-v1";

const cfg = window.FIREBASE_CONFIG || {};
const configured = !!(cfg.apiKey && cfg.appId && !/^PASTE/.test(cfg.apiKey) && !/^PASTE/.test(cfg.appId));

const state = { ready: false, user: null, status: "", busy: false, justDeleted: false };
let fb = null;

function readLocal() {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { return {}; }
}
function writeLocal(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { /* storage blocked */ }
}

// Per unit the best score wins. Runs cannot be summed: both sides already share
// whatever was synced before, so adding them would double count. The larger
// count stands instead.
function merge(a, b) {
  const out = Object.assign({}, a);
  Object.keys(b || {}).forEach(function (ep) {
    const r = b[ep] || {}, l = out[ep];
    out[ep] = l
      ? { best: Math.max(l.best || 0, r.best || 0), total: Math.max(l.total || 0, r.total || 0),
          runs: Math.max(l.runs || 0, r.runs || 0) }
      : { best: r.best || 0, total: r.total || 0, runs: r.runs || 0 };
  });
  return out;
}

function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function setStatus(s) { state.status = s; draw(); }

/* ── account bar ─────────────────────────── */
const G_MARK =
  '<svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">' +
  '<path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.8 6C12.4 13.6 17.7 9.5 24 9.5z"/>' +
  '<path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9h12.4c-.5 2.9-2.2 5.3-4.6 7l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z"/>' +
  '<path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.8-6z"/>' +
  '<path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.8 6C6.6 42.6 14.6 48 24 48z"/></svg>';

// Two places on the hub: a compact control in the header's top-right corner
// (#account), and one line inside the progress card saying where the scores
// live (#syncNote) - the explanation sits next to the thing it explains.
function draw() {
  const el = document.getElementById("account");
  const note = document.getElementById("syncNote");
  if (!el) return;
  if (!configured || !state.ready) {
    el.innerHTML = "";
    if (note) note.innerHTML = "";
    return;
  }

  if (!state.user) {
    el.innerHTML =
      '<button class="signin" id="tjSignIn"' + (state.busy ? " disabled" : "") +
        ' aria-label="Sign in with Google">' + G_MARK +
        '<span>' + (state.busy ? "Signing in…" : "Sign in") + '</span></button>';
    document.getElementById("tjSignIn").addEventListener("click", signIn);
    if (note) {
      note.innerHTML = state.status
        ? esc(state.status)
        : 'Saved on this device only. Sign in with Google to keep it in step across your ' +
          'devices · <a href="#/privacy">what’s stored</a>';
    }
    return;
  }

  const full = state.user.displayName || state.user.email || "Account";
  const first = full.split(/[\s@]/)[0] || full;
  el.innerHTML =
    '<button class="acct-chip" id="tjAcct" aria-haspopup="true" aria-expanded="false" ' +
      'aria-label="Account: ' + esc(full) + '">' +
      '<span class="acct-avatar" aria-hidden="true">' + esc(first.charAt(0).toUpperCase()) + '</span>' +
      '<span class="acct-name">' + esc(first) + '</span><span class="acct-caret" aria-hidden="true">▾</span>' +
    '</button>' +
    '<div class="acct-menu hide" id="tjAcctMenu" role="menu">' +
      '<div class="acct-full">' + esc(full) + '</div>' +
      '<a role="menuitem" href="#/privacy">Your data</a>' +
      '<button role="menuitem" id="tjSignOut">Sign out</button>' +
    '</div>';
  const chip = document.getElementById("tjAcct"), menu = document.getElementById("tjAcctMenu");
  chip.addEventListener("click", function (e) {
    e.stopPropagation();
    const open = menu.classList.toggle("hide") === false;
    chip.setAttribute("aria-expanded", String(open));
  });
  document.getElementById("tjSignOut").addEventListener("click", function () {
    fb.signOut(fb.auth);
  });
  if (note) {
    const s = state.status || "Synced";
    note.innerHTML = s === "Synced"
      ? '<span class="ok">✓</span> Synced across your devices · <a href="#/privacy">what’s stored</a>'
      : esc(s);
  }
}
// Close the account menu on any click elsewhere.
document.addEventListener("click", function (e) {
  const menu = document.getElementById("tjAcctMenu");
  if (menu && !menu.classList.contains("hide") && !menu.contains(e.target)) {
    menu.classList.add("hide");
    const chip = document.getElementById("tjAcct");
    if (chip) chip.setAttribute("aria-expanded", "false");
  }
});

/* ── privacy page: delete account ────────── */
// app.js draws a signed-out version of #data-controls (reset this browser).
// When someone is signed in, this replaces it, because only this file holds the
// Firebase session needed to delete the cloud record and the account.
function drawPrivacy() {
  const el = document.getElementById("data-controls");
  if (!el || !configured || !state.ready) return;

  if (!state.user) {
    // Firebase announces the sign-out and this page redraws in no fixed order,
    // so the notice stays up until the next sign-in rather than showing once.
    if (state.justDeleted) {
      el.insertAdjacentHTML("afterbegin",
        '<p class="done-msg">Your account and progress have been deleted.</p>');
    }
    return;
  }

  const who = state.user.displayName && state.user.email
    ? esc(state.user.displayName) + " (" + esc(state.user.email) + ")"
    : esc(state.user.email || state.user.displayName || "your Google account");
  el.innerHTML =
    '<p>You’re signed in as <strong>' + who + '</strong>. Your scores are saved to this account.</p>' +
    '<button class="danger" id="tjDelete">Delete my account and progress</button>' +
    '<div class="confirm hide" id="tjDeleteConfirm">' +
      '<p>This permanently deletes your saved scores and your sign-in account for this site. ' +
        'It also clears the scores saved in this browser. It can’t be undone.</p>' +
      '<div class="confirm-row"><button class="danger" id="tjDeleteYes">Yes, delete everything</button>' +
      '<button class="nav-btn" id="tjDeleteNo">Cancel</button></div></div>' +
    '<p class="fine" id="tjDeleteMsg"></p>';

  const btn = document.getElementById("tjDelete"), box = document.getElementById("tjDeleteConfirm");
  btn.addEventListener("click", function () { box.classList.remove("hide"); btn.classList.add("hide"); });
  document.getElementById("tjDeleteNo").addEventListener("click", function () {
    box.classList.add("hide"); btn.classList.remove("hide");
  });
  document.getElementById("tjDeleteYes").addEventListener("click", deleteEverything);
}

function privacyMsg(text) {
  const m = document.getElementById("tjDeleteMsg");
  if (m) m.textContent = text;
}

async function deleteEverything() {
  const user = fb.auth.currentUser;
  if (!user) return;
  const yes = document.getElementById("tjDeleteYes");
  if (yes) yes.disabled = true;
  privacyMsg("Deleting…");

  // The cloud record goes first, while the session can still prove who owns
  // it. If this fails nothing has been removed, and it is safe to try again.
  try {
    await fb.deleteDoc(fb.doc(fb.db, "progress", user.uid));
  } catch (e) {
    if (yes) yes.disabled = false;
    return privacyMsg("Couldn’t connect, so nothing was deleted. Check your connection and try again.");
  }

  // Google makes deleting an account require a recent sign-in. If this one is
  // too old, ask once more, then retry.
  try {
    await fb.deleteUser(user);
  } catch (e) {
    if (e && e.code === "auth/requires-recent-login") {
      try {
        privacyMsg("For security, Google needs you to confirm it’s you…");
        await fb.reauthenticateWithPopup(user, new fb.GoogleAuthProvider());
        await fb.deleteUser(user);
      } catch (e2) {
        if (yes) yes.disabled = false;
        return privacyMsg("Your scores were deleted, but the sign-in account wasn’t. Sign in again and repeat this to finish.");
      }
    } else {
      if (yes) yes.disabled = false;
      return privacyMsg("Your scores were deleted, but the sign-in account wasn’t. Sign in again and repeat this to finish.");
    }
  }

  // Clear this browser's copy too: left in place, the next sign-in here would
  // upload it straight back.
  try { localStorage.removeItem(KEY); } catch (e) { /* storage blocked */ }
  state.justDeleted = true;
  document.dispatchEvent(new CustomEvent("tj:progress-updated"));
}

/* ── sync ────────────────────────────────── */
async function pullAndMerge() {
  if (!state.user) return;
  setStatus("Syncing…");
  try {
    const ref = fb.doc(fb.db, "progress", state.user.uid);
    const snap = await fb.getDoc(ref);
    const remote = snap.exists() ? (snap.data().units || {}) : {};
    const local = readLocal();
    const merged = merge(local, remote);
    if (!same(merged, local)) {
      writeLocal(merged);
      document.dispatchEvent(new CustomEvent("tj:progress-updated"));
    }
    if (!same(merged, remote)) {
      await fb.setDoc(ref, { units: merged, updatedAt: fb.serverTimestamp() });
    }
    setStatus("Synced");
  } catch (e) {
    setStatus(navigator.onLine ? "Couldn’t sync - saved on this device" : "Offline - saved on this device");
  }
}

async function signIn() {
  state.busy = true; setStatus("");
  const provider = new fb.GoogleAuthProvider();
  try {
    await fb.signInWithPopup(fb.auth, provider);
  } catch (e) {
    // Some mobile browsers block popups outright; fall back to a full-page
    // redirect, which lands back here and is picked up by getRedirectResult.
    if (e && (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment")) {
      return fb.signInWithRedirect(fb.auth, provider);
    }
    state.busy = false;
    setStatus(e && e.code === "auth/popup-closed-by-user" ? "" : "Sign-in didn’t finish - try again");
  }
}

async function start() {
  if (!configured) return;
  try {
    const [app, auth, fs] = await Promise.all([
      import(SDK + "firebase-app.js"),
      import(SDK + "firebase-auth.js"),
      import(SDK + "firebase-firestore.js"),
    ]);
    const fapp = app.initializeApp(cfg);
    fb = {
      auth: auth.getAuth(fapp), db: fs.getFirestore(fapp),
      GoogleAuthProvider: auth.GoogleAuthProvider, signInWithPopup: auth.signInWithPopup,
      signInWithRedirect: auth.signInWithRedirect, signOut: auth.signOut,
      deleteUser: auth.deleteUser, reauthenticateWithPopup: auth.reauthenticateWithPopup,
      doc: fs.doc, getDoc: fs.getDoc, setDoc: fs.setDoc, deleteDoc: fs.deleteDoc,
      serverTimestamp: fs.serverTimestamp,
    };
    auth.getRedirectResult(fb.auth).catch(function () { /* nothing pending */ });
    auth.onAuthStateChanged(fb.auth, function (user) {
      state.user = user; state.busy = false; state.ready = true;
      if (user) state.justDeleted = false;
      setStatus(user ? "Syncing…" : "");
      document.dispatchEvent(new CustomEvent("tj:auth-changed"));
      if (user) pullAndMerge();
    });
  } catch (e) {
    // Firebase unreachable (offline, blocked by an extension, sandboxed host):
    // the site carries on with per-device progress and shows no account bar.
    state.ready = false; draw();
  }
}

document.addEventListener("tj:hub-rendered", draw);
document.addEventListener("tj:privacy-rendered", drawPrivacy);
document.addEventListener("tj:progress-saved", function () { if (state.user) pullAndMerge(); });
// Coming back to the tab is when another device's progress matters most.
let lastPull = 0;
document.addEventListener("visibilitychange", function () {
  if (document.visibilityState === "visible" && state.user && Date.now() - lastPull > 20000) {
    lastPull = Date.now(); pullAndMerge();
  }
});

start();
