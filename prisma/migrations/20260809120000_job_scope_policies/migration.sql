-- Background job scope.
--
-- Two things in this system genuinely span every building: the daily reminder
-- run, which must find work in all of them, and the Resend delivery webhook,
-- which arrives knowing a provider message id and nothing else. Both need to
-- answer "which building?" before any scoped work can begin, and neither has a
-- tenant of its own.
--
-- The grant is the smallest thing that answers that question: SELECT on the
-- tenant registry and SELECT on notifications. Every other table still requires
-- app.current_building_id, so a job resolves the building here and then does
-- its real work inside withBuildingTx per building.
--
-- Rejected: running the cron as the migration role, which owns the tables and
-- would bypass every policy in the system — turning one narrow need into a
-- total exemption.

DROP POLICY IF EXISTS job_building_scan ON "Building";
CREATE POLICY job_building_scan ON "Building"
  FOR SELECT
  USING (current_setting('app.job_scope', true) = 'all_buildings');

DROP POLICY IF EXISTS job_notification_scan ON "Notification";
CREATE POLICY job_notification_scan ON "Notification"
  FOR SELECT
  USING (current_setting('app.job_scope', true) = 'all_buildings');
