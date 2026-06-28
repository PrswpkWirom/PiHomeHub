self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open("pihomehub-v1").then((cache) =>
      cache.addAll(["/", "/dashboard", "/manifest.webmanifest"])
    )
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
