# Mobile and social review

This pass adds local speaking detection, incoming voice sound/volume controls, a browser-supported audio output picker, room reactions, typing indicators, and mobile Watch / Voice / Chat / Queue shortcuts. The existing name requirement, host authority, six-person room limit, and four-hour deadline remain in place.

## Findings addressed

| Finding | Change |
| --- | --- |
| Voice polling used a phone timestamp as its cursor, so an incorrect device clock could skip server signals. | Poll using increasing database message IDs. |
| New chat messages could scroll the entire page while a guest read older messages. | Scroll only inside chat when already near the bottom; otherwise show an unread button. |
| A fixed 100-message window can receive a new message without its length changing. | Detect unread messages using IDs instead of array length. |
| Sending chat could appear to fail after an acknowledged insert if the following heartbeat failed. | Acknowledge the insert independently and refresh in the background. Preserve a newer draft typed while sending. |
| Chat sends could encounter the same suspended-membership error as voice. | Renew the named membership before sending. Room expiry and RLS still apply. |
| Landing visitors downloaded the entire watch-room interface immediately. | Load the room on demand with a visible loading state. |
| Voice cards indicated an open mic but did not show who was speaking. | One local AudioContext samples audio levels; a short hold reduces flicker. Muted/disconnected participants are not shown as speaking. No analysis audio is uploaded or recorded. |

## Activity and accessibility

Typing/reaction events use the existing recipient-only `baithak_signals` policies. Typing transmits only a boolean, throttled to at most one active update per 2.5 seconds per sender/recipient, with an idle stop and local timeout. It never transmits drafts. Reactions use an allowlist, a tap cooldown, bounded display history, and automatic removal. Old, duplicate, out-of-order typing, and outsider events are ignored. Existing heartbeat maintenance removes old signaling rows.

Speaking is an audio-energy estimate and can respond to background noise. Text status accompanies the visual ring. Reduced-motion preferences disable animated bars/dots. Audio output controls are optional and fail gracefully on unsupported browsers. Incoming sound can be disabled independently of the microphone. Device routing and iPhone volume remain controlled by the operating system where browser APIs are unavailable.

## Remaining verification and follow-up

- Verify microphone, autoplay recovery, output selection, background return, and simultaneous speech on physical Android/iPhone devices and separate networks. Simulated tests cannot establish actual audio quality.
- A TURN relay is still necessary for reliable voice through restrictive hostel/campus networks. STUN-only peer connections cannot guarantee universal connectivity.
- Before expanding beyond small private groups, measure Supabase signaling quotas. Activity currently fans out to at most five recipients and uses short-lived database rows; larger scale would benefit from authorized private Broadcast channels with server-side policies.
- Room expiry denies access immediately; physical room/chat deletion still relies on the documented maintenance job. The connected administrative account cannot currently manage this app's Supabase project, so no new cleanup schedule or database policies were applied.
