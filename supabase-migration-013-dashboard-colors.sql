-- Run in Supabase SQL Editor after migration 012. Safe to re-run.

alter table app_settings add column if not exists dashboard_widgets jsonb not null default '{}';
-- Empty object means "show everything" — the app treats any missing key as true.
-- Keys: sold_job_count, job_counts_by_stage, customer_questions,
-- overdue_opportunities, total_ar, total_paid, revenue_ytd, revenue_mtd,
-- total_profit, sales_route_ai, new_opportunity_button

alter table app_settings add column if not exists color_section_heading text not null default '#9b773d';
alter table app_settings add column if not exists sidebar_inactive_text text not null default '#49402a';
alter table app_settings add column if not exists sidebar_active_bg text not null default '#49402a';
alter table app_settings add column if not exists sidebar_active_text text not null default '#f2ede1';
alter table app_settings add column if not exists signout_hover_bg text not null default '#302a1a';
