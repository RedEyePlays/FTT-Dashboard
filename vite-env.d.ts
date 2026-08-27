interface ImportMetaEnv {
  readonly VITE_API_KEY: string
  // Optional — error monitoring (services/errorReporting.ts) runs disabled
  // when unset, so local dev and any deploy that doesn't configure one still
  // works normally.
  readonly VITE_SENTRY_DSN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Injected by vite.config.ts's `define` from package.json's version at build
// time, so an error report can be tied back to the exact deploy it came from.
declare const __APP_VERSION__: string;