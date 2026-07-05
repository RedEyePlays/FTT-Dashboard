<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/14LwpKmFbK8-yXAg4NnTF3UXQT9jePZyp

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set `VITE_API_KEY` in [.env](.env) to your Gemini API key (this is the
   variable the app actually reads — see `services/geminiService.ts`).
3. Run the app:
   `npm run dev`

## Scripts

- `npm run dev` — start the Vite dev server
- `npm run build` — production build
- `npm run typecheck` — TypeScript type-check (`tsc --noEmit`)
- `npm test` — run the unit test suite (Vitest)

CI (`.github/workflows/ci.yml`) runs type-check, tests, and build on every push
and pull request.
