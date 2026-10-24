# McLoud Jobs Bot API (Sales)

This is the instruction sheet for any bot that works the sales side of McLoud Jobs. Give it to the bot along with its key.

A bot works the whole sales side, and nothing else:

| Area | Read | Add | Change |
|------|------|-----|--------|
| Leads (people who asked for work) | yes | no | no |
| Prospects (properties we want to win) | yes | yes | any field |
| People (contacts) | yes | yes | any field |
| Companies | yes | yes | any field |
| Outreach (touches) | yes | yes | no |
| Follow up lists (the Sales page) | yes | no | no |

A bot can never delete anything. Deleting is owner only, in the app. A PATCH replaces what is there, and every change is saved in the audit log with the value before and after. It cannot reach jobs, financials, subcontractors, staff, or settings. The database enforces all of this, not just the website.

## Setup (owner, once)

1. Run `supabase-migration-161-bot-sales-api.sql` in the Supabase SQL Editor (after migration 160), then `supabase-migration-162-owner-delete-and-touch-timeline.sql` (adds outreach history), then `supabase-migration-163-staff-touch-log.sql` (easier logging, plus staff can log touches by hand), then 164 and 165 (follow up lists, touches without a property), then `supabase-migration-166-bot-sales-people-companies.sql` (people, companies, prospect updates, follow up lists for bots).
2. In the app go to Settings, then the Bots tab, then New bot key. Give it a name (shown on everything it creates), a requests per minute limit, and optionally an expiry date.
3. Copy the key. It is shown once. It looks like `mcb_` followed by 64 characters.
4. To cut a bot off, press Revoke on its card. It stops working at once.

## Basics

Base URL: your site, then `/api/bot/sales`. Example: `https://YOUR-SITE.vercel.app/api/bot/sales`.

Every request sends the key as a bearer token. Never put the key in the URL.

```
Authorization: Bearer mcb_...
```

All answers are JSON. Reads are GET. Adding is POST with a JSON object body and `Content-Type: application/json`. Filling in an existing record is PATCH to the record's address (`/people/{id}`, `/companies/{id}`, `/prospects/{id}`) with a JSON object body. Every list can also be fetched one record at a time with GET on that address, which answers 404 when there is no such record.

Check that a key works and see the allowed values:

```
curl -s https://YOUR-SITE/api/bot/sales -H "Authorization: Bearer $KEY"
```

This returns the bot name, its limits, and `allowed_values` (channels, directions, outcomes, stages, the stages a bot may set, tiers, verticals, `contact_types` for people, `company_types` for companies). Read `allowed_values` instead of guessing.

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

Filters (all optional): `id`, `company_id`, `stage`, `vertical`, `tier` (A, B, C), `city`, `state`, `type`, `q`, `email` (finds an org by any contact address), `can_email` (true or false), `contacted` (true or false), `created_since`, `limit`, `cursor`.

Each prospect has: `id`, `name`, `type`, `vertical`, `tier`, `stage`, `street`, `unit`, `city`, `state`, `zip`, `management_company`, `year_built`, `sq_ft`, `notes`, `contact` (main contact with `name`, `email`, `phone`, `can_email`), `won_at` and `won_note` (when won), `people` (other contacts, each with `can_email`), `can_email`, `do_not_contact`, `do_not_contact_source` (`company` when the company is do not contact, otherwise `property`), `last_contacted_at`, `next_action_at`, `next_action_note`, `stage_changed_at`, `lost_reason`, `reengage_at`, `company_id`, and `touches` (`count`, `last_at`, `last_outcome`).

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

One person, one record: if the `contact_email` you send already belongs to someone in People, no second person is created. The prospect is linked to the existing person instead, and `contact_added` stays false.

`type` and `vertical` are one shared list now (`allowed_values.property_types`). Common names such as `church` are accepted and saved as `Religious - Churches`. A value that is not on the list is kept as sent.

A duplicate is the same name at the same street, or the same name in the same city when a street is missing. Two campuses of one church at different streets are separate prospects. `similar` lists soft matches (for example a shared email or phone) for you to look at. They do not block creation.

## 4. Update a prospect

`PATCH /api/bot/sales/prospects/{id}`

```
curl -s -X PATCH https://YOUR-SITE/api/bot/sales/prospects/PROSPECT_ID \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: zion-next-step-2026-10-24" \
  -d '{"stage": "proposal", "next_action_at": "2026-10-30T15:00:00Z", "next_action_note": "Send the roof estimate", "add_note": "Walked the roof with the pastor"}'
```

A PATCH replaces the current value of any field you send. Send `null` to clear an optional field. The fields:

- **Working fields**, for moving a prospect along: `stage` (`prospecting`, `contacted`, `proposal`, `won`, `lost`), `next_action_at` (ISO time), `next_action_note`, `lost_reason` and `reengage_at` (a date, only while the stage is `lost`), and `do_not_contact`. Send `null` to clear `next_action_at`, `next_action_note`, `lost_reason` or `reengage_at`. A bot can set `won`, but must send `won_note` saying what was agreed (and may send `won_at`, a recent date, which defaults to today). `won_note` and `won_at` are only accepted together with stage `won`. A bot cannot move a prospect out of `won`; staff can. A bot can set `do_not_contact` to `true` but never clear it.
- **Descriptive fields**: `name`, `type`, `vertical`, `tier`, `street`, `unit`, `city`, `state`, `zip`, `management_company`, `year_built` (four digits), `sq_ft`, `contact_name`, `contact_email`, `contact_phone`, `company_id`, `source`, `target_value` (a dollar amount), `active` (true or false), `last_visited_at` (ISO time), `notes`. All of these except `name` can be cleared with `null`.

`notes` replaces the whole notes field, including what staff wrote. Prefer `add_note`, which appends a dated note signed with your bot name and never replaces anything.

Answer: `{ "status": "updated", "id": "...", "updated": { "stage": { "before": "contacted", "after": "proposal" } }, "skipped": [] }`. `status` is `updated` or `unchanged`. The `updated` list is also saved in the audit log, so staff can see exactly what a bot changed.

## 5. Read and add people

People are the contacts in the database: property managers, pastors, owners, agents. Residential homeowners are in this list too, so use `type` to filter. People who belong to a subcontractor company are never returned.

`GET /api/bot/sales/people`, `GET /api/bot/sales/people/{id}`

```
curl -s "https://YOUR-SITE/api/bot/sales/people?company_id=COMPANY_ID&can_email=true" -H "Authorization: Bearer $KEY"
```

Filters (all optional): `id`, `q` (searches name, email, position, property), `email`, `type` (see `allowed_values.contact_types`), `company_id`, `property_id`, `can_email` (true or false), `contacted` (true or false), `created_since`, `limit`, `cursor`. Also `email_confidence` (`verified` or `pattern_guess`), to pick people whose address is safe to use.

Each person has: `id`, `name`, `first_name`, `last_name`, `email`, `email_confidence` (`verified`, `pattern_guess` or null), `phone`, `phone_type`, `phone2`, `phone2_type`, `position`, `role`, `type`, `team_office`, `street`, `unit`, `city`, `state`, `zip`, `notes`, `company` (`id`, `name`), `property` (`id`, `name`), `can_email`, `blocked_reason` (null, or `no_email`, `suppressed`, `opted_out`, `bounced`, `left_company`, `do_not_contact`, `company_do_not_contact`), `touches` (`count`, `last_at`, `last_outcome`), `created_at`. Billing details are never included.

`POST /api/bot/sales/people` adds a person:

```
curl -s https://YOUR-SITE/api/bot/sales/people \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: person-dana-reyes-2026-10-24" \
  -d '{"name": "Dana Reyes", "email": "dana@hopepg.com", "position": "Regional Manager", "type": "Multi-Family", "company_id": "COMPANY_ID"}'
```

Give a name (or `first_name` and `last_name`), or at least an email. Allowed fields: `name`, `first_name`, `last_name`, `email`, `email_confidence`, `phone`, `phone_type`, `phone2`, `phone2_type`, `position`, `role`, `type`, `team_office`, `street`, `unit`, `city`, `state`, `zip`, `company_id`, `property_id`, `notes`. Phone types are `office`, `direct`, `mobile`, `home`, `main`, `other`. Say whether an email is `verified` (confirmed, for example from the person or a reply) or a `pattern_guess` (built from the company's email pattern), because guesses bounce more. Link the person with `company_id` and `property_id` (ids from the lists). A person linked to a property gets the role `Property Contact` unless you give one.

Answer: `{ "status": "created", "id": "...", "matched_on": null, "can_email": true, "blocked_reason": null, "similar": [] }`. Like prospects, `status` is `created` (HTTP 201) or `duplicate` (HTTP 200, nothing overwritten). A duplicate is the same email, or with no email the same name at the same company or property. `similar` lists people with the same name or phone, for you to look at.

`PATCH /api/bot/sales/people/{id}` changes any field on an existing person. Same fields as adding, plus `add_note`, `blocked_reason` and `shared_email` (true or false). Send `null` to clear an optional field; `name`, `blocked_reason` and `email_confidence` cannot be cleared. `email_confidence` can move from `pattern_guess` to `verified`, but a bot cannot downgrade a `verified` address. `blocked_reason` (`bounced`, `left_company` or `opted_out`) records why a person cannot be emailed, and it blocks automated email at once. A bot can set it but cannot clear it; staff clear it. An email that already belongs to someone else is refused with 409 `email_in_use` and the other person's id. The answer has the same shape as a prospect update.

## 6. Read and add companies

Companies are management companies, ownership groups, REITs and developers. Subcontractors are in the same table but are never returned and cannot be created here.

`GET /api/bot/sales/companies`, `GET /api/bot/sales/companies/{id}`

Filters (all optional): `id`, `q`, `type` (see `allowed_values.company_types`), `city`, `state`, `email` (the company's contact email or any of its people's), `created_since`, `limit`, `cursor`.

A company marked do not contact by staff shows `do_not_contact: true` with its reason. That stops outreach to every property and person under it, so check `can_email` and `blocked_reason` before you write to anyone there.

Each company has: `id`, `name`, `type`, `street`, `unit`, `city`, `state`, `zip`, `contact_name`, `contact_email`, `contact_phone`, `notes`, `people_count` and `people` (up to 25), `properties_count` and `properties` (up to 25, with `stage`), `touches` (with its people and properties: `count`, `last_at`, `last_outcome`), `created_at`.

`POST /api/bot/sales/companies` adds one (only `name` is required). Allowed fields: `name`, `type`, `street`, `unit`, `city`, `state`, `zip`, `contact_name`, `contact_email`, `contact_phone`, `notes`. Same name at the same street is a `duplicate`; with a street missing on one side, the same city; with neither to compare, the name alone.

`PATCH /api/bot/sales/companies/{id}` changes any field, and `add_note` appends a note. Send `null` to clear an optional field (everything except `name`). Same answer shape as above.

## 7. Follow up lists (the Sales page)

The lists and scorecard staff see on the Sales page. `GET /api/bot/sales/follow-up`

```
curl -s "https://YOUR-SITE/api/bot/sales/follow-up?limit=25&stalled_days=14" -H "Authorization: Bearer $KEY"
```

Filters (optional): `limit` (1 to 100, default 25, per list), `stalled_days` (1 to 365, default 14).

The answer has four lists, each `{ "count": N, "items": [...] }`, where every item has the prospect `id` and `name` (fetch the full record with `GET /prospects/{id}`):

- `overdue`: a next step with a date that has passed.
- `no_next_step`: contacted or at proposal, with nothing planned.
- `stalled`: contacted or at proposal and quiet for `stalled_days` or more (`quiet_days`).
- `try_again`: lost prospects whose try again date has arrived (`reengage_at`, `lost_reason`).

It also has `scorecard`: `overall`, `by_vertical` and `by_source`, each with `prospects`, `reached`, `replied`, `estimates` and `won`. Work these lists top down, and use `PATCH /prospects/{id}` to set the next step once you have acted.

## 8. Log outreach

Record every touch you make, so staff and other bots can see it. `POST /api/bot/sales/outreach`

The shortest valid call says "I emailed this person". Channel defaults to `email` and outcome to `sent`:

```
curl -s https://YOUR-SITE/api/bot/sales/outreach \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: touch-zion-2026-10-23-intro" \
  -d '{"email": "ann@zion.org"}'
```

A fuller call, with everything spelled out:

```
curl -s https://YOUR-SITE/api/bot/sales/outreach \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: touch-zion-2026-10-23-visit" \
  -d '{
    "prospect_id": "PROSPECT_ID",
    "channel": "visit",
    "outcome": "connected",
    "note": "Talked to the office manager, wants a roof inspection",
    "sent_at": "2026-10-23T14:30:00Z"
  }'
```

Fields:

- `prospect_id`, `person_id` or `email`: at least one is required. `person_id` logs the touch on that person, and on their prospect when they belong to one. A person does not need a prospect. An email must match exactly one prospect or person. If it matches none (404) or several (409, with `prospect_ids` and `person_ids`), you get an error, so use an id when you have it. Sending `prospect_id` with a `person_id` from a different prospect is refused (422 `person_not_at_prospect`).
- `channel`: `email` (default), `call`, `text`, `mail`, `visit`, `other`.
- `outcome`: `sent`, `connected`, `replied`, `bounced`, `interested`, `not_interested`, `unsubscribed`, `no_answer`, `voicemail`, `meeting_set`, `wrong_contact`, `note`. Defaults to `sent` for `email`, `text` and `mail`. For `call`, `visit` and `other` you must say what happened.
- `direction`: `outbound` (default) or `inbound`. A `replied` outcome defaults to `inbound`.
- `note`: short free text.
- `sent_at`: ISO time, defaults to now.

Answer: `{ "status": "logged", "touch_id": "...", "prospect_id": "...", "person_id": "...", "effects": [...] }`. `prospect_id` or `person_id` is null when the touch is not tied to one. `effects` lists what the platform did because of the outcome. A touch with no prospect never changes prospect fields, and a touch at a company is logged on the person you reached there.

### Logging many at once

Send up to 25 touches in one call. Put them in a `touches` list and nothing else in the body:

```
curl -s https://YOUR-SITE/api/bot/sales/outreach \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: batch-2026-10-23-a" \
  -d '{"touches": [
    {"email": "ann@zion.org"},
    {"email": "pastor@grace.org", "channel": "call", "outcome": "voicemail"}
  ]}'
```

The answer is HTTP 200 with one result per touch, in order, each with its `index`: `{ "results": [ { "index": 0, "ok": true, "status": "logged", ... }, { "index": 1, "ok": false, "http_status": 404, "code": "unknown_prospect", ... } ], "summary": { "total": 2, "ok": 1, "failed": 1 } }`. One bad touch never blocks the others. Check each result.

- Every touch counts toward your rate limit, the same as if you had sent them one at a time. If you hit the limit, the rest come back as `skipped` and the `Retry-After` header says how long to wait. Resend only those.
- The Idempotency-Key covers the whole batch (up to 120 characters). Touch number N uses `<key>:N`, so resending the same batch will not log anything twice.
- A bad or revoked key refuses the whole request, as usual.

### What each outcome does

- `sent`, `connected`, `voicemail`, `replied`, `interested`, `not_interested`, `unsubscribed`, `meeting_set`: counts as contact. Updates last contacted, and moves a prospect still at `prospecting` to `contacted` (when the touch has a prospect).
- `replied`, `interested`, `meeting_set`: also stops any platform email sequence for that address and sets the prospect's next action note so staff follow up.
- `not_interested`: stops platform sequences for that address. The address is not suppressed.
- `unsubscribed`: suppresses the address, stops sequences, and opts the contact out of automated email. Never email them again.
- `bounced`: suppresses the address. Does not count as contact.
- `no_answer`, `wrong_contact`, `note`: logged only. Use `note` to leave an observation (for example "looks vacant") that is not a contact.

## 9. Read outreach history

What has already happened with a prospect, person, company or address, so you do not contact someone twice. `GET /api/bot/sales/outreach`

```
curl -s "https://YOUR-SITE/api/bot/sales/outreach?prospect_id=PROSPECT_ID" -H "Authorization: Bearer $KEY"
curl -s "https://YOUR-SITE/api/bot/sales/outreach?email=ann@zion.org" -H "Authorization: Bearer $KEY"
curl -s "https://YOUR-SITE/api/bot/sales/outreach?person_id=PERSON_ID" -H "Authorization: Bearer $KEY"
curl -s "https://YOUR-SITE/api/bot/sales/outreach?company_id=COMPANY_ID" -H "Authorization: Bearer $KEY"
```

Filters (all optional): `prospect_id`, `person_id`, `company_id`, `email`, `channel`, `outcome`, `source`, `since` (ISO date), `limit` (1 to 200, default 50), `cursor`. Use only one of `prospect_id`, `person_id`, `company_id` or `email`. With none of them, you get the latest history across everything.

- `prospect_id` returns everything for that prospect and the people linked to it.
- `person_id` returns everything for that person.
- `company_id` returns everything for the company, its properties, and everyone linked to the company or those properties.
- `email` returns exactly that address: touches sent to it, and touches logged for the person who holds it.
- `source` is `touch` (logged by a bot, including you), `staff` (logged by staff by hand, shown with `by` set to `Staff` and no note, so you do not contact someone staff already reached), or `sequence` (sent earlier by the platform's email sequences, with replies and bounces).
- `outcome` takes any outcome from section 8, plus `opened` and `clicked` for sequence emails.

Newest first. Each item:

```
{ "id": "...", "at": "2026-10-21T14:05:00Z", "source": "touch", "channel": "email",
  "direction": "outbound", "outcome": "sent", "summary": null, "note": "Intro email",
  "by": "church-bot", "email": "ann@zion.org",
  "prospect": { "id": "...", "name": "Zion Lutheran Church" },
  "person": { "id": "...", "name": "Ann Fox" } }
```

`by` is the bot name for a touch and the sequence name for a sequence event. `summary` is the subject line for a sequence email. `prospect` and `person` are null when the touch is not tied to one. Paging works the same as for prospects (`next_cursor`).

Staff email is never part of this. It covers bot touches, staff touches (without their notes) and past platform sequence activity only.

## Rules for bots

1. Check `can_email` before sending any email. If it is false, do not email that person. `do_not_contact` means no contact of any kind.
2. Always send an `Idempotency-Key` (8 to 128 characters: letters, numbers, `_ . : -`) on every POST. If a request times out, resend it with the same key and body. It will not be applied twice. Reusing a key with a different body returns 422 `idempotency_conflict`.
3. Log every touch, including bounces, unsubscribes, and replies, as soon as they happen. Before you contact someone, check their history (section 9) and skip anyone already reached recently.
4. Page with `next_cursor`. Do not fetch faster than your rate limit.
5. On 429, wait the number of seconds in the `Retry-After` header.
6. Your own outgoing email is sent from your own mailbox, not the platform. It must include an unsubscribe option and our postal address (CAN-SPAM). When someone unsubscribes, log `unsubscribed` right away.
7. Do not scrape or guess. Only add organizations and people you have a real reason to contact.
8. Look before you add. Search `people`, `companies` and `prospects` first. The duplicate checks catch the obvious cases, but a record you found yourself is always better than a new one.
9. Edits replace staff entries. Before you overwrite a value that looks deliberate, read the record first and say why in `add_note`. `skipped` now only appears for `email_confidence`, which a bot cannot lower from `verified`.
10. Never email anyone whose `can_email` is false, whichever list you found them in. `blocked_reason` says why.
11. Test records (fake people, companies and properties staff have marked as tests) never appear in any answer and cannot be reached by id. Do not try to work with them.

## Errors

Errors look like `{ "code": "...", "error": "human readable message" }`, sometimes with an `allowed` list.

| HTTP | code | Meaning |
|------|------|---------|
| 400 | `invalid_json` | Body is not valid JSON |
| 401 | `unauthorized`, `key_expired` | Missing, wrong, or revoked key, or an expired key |
| 403 | `forbidden` | Key does not have the sales scope |
| 404 | `unknown_prospect`, `unknown_person`, `unknown_company`, `not_found` | No record with that id, or (logging) no prospect or person with that email. Add it first. `not_found` is the answer to GET on one record |
| 405 | | A method that is not offered. There is no DELETE anywhere |
| 409 | `ambiguous_prospect`, `email_in_use` | The email matches several records (use an id), or a person update would give someone an email another person already has |
| 413 | `too_large` | Body over 50,000 characters |
| 422 | `unknown_field`, `unknown_filter`, `invalid_field`, `invalid_filter`, `invalid_filters`, `invalid_body`, `invalid_id`, `person_not_at_prospect`, `invalid_idempotency_key`, `idempotency_conflict` | A field or value is wrong, or an Idempotency-Key was reused with a different body. Read `error` and `allowed` |
| 429 | `rate_limited` | Too many requests. See `Retry-After` |
| 500 | `server_error` | Our side. Retry later |
| 503 | `not_configured` | Migration 161 (or 162 for history, 163 for the newer logging, 166 for people, companies and updates, 167 for the newer people fields, won prospects and test records) has not been run |

Rejected requests (422) count toward your rate limit, so fix the request instead of retrying it unchanged.

## Staff view

Settings, then Bots, shows each key with its last use, 24 hour call count, prospects, people and companies added, touches logged, and a recent activity list. Everything a bot adds is marked in the database with `created_by_bot_id`, so it can be reviewed or removed by an owner. Every change a bot makes to an existing record is saved in the audit log with the value before and after.

Every touch a bot logs, every sequence email, and mail from a connected mailbox shows in the Touches section of the Person, Property and Company popups. A touch on a person also shows on their property and company, labeled with the person's name.
