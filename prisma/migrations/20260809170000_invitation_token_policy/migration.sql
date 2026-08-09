-- Invitation redemption scope.
--
-- Someone following an invitation link has, by definition, no membership in the
-- building yet. There is no tenant to resolve, so tenant_isolation hides the one
-- row that is about to grant them one.
--
-- The scope is a single row wide. The policy matches on the token hash the
-- caller has already presented, so a session that sets this setting sees only
-- the invitation it can produce a token for — enumeration is impossible, and so
-- is reading anything else in the building. Redemption resolves the building
-- from that row and does the rest of its work inside withBuildingTx.
--
-- Rejected: adding Invitation to the background job scope. That would make
-- every invitation in every building readable by any code path that opens a job
-- transaction, to serve a lookup that already knows exactly which row it wants.

DROP POLICY IF EXISTS invitation_by_token ON "Invitation";
CREATE POLICY invitation_by_token ON "Invitation"
  FOR SELECT
  USING (
    "tokenHash" = NULLIF(current_setting('app.invitation_token_hash', true), '')
  );
