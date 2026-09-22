const CACHE_NAME = "zl-kiosk-shell-v1";
const APP_SHELL = [
	"/kiosk",
	"/kiosk-manifest.webmanifest",
	"/kiosk-icon.svg",
	"/assets/zl-logo.png",
	"/assets/sign_in_tablet_icon_lightning.png",
];

self.addEventListener("install", (event) => {
	event.waitUntil(
		caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)),
	);
	self.skipWaiting();
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys
						.filter((key) => key !== CACHE_NAME)
						.map((key) => caches.delete(key)),
				),
			)
			.then(() => self.clients.claim()),
	);
});

self.addEventListener("fetch", (event) => {
	const request = event.request;
	const url = new URL(request.url);

	if (request.method !== "GET" || url.origin !== self.location.origin) {
		return;
	}

	// Session state and sign-in submissions must always use the live server.
	if (url.pathname.startsWith("/api/")) {
		return;
	}

	if (request.mode === "navigate") {
		event.respondWith(
			fetch(request).catch(() => caches.match("/kiosk")),
		);
		return;
	}

	event.respondWith(
		caches.match(request).then((cached) =>
			cached || fetch(request).then((response) => {
				if (response.ok && url.pathname.startsWith("/assets/")) {
					const copy = response.clone();
					void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
				}
				return response;
			}),
		),
	);
});
