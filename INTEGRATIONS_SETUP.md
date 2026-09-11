# Integrations setup

Covers Settings → Integrations: Google Calendar, Microsoft Calendar, QuickBooks
Online, Resend, and Weather. Run **migration 087** first
(`supabase-migration-087-integrations.sql`, Supabase SQL Editor).

## 1. One env var everything needs

Generate a 32-byte key and add it in Vercel (Project → Settings →
Environment Variables):

```
openssl rand -hex 32
```

```
INTEGRATION_ENCRYPTION_KEY=<the output above>
```

This encrypts every OAuth token and API key before it's stored in Supabase.
**Do not lose or rotate it** — doing so invalidates every connection and
saved key; everyone would need to reconnect / re-enter keys.

Also confirm these already exist (they should, from earlier phases):
`SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL` (should be
`https://jobs.mcloudconstruction.com`), `CRON_SECRET`.

---

## 2. Google Calendar

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → create
   a project (or use an existing one).
2. **APIs & Services → Library** → enable the **Google Calendar API**.
3. **APIs & Services → OAuth consent screen** → External → fill in the app
   name/support email → add your own email as a test user (keeps it out of
   Google's verification review while you're the only one connecting).
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   → Application type: **Web application**.
5. Under **Authorized redirect URIs**, add exactly:
   `https://jobs.mcloudconstruction.com/api/integrations/google/callback`
6. Copy the Client ID and Client Secret into Vercel:

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

7. In Settings → Integrations, click **Connect** next to Google Calendar.

---

## 3. Microsoft Calendar

1. Go to [Azure Portal → App registrations](https://portal.azure.com/) →
   **New registration**.
2. Name it anything; under **Supported account types**, choose "Accounts in
   any organizational directory and personal Microsoft accounts" (this is
   what lets both a personal Outlook.com account and a work Microsoft 365
   account sign in).
3. **Redirect URI**: platform **Web**, value:
   `https://jobs.mcloudconstruction.com/api/integrations/microsoft/callback`
4. **Certificates & secrets → New client secret** → copy the value
   immediately (it's only shown once).
5. **API permissions → Add a permission → Microsoft Graph → Delegated
   permissions** → add `Calendars.ReadWrite`, `User.Read`, `offline_access`.
6. Copy the Application (client) ID and the secret value into Vercel:

```
MICROSOFT_CLIENT_ID=...
MICROSOFT_CLIENT_SECRET=...
```

7. In Settings → Integrations, click **Connect** next to Microsoft Calendar.

---

## 4. QuickBooks Online

1. Go to [Intuit Developer](https://developer.intuit.com/) → sign in → **My
   Apps → Create an app** → QuickBooks Online and Payments.
2. Under **Keys & OAuth**, add this exact redirect URI (both the
   Development and Production keys tab have their own redirect URI field —
   add it to whichever key set you're using):
   `https://jobs.mcloudconstruction.com/api/integrations/quickbooks/callback`
3. Copy the Client ID / Client Secret into Vercel. Set `QBO_ENVIRONMENT` to
   match which keys you used:

```
QBO_CLIENT_ID=...
QBO_CLIENT_SECRET=...
QBO_ENVIRONMENT=production
```

(Use `sandbox` + the Development keys to test against Intuit's sandbox
company first, if you'd rather not connect the real books right away.)

4. **Invoice sync requires an existing Product/Service item in QBO** —
   QuickBooks has no way to post a bare dollar amount, every invoice line
   needs to reference an item. Every new QBO company ships with a default
   item named "Services"; if yours is named something else, set:

```
QBO_DEFAULT_ITEM_NAME=Your Item Name
```

5. In Settings → Integrations, click **Connect** next to QuickBooks Online.
6. On a draw invoice's document page, an admin will see a **"Sync to
   QuickBooks"** button — it creates (or updates, on re-sync) the matching
   customer and invoice in QBO.

---

## 5. Resend (email)

No developer console steps beyond creating a [Resend](https://resend.com)
account and verifying your sending domain there (same domain you're already
using for Vercel DNS — `mcloudconstruction.com`, likely under a subdomain
like `send.mcloudconstruction.com`, same pattern as the existing setup).

1. Resend dashboard → **API Keys → Create API Key**.
2. In Settings → Integrations, paste it into the Resend field and **Save**.

Once saved, all app email (estimates, contracts, invoices, automations)
sends through Resend instead of the SMTP server. Removing the key falls
back to SMTP automatically — nothing else needs to change.

---

## 6. Weather

1. Create a free account at [OpenWeatherMap](https://openweathermap.org/api)
   → **API keys** tab → copy the default key (new keys can take up to an
   hour to activate).
2. In Settings → Integrations, paste it into the Weather field, optionally
   set a default zip code, and **Save**.

---

## 7. Calendar sync — how it runs

- Automatically every 2 hours via Vercel Cron (`/api/cron/calendar-sync`,
  see `vercel.json`). **Note:** Vercel's Hobby plan only allows one cron
  run per day regardless of the schedule set — if you're on Hobby, either
  upgrade to Pro or rely on the manual button below.
- Manually anytime via the **"Sync calendar now"** button in Settings →
  Integrations.

What it does each run, per connected staff member:
- **Push**: any job with a Scheduled Start Date in the last 30 days or the
  future gets created/updated as an all-day event on their calendar.
- **Pull**: events in the next 60 days from their personal calendar are
  cached and shown as small "N personal" badges on the internal Job
  Calendar (`/jobs/calendar`) — titles are visible on hover, but no other
  detail is pulled in.

Only the account owner can currently connect a calendar, since Settings is
an owner-only page — extending this to other staff roles would need a
small "My Account" page outside Settings, separate from this phase.
