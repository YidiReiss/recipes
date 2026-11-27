/* Reiss Family Recipes — service worker (v20261126a).
   Makes https://yidireiss.github.io/recipes/ installable and usable offline
   without altering online behavior or compromising private/mutable sync data.
   - Two caches:
     1) SHELL_CACHE (reiss-recipes-shell-v20261126a): precached app shell only;
        old shell caches are purged on activate.
     2) DATA_CACHE (reiss-recipes-data-v1): runtime read-only data & static
        assets; preserved across deploys so offline recipes/photos survive.
   - Lifecycle: install precaches strictly relative shell URLs and calls
     skipWaiting(); activate cleans old shell caches only and calls
     clients.claim() (no auto-reload on controllerchange).
   - Fetch rules (GET + http(s) only; never cache Authorization headers,
     non-200 responses, or opaque responses; never resolve to undefined):
     * Navigations: network-first, cache index.html on success, offline fallback
       to scope-resolved ./index.html (or 503 Offline).
     * Bridge origin (https://recipe-bridge.leibreiss.workers.dev):
       allow-list ONLY public read-only GETs (/price-history, /pantry-stock) as
       network-first into DATA_CACHE. All other bridge routes (/read,
       /receipts/*, /price-check-flag, /health, etc.) go straight to network.
     * Same-origin mutable JSONs (data/meal-plan.json, data/pantry.json,
       data/store-notes.json, data/inbox/*): strictly network-only.
     * Same-origin read-only data/*.json: network-first into DATA_CACHE with
       query-stripped cache key (url.origin + url.pathname) so ?v=Date.now()
       cache-busters still hit offline.
     * Same-origin shell files (styles.css?v=..., app.js?v=..., manifest.json,
       icons): exact-URL match in SHELL_CACHE.
     * Other same-origin static assets (images, PDFs, USER-GUIDE.md):
       stale-while-revalidate in DATA_CACHE.
     * Everything else (POSTs, non-http(s), third-party): straight to network. */

var SHELL_CACHE = "reiss-recipes-shell-v20261126a";
var DATA_CACHE = "reiss-recipes-data-v1";

var SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=20261126a",
  "./app.js?v=20261126a",
  "./manifest.json",
  "./assets/images/icon-192.png",
  "./assets/images/icon-512.png",
  "./assets/images/icon-512-maskable.png"
];

var BRIDGE_ORIGIN = "https://recipe-bridge.leibreiss.workers.dev";

var BRIDGE_CACHEABLE_PATHS = {
  "/price-history": true,
  "/pantry-stock": true
};

var NETWORK_ONLY_DATA_PATHS = {
  "data/meal-plan.json": true,
  "data/pantry.json": true,
  "data/store-notes.json": true
};

var SHELL_REL_PATHS = {
  "": true,
  "index.html": true,
  "styles.css": true,
  "app.js": true,
  "manifest.json": true,
  "assets/images/icon-192.png": true,
  "assets/images/icon-512.png": true,
  "assets/images/icon-512-maskable.png": true
};

function isCacheable(res) {
  return Boolean(res && res.status === 200 && (res.type === "basic" || res.type === "cors"));
}

function offlineResponse() {
  return new Response("Offline", {
    status: 503,
    headers: { "Content-Type": "text/plain; charset=utf-8" }
  });
}

function hasAuthHeader(req) {
  return Boolean(req && req.headers && typeof req.headers.has === "function" && req.headers.has("Authorization"));
}

function scopeIndexUrl() {
  if (self.registration && self.registration.scope) {
    return new URL("./index.html", self.registration.scope).href;
  }
  return "./index.html";
}

function relativeScopePath(url) {
  var scopePathname = "/";
  if (self.registration && self.registration.scope) {
    scopePathname = new URL("./", self.registration.scope).pathname;
  }
  if (scopePathname.charAt(scopePathname.length - 1) !== "/") {
    scopePathname += "/";
  }
  if (url.pathname.indexOf(scopePathname) === 0) {
    return url.pathname.slice(scopePathname.length);
  }
  return url.pathname.replace(/^\/+/, "");
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (cache) {
      return cache.addAll(SHELL);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (k) { return k !== SHELL_CACHE && k !== DATA_CACHE; })
          .map(function (k) { return caches.delete(k); })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

function putInCache(event, cacheName, key, res) {
  if (!isCacheable(res)) return;
  var copy = res.clone();
  var work = caches.open(cacheName).then(function (cache) {
    return cache.put(key, copy);
  }).catch(function () {});
  if (event && typeof event.waitUntil === "function") {
    event.waitUntil(work);
  }
}

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (!req || req.method !== "GET") return;
  if (hasAuthHeader(req)) return;

  var url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  // 1. Navigations: network-first, fall back to scope-resolved ./index.html offline.
  if (req.mode === "navigate") {
    var indexKey = scopeIndexUrl();
    event.respondWith(
      fetch(req).then(function (res) {
        putInCache(event, SHELL_CACHE, indexKey, res);
        return res;
      }).catch(function () {
        return caches.match(indexKey).then(function (cached) {
          if (cached) return cached;
          return caches.match("./index.html").then(function (fallback) {
            return fallback || offlineResponse();
          });
        });
      })
    );
    return;
  }

  // 2. Bridge origin: allow-list ONLY public read-only endpoints.
  //    Never intercept or cache /read, /receipts/*, /price-check-flag, /health, etc.
  if (url.origin === BRIDGE_ORIGIN) {
    if (!BRIDGE_CACHEABLE_PATHS[url.pathname]) return;
    var bridgeKey = url.origin + url.pathname;
    event.respondWith(
      fetch(req).then(function (res) {
        putInCache(event, DATA_CACHE, bridgeKey, res);
        return res;
      }).catch(function () {
        return caches.open(DATA_CACHE).then(function (cache) {
          return cache.match(bridgeKey);
        }).then(function (cached) {
          return cached || offlineResponse();
        });
      })
    );
    return;
  }

  // 3. Same-origin requests.
  if (url.origin === self.location.origin) {
    var relPath = relativeScopePath(url);

    // 3a. Mutable shared state JSONs: strictly network-only (never cache stale sync state).
    if (NETWORK_ONLY_DATA_PATHS[relPath] || relPath.indexOf("data/inbox/") === 0) {
      return;
    }

    // 3b. Read-only data/*.json: strip ?v=Date.now() query for cache key, network-first into DATA_CACHE.
    if (relPath.indexOf("data/") === 0 && /\.json$/i.test(relPath)) {
      var dataKey = url.origin + url.pathname;
      event.respondWith(
        fetch(req).then(function (res) {
          putInCache(event, DATA_CACHE, dataKey, res);
          return res;
        }).catch(function () {
          return caches.open(DATA_CACHE).then(function (cache) {
            return cache.match(dataKey);
          }).then(function (cached) {
            return cached || offlineResponse();
          });
        })
      );
      return;
    }

    // 3c. Precached shell files (styles.css?v=<label>, app.js?v=<label>, manifest.json, icons):
    //     keep exact URL matching (preserving ?v=<label>) against SHELL_CACHE.
    if (SHELL_REL_PATHS[relPath]) {
      event.respondWith(
        caches.open(SHELL_CACHE).then(function (cache) {
          return cache.match(req).then(function (cached) {
            if (cached) return cached;
            return fetch(req).then(function (res) {
              putInCache(event, SHELL_CACHE, req, res);
              return res;
            }).catch(function () {
              return offlineResponse();
            });
          });
        })
      );
      return;
    }

    // 3d. Other same-origin static assets (recipe photos, PDFs, USER-GUIDE.md):
    //     stale-while-revalidate in DATA_CACHE; never resolve to undefined.
    event.respondWith(
      caches.open(DATA_CACHE).then(function (cache) {
        return cache.match(req).then(function (cached) {
          var network = fetch(req).then(function (res) {
            putInCache(event, DATA_CACHE, req, res);
            return res;
          }).catch(function () {
            return cached || offlineResponse();
          });
          if (cached && typeof event.waitUntil === "function") {
            event.waitUntil(network);
          }
          return cached || network;
        });
      })
    );
    return;
  }

  // 4. Everything else (third-party fonts, scripts, etc.): straight to network.
});
