/* Offline support.

   The page shell: every asset index.html references carries ?v=N, so a
   cached copy of a given URL never goes stale; they are served from the cache
   first. index.html itself is fetched from the network first, so a new
   version is picked up as soon as there is a connection, and the cached copy
   is the fallback offline. Installing caches index.html and everything it
   references, which is the whole course: data.js holds every unit.

   Fonts and the sign-in library come from Google; they are cached as they are
   used, so they work offline after the first visit. Recitations are not
   cached (they are large, and fetched one āya at a time), and sign-in pages
   and the progress database are never touched. */

const CACHE = "tajweed-v1";
const SHELL = "./";

// The assets index.html refers to, read from the page itself so this file
// needs no editing when their ?v= numbers change.
function assetsOf(html) {
  const out = new Set();
  const re = /(?:src|href)="([^"#]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    const u = new URL(m[1], self.registration.scope);
    if (u.origin === self.location.origin || u.hostname === "fonts.googleapis.com") out.add(u.href);
  }
  return [...out];
}

async function cacheShell(res) {
  const cache = await caches.open(CACHE);
  const html = await res.clone().text();
  await cache.put(SHELL, res.clone());
  const wanted = assetsOf(html);
  await Promise.all(wanted.map(async (u) => {
    if (!(await cache.match(u))) {
      try { const r = await fetch(u); if (r.ok) await cache.put(u, r); } catch (e) { /* offline: next time */ }
    }
  }));
  // Drop same-origin assets from older versions that this page no longer uses.
  const keep = new Set(wanted);
  for (const req of await cache.keys()) {
    const u = new URL(req.url);
    if (u.origin === self.location.origin && u.search.includes("v=") && !keep.has(req.url)) {
      await cache.delete(req);
    }
  }
}

self.addEventListener("install", (e) => {
  e.waitUntil(fetch(SHELL, { cache: "no-cache" }).then(cacheShell).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function cacheable(url) {
  if (url.origin === self.location.origin) return !url.pathname.includes("/__/");
  return url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com" ||
    (url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/"));
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (req.mode === "navigate" && url.origin === self.location.origin && !url.pathname.includes("/__/")) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) e.waitUntil(cacheShell(res.clone()));
        return res;
      }).catch(() => caches.match(SHELL))
    );
    return;
  }

  if (!cacheable(url)) return;
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok || res.type === "opaque") {
        const copy = res.clone();
        e.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy)));
      }
      return res;
    }))
  );
});
