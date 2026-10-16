# Baithak · बैठक

**One player. Your people.** An invite-only YouTube watch room with synchronized playback, a shared queue, and chat. Create a room with a room name and your display name. Invitations prefill the room link and ask each visitor to enter a name before joining. No email, password, or login form.

## Features

- Embedded YouTube player as the main stage. The host controls play, pause, seek, speed, video changes, and queue advancement.
- ±10-second controls and a shared timeline. Native YouTube host controls also synchronize. Guest volume/fullscreen remain local; guests can click Start watching if autoplay is blocked.
- Paste YouTube watch/share/music/shorts/live/embed URLs or video IDs. Videos play inside Baithak.
- Continuous playback: queued videos play first and public playlists refill automatically. When those finish, YouTube shows its own related suggestions inside the host player; the host’s selection is detected and synchronized to every guest.
- Paste a public playlist URL to load it in pages of 20; the next page is fetched when five or fewer queued videos remain. Private/deleted playlist entries are skipped.
- Everyone can add videos (up to 30). Only the host or the person who added an item can remove it. Playing a selected queue item consumes it atomically.
- The creator starts as host and can pass control. Guests can request to host. Departed/inactive hosts are replaced by the server.
- Six people total, invitation links, text chat, optional live voice, room expiration, owner end-room, and an explicit local player preview.

This version replaces the meeting/screen-sharing interface. Each device loads the same YouTube video and follows the room timeline. Optional voice uses audio-only WebRTC between participants; Supabase carries membership-protected signaling and never receives microphone audio. Original screen-sharing components remain in source but are not mounted.

## Live voice and temporary rooms

Click **Join voice** to grant microphone access. Voice starts only after this action. Participants can mute/unmute, reconnect, or leave voice while continuing to watch. Use headphones to avoid echo. If browser autoplay blocks incoming audio, an **Enable voice audio** button appears. Microphone tracks and peer connections close on leaving the room, ending it, or automatic expiry. A permission request still pending when the room closes is discarded and its tracks stopped.

Rooms last **four hours from creation**; joining, refreshing, and host changes do not extend them. The server rejects room commands, signaling, and chat after `expires_at`. The visible countdown uses the server-adjusted clock; reaching zero stops playback and voice and replaces the room with an ended screen. Existing database policies already enforce expiry, so this update needs no schema migration. Expiry disables access; stored room/chat rows are removed by the separate maintenance job below.

Voice uses the existing `baithak_signals` table, Realtime events, and a polling fallback. Signaling includes per-join session IDs to ignore stale offers after reconnecting. Audio is not recorded. Free STUN works on many networks; restrictive NAT/firewalls can require TURN. Set `VITE_ICE_SERVERS` to a JSON array of browser-visible ICE server configuration if you operate a relay. Do not put privileged or long-lived server secrets there. No paid voice provider is required, but peer-to-peer connectivity cannot be guaranteed on every network without a relay.

On returning from a suspended mobile tab, the app renews the previously named guest's membership with the invitation if its 75-second activity window elapsed. Voice confirms current membership after the microphone prompt, refreshes on network/foreground recovery, and retries a denied signaling write once after checking both participants. Inactive recipients are removed rather than retried. Expired rooms still cannot be rejoined; RLS remains enabled and unchanged.

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
| `VITE_ICE_SERVERS` | Optional JSON ICE server list for voice; defaults to free Cloudflare STUN |

Never put service-role keys, database passwords, or secret keys in `VITE_` variables. Deployed configuration takes precedence over browser-local settings. Operator settings are at `/?setup=1`; guests never need them.

## Supabase setup

Target: `https://srdiobwssgiuwenbmxvd.supabase.co`.

- **Fresh installation:** run [supabase/setup.sql](supabase/setup.sql) in the SQL Editor. It combines the base rooms schema and watch upgrade.
- **Existing base installation:** run [supabase/youtube-sync.sql](supabase/youtube-sync.sql), then [supabase/autoplay.sql](supabase/autoplay.sql).
- **Existing watch-room installation:** run only [supabase/autoplay.sql](supabase/autoplay.sql). This additive upgrade is safe to rerun and preserves rooms/queues.
- Enable **Anonymous Sign-Ins** in Authentication → Sign In / Providers. This identifies guests silently; no login screen is shown.
- Keep `baithak_private` out of exposed Data API schemas. Public wrappers are security invokers; checked privileged implementations remain private.
- Run [supabase/verify.sql](supabase/verify.sql) and dashboard security advisors. The watch-room upgrade adds `baithak_playback` to Realtime. The playlist upgrade adds shared playlist cursors and the latest 100 played video IDs to that row. Legacy autoplay columns remain for migration compatibility but the app does not generate recommendations.
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

## YouTube suggestions and continuous playback

The explicit shared queue plays first. Public playlists refill and advance automatically. When the queue and playlist are empty, the embedded player displays related videos selected by YouTube. The host can choose one inside the player; Baithak detects the resulting video change and broadcasts its ID, title, state, and timestamp so every guest follows the same choice.

Baithak does not generate, rank, or filter autoplay recommendations. The public YouTube APIs do not expose the personalized Up Next feed or a command that selects its first recommendation automatically. Consequently, a single non-playlist video stops on YouTube's related-video screen until the host selects a suggestion. Exact hands-free website autoplay would require a companion browser extension controlling a signed-in youtube.com tab.

The browser may still require one Start watching click for unmuted audio. Once permitted, consecutive videos are loaded in the same embedded player. Unavailable/non-embeddable queued videos are skipped by the host, with a three-failure limit to prevent infinite retry chains. Playback is continuous where browser and YouTube policies allow it; it cannot guarantee gapless or buffer-free streaming.
