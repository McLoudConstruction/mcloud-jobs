-- Run this in Supabase SQL Editor, replacing the email below with the
-- actual test customer email that's seeing too much. This checks the
-- three most likely real causes, since the RLS policies themselves are
-- structurally correct (verified by reading every migration that's ever
-- touched them) — the issue is very likely one of these three things,
-- not a policy gap:

-- 1. Does this email's auth account have admin role set? If so, the
--    "Admin can do everything" policy applies to them regardless of
--    anything else — this is the single most likely cause, since it
--    would exactly explain "sees every job."
select id, email, raw_app_meta_data->>'role' as role
from auth.users
where email = 'PUT_TEST_EMAIL_HERE';

-- 2. Does this email appear as customer_email or billing_email on more
--    than one job? (A real match per the policy, not a bug — just more
--    jobs than expected got that email on them.)
select id, job_number, estimate_number, customer_name, customer_email, billing_email
from jobs
where customer_email = 'PUT_TEST_EMAIL_HERE' or billing_email = 'PUT_TEST_EMAIL_HERE';

-- 3. Does this email have portal access granted on more than one job
--    via the newer multi-contact system?
select jpa.job_id, j.job_number, j.estimate_number, j.customer_name, jpa.portal_access
from job_portal_access jpa
join jobs j on j.id = jpa.job_id
where jpa.email = 'PUT_TEST_EMAIL_HERE';
