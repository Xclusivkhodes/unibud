# Frontend handoff

Frontend work is a separate authorized workstream. It is not integrated here. The partner base is commit `0beaaa25d2f83ea8623a0aa6eb166de0c7144c96`. This branch does not edit that allowlist: `src/components/**`, `src/app/globals.css`, `src/app/login/page.tsx`, `src/app/register/page.tsx`, `src/app/(study)/layout.tsx`, presentational `page.tsx` files under that tree, `src/nav.ts`, and frontend-only tests.

`src/app/actions.ts` is backend-owned server wiring. It is marked `use server` and may import the domain. Browser modules must not import `src/domain.ts`, `src/db.ts`, `src/server/*`, or `node:sqlite`. New UI should call relative `/api` on the same host and port. There is no CORS allowlist.

`src/components/screens.tsx` `Games` still names `total` in its props type and renders `{total}` without destructuring it. That defect belongs to the frontend workstream. `npm run typecheck` is the full-app check and is expected to fail there until they fix it. `npm run typecheck:backend` checks the server project only and is not an app typecheck.

## Preserved scaffold

These files are the current UI attempt. They are not an accepted interface.

- `src/components/Shell.tsx`
- `src/components/Bits.tsx`
- `src/components/screens.tsx`
- `src/app/globals.css`
- `src/app/layout.tsx`
- `src/app/page.tsx`
- `src/app/login/page.tsx`
- `src/app/register/page.tsx`
- `src/app/(study)/layout.tsx`
- `src/nav.ts`
- `src/app/actions.ts` (server actions used by that scaffold)
- `public/brand/unibud-primary-logo-reference.png` (1028×442, SHA-256 `7b45bb1b4407d4c4095d004f512a167edb1b8a75a639cb38de66aeef6eec0216`)
- `public/brand/unibud-navy-owl-reference.png` (198×233, SHA-256 `0160cd73adba2488b05f39e240e082952199d72f2da4ed5edc26fb3392665b8a`)
- `docs/design/approved-glass-v2.jpg` is the approved reference image. Do not use it as the application background or as a screenshot.

`src/components/screens.tsx` does not typecheck: `Games` lists `total` on its props type but does not destructure it, then renders `{total}` at line 403. `npm run typecheck` includes that file and the other screens. It is the full-app check and fails on this defect. `npm run typecheck:backend` is a separate server-only command. A green backend check is not a green app check. Root `src/app/layout.tsx` and `src/app/page.tsx` are backend-owned bootstrap files, not part of the frontend allowlist.

## Boundary

The frontend should call HTTP only. Do not import `src/db.ts`, `src/domain.ts`, `src/server/*`, or `node:sqlite`. Do not read provider environment variables in browser code. Provider status comes from `GET /api/providers`, which returns no key material.

Shared response names live in `src/contract/types.ts`.

Frozen signup, for the register page this branch does not edit: POST `/api/auth/register` now requires `education_level` (`university` | `senior_high` | `junior_high`) and `age_band` (`under_13` | `13_17` | `18_plus`). This is a breaking request change. Do not send a date of birth. GET `/api/me` adds `education_level`, `age_band`, `account_status`, `ai_available`, and `needs_profile_completion`. `ai_available` is false for every current account because Gemini is blocked for the whole app. Legacy profiles come back with null claims and `needs_profile_completion: true`; complete them with POST `/api/profile/completion`.

## Auth cookie and CSRF

- Cookie name: `unibud_session`
- Flags: `HttpOnly`, `Path=/`, `SameSite=Lax`, `Max-Age` 14 days
- `Secure` is set by default. Local HTTP on this machine opts out only with `UNIBUD_COOKIE_INSECURE=1`
- Mutating requests must send header `X-Unibud-Request: 1`
- If `Origin` is sent, its host must match the `Host` header. `X-Forwarded-Host` is not trusted. A mismatch returns `{ "error": "csrf_origin" }` with status 403
- Missing the custom header returns `{ "error": "csrf_required" }` with status 403
- The cookie value is the session token. The server stores only its SHA-256

## Runtime owned here

`npm run serve` compiles `tsconfig.server.json` and listens on `127.0.0.1` and `PORT` (default 3000). That process serves `/api/*` only. It is not a public deployment.

`npm run dev` and `npm run build` still point at Next.js and will compile the scaffold. They are not the backend entrypoint until the scaffold typecheck is repaired by the frontend owner.

## Visual direction already approved

Founder approval at 01:08 Africa/Accra selected the glass V2 direction and the owl rasters above. Tokens recorded from the design handoff: base `#081727`, navy `#14263D`, ivory `#F7F4ED`, muted `#BAC9D7`, ink `#14263D`, teal `#28736C`, amber `#E5B85C`. Implementing those styles is the frontend branch's work.
