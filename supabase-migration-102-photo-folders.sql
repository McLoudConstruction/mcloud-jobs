-- Photos tab: folder capability when uploading, so photos on a job can
-- be grouped (e.g. "Before", "Framing", "Punch List") instead of one
-- flat list. Null/empty folder = "General".
alter table job_photos add column if not exists folder text;
