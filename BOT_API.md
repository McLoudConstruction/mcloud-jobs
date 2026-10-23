# McLoud Jobs Bot API (Sales)

This is the instruction sheet for any bot that works the sales side of McLoud Jobs. Give it to the bot along with its key.

A bot can do four things, and nothing else:

1. Read leads
2. Read prospects
3. Add prospects
4. Log outreach

It cannot reach jobs, financials, subcontractors, staff, or settings. The database enforces this, not just the website.

## Setup (owner, once)

1. Run `supabase-migration-161-bot-sales-api.sql` in the Supabase SQL Editor (after migration 160).
2. In the app go to Settings, then the Bots tab, then New bot key. Give it a name (shown on everything it creates), a requests per minute limit, and optionally an expiry date.
3. Copy the key. It is shown once. It looks like `mcb_` followed by 64 characters.
4. To cut a bot off, press Revoke on its card. It stops working at once.

## Basics

Base URL: your site, then `/api/bot/sales`. Example: `https://YOUR-SITE.vercel.app/api/bot/sales`.

Every request sends the key as a bearer token. Never put the key in the URL.

```
Authorization: Bearer mcb_...
```

All answers are JSON. Reads are GET. Writes are POST with a JSON object body and `Content-Type: application/json`.

Check that a key works and see the allowed values:

```
curl -s https://YOUR-SITE/api/bot/sales -H "Authorization: Bearer $KEY"
```

This returns the bot name, its limits, and `allowed_values` (channels, directions, outcomes, stages, tiers, verticals). Read `allowed_values` instead of guessing.

## 1. Read leads

Leads are people who asked us for work (website forms, referrals). `GET /api/bot/sales/leads`

```
curl -s "https://YOUR-SITE/api/bot/sales/leads?stage=prospecting&limit=50" -H "Authorization: Bearer $KEY"
```

Filters (all optional): `stage`, `source`, `vertical`, `project_type`, `q` (text search), `created_since`, `updated_since` (ISO dates), `limit` (1 to 200, default 50), `cursor`.

Each lead has: `id`, `company`, `project`, `stage`, `source`, `vertical`, `project_type`, `contact_name`, `contact_email`, `contact_phone`, `site_address`, `notes`, `anticipated_timeline`, `loss_reason`, `prospect_id`, `can_email`, `created_at`, `updated_at`, and marketing fields.

Leads are read only.

## 2. Read prospects

Prospects are organizations we want to win (churches, apartments, hotels, offices). `GET /api/bot/sales/prospects`

```
curl -s "https://YOUR-SITE/api/bot/sales/prospects?vertical=church&city=Kansas%20City&can_email=true&contacted=false" -H "Authorization: Bearer $KEY"
```

Filters (all optional): `stage`, `vertical`, `tier` (A, B, C), `city`, `state`, `type`, `q`, `email` (finds an org by any contact address), `can_email` (true or false), `contacted` (true or false), `created_since`, `limit`, `cursor`.

Each prospect has: `id`, `name`, `type`, `vertical`, `tier`, `stage`, `street`, `unit`, `city`, `state`, `zip`, `management_company`, `year_built`, `sq_ft`, `notes`, `contact` (main contact with `name`, `email`, `phone`, `can_email`), `people` (other contacts, each with `can_email`), `can_email`, `do_not_contact`, `last_contacted_at`, `next_action_at`, `next_action_note`, and `touches` (`count`, `last_at`, `last_outcome`).

### Paging

When more results exist the answer contains `next_cursor`. Send it back as `?cursor=...` along with the same filters. When `next_cursor` is missing or null you have everything. Treat the cursor as an opaque string.

## 3. Add a prospect

`POST /api/bot/sales/prospects`

```
curl -s https://YOUR-SITE/api/bot/sales/prospects \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: church-zion-lutheran-2026-10-23" \
  -d '{
    "name": "Zion Lutheran Church",
    "type": "church",
    "street": "9 Pine Rd",
    "city": "Lee'"'"'s Summit",
    "state": "MO",
    "contact_name": "Ann Fox",
    "contact_email": "ann@zion.org"
  }'
```

Only `name` is required. Allowed fields: `name`, `type`, `vertical`, `tier`, `street`, `unit`, `city`, `state`, `zip`, `management_company`, `year_built`, `sq_ft`, `notes`, `contact_name`, `contact_email`, `contact_phone`, `contact_position`. Any other field is rejected with 422 and the allowed list. Give as much as you know, especially street and city, because they drive duplicate detection.

Answer:

```
{ "status": "created", "id": "...", "contact_id": "...", "can_email": true,
  "matched_on": null, "contact_added": false, "similar": [] }
```

`status` is one of:

- `created`: a new prospect was added (HTTP 201).
- `duplicate`: we already have this organization (HTTP 200). `id` is the existing one, `matched_on` says why. Nothing was overwritten. If you sent a contact email we did not have, only that contact was added (`contact_added: true`).

A duplicate is the same name at the same street, or the same name in the same city when a street is missing. Two campuses of one church at different streets are separate prospects. `similar` lists soft matches (for example a shared email or phone) for you to look at. They do not block creation.

## 4. Log outreach

Record every touch you make, so staff and other bots can see it. `POST /api/bot/sales/outreach`

```
curl -s https://YOUR-SITE/api/bot/sales/outreach \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: touch-zion-2026-10-23-intro" \
  -d '{
    "email": "ann@zion.org",
    "channel": "email",
    "outcome": "sent",
    "note": "Intro email about roof inspections"
  }'
```

Fields:

- `prospect_id` or `email`: one is required. An email must match exactly one prospect or one of its contacts. If it matches none (404) or several (409), you get an error, so use `prospect_id` when you have it.
- `channel` (required): `email`, `call`, `text`, `mail`, `other`.
- `outcome` (required): `sent`, `replied`, `bounced`, `interested`, `not_interested`, `unsubscribed`, `no_answer`, `voicemail`, `meeting_set`, `wrong_contact`.
- `direction`: `outbound` (default) or `inbound`.
- `note`: short free text.
- `sent_at`: ISO time, defaults to now.

Answer: `{ "status": "logged", "touch_id": "...", "prospect_id": "...", "effects": [...] }`. `effects` lists what the platform did because of the outcome.

### What each outcome does

- `sent`, `voicemail`, `replied`, `interested`, `not_interested`, `unsubscribed`, `meeting_set`: counts as contact. Updates last contacted, and moves a prospect still at `prospecting` to `contacted`.
- `replied`, `interested`, `meeting_set`: also stops any platform email sequence for that address and sets the prospect's next action note so staff follow up.
- `not_interested`: stops platform sequences for that address. The address is not suppressed.
- `unsubscribed`: suppresses the address, stops sequences, and opts the contact out of automated email. Never email them again.
- `bounced`: suppresses the address. Does not count as contact.
- `no_answer`, `wrong_contact`: logged only.

## Rules for bots

1. Check `can_email` before sending any email. If it is false, do not email that person. `do_not_contact` means no contact of any kind.
2. Always send an `Idempotency-Key` (8 to 128 characters: letters, numbers, `_ . : -`) on every POST. If a request times out, resend it with the same key and body. It will not be applied twice. Reusing a key with a different body returns 422 `idempotency_conflict`.
3. Log every touch, including bounces, unsubscribes, and replies, as soon as they happen.
4. Page with `next_cursor`. Do not fetch faster than your rate limit.
5. On 429, wait the number of seconds in the `Retry-After` header.
6. Your own outgoing email is sent from your own mailbox, not the platform. It must include an unsubscribe option and our postal address (CAN-SPAM). When someone unsubscribes, log `unsubscribed` right away.
7. Do not scrape or guess. Only add organizations you have a real reason to contact.

## Errors

Errors look like `{ "code": "...", "error": "human readable message" }`, sometimes with an `allowed` list.

| HTTP | code | Meaning |
|------|------|---------|
| 400 | `invalid_json` | Body is not valid JSON |
| 401 | `unauthorized`, `key_expired` | Missing, wrong, or revoked key, or an expired key |
| 403 | `forbidden` | Key does not have the sales scope |
| 404 | `unknown_prospect` | No prospect with that `prospect_id` or email. Add it first |
| 409 | `ambiguous_prospect` | The email matches several prospects. Use `prospect_id` |
| 413 | `too_large` | Body over 50,000 characters |
| 422 | `unknown_field`, `unknown_filter`, `invalid_field`, `invalid_filter`, `invalid_filters`, `invalid_body`, `invalid_idempotency_key`, `idempotency_conflict` | A field or value is wrong, or an Idempotency-Key was reused with a different body. Read `error` and `allowed` |
| 429 | `rate_limited` | Too many requests. See `Retry-After` |
| 500 | `server_error` | Our side. Retry later |
| 503 | `not_configured` | Migration 161 has not been run |

Rejected requests (422) count toward your rate limit, so fix the request instead of retrying it unchanged.

## Staff view

Settings, then Bots, shows each key with its last use, 24 hour call count, prospects added, touches logged, and a recent activity list. Prospects added by a bot are marked in the database with `created_by_bot_id`, so they can be reviewed or removed.
