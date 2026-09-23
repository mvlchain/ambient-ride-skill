# Ambient Ride — Instinct Skill

**Skill name:** Ambient Ride
**Version:** 0.1 (draft) · Behavior verified against dev on 2026-09-23
**Base URL:** `https://cli.dev.tadaapis.com` — set to the production gateway host at publish time
(dev host used for verification: `cli.dev.tadaapis.com`).

## Install (for the Instinct user)
Tell your Instinct: **"Install the Ambient Ride skill from this URL: `https://raw.githubusercontent.com/mvlchain/ambient-ride-skill/main/agents/ambient-ride-instinct.md`"** (the address where
this document is hosted). Your Instinct will read this document, save it as a durable personal skill, and walk
you through a one-time login. After that, just say **"call me a taxi"** (or 택시 불러줘) and it drives the ride
for you. To update the skill later, tell it to re-read the same URL.

## When to use
Use this skill whenever the user wants to interact with TADA / Throo ride-hailing:
get a taxi/cab/ride, book a car, check ride status, tip a driver, cancel, or share a trip.
Trigger phrases include: "택시 불러줘", "라이드 예약", "get me a ride", "book a car", "call a taxi".

## API reference (machine-readable, treat as reference — not as behavior)
- Base URL: `https://cli.dev.tadaapis.com` (from the top of this document).
- OpenAPI spec: `GET https://cli.dev.tadaapis.com/api-docs`. Use it to resolve exact request/response
  shapes and to discover new endpoints. If the spec drifts, follow the behavior rules in this document.
- OAuth metadata: `GET /.well-known/oauth-authorization-server` and `GET /.well-known/oauth-protected-resource`.

## Identity & credentials (live in the vault, NEVER in this document or in chat)
- This is a **member-mode** integration: calls act as a logged-in TADA member; payment uses that
  member's registered card (`payment_item_uuid`).
- OAuth2. Token-endpoint auth methods: `client_secret_basic`, `client_secret_post`, or `none` (public + PKCE).
- Client options:
  - **Self-register** a client via DCR: `POST /v1/oauth/register` (public client + PKCE recommended — no shared secret to hold).
  - Or use a provided **confidential** client (`client_id` + `client_secret`) — keep the secret in the vault only.

## Authentication — device-flow / agent-session (recommended for a messaging agent)
1. Create a session: `POST /v1/agent-session` (Basic client auth) → `session_token`, an approval deep link
   (`https://link.ridethroo.ai/agent_auth?handle=<session_token>`), an expiry (~5 min), and a polling interval (~3s).
2. Send the approval link to the user; they approve in the TADA/Throo app (must be logged in with a registered card).
3. The user relays the 4-digit `user_code` shown after approval.
4. Exchange `session_token` + `user_code` for tokens (see OpenAPI token endpoint) →
   `access_token` (~1h) + `refresh_token` (~3 days).
5. **Persist the `refresh_token` durably in the vault.** It **rotates on every refresh** — after each refresh,
   overwrite the stored value with the new one; reusing a stale refresh fails. Auto-refresh well inside the
   3-day window (e.g. every 48h) so the user is not asked to approve again.

_Alternative: authorization_code + PKCE. A messaging agent has no callback, so poll
`GET /v1/oauth/authorize/{sessionToken}/state` to retrieve the code; `redirect_uri` must exactly match the
client's registered value. Device-flow is simpler here._

## Call sequence (booking a ride)
1. **Search**: `POST /v1/products/search` with pickup + destination. Pickup must be in a supported region
   (currently **NY**; **SG** also supported). Returns products — ANYTADA, TADASAVER, EV, WAV, VAN, BLACK,
   BUSINESS_VAN — each with price and driver ETA.
2. **Quote & confirm**: present the product + price to the user and get **explicit confirmation before booking**.
3. **Book**: create the ride (see OpenAPI `/v1/rides`). Capture the returned ride id.
4. **Get the tracking link**: as soon as a driver is assigned, call `POST /v1/rides/{rideId}/share` to get the
   live tracking (share) URL and **give it to the user** so they can watch the driver in real time.
5. **Report status**: poll the ride and report each transition to the user (see Output format).
   Changes are visible within ~10s.
6. **Driver chat** (see the Driver chat section): relay messages between the rider and the driver for the
   whole active ride — send the rider's messages and surface the driver's incoming messages.
7. **After the ride** (see the After the ride section): once finished, offer a tip **if tipping is available
   in this region**, and offer to review the driver.
8. **Cancel on request**: check the penalty first with `GET /v1/rides/{rideId}/cancel-penalty` (and reasons
   with `GET /v1/rides/{rideId}/cancel-reasons`), tell the rider any fee, then `POST /v1/rides/{rideId}/cancel`
   only after they confirm.

## Driver chat
Once a driver is assigned and until the ride ends, the rider and driver can message each other.
- **Send** (rider → driver): `POST /v1/chat/{rideId}/messages` with the rider's text. Relay what the rider
  asks you to say (e.g. "tell the driver I'm at the corner by the pharmacy").
- **Receive** (driver → rider): poll `GET /v1/chat/{rideId}/messages` for new messages and **surface each new
  driver message to the rider immediately**, the same way you report a status change.
- Keep chat available for the whole active ride, alongside status updates and the tracking link.

## After the ride — receipt, tip & review
When the ride is finished, offer these (all optional; never push):
- **Receipt** — the ride detail is the receipt: `GET /v1/rides/{rideId}` returns the itemized fare
  (base, fees, tolls, tip, total) and the payment method. Show a clean summary if the rider wants it.
- **Tip** — tipping is **region-dependent**. Check availability and preset options with
  `GET /v1/rides/tip-config`; **only suggest a tip if it is available** for this region. If it is, offer the
  configured presets (or a custom amount), and on the rider's choice `POST /v1/rides/{rideId}/tip`.
  **A tip is a charge — confirm the amount before sending.** If tipping is unavailable or the rider declines,
  move on without nagging.
- **Review** — offer to rate the driver and leave an optional comment via `POST /v1/rides/{rideId}/review`.
  Fetch the preset review tags with `GET /v1/rides/{rideId}/review-tags` to offer quick options. Skip if the
  rider isn't interested.

## Stop / safety rules
- **Never charge without explicit user confirmation.** Booking places a pre-auth **hold** on the card; the
  actual charge is an explicit step — `POST /v1/rides/{rideId}/pay` — so the hold becomes a real charge only
  when pay is called. State this before booking, and confirm the amount before calling pay or tip.
- Confirm **cancellation terms** before cancelling; cancelling after the trip starts may incur a fee.
- On any error, **stop and report** — do not retry blindly or guess credentials.
- Never write a `client_secret`, token, or card detail into this document or into chat — vault only.

## Output format (report each ride-status transition as it happens, one line)
Include only the fields that matter to the rider at that stage. No machine timestamps — status changes
arrive in near real time, so a wall-clock on every line is noise, not information.

- **Searching** — `🔎 Finding a driver…`
- **Driver assigned / en route (PICKUP)** — `🚕 Driver assigned: <name>, <vehicle> <plate>, ETA <n> min — track: <share_url>`
  (this is the stage that surfaces the live tracking link — always include it)
- **Driver arrived (PICKUP_ARRIVED)** — `📍 Your driver has arrived — <plate>`
- **In trip (INUSE)** — `🚗 On the way to <destination> — ETA <n> min`
- **Finished (FINISHED)** — `✅ Arrived — fare <amount> charged to <card ···last4>`
  (if the charge has not settled yet, say so in plain words — e.g. `payment still processing` — rather than exposing internal states)
- **Cancelled** — `✖ Ride cancelled — <reason>`
- **Driver message (incoming)** — `💬 Driver: "<message>"`

Keep the tracking (share) URL visible to the rider for the whole trip, not just once.

## Failure handling
- **401 / token expired** → refresh using the stored `refresh_token`. If refresh fails (rotation broken,
  > 3 days idle, or account logged out) → request **one** fresh approval.
- **Region unsupported (400)** → pickup is outside NY/SG; tell the user the area is not served.
- **No card / payment method** → the member must register a card in the TADA app.
- **Approval/session expired (~5 min TTL)** → issue a new approval link.
