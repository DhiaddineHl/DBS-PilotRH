/* PilotRH — service worker
   Objectif : rendre l'espace salarié installable sur Android/iOS (« Ajouter à
   l'écran d'accueil ») et démarrer instantanément même avec un réseau d'usine
   médiocre.

   Règle absolue : on ne met JAMAIS en cache les réponses de /api/. Un pointage,
   un solde de congés ou un résultat de sondage périmé serait pire qu'une erreur
   franche. Seuls la coquille et les fichiers statiques sont mis en cache.
*/
const CACHE = 'pilotrh-v3';
const STATIQUES = [
  '/moi',
  '/assets/pilotrh-core.js',
  '/assets/pilotrh-ui.css',
  '/assets/icone.svg',
  '/assets/icone-192.png',
  '/assets/manifest.webmanifest',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(STATIQUES.map(u => c.add(new Request(u, {cache: 'reload'})))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // jamais de cache pour les données ni pour les pages d'administration
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/photos/')) return;
  if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/login') return;

  // réseau d'abord, cache en secours : le salarié voit toujours la version à jour
  // quand le réseau répond, et l'application s'ouvre quand même s'il ne répond pas
  e.respondWith(
    fetch(req)
      .then(r => {
        if (r && r.ok) {
          const copie = r.clone();
          caches.open(CACHE).then(c => c.put(req, copie)).catch(() => {});
        }
        return r;
      })
      .catch(() => caches.match(req).then(r => r || caches.match('/moi')))
  );
});
