# Baithak · बैठक

**One player. Your people.** An invite-only YouTube watch room with synchronized playback, a shared queue, and chat. Create a room with only its name; invitations join automatically. Display names are optional. No email, password, or login form.

## Features

- Embedded YouTube player as the main stage. The host controls play, pause, seek, speed, video changes, and queue advancement.
- ±10-second controls and a shared timeline. Native YouTube host controls also synchronize. Guest volume/fullscreen remain local; guests can click Start watching if autoplay is blocked.
- Paste YouTube watch/share/music/shorts/live/embed URLs or video IDs. Videos play inside Baithak.
- Everyone can add videos (up to 30). Only the host or the person who added an item can remove it. Playing a selected queue item consumes it atomically.
- The creator starts as host and can pass control. Guests can request to host. Departed/inactive hosts are replaced by the server.
- Six guests, invitation links, chat, room expiration, owner end-room, and an explicit local player preview.

This version replaces the meeting/screen-sharing interface. Each device loads the same YouTube video and follows the room timeline. No screen capture, TURN, SFU, or video relay is involved. Original screen-sharing components remain in source but are not mounted.

## Stack and synchronization

React + TypeScript + Vite, YouTube IFrame Player API, Supabase Postgres/guest sessions/Realtime, GitHub, and Vercel. Open-source application code; external services have free-tier limits.

1. Host actions call `baithak_watch`. The database validates active membership, host ID, host epoch, and expected revision under a row lock.
2. Accepted state updates arrive through Supabase Realtime WebSocket Postgres Changes. Clients cannot directly write playback state or spoof host events.
3. Guests calculate current position from saved position + elapsed server time × speed. Request-midpoint clock estimation compensates for laptop clock differences.
4. Old/duplicate revisions are ignored. Host requests serialize; a revision conflict refreshes and retries once if host authority has not changed.
5. The host reanchors position about every five seconds. Guests check drift about every three seconds and seek above 1.2 seconds. Five-second polling recovers missed events.
6. Guest state application never publishes host commands. Programmatic host changes suppress native-event echoes. Native seeking is detected from timestamp discontinuities because the IFrame API has no seek event.
7. Late join, network recovery, and returning to the tab restore authoritative state. `video_epoch` supports same-video replay; `host_epoch` rejects commands from previous hosts.

## Local development

Use Node 22.12+ or Node 24.

```bash
npm ci
cp .env.example .env.local
npm run dev
npm test
npm run build
```

| Variable | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Public browser key (`sb_publishable_…`) |
| `VITE_YOUTUBE_API_KEY` | Optional referrer-restricted YouTube Data API key for inline keyword search |

Never put service-role keys, database passwords, or secret keys in `VITE_` variables. Deployed configuration takes precedence over browser-local settings. Operator settings are at `/?setup=1`; guests never need them.

## Supabase setup

Target: `https://srdiobwssgiuwenbmxvd.supabase.co`.

- **Fresh installation:** run [supabase/setup.sql](supabase/setup.sql) in the SQL Editor. It combines the base rooms schema and watch upgrade.
- **Existing base installation:** run only [supabase/youtube-sync.sql](supabase/youtube-sync.sql).
- Enable **Anonymous Sign-Ins** in Authentication → Sign In / Providers. This identifies guests silently; no login screen is shown.
- Keep `baithak_private` out of exposed Data API schemas. Public wrappers are security invokers; checked privileged implementations remain private.
- Run [supabase/verify.sql](supabase/verify.sql) and dashboard security advisors. The upgrade adds `baithak_playback` to Realtime.
- Set the public URL/key in Vercel, then redeploy.

Setup requires project-owner access. A publishable key cannot install tables/functions or change authentication settings.

## Deployment

Vercel project `baithak`; Vite preset; install `npm ci`; build `npm run build`; output `dist`. Site: `https://baithak-alpha.vercel.app/`. Invitations use `/?room=…`, so no SPA rewrite is required. Automatic Git deployments require linking GitHub inside Vercel; direct source deployment also works.

## Tests and limits

`npm test` covers local Postgres authorization, membership, stale revisions, host epochs, queue permissions/consumption, host recovery, timestamp extrapolation, clock estimation, and simulated YouTube player behaviour. Simulated-player tests cover late join, guest event isolation, host commands, changed videos, and same-video replay.

These tests do not prove real playback across independent networks. That requires installed production SQL, guest access, and at least two active devices. The local preview is not remote synchronization.

YouTube ads, buffering, embedding/region restrictions, and autoplay policies affect individual participants. Identical frames, zero latency, and no buffering are not guaranteed. Automatic group pause on buffering is not included; guests catch up after recovery.

Inline keyword search requires the optional YouTube API key and its free quota. Without it, users can paste links and use an explicitly labelled external YouTube search link. Embedded playback needs no YouTube API key. No scraping, media downloading, or audio extraction is used.

Membership expires after 75 seconds without room heartbeats; rooms expire after four hours. Chat stays in Postgres (latest 100 messages displayed); no audio/video is recorded. Run [supabase/maintenance.sql](supabase/maintenance.sql) periodically; queue/playback rows cascade with expired rooms. Never delete unrelated auth users.

Anonymous signup and Realtime/database free quotas apply. Before broad public access, add free Turnstile/CAPTCHA to guest signup and review usage limits.

MIT license. Third-party services have their own terms.
