# OLX + Vinted Deal Hunter

A PWA plus a home worker that polls OLX.pt and Vinted.pt for PC parts and sends web-push alerts for great deals. Built for a friend who resells PCs.

- Plan: `C:\Users\mrttm\.claude\plans\contexto-um-amigo-est-zazzy-clock.md` (phases F0–F7). F0 findings: `docs/F0-validacao.md`.
- Stack: `apps/worker` (Node 24 + TS, Playwright/Edge for OLX, plain fetch for Vinted, runs on the friend's home PC via pm2), `apps/web` (Vite + React PWA on Cloudflare Pages), `packages/shared`, `supabase/` (Postgres, RLS, pg_cron). AI deal scoring: Gemini 3.8 Flash (free tier) with a rules fallback.
- User rules: never create accounts; stop and ask for any login/key. The user is on Claude Pro, so keep sessions lean (one phase per session, no subagents).
- UI language: Portuguese (pt-PT).
