# MicroFlix Desktop companion app

This repository now also includes a **Render server browser collector** for MicroFlix Studios. The Render deployment runs Chromium, a password-protected noVNC browser viewer and the existing analytics collector in one Docker web service. The MicroFlix website stays on its current hosting. No existing RoadCodaWebsite service is reused or changed.

## Deploy from your phone or computer

1. In Render choose **New → Blueprint** and select `RoadCoda/microflix-desktop`.
2. Select branch **microflix-render-collector**. The configuration file is `render.yaml`.
3. Review the proposed **paid 1 CPU / 2 GB web service and 5 GB disk** and Render's current price before clicking deploy. This is a starting size to test; TikTok browser memory needs may require increasing it. The free/static service types are unsuitable for persistent Studio login.
4. Supply the two requested secrets directly in Render:
   - `MICROFLIX_WORKER_TOKEN`: the key from MicroFlix → More → Demographics → Server connection settings. If you did not retain the key, disconnect/reconnect there to create a replacement, which revokes the old key.
   - `VIEWER_PASSWORD`: a unique, random password or passphrase of at least 20 characters. This protects the server browser viewer, not your TikTok account.
5. Deploy, then open the service's **HTTPS onrender.com URL**. Render supplies `RENDER_EXTERNAL_URL` automatically; do not expose CDP/VNC ports or configure another public origin.
6. Enter your viewer password. Sign into TikTok yourself inside the displayed server browser. Use the **Toggle keyboard** control on a phone if needed. Set TikTok Studio's display language to English. Do not send TikTok credentials or verification codes to chat.
7. Click **Start collector** in the viewer. Return to `https://app.microflixstudios.com/demographics`, select **Check connection**, then **Sync now**. The worker should show online after its next poll.
8. Verify a single saved capture against Studio before relying on a library run. Captures are saved per video, so pause after the first one if appropriate. Then resume. The phone page can close while the server runs.

The container starts with collection **stopped** so initial login is uninterrupted. After a container restart/redeploy, reopen the viewer and click Start collector again. If you later automate startup, preserve the same account/session isolation and sign-in pause behavior.

## Reading and privacy

The collector reads visible pages only. It uses no TikTok API, vidIQ or AI credits, does not post/edit/delete videos, does not read cookies or hidden application state, and does not evade verification. It discovers the configured account's public-profile video links; this may not enumerate every historical video. Studio identity must match the configured account through its navigation profile link. Unknown navigation/layouts pause collection rather than guessing.

Jobs, leases, status and validated records are stored in the existing MicroFlix account. Only a worker-key hash is stored there. Browser login state is kept under `/var/data/tiktok-profile` on the Render disk. Render documents encrypted-at-rest persistent disks; restrict access to your Render team. Treat the browser profile and viewer password as sensitive. One deployment is for one account; this is not a shared multi-customer browser service.

The public port serves the authenticated viewer only. CDP and raw VNC listen on loopback. Session cookies are HttpOnly, Secure and SameSite=Strict, expire after one hour, and are revoked on viewer logout. HTTP controls and WebSocket upgrades enforce the configured origin and session. Login attempts and session counts are bounded. The unauthenticated health endpoint returns readiness only. No secrets are present in this repository.

Pause the sync in MicroFlix before using the browser for verification or account changes. **Stop collector** stops its process; an interrupted task's lease can remain active for up to five minutes. Pause/resume in MicroFlix releases it immediately. Disconnecting in MicroFlix revokes server writes; also sign out of TikTok in the viewer to end that browser session.

## Validation status

- `npm ci && npm test`: tests actual HTTP authentication, CSRF/origin checks, session revocation, WebSocket authorization/byte transport, rate limits and synthetic Studio page parsing.
- Node syntax checks pass for the host, viewer, worker and reader.
- **Docker image build, Render deployment and live TikTok sign-in/capture remain unverified.** The authoring environment has no Docker/browser runtime. The tests do not claim that TikTok accepts a hosted browser or that its current layout matches the parser.
- No paid Render resources are created by committing this branch. Render creates them only when you deploy the Blueprint.

Developer entry point: `server-collector/host.mjs`. The original page reader, parser and worker came from MicroFlix Site source commit `2e78a57ad2b3b486e2c578b7beee515cd14e9025`. Automatic deploys are disabled in the Blueprint.
