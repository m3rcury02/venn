const CACHE_NAME = "venn-offline-v1";
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.add(OFFLINE_URL)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Only GET page navigations are intercepted. Everything else -- API calls,
// Supabase/TMDB requests, any RLS-scoped data -- passes straight through.
// This app's security model is per-row RLS; caching a real response here
// risks a service worker replaying one account's page to the next person on
// a shared device.
//
// The GET check matters on its own: /share (phase 6) launches as a POST
// navigation (mode "navigate", method "POST"). Without excluding it here,
// every Android share would route through this handler's fetch()/catch()
// instead of going straight to the network -- re-issuing a POST from a
// service worker risks losing it, and a network hiccup would fall back to
// /offline instead of the real ingest, which is exactly what SPEC §5 says
// must never happen to a share.
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate" || event.request.method !== "GET") {
    return;
  }

  event.respondWith(
    fetch(event.request).catch(() =>
      caches.open(CACHE_NAME).then((cache) => cache.match(OFFLINE_URL)),
    ),
  );
});
