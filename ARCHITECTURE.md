# Architecture

How Co-operator fits together, in the order it matters. `DECISIONS.md` records
*why* each of these is the way it is, including what was rejected.

---

## The shape of the thing

A Next.js App Router application, TypeScript in strict mode, Prisma against
PostgreSQL, Auth.js with email magic links, deployed to Vercel. No AI anywhere
in the product: no drafted minutes, no extracted certificate fields, no
summaries. A board acting on a filing deadline needs a record it can point at,
not a paraphrase.

```
src/
  app/                      routes only — no queries, no business rules
    b/[buildingSlug]/       everything tenant-scoped lives under here
    invite/[token]/         redemption, the one pre-membership page
    api/cron/run/           the single daily job
    api/webhooks/resend/    delivery receipts
  components/
    elevation/              the building as a live object
    patterns/               shell, header, buttons, status chip
  lib/
    auth/                   session, capabilities, invitations
    db/
      context.ts            slug + user → BuildingContext
      tx.ts                 the four transaction scopes
      visibility.ts         building-wide vs unit-scoped, as where-fragments
      scoped/               every query in the system
    primitives/             obligations, shares, ledger, approvals, prerequisites
    compliance/             the applicability DSL and the generator
    email/                  mailer drivers, and send.ts which logs before sending
    storage/                presigned PUT/GET behind an interface
    time.ts money.ts        the two things that are wrong everywhere else
prisma/
  schema.prisma             the domain, one file
  migrations/               includes the generated RLS policies
  seed/                     two buildings, always
scripts/generate-rls.ts     derives policies from the live schema
tests/                      tenancy, arch, primitives, module lifecycles, e2e
```

---

## Multi-tenancy

The part that must not be got wrong. `Building` is the tenant root; every tenant
table carries a non-nullable, indexed `buildingId`, including join tables.

**The tenant is in the URL, never on the session.** `/b/[buildingSlug]/…`. The
layout at `src/app/b/[buildingSlug]/layout.tsx` resolves a `BuildingContext`
once; pages re-request it through `getBuildingContext`, which is memoised for
the render pass.

**Nothing outside `src/lib/db/scoped/` imports Prisma.** Not a route handler,
not a Server Action, not a page, not a component. Every function in that
directory takes a `BuildingContext` as its first argument. `tests/arch/
no-direct-prisma.test.ts` fails the build if that is violated, and ESLint
blocks the import path.

**Three layers, one of them the real defence.**

| Layer | What it does |
| --- | --- |
| The path | The tenant is explicit and visible |
| The application | `scoped/*` is the only code that queries; context first |
| Postgres RLS | A policy on all 37 tenant tables, plus `FORCE ROW LEVEL SECURITY` |

The application layer is the defence. RLS is what catches the mistake. A team
that believes RLS is the defence writes sloppier queries.

**Two database roles.** Postgres exempts a table's owner from RLS, so an app
connecting as the owner has policies that do nothing. Migrations run as
`cooperator_owner` (`DIRECT_URL`); requests run as `cooperator_app`
(`DATABASE_URL`), which owns nothing and holds no `BYPASSRLS`. Append-only
tables — `AuditLog`, `Charge`, `Payment` — are enforced by withholding UPDATE
and DELETE from that role, so "append-only" survives a developer reaching for
`prisma.auditLog.update` at 11pm.

### The four transaction scopes

All of them live in `src/lib/db/tx.ts`, and they are the only code that sets a
Postgres GUC. Everything uses `SET LOCAL`, so a setting dies with its
transaction and cannot ride a pooled connection into the next request.

| Wrapper | Setting | What it can see |
| --- | --- | --- |
| `withBuildingTx(id)` | `app.current_building_id` | One building. The workhorse. |
| `withMemberBootstrapTx(userId)` | `app.current_user_id`, then `app.member_building_ids` | This user's own memberships, then the buildings they proved membership in. Sign-in only. |
| `withJobTx()` | `app.job_scope='all_buildings'` | SELECT on `Building` and `Notification`. Nothing else. |
| `withInvitationTokenTx(hash)` | `app.invitation_token_hash` | Exactly one invitation: the one whose token the caller can present. |
| `withUntenantedTx()` | none | Auth.js user/session/token tables and the shared ruleset — tables with no tenant at all. |

Everything fails closed. A query issued outside a wrapper compares against NULL,
matches nothing, and returns an empty result. The failure mode of forgetting the
wrapper is an empty page, never another building's data.

**The policies are generated, not hand-written.** `scripts/generate-rls.ts`
reads the live schema and applies one rule — every table with a `buildingId`
gets tenant isolation — plus the named exceptions above. The same query backs
`tests/tenancy/coverage.test.ts`, so adding a tenant table without a policy
fails by name and prints the command that fixes it.

**The seed always creates two buildings** with overlapping-looking data: similar
unit labels, similar dates, one person who is a member of both. A single-tenant
seed cannot fail an isolation test.

---

## Identity and permissions

**Roles are a set on `Membership`, not a type of user.** In a twelve-unit
building the treasurer is also a shareholder with an apartment and an alteration
request of their own. `Membership.roles` is `Role[]`.

**Capabilities are derived from roles in one file** —
`src/lib/auth/capabilities.ts` — and nothing else in the codebase branches on a
role name. `can(ctx, "…")` for rendering, `assertCan(ctx, "…")` for writes.

**Two scoping tiers are kept distinct.** `src/lib/db/visibility.ts` returns
where-fragments rather than booleans, so the distinction is enforced in the
query rather than remembered at each call site:

- *Building-wide* — compliance, insurance, the calendar. Everyone sees it.
- *Unit-scoped* — arrears, alterations, sublets, tickets. A shareholder sees
  their own; an officer with the matching capability sees all.

`arrears.viewAll` belongs to the treasurer and the president only. In a
twelve-unit building that is one or two people, and who is behind on maintenance
is the most socially explosive fact the system holds.

---

## The primitives

Seven, built before any module, each with tests that found real bugs.

1. **Obligations** (`primitives/obligations/recurrence.ts`) — four explicit
   recurrence types (`NONE`, `FIXED_INTERVAL`, `CYCLICAL_BY_YEAR`,
   `ANCHORED_TO_COMPLETION`), never cron strings. Status is *derived* from due
   date and state, never stored, so nothing can go stale. An unanswerable
   question returns `indeterminate` rather than a guess.
2. **Documents** — expiry is a first-class field, and an expiring document
   generates a calendar obligation. Storage is behind an interface; uploads are
   presigned PUTs namespaced `buildings/{buildingId}/{entity}/{id}/{filename}`.
   There is no public URL and no stable document link anywhere in the product.
3. **Share register** (`primitives/shares.ts`) — dated `ShareAllocation` and
   `UnitHolding` records. There is no `shares` column on `Unit`, so a quorum
   computed for a 2021 meeting still uses the 2021 numbers. Thresholds are exact
   fractions compared by cross-multiplication, because two-thirds of 1200 is
   exactly 800 and basis points make it 801.
4. **Ledger** (`primitives/ledger.ts`) — append-only, integer cents, no floats.
   A correction is a reversing entry. Aging applies payments to the oldest
   charge first, and a credit produces all-zero buckets rather than a negative
   one.
5. **Bookable resources** (`primitives/prerequisites.ts`) — a checker registry,
   so "deposit paid, valid COI, no arrears" is data rather than an `if`. A COI
   is checked against the booking date, not today.
6. **Notification log** (`email/send.ts`) — the record is written *before*
   dispatch, with the rendered text stored verbatim. It is evidence that a
   legally required notice was sent, so it must survive the provider being down.
   `dedupeKey` carries idempotency.
7. **Approvals** (`primitives/approvals.ts`) — one state machine with an
   explicit transition table, shared by alterations, sublets and anything else
   that needs a decision with a reason attached.

Plus an **audit log**: every state change writes an entry naming the actor, the
action (the same dotted string as the capability that authorised it), and a
human summary.

---

## Compliance

The ruleset lives in seed data (`prisma/seed/rules/ruleset.ts`), not in code.
Seventeen rules, each with a citation and a source URL; thirteen are flagged
`needsVerification: true` with a specific note saying what to check. There are
no hardcoded conditionals like `if (units > 6)` anywhere.

Applicability is a small predicate DSL (`compliance/applicability.ts`) evaluated
against the building's attributes, returning a decision *with its reasoning* —
which inputs it read, and what it concluded. A null attribute never satisfies a
threshold: an unknown boiler type is not a boiler exemption.

**Nothing reaches a building's calendar automatically.** The engine proposes;
a board member confirms or dismisses, and a dismissal keeps its reason. That
review step is the product's position on the difference between "the law
probably applies to you" and "your building owes this on this date".

The persistent disclaimer is on every page and is not dismissible.

---

## Cross-cutting rules

- **Time.** `America/New_York`, always, from `src/lib/time.ts`. Legally
  date-only fields are `@db.Date` and never a timestamp. `PlainDate` is a
  branded string; timestamps convert to a calendar day through the building's
  timezone, never the server's.
- **Money.** Integer cents everywhere. No floats.
- **Email.** Everything goes through the notification log. `EMAIL_DRIVER=catcher`
  writes `.eml` files to `./.mail` and never opens a socket; seed data contains
  plausible addresses at real domains, and a development run that mails them is
  not a mistake anyone gets to make twice.
- **Jobs.** One idempotent daily run at `/api/cron/run`, authenticated with a
  shared secret compared in constant time. Re-running it is a no-op.
- **Errors.** Nothing is swallowed. Server Actions return a typed
  `Result<T>` — `{ ok, code, message, fields }` — so a form can put an error on
  the field it belongs to.
- **Configuration.** `src/lib/env.ts` validates at boot and fails loudly, naming
  every missing variable at once. Conditional requirements (a Resend key only
  when Resend is selected) are in the schema.

---

## Testing

| Suite | What it proves |
| --- | --- |
| `tests/tenancy/isolation.test.ts` | The scoped query layer never crosses buildings |
| `tests/tenancy/rls.test.ts` | The database refuses too, via raw SQL as the app role |
| `tests/tenancy/coverage.test.ts` | Every tenant table has a policy |
| `tests/arch/*` | Nothing imports Prisma directly; scaffolds admit what they are |
| `tests/primitives/*` | Recurrence, shares, ledger, approvals, prerequisites |
| `tests/compliance`, `tests/alterations`, `tests/auth` | Module lifecycles against a real database |
| `tests/e2e/smoke.spec.ts` | Invite → accept → calendar → file, in a real browser |

The tenancy suite has been mutation-tested: breaking unit scoping fails eight
tests, removing the tenant setting fails the seed and the suite, and adding a
tenant table without a policy fails three tests that name the table.

Unit tests run against a real Postgres. There is no in-memory substitute that
exercises row-level security, and RLS is half of the guarantee.

---

## What is deliberately not here

Purchase and board-package applications. Payment processing — payments are
*recorded*, never collected, and there is no Stripe, ACH or card field anywhere
in the schema. Accounting or a general ledger. A native mobile app. Real-time
anything: no websockets, no live cursors. And no AI features.
