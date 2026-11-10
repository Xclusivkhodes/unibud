# UniBud

University learning workspace. The runnable service in this branch is the loopback HTTP API (`npm run serve`). Screen files under `src/components` and `src/app/**/page.tsx` are an unfinished scaffold for the frontend owner. See `docs/FRONTEND-HANDOFF.md` and `docs/API-CONTRACT.md`.

Founder visual approval for the glass direction and owl rasters is recorded in `docs/TRACEABILITY.md`. Screen implementation continues after this review checkpoint. `docs/design/approved-glass-v2.jpg` and `public/brand/` are the supplied reference assets only. The concept image is not the application and is not a screenshot.

## Prerequisites verified in this environment

- Node.js v22.23.4 (`node:sqlite` is experimental in this Node line)
- npm 10.9.9
- No database server, container, or API key
- `ts-fsrs` 6.0.0 requires Node `>=24` and is not installed. Scheduling is the labeled `deterministic-sm2` algorithm.
- KaTeX is not installed. Stored mathematics is source text. Rendering would not verify it.

## Local commands

```bash
npm install
npm test
npm run typecheck:backend
npm run typecheck
npm run dev
```

`npm run dev` and `npm start` serve the Next app and `/api` on `127.0.0.1:3000`. The browser should call relative `/api`. `npm run serve` runs the same API handler alone on that default port; do not run it beside Next. `npm run typecheck:backend` is the server project only. `npm run typecheck` is the full app check and currently fails in `src/components/screens.tsx` because `Games` uses `total` without destructuring it. That failure is not a green app typecheck.

## Environment variable names

See `.env.example`. Values stay empty. Google dispatch remains blocked even if `GEMINI_API_KEY` is present, until age and product policy are resolved. Configured does not mean live-verified. This milestone does not perform paid or live provider calls.

## Baseline

Implementation branch started from `1552410ebd0de5087fb330485c3c7004360995e0` on `main`. The pre-pause tree had no UI files.
