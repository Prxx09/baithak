# Baithak · बैठक

**One screen. Your people.** A private web hangout where one person broadcasts a browser tab, window, or screen with available audio. Everyone else receives that broadcast. Anyone in the room can take the sharing slot after it is released.

## Stack

- React, TypeScript, Vite, and browser-native WebRTC (MIT/open web application stack).
- Supabase Postgres, guest authentication, RLS, Realtime signaling, and chat.
- Vercel static hosting; GitHub source control.
- Direct peer media connections for a maximum of six people. Each broadcaster uploads a separate media copy per viewer. No SFU, paid media API, recording, or video storage is required.

## Run locally

Use Node 22.12+ or Node 24.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Set `VITE_SUPABASE_PUBLISHABLE_KEY` to the project's **publishable** key. Never put a service role/secret key in any `VITE_` variable. All `VITE_` values are public browser configuration.

```bash
npm test
npm run build
```

## Set up the dedicated Supabase project

Target: `https://srdiobwssgiuwenbmxvd.supabase.co`.

1. In the SQL Editor, run **[supabase/schema.sql](supabase/schema.sql)** once. The equivalent CLI-generated migration is in `supabase/migrations/`; use one installation path, not both. The setup intentionally fails/rolls back on an already-installed schema instead of hiding an incomplete installation.
2. Enable **Anonymous Sign-Ins** under Authentication → Sign In / Providers. Guests receive individual authenticated identities; the publishable key alone does not authorize membership.
3. Keep `baithak_private` out of exposed Data API schemas. `public` must be exposed.
4. Confirm `baithak_signals` and `baithak_chat` are in the `supabase_realtime` publication (included in the SQL).
5. Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` on Vercel for Production/Preview, then redeploy. Connection settings in the UI are a local operator fallback, not a way to distribute configuration to other guests.
6. Run `supabase/verify.sql` in the SQL Editor. Run database security advisors in the dashboard.

The connected Supabase account must own/have access to the target project to apply the schema through MCP. Access to another account's projects does not grant access to this one.

## Deploy to Vercel

Import `Prxx09/baithak`, use the **Vite** framework preset, install with `npm ci`, build with `npm run build`, and use `dist` as the output directory. Rooms use `/?room=…` invitations, so no SPA rewrite is needed. A production GitHub login connection in Vercel is required for automatic Git deployments. Direct source deployments work without it.

## Features

- Create a room using only its name and share a 128-bit invitation code/link. No email, password, OTP, or sign-in screen.
- Invitations join automatically using an invisible guest session. Display names are optional; otherwise a guest name is assigned.
- Deployed connection settings are applied automatically to all visitors. Operator settings remain available at `/?setup=1`.
- Up to six active guests per room; four-hour rooms; up to three open rooms per creator.
- Atomically claim/release one sharing slot; request a turn in the People panel.
- A 45-second sharing lease, refreshed every seven seconds. Clients stop sharing after 30 seconds without a successful heartbeat. Inactive memberships expire after 75 seconds.
- Tab/window/screen capture, optional content audio, 480p/720p/1080p selection (browser quality constraints are targets, not guarantees).
- Optional microphone and camera per person. Screen preview is muted locally. Voice and shared audio are separate streams.
- Room chat, participant list, copy invitation, owner end-room, reconnect controls, guest-friendly error states.
- YouTube search opens YouTube on the broadcaster's device. Optionally set a referrer-restricted `VITE_YOUTUBE_API_KEY` for inline results; without it, search opens YouTube results in a new tab. This fallback is clearly labelled in the UI.
- Explicit local room preview; it does not imply other participants are connected.

## Connectivity and free usage

The default STUN configuration uses Cloudflare's free public STUN endpoint. STUN alone cannot connect every pair of networks. For restrictive NATs/corporate networks, configure `VITE_ICE_SERVERS` with a TURN relay you operate or a free-tier provider. Never commit TURN secrets. A production relay integration should issue short-lived credentials from a membership-checked server endpoint rather than bundling a permanent shared password. Do not enable paid overages to satisfy this app's free-only scope.

At a 2 Mbps screen bitrate, five viewers require roughly 10 Mbps of broadcaster upload before audio, cameras, and overhead. Start at 720p and use headphones. Group microphone/camera traffic also grows with the number of peers.

WebRTC uses jitter buffers and congestion control; zero latency, identical presentation times, or no buffering cannot be guaranteed. The sub-second healthy-network goal needs real cross-network measurements. This MVP does not attempt frame-accurate synchronization across receivers.

Desktop Chrome/Edge tab capture is the primary broadcasting target. Screen/system audio capture is browser/OS-dependent. Protected media may not capture. Mobile receiving depends on WebRTC support and user playback activation; mobile broadcasting is not a verified target.

## Security and data lifecycle

- All application tables have RLS. Only active members can read a room or its chat. Signaling rows are visible only to the authenticated receiver; inserts bind sender identity to `auth.uid()`.
- Room writes are restricted to a checked private function and a security-invoker public wrapper. Membership/admission and share claims serialize on a room row lock. All definer functions pin an empty search path and revoke anonymous/public execution.
- The share slot is authoritative for the application and compliant receivers ignore other content streams. Peer-to-peer transport cannot prevent a deliberately modified member client from sending arbitrary data. Media-server-side publisher enforcement would require an SFU.
- Invite links are bearer invitations. Anyone who has one may join while capacity is available. Display names are not identity verification.
- Chat is stored in Postgres (the latest 100 messages are shown). Signals expire from active-room storage after 90 seconds. Expired room data should be removed with `supabase/maintenance.sql`; no recording is made.
- Supabase's anonymous-auth rate limit applies. Before opening to a broad audience, add Turnstile/CAPTCHA to guest signup and review rate/usage limits. No paid CAPTCHA service is required.

## Verification status

Build/type checks and local database integration tests can run without production access. A live two-person screen/audio/handover test requires the target Supabase schema, guest auth, publishable key, and working peer/relay connectivity. Do not describe the local preview as a verified multi-person deployment.

## License

MIT. Third-party services have their own terms and free-tier limits.
