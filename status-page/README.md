# Public Repair Status Page

A tiny, fully standalone page for `status.flipthat.tech` (or whatever domain you point at it). It is **not** part of the main dashboard app — it has no login, no navigation, no shared code, and no build dependency on anything outside this folder. It talks to exactly one thing: the public `repairStatusLookup` Cloud Function, over plain `fetch`.

## Build

From the repo root:

```sh
npm run build:status
```

Output goes to `dist-status/` (gitignored), separate from the main app's `dist/`.

To preview locally:

```sh
npm run dev:status      # http://localhost:3001
npm run preview:status  # serves the built dist-status/
```

## Deploy (one-time setup)

This repo's `firebase.json` already declares two Hosting **targets** — `main` (the dashboard) and `status` (this page) — but a target has to be pointed at a real Firebase Hosting site before you can deploy to it.

1. In the Firebase Console, create a new Hosting site (e.g. `ftt-status`) under this project, and set up `status.flipthat.tech` as its custom domain (Console → Hosting → Add custom domain).
2. Point the `status` target at that site:
   ```sh
   firebase target:apply hosting status <your-new-site-id>
   ```
3. Build and deploy just this target:
   ```sh
   npm run build:status
   firebase deploy --only hosting:status
   ```

The `main` target is already mapped to the existing dashboard site in `.firebaserc`, so `firebase deploy --only hosting:main` (or the old `--only hosting` for both) continues to work as before.

## Why it's isolated

- Its own Vite config (`vite.status.config.ts`, repo root) and its own `tsconfig.json` — `status-page/` is excluded from the main app's `tsconfig.json` and never touched by `vite build`.
- Plain TypeScript + DOM, no React, no shared components/services/domain modules from the main app.
- Reaches the Cloud Function with a bare `fetch` call against Firebase's callable-function HTTP protocol (`status-page/src/api.ts`) — no Firebase client SDK, so no shared Firebase app instance either.
- The only thing connecting this page to the shop is the Firebase **project id** baked into the function URL (`status-page/src/config.ts`) — there is no link, button, or text anywhere in this bundle referencing the dashboard app.
