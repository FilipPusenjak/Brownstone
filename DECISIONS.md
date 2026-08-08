# Decisions

What was chosen, what was rejected, and where this build disagrees with the
brief. Newest section last.

---

## Tenancy

**`Building` is the tenant root, and the tenant lives in the URL.**
Every page under `/b/[buildingSlug]` resolves a `BuildingContext` in one layout
and nowhere else. Rejected: a "current building" on the session. That makes the
tenant ambient, means two open tabs fight each other, and turns every bug report
into "which building were you looking at?".

**Three layers, and only one of them is the real defence.**
1. The path — the tenant is explicit in the URL.
2. The application — `src/lib/db/scoped/*` is the only code that touches Prisma,
   and every function there takes a `BuildingContext` first.
3. Postgres RLS — a policy on all 37 tenant tables.

The application layer is the defence. RLS is what catches the mistake. Saying
which is which matters, because a team that believes RLS is the defence writes
sloppier queries.

**Two database roles, not one.**
Postgres exempts a table's *owner* from row-level security. An application
connecting as the owner has policies that do nothing whatsoever, and the test
suite would happily pass. So migrations run as `cooperator_owner` and requests
run as `cooperator_app`, which owns nothing and holds no `BYPASSRLS`. Every
table is additionally marked `FORCE ROW LEVEL SECURITY`.

This is verified rather than assumed: an insert attempted as the owner during
development was rejected by the policy, which is how we know it is on.

**Fail closed.** Policies compare `buildingId` against
`current_setting('app.current_building_id', true)`. A query issued outside
`withBuildingTx` has no setting, the comparison is NULL, and it matches nothing.
The failure mode of forgetting the wrapper is an empty page, never another
building's data. `NULLIF` guards the empty string, since `''::uuid` would raise
instead of filtering.

**The RLS migration is generated, not hand-written.**
`scripts/generate-rls.ts` derives policies from one rule — every table with a
`buildingId` gets tenant isolation — by reading the live schema. Hand-writing 37
policy blocks is the process that misses the 38th. The same query backs
`tests/tenancy/coverage.test.ts`, so adding a tenant table without a policy
fails the build by name.

**Rejected: `SET` instead of `SET LOCAL`.** `SET` outlives the transaction, and
on a pooled connection that means one request's tenant leaking into the next
request that borrows the socket. There is a test asserting the setting does not
survive a commit.

**The sign-in bootstrap gets two narrow policies, not a bypass.**
Resolving a slug to a building happens before any tenant is known, and a person
may belong to two co-ops, so that one read legitimately crosses tenants.
Rejected: an RLS bypass role for context resolution — too broad, and it would
become the path of least resistance for anything awkward. Rejected: a policy
with a subquery against `Membership` — policies referencing other RLS tables
recurse in Postgres, and the workaround is a `SECURITY DEFINER` function, which
is a great deal more machinery to get subtly wrong. Instead `member_self` lets
a user read their own membership rows, and `member_bootstrap` lets them read
buildings whose ids that first read already proved. Both are plain column
comparisons.

**Context resolution is separate from session reading.**
`src/lib/db/context.ts` answers "given a user id and a slug, what may this
person see". `src/lib/auth/current.ts` answers "who is making this request".
Splitting them keeps `next-auth` and the request lifecycle out of the tenancy
suite, so a test about a database property never has to stand up an HTTP
session. It also means the isolation tests exercise the real resolver rather
than a stub that would drift.

---

## Permissions

**Roles are a set on the membership; capabilities are derived.**
Straight from the brief, and correct: in a twelve-unit co-op the treasurer *is*
a shareholder. `src/lib/auth/capabilities.ts` is the only file connecting the
two, and call sites check capabilities.

**Unit scoping is a separate tier, and it is the one that matters.**
`visibility(ctx, domain)` returns a Prisma `where` fragment. A member with no
units and no building-wide capability gets `{ unitId: { in: [] } }` — matching
nothing — rather than `{}`, which would show them the whole building. The
easy mistake there is the catastrophic one, so it is written down and tested.

**`arrears.viewAll` belongs to the treasurer and the president. Nobody else.**
Not the secretary, not the board at large, not the super. Which neighbour is
behind on maintenance is the most socially explosive fact this system holds.

---

## Domain modelling

**No `Unit.shares` column.** Share counts come from dated `ShareAllocation`
rows, and holders from dated `UnitHolding` rows. A denormalised "current"
mirror is exactly the field that drifts, and quorum for a 2021 meeting must
still compute the 2021 numbers after a 2024 transfer. Cost: a slightly heavier
read on the units list. Worth it.

**Obligation status is derived, never stored.** A status column goes stale the
first day nobody runs the cron, and a compliance calendar that is quietly stale
is worse than no calendar — people trust it. `dueStatus()` computes from
`dueOn`, `completedOn` and `state` at read time.

**Recurrence is four explicit shapes, not a cron string.** `NONE`,
`FIXED_INTERVAL`, `CYCLICAL_BY_YEAR`, `ANCHORED_TO_COMPLETION`. The last one —
"due five years after the last test that passed" — has no cron expression and is
extremely common in building compliance. When a date genuinely cannot be
computed, `nextDueDate` returns `indeterminate` with a reason, and the board is
asked. It never guesses.

**Applicability is data.** There is no `if (building.stories > 6)` anywhere in
the codebase. Rules carry a predicate over building attributes, evaluated by
`src/lib/compliance/applicability.ts`, which returns a plain-language reason
alongside the verdict.

**An unknown attribute never satisfies a threshold.** A building with no
recorded floor area is not concluded to be exempt from the benchmarking laws;
the reason reads "gross floor area is not recorded". Treating null as zero is
how a compliance product produces a confident wrong answer.

**The ruleset is deployed, not seeded.** `ComplianceRule` rows are reference
data — the same law for every co-op in the city — upserted by `code` via
`pnpm rules:sync`. Seeding them would mean correcting a citation in production
required reseeding tenant data. This is a small departure from the brief's
"lives in seed data"; the ruleset still *lives* in `prisma/seed/rules/ruleset.ts`
and is still seeded in development, it simply also has a deploy path.

**Ledger and audit log are append-only below the application.** The runtime
role is not granted `UPDATE` or `DELETE` on `Charge`, `Payment` or `AuditLog`.
A correction is a reversing entry. An audit log that can be edited is not an
audit log, and enforcing that only in TypeScript means enforcing it until
someone is in a hurry.

---

## Where this disagrees with the brief

**Two status colours, not one.** The brief asks for a single saturated accent
reserved for system status. A compliance product cannot say "action required"
and "expired" in the same colour — telling those apart is the product's entire
job. So there are two, both municipal, both meaning-only: verdigris `#0B6E62`
for action required, stamp red `#A32E24` for overdue and expired. Complete is
deliberately *colourless* — ink and a mark, like an approved permit — which
keeps saturation rare and honest. Flagged to the client; reversible in one file
if they disagree.

**Contractor COIs: no unauthenticated upload path in v1.** Left open by the
client, defaulted conservatively. Officers upload on a contractor's behalf. The
schema already permits a tokenised link later without a migration.

**No AI, anywhere in the product.** Client instruction, recorded as standing.
No LLM extraction of COI fields, no drafted minutes, no summarised tickets, no
"smart" anything. Nothing in the plan had it; nothing will acquire it.

---

## Stack

**TypeScript pinned to 5.9.3, not the native 7.x.** Next 16, React 19, Prisma 7
and Tailwind 4 are already a lot of new surface for a foundation to sit on.

**ESLint pinned to 9.x.** ESLint 10's scope-manager API is ahead of the
typescript-eslint version `eslint-config-next@16` depends on; on 10 the lint run
crashes outright.

**Server Actions for mutations**, per the brief, returning
`Result<T>` rather than throwing. Route handlers only where Server Actions do
not apply: auth, cron, provider webhooks, and presigned upload URLs.

**Development drivers for mail and storage.** No live Resend or R2 credentials
in this environment, so `EMAIL_DRIVER=catcher` writes `.eml` files to `./.mail`
and `STORAGE_DRIVER=local` writes to disk, both behind the same interfaces as
the real adapters. Seed data contains plausible addresses at real domains; a
development run that quietly mails them is a mistake nobody gets to make twice.
`env.ts` refuses to boot in production with either dev driver selected.

**Magic links go through Co-operator's own mailer**, not Auth.js's default
transport, so the catcher applies to sign-in links too. A magic link mailed to a
real address during a seeded dev run is an account takeover.
