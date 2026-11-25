Chat assistant, jobs app (deploy this one FIRST)

1. Run supabase-migration-181-chat-and-consult-booking.sql in the Supabase SQL editor (safe to run twice).
2. In the jobs Vercel project add env var CHAT_SHARED_SECRET (16+ random characters; the website needs the identical value). Optional: CHAT_DAILY_MESSAGE_CAP (default 3000).
3. Copy the files in this zip over the repo (same paths), commit, deploy.
4. Open Settings > Consultations. Turn on booking, check the weekly hours, and add blackouts (Thanksgiving Nov 26, Christmas, etc.). Until it is turned on, the bot answers questions and takes callback details but does not book.
