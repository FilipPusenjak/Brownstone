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
Postgres exempts a table's _owner_ from row-level security. An application
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
Straight from the brief, and correct: in a twelve-unit co-op the treasurer _is_
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
"lives in seed data"; the ruleset still _lives_ in `prisma/seed/rules/ruleset.ts`
and is still seeded in development, it simply also has a deploy path.

**Ledger and audit log are append-only below the application.** The runtime
role is not granted `UPDATE` or `DELETE` on `Charge`, `Payment` or `AuditLog`.
A correction is a reversing entry. An audit log that can be edited is not an
audit log, and enforcing that only in TypeScript means enforcing it until
someone is in a hurry.

---

## Where this disagrees with the brief

**Status colours: superseded by the client (M6).** The brief asked for one
saturated accent. I argued for two — action and overdue — with complete left
deliberately colourless. The client saw it and chose a four-state progression
instead: **started is yellow, in progress is blue, complete is green**, with
overdue and denied keeping the stamp red a compliance product cannot do
without. Implemented as they asked.

The mapping I chose, which is the part they did not specify and may want to
adjust: submitted → yellow, under review → blue, approved and completed →
green, overdue and denied → red. Draft, withdrawn, upcoming, waived and not-
applicable carry no colour at all, because nothing is being asked of anyone and
a table where every row is coloured is a table where colour means nothing.

Two consequences worth knowing. The hues are darkened — the yellow is a dark
ochre `#8A6A00`, the green a forest `#1E6B3A` — because pure yellow and green
cannot clear 4.5:1 on a light ground, and this product is read by people in
their sixties and seventies. And verdigris was retired _from status_ while
staying the interface accent for buttons, links, focus and the active nav item,
so "the thing you can do" and "the state something is in" never share a colour.

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

---

## Passwords, and why there are two ways in

Co-operator shipped with emailed links and nothing else, on the reasoning that a
three-person board will not configure OAuth and that a password is one more
thing to lose. What that missed is the day the mail does not arrive — an
unverified sending domain, a spam filter, an address that bounces — which is a
board locked out of its own building's record with no way back in. A link is a
fine convenience and a poor sole key. So both exist, and each is the other's
recovery path.

**Password sign-in writes the `Session` row itself** rather than using Auth.js's
`Credentials` provider, which is documented as requiring the JWT session
strategy. Database sessions are not negotiable here: a membership revoked when
somebody sells their apartment has to stop working now, not when a token
expires. `src/lib/auth/sessions.ts` therefore issues the row and sets the same
cookie Auth.js would, and everything downstream reads the same table and cannot
tell which door was used. The two constants that have to match Auth.js — the
cookie's name and the thirty-day idle expiry — are pinned by test.

**scrypt from `node:crypto`**, at OWASP's baseline parameters, rather than
bcrypt or argon2. Both of those arrive as native modules that must compile for
the deployment target; scrypt is memory-hard, ships with the platform, and adds
nothing to the supply chain. Each digest records the parameters it was made
with, so raising the cost later does not invalidate every password already set.

**There is no open sign-up.** An account exists to hold a membership, and
memberships come from invitations, so the invitation is where the account gets
made — one page, a name and a password, no second email to wait for. A public
sign-up form would also be a way to claim an address before the board invites
it: register the incoming owner's address today, and the email binding in
`acceptInvitation` hands over their apartment tomorrow.

**An invitation may create an account and may never touch an existing one**, not
even one with no password set. A board in one building can invite any address it
likes; if that address already belongs to a member of another building, letting
the token set a password on it would be a cross-building takeover with a form in
front of it. The rule is flat and needs no case analysis.

**A wrong password costs time and never locks the account.** Lockout is a denial
of service anybody can trigger by knowing an address. Five consecutive failures
are free, and after that the wait grows to a fifteen-minute cap — four attempts
an hour against a scrypt digest is not a rate that finds a twelve-character
password, and the real owner waits minutes at worst. `signInFailures` and
`signInBlockedTill` live on `User` because a serverless deployment has no
in-process memory to keep them in.

**Setting the first password does not ask for a current one**, because the
session that got here came from an emailed link — the same proof a reset email
would demand. Changing one does, because an unattended laptop is how a session
ends up in the wrong hands. Either way every _other_ session is ended and this
one is left alone: deleting the caller's own row and issuing a replacement looks
equivalent and is not, since the rest of the request still carries the old token
and the page behind the form decides nobody is signed in.

**`pnpm auth:password <email>` is the ops door.** Every route to a password in
the application needs something the person already holds — an invitation token,
or a session from a link. That leaves one gap: the first account on a fresh
deployment, and whoever is locked out because the mail is not working yet. It is
a terminal command rather than a page because it needs the database URL, which
is not something a visitor can present. Relatedly, `SEED_DEVELOPER_EMAIL` makes
the seed carry one real account's password digest across a reseed, since
otherwise reseeding a hosted instance locks its owner out of it.

---

## Alterations, documents and certificates (M5)

**A decision is a record, not a setting.** Once approved or denied, an
alteration cannot be re-decided or withdrawn — the answer to a board changing
its mind is a new request. Otherwise the minutes and the system can disagree
about what was approved and when, which is exactly the continuity gap this
product exists to close.

**The interface can only offer what the server would allow.** `availableActions`
runs on the server against the shared approval state machine, and the result
drives which buttons render. There is no second, client-side opinion about who
may approve what.

**Board-only comments are filtered in the query, not the view.** A thread that
leaks through an API response leaks whether or not a component renders it.
`getAlteration` applies the visibility filter, so the private thread never
reaches the client at all.

**A COI expiry is a compliance obligation.** Recording a certificate generates
an `Obligation` on the same calendar as the boiler inspection, with reminders at
45, 14 and 3 days. Rejected: a separate "alerts" or "expiring soon" concept —
a board already has one list they check, and a second one is a list they don't.

**The additional-insured endorsement is tracked as its own verified fact,** with
a name and a timestamp against it. A certificate that does not name the
corporation is valid on its face and worthless to the building; it is the most
common defect in a co-op COI, so "we looked at it" and "we checked the
endorsement" are recorded as different claims.

**Uploads go straight from the browser to storage** over a presigned PUT, and
the client is assumed to be lying about all of it — content type, size and
filename are validated server-side before anything is signed, and the returned
key is re-checked against the building's prefix when the document row is
written. Downloads are short-lived presigned GETs issued only after a capability
check, so there is no document URL that keeps working once someone leaves the
board.

**Officers can file on a shareholder's behalf.** In a twelve-unit building the
secretary routinely types things up for a neighbour who doesn't use email.
Anyone with `alteration.viewAll` may file against any unit; a plain shareholder
may only file against their own.

---

## Reminders, email and the cron (M7)

**Idempotency is enforced twice, not once.** `ObligationReminder` is unique on
(obligation, offset, scheduledFor), so a reminder row exists at most once. And
`Notification.dedupeKey` derives from that same triple plus the recipient, so
even if a reminder row were processed twice the second send loses the insert
race and never reaches the provider. Belt and braces on purpose: a cron that
mails a twelve-unit building twice about the same boiler inspection is how a
board learns to ignore the emails, and once they do the product has failed at
the only thing it does.

**One email per filing per day, not one per reminder offset.** Found by running
the job for real rather than by reasoning about it: forcing every offset due at
once produced four separate emails to the same person about the same filing.
Reminders for one obligation coming due on the same day now collapse into a
single message — the most urgent offset wins, and the rest are marked sent.
This is the same failure as double-sending, arriving by a different route.

**Reminders whose date has passed are picked up, not skipped.** A building
standing the system up in March should still hear about the filing whose
reminder date was February.

**Not everyone gets every email.** The assignee plus officers, not the whole
building. A shareholder does not need eleven emails a year about the boiler,
and a product that mails everyone about everything gets filtered to a folder.

**A new, narrow cross-tenant grant: `withJobTx`.** Two things genuinely span
every building — the daily run, which must find work in all of them, and the
delivery webhook, which arrives knowing a provider message id and nothing else.
Both need to answer "which building?" before any scoped work can start. The
grant is SELECT on `Building` and SELECT on `Notification`, and nothing else;
`tests/tenancy/rls.test.ts` asserts the scope reaches no further and cannot
write. Rejected: running the cron as the migration role, which owns the tables
and would bypass every policy in the system — turning one narrow need into a
total exemption.

This was found by a failing test rather than by design: `withUntenantedTx`
correctly returned zero buildings, because `Building` carries RLS keyed on
`id`. The fail-closed default worked exactly as intended and surfaced a gap in
the plan.

**Webhook signatures use Svix's own library, not a hand-rolled HMAC.** Resend
signs with Svix. A verifier written from a guess at the scheme, tested against
a payload written from the same guess, passes its tests and proves nothing —
worse than no test, because it looks like coverage. Using their library means
the test exercises the real algorithm.

### What is genuinely unverified

There is no Resend API key in this environment. Being precise about the gap:

_Covered._ The request Co-operator puts on the wire — endpoint, method, bearer
token, and a body carrying `from`, `to`, `subject`, `html` and `text` — is
asserted by intercepting `fetch` rather than mocking the SDK, which would only
prove that Co-operator calls a function it also defines. A provider refusal
surfaces as a FAILED notification rather than being swallowed. Signature
verification runs the real Svix algorithm.

_Not covered._ That Resend accepts that request; that the sending domain is
verified (a DNS matter no code can prove); and inbox placement. All three are
first-deploy checks, not logic. Do a single live test send before trusting the
notices module with a legally required notice.

---

## Invitations, and the rest of M8

**An invitation is bound to the address it was sent to.**
Accepting requires being signed in as the invited person. Email gets forwarded —
"here's the co-op thing, can you take a look?" — and without this binding a
forwarded link is a membership for whoever opens it. The friction is one
sentence on a page ("this invitation was sent to …"); the failure it prevents is
a stranger inside a building's records. Rejected: treating the token alone as
proof, which is how most invite systems work and why forwarded invites are a
recurring class of incident.

**The token is never stored.** Only its SHA-256 hash, looked up by hash and
compared in constant time. A database dump, a leaked backup or a read replica
hands over hashes, not building access. It expires in fourteen days, is
single-use, and can be withdrawn — a board that invites the wrong address needs
to close that door before the wrong person notices, so the members page lists
every invitation still outstanding.

**Every invalid case gets the same sentence.** No such token, revoked, wrong
building — all "That invitation link isn't valid", so a caller cannot learn
which invitations exist by probing. Expiry and revocation are the exceptions:
those are told plainly, because the person holding that link is almost always
the invited neighbour and "ask the board for a new one" is the useful answer.

**Accepting is a button, not a page load.** A mail client or a corporate link
scanner that prefetches the URL would otherwise consume the invitation before
the person ever saw it — the single-use rule turned against its owner.

**Inviting is not promoting.** `member.invite` lets an officer add a neighbour;
attaching an officer role additionally requires `member.manage`. Without that
split, a treasurer could mint a president by inviting one.

**A one-row RLS scope for redemption.**
Someone following an invitation link has no membership yet, so there is no
tenant to resolve and `tenant_isolation` hides the row that is about to grant
them one. Rejected: adding `Invitation` to the background job scope, which would
make every invitation in every building readable by any code path that opens a
job transaction. Instead `invitation_by_token` matches on the token hash the
caller has already presented: the scope is one row wide, enumeration is
impossible, and the rest of redemption runs inside `withBuildingTx` like
everything else. `tests/tenancy/rls.test.ts` asserts that scope reads exactly
one row, reads nothing else, and cannot write.

**The boot guard gained an opt-out that cannot reach production.**
`next start` sets `NODE_ENV=production`, and the guard refuses the catcher mail
driver there — correctly, since a deployment that writes notices to a temporary
disk reports success and sends nothing. But the smoke test needs exactly that:
a real production build whose magic links it can read. So
`ALLOW_DEV_DRIVERS_IN_PRODUCTION=1` lifts the two driver checks and is ignored
outright when `VERCEL=1`. Pasting it into a Vercel project's environment does
nothing at all, which is the only version of this flag worth having.

**Three pages existed only in the navigation.** Units, Documents and the audit
trail were linked from the shell and had no routes, as did `/verify-request` —
the page Auth.js sends every person to immediately after they ask for a sign-in
link. That one was the worst of the four: the primary path into the product
ended on a 404. All four are now built, along with a 404 page that reads as part
of the product rather than as a framework default.

**The 404 page has to serve two meanings at once.** A building you are not a
member of returns 404 rather than 403, deliberately, so a stranger cannot
confirm a co-op exists at a slug. That means the wording must cover "no such
page" and "not yours" without telling the reader which one they hit.

### The smoke test, and what it is worth

`tests/e2e/smoke.spec.ts` runs one path: a president signs in, invites a
neighbour as a board member, the neighbour opens the link, is bounced to sign in
and carried back, joins, confirms a proposed requirement onto the calendar,
files it, and is refused the other building with a 404. Nothing in it reaches
into the database to fake a session — it reads magic links out of `./.mail` the
way a person reads them out of an inbox.

It earned its place by finding four defects that unit tests could not: a
cookie-host mismatch that made sign-in silently fail whenever the app was driven
on `127.0.0.1` while issuing links for `localhost`; a sign-in page that dropped
the invitation token, sending an invited person to a building list they are not
a member of; the missing `/verify-request` page; and the three dead navigation
links. The first two are invisible to any test that does not use a real browser
and a real inbox.

Two things about running it. It needs a browser Playwright can find —
`PLAYWRIGHT_CHROMIUM_PATH` overrides the executable where the container ships
one at a fixed path. And it drives one host end to end, because `localhost` and
`127.0.0.1` are different hosts to a cookie jar; the config picks the host and
hands it to the server as `AUTH_URL` rather than letting the two disagree.

---

## Arrears

**Maintenance is posted for the building, not per apartment.**
The treasurer enters what the building needs to collect and it is split by
share allocation, because that is what maintenance _is_ in a co-op — a unit's
share of the building's costs, not a rent figure attached to a door. Rejected: a
per-unit monthly rate. It would have meant storing a number that is really a
derived one, and the first share transfer would have left it silently wrong for
every month after.

**The split is previewed before it is posted, from the same function that
posts it.** `allocateByShares` is pure and already tested, so the client runs it
on the numbers already on the page and shows the exact per-apartment figures
while the treasurer is still typing. Not an estimate — the same integer
arithmetic, remainder to the largest holders, parts summing to the total. The
server recomputes from the register as of the due date and stays the authority;
if a transfer landed between the render and the submit, the server's numbers are
what get written and the result panel says what actually happened.

**Shares are read as of the due date, not as of today.** A transfer last month
changes who owes what this month, and the dated share register is the only
reason that question has an answer at all. This is the payoff for having no
`shares` column on `Unit`.

**The monthly run refuses to post a month twice.** Double-posting a building's
maintenance produces twelve angry emails and an evening of reversing charges by
hand, and a double-submitted form should not be able to cause it. The check is a
query for a live `MAINTENANCE` charge on that due date, inside the same
transaction as the writes.

**Posting is the treasurer's alone.** `arrears.postCharge` and
`arrears.recordPayment` are deliberately not in the president's set, though
`arrears.viewAll` is. The president can see every ledger and change none of it.
In a twelve-unit building this is a separation between two named neighbours
rather than two departments, and it is worth keeping precisely because it would
be so easy to collapse.

**A reversal carries the original's due date.** The reversing charge is dated to
when the original fell due, not to today, so the pair nets out in the bucket the
original occupied instead of appearing as a credit in the current column. A
reversal that ages differently from the thing it reverses is how a unit ends up
looking permanently overdue for a charge that was withdrawn.

**Reversed pairs stay visible, struck through.** Hiding them would make the
ledger easier to read and much less useful — "there was a charge here once and
it came off" is exactly what a shareholder disputes and a future board has to
reconstruct.

**Still not built, deliberately:** payment plans, late-fee rules, and the
arrears letter. The letter waits on a verified sending domain, since a dunning
notice that silently fails to deliver is worse than none. Late fees, when they
come, should propose rather than post — the same review-list shape the
compliance module uses, because charging money against a proprietary lease
nobody has re-read is not something software should do unattended.

---

## Building work and assessments

**One concept, two origins.** Work can stand alone — a new boiler, the lobby —
or hang off a compliance obligation, which is how a parapet _observation_ turns
into parapet _repairs_. Rejected: two separate things. A board asking "what is
this going to cost us" does not care which of those it started as, and making
them choose a menu before they can record a quote is the kind of taxonomy that
only makes sense to whoever built it.

**The split is shown to everyone, including the shareholder being assessed.**
This is a deliberate exception to the rule that governs the rest of the ledger.
Arrears are private because falling behind is private; the split of a roof is a
published fact. A shareholder facing a four-thousand-dollar assessment is
entitled to see the estimate and the arithmetic without asking an officer, and a
board that could not show it would have a governance problem rather than a
privacy one.

**Percentage and money together, never money alone.** "You owe $4,180.22"
invites an argument. "You hold 209 of 1,200 shares, 17.4%, which is $4,180.22"
answers it first. The percentages are rounded for reading and never used to
compute money — the cent that rounding would lose goes to the largest holder
instead — which is why the money column sums exactly and the percentage column
may not quite reach 100.

**What is displayed comes from the function that writes the charges.**
`splitLines` and the real posting path both call `allocateByShares`. A test
raises an assessment and asserts, unit by unit, that what the interface showed
equals what landed on the ledger; mutating the display to round independently
fails it. Two implementations of the same arithmetic is how a shareholder ends
up with a bill that disagrees with the page they were shown.

**Recording work and charging for it are different capabilities.** Any officer
may record that the roof needs doing and what the quote came to — that is
planning and it costs nobody anything. Turning the estimate into money owed by
twelve neighbours needs `arrears.postCharge`, the treasurer's alone. In a real
co-op a special assessment follows a board vote; Co-operator does not pretend to
hold that vote, but it refuses to let an estimate quietly become a debt.

**Raising is once, and confirmed.** A second raise is refused rather than
doubling everyone's assessment. The button asks again before it fires, naming
the number of apartments, because this is the moment an estimate becomes debt on
twelve ledgers and undoing it means a reversing entry per apartment.

**The estimate locks once an assessment is raised against it.** It is what the
charges were justified by; editing it afterwards would leave real money on the
ledger explained by a number that has since changed. A revised cost is a second
piece of work.

**Before and after are read differently, on purpose.** Unraised, the split is a
projection recomputed live from the current share register. Raised, it is read
back from the charges themselves rather than recalculated — shares may have
moved since, and the bill somebody actually received does not change when their
neighbour sells.

### The board's vote

**An assessment cannot be raised without a recorded vote that carried.** This is
the one place the product refuses to proceed on the treasurer's authority alone.
A special assessment follows a board vote in every set of bylaws worth the
paper, and software that lets one officer put four thousand dollars on twelve
neighbours' ledgers without one is software that will eventually be blamed for
it. The raise control is not merely disabled — it is not on the page until the
vote is there, and the write path refuses independently, because a disabled
button is a suggestion.

**Recorded, not held.** Nobody casts a ballot in a browser. The board meets, or
agrees by written consent, and this writes down the tally so the charges can
point at it afterwards. Pretending to run the vote would mean pretending the
software knows who is on the board and who was in the room, which it does not.

**Its own fields on the work, not a `Resolution`.** `Resolution` is
meeting-bound and share-weighted — the shareholder-vote concept the Meetings
module will use. A board authorising an assessment is per-capita, and small
boards decide by written consent between meetings more often than they meet.
Forcing it through `Resolution` would have meant a nullable `meetingId` and a
tally whose column names said "shares" while holding director headcounts.
Rejected: one table meaning two things, with the difference kept in the reader's
head.

**Abstentions are recorded and do not decide it.** A simple majority of the
votes actually cast carries it, which is what "the board voted 4–1" means to the
people who were there. Two for, one against and three abstaining carries; there
is a test that says so, because the alternative reading is defensible enough
that somebody will eventually assume it.

**A decision freezes once money is raised on it.** Rewriting the tally
afterwards would leave real charges explained by a vote that has since changed.
A vote that went the other way, or a revised scope, is a second piece of work.

## Meetings, quorum and proxies

The module that turns the share register into governance. Everything else in
Co-operator records facts about a building; this records what its owners
decided, which is the thing a board is most often asked to prove and least
often able to.

**Quorum is measured in shares, and the bylaw fraction is stored as a
fraction.** `quorumNumerator`, `quorumDenominator` and `quorumStrict`, never a
percentage. Two-thirds of The Adelaide's 1,200 shares is exactly 800; 66.67% of
them is 801, so a meeting with precisely two-thirds present would be recorded as
inquorate over a rounding artefact — on the very vote most likely to be
contested. Comparisons cross-multiply, so nothing is divided anywhere between
the bylaws and the verdict.

`quorumStrict` separates "more than half" from "at least half". There are two
tests with identical attendance, identical fractions and opposite outcomes; the
only difference is the word "more" in the bylaws.

**No business without quorum.** `recordResolution` recomputes quorum from the
attendance and live proxies and refuses if it is short, naming how many shares
short. A resolution passed at an inquorate meeting is void, and discovering that
three years later — when somebody challenges the assessment it authorised — is
the expensive way to find out. Two related refusals: an apartment that is not
recorded as present cannot vote, and a vote marked as cast by proxy must have a
live proxy behind it.

**Only those three refusals.** The temptation is to keep going — quorum lost
mid-meeting, who may chair, whether notice was properly given. Each is real, and
each depends on facts the software does not have. Three rules that are always
right beat a dozen that are usually right and occasionally wrong in a way nobody
notices until it matters.

**Votes are recorded per apartment; shares are looked up.** A secretary has a
list of who voted which way, not a share total. Asking them to add 260 and 210
and 180 under time pressure is asking for the one arithmetic mistake this module
exists to prevent. `ResolutionVote` holds the apartment and the choice, and the
share count as it stood on the meeting date is frozen onto the row — a transfer
next spring must not restate what last autumn's meeting decided. The tally on
`Resolution` is stored for the same reason, and `outcomeOf` recomputes the
verdict from it on every render, so a page showing both would show a
disagreement rather than hide one.

**A threshold per resolution, not per building.** An ordinary motion carries on
a majority while amending the bylaws takes two-thirds or three-quarters, and the
two get voted on at the same meeting. `basis` records what the threshold is
measured against — shares voted, shares present, or all shares outstanding —
because bylaws differ on whether an abstention is a no, and that difference
decides close votes. Recording it beats burying an assumption in the arithmetic.

**Proxies supersede rather than replace.** No unique constraint on
(meeting, unit): granting a second proxy revokes the first and inserts a new
row, so both grants survive. "Who held my proxy that night" is exactly the
question asked when a vote is contested, and an `UPDATE` would erase the answer.
At most one is live at a time, enforced in the write path.

A shareholder may give away their own apartment's vote and no one else's;
recording a proxy for a neighbour takes `meeting.manage`. Revoking is symmetric:
the granting apartment always may, anyone else needs the capability. A proxy
also marks the apartment present in `PROXY` mode, so it counts toward quorum —
and `computeQuorum` counts an apartment once when it both sends a proxy and
turns up anyway, which is not hypothetical and would otherwise inflate the
quorum that authorised the night's business.

**Adoption closes the record.** Once the board adopts the minutes, nothing about
the meeting can change: no attendance, no proxies, no resolutions, no edits to
the minutes themselves. A board that finds an error afterwards corrects it at
the next meeting, and that correction is itself minuted. Letting an officer
quietly edit adopted minutes would remove the only reason anyone trusts them.
One gate — `openMeeting` — is checked by every write in the module, so the rule
cannot be true of five paths and forgotten on the sixth.

**Minutes are text on the meeting, not an uploaded file.** A draft goes through
several hands before a board adopts it, and a chain of emailed documents is how
the version that gets adopted stops matching the version anyone read.
`minutesDocumentId` still holds the signed scan afterwards, for buildings that
keep one.

**The board's decision on building work can point at the meeting.**
`BuildingWork.decisionMeetingId` was in the schema when the vote gate was built
but had no way to be set; the meeting picker now fills it, and both pages link
to each other. A board's vote to spend $48,000 belongs in the minutes of the
meeting that took it, not only on the page of the job it paid for. It stays
optional — small boards decide by written consent between meetings more often
than they meet.

## Repair tickets, and who pays

The module residents actually open. Everything else in Co-operator is something
a board does; this is something a shareholder does, and the design follows from
that — one control for reporting, and every other control belonging to whoever
has to deal with it.

**The rule the module exists for: a shareholder cannot be billed for a repair
until the board has determined, in writing and under a name, that they are the
one who pays.** Who is responsible for a leak — the corporation, whose riser is
behind the wall, or the shareholder, whose fixture failed — is the argument
every co-op repair turns into. It is answered by reading a proprietary lease,
not by whoever holds the chequebook that week. `chargeTicketToUnit` refuses
without a determination, refuses when the determination says the corporation
pays, and refuses a second bill. Enforced in the write path, because a disabled
button is a suggestion.

**The determination runs through the shared approval workflow.** It gets a
comment thread the shareholder can argue in, a decision with a named officer and
a stated basis, and the state machine's rule that a decision cannot be edited,
only superseded. `Resolution` was the wrong vehicle — that is meeting-bound and
share-weighted — but `ApprovalRequest` already meant "somebody asks, the board
looks, an officer decides, and it is recorded", which is exactly this.

**There is no "deny".** Every repair has somebody responsible for it, so
approving means naming who pays, and a board that disagrees with a proposed
answer records the answer it does agree with. Denial would leave the question
open while the record looked settled — the worst of both. `decideResponsibility`
refuses the action explicitly rather than letting the shared machine offer it.

**Anyone who can see the ticket can open the determination, including the
shareholder.** Being able to make the board answer in writing is the point of
the feature from their side, not only from the board's.

**Triage is optional; going backwards is not.** The super who tightens a
handrail the same afternoon should not have to record that he considered it
first — a workflow that insists on ceremony for a five-minute job is a workflow
people stop using, and a repair log nobody updates is worse than none. What the
transition table refuses is a resolved repair becoming untriaged, and resolving
a closed one without reopening it. Reopening is first-class: a fault that comes
back three weeks later is the same fault, it clears `resolvedAt` because the
repair plainly did not hold, and it keeps the note about what was tried. Forcing
a second ticket would lose exactly the history that makes the pattern obvious.

**Resolution requires saying what was done.** A ticket closed with no account of
the work teaches the next board nothing. "Replaced the flush valve, not the whole
tank" is what tells them, two years on, whether this is the same fault recurring.

**A ticket with no apartment is everyone's.** `optionalUnitFilter`, not
`unitFilter`: the front door and the boiler are the whole building's business
while a leak in 3R is private to 3R and the officers. `getTicket` returns null
rather than a forbidden error for a neighbour's ticket, because "it exists but is
not yours" is itself a disclosure in a building where everyone knows everyone.

**Assignment is a member or a plain-text vendor.** An outside plumber has no
login and never will, and modelling one as a user in order to assign a ticket
would put a fictional person in the members list. Both fields exist rather than
one, because "Sal will meet the plumber" is a real arrangement and a system that
refuses to record it gets worked around in a notes field.

**The charge points at the ticket, not the other way round.** `Charge.ticketId`,
following `Charge.buildingWorkId`: the money points at its justification, so a
bill can always be traced back to the determination that authorised it, and a
reversal is just another charge row rather than a nulled foreign key.

### Two things this module changed elsewhere

**The upload path moved out of alterations.** Repair tickets were the second
caller of "sign a PUT, send the bytes, record that they landed", and two copies
of an upload path is two places for the permission check to drift. It now lives
in `documents/actions.ts` with `UploadField` in `components/patterns`. The
capability check never moved — it has always been one `canAttachTo` that every
path asks, and a new entity type has to add its case there deliberately rather
than inheriting access by omission.

**`Field` associates its label explicitly.** It used to wrap the control in a
`<label>`, which meant the accessible name was the label's entire text content.
For a `<select>` that includes every option, so a field announced as "Where
Somewhere shared GARDEN 1F 2F…"; with a hint it announced as "Where Your
apartment, or blank for somewhere shared". Now the label uses `htmlFor` and the
hint is attached with `aria-describedby`, which is announced after the name and
can be skipped — which is what a hint is. Found by a browser test that could not
locate a field by its own label, which is the same problem a screen reader user
would have had.

## The sublet register, and the cap

The third module through the shared approval workflow, after alterations and
repair responsibility determinations. Three callers is what makes that a
primitive rather than a coincidence, and nothing about it had to change to take
the third — which was the point of extracting it before there was a second.

**The cap is a different kind of rule from the other two gates.** An assessment
needs a vote behind it and a repair bill needs a determination: both are
_authorisations_, questions about who decided. The sublet cap is a
**building-wide invariant** — not more than twenty per cent of the apartments
may be sublet at once — and the question it answers is not "who said so" but
"would this put the corporation over its own lease".

The stakes are not only the house rules. A co-op over its cap can lose lending
eligibility for every shareholder trying to sell, because secondary lenders
limit how much of a building may be non-owner-occupied. It is the number a
volunteer board most reliably loses across a turnover.

**Checked at approval, not at application.** The count moves underneath a
pending application: two shareholders apply in March, the board approves the
first in April, and by the time it reaches the second the building is full.
Checking on the way in would have let both through. Being at the cap today is
also not a reason to refuse to _look_ at an application for a term starting in
six months, by which time somebody's term will have run out.

**Counted as of the term's start date, not today.** The question is whether the
building will be over its limit when this subtenant actually moves in. The page
shows the same reading, computed from the same function against the same date,
so the warning a board reads and the refusal they get are the same arithmetic.

**Exact fractions again.** Twenty per cent of six apartments is 1.2, and "may a
second apartment be sublet" has to be answered without ever producing 1.2 —
cross-multiplied, `count * 100 <= totalUnits * capPercent`. "Not more than" is
inclusive, so twenty per cent of ten apartments is exactly two and two is
allowed. There is a test that walks every cap from 1% to 100% across building
sizes 1–40 and asserts the largest allowed count is exactly the count that
passes the comparison; if the two ever disagree, one of them has started doing
float arithmetic.

**Whether a sublet is running is derived, never stored.** No status column: the
decision lives on the approval, and the dates plus an optional early end answer
"is this apartment sublet on the 3rd of June". A status column would be a second
source of truth for a fact the dates already carry, and the day the two disagree
is the day somebody is refused a sublet the register says there is room for.

**Ending early is a first-class act, because it frees a slot.** A subtenant who
leaves in September makes the neighbour whose application was refused in June
approvable — and nobody will think to look unless the register says the
apartment is free. It also closes the expiry reminder, since that date is no
longer coming.

**A renewal is a new registration, not an extended term.** Most proprietary
leases make a renewal a fresh application, and they are right to: the cap has to
be re-checked and the board has to be able to say no the second time. Rewriting
the end date in place would lose the fact that they said yes twice, and would
slip an extra year past the cap check. `renewedFromId` links them, and the
renewal picks up the day after the previous term ends — starting it the same day
would overlap, and the application would refuse itself.

**Approval puts the term's end on the compliance calendar.** The same machinery
a certificate of insurance uses, for the same reason: a date filed and forgotten
is worth nothing, and being told sixty days out is the product. A sublet running
past its term is a subtenant in occupation without permission, which is the
corporation's problem rather than the shareholder's.

**The fee is a separate, deliberate act by the treasurer.** Like every other way
money reaches a ledger here. Refused before approval — billing a shareholder for
permission they have not been given is the wrong order — and refused twice,
because a correction is a reversing entry.

**The count is public; the names are not.** The register is unit-scoped like
arrears, so a shareholder sees their own applications and an officer sees the
building's. The cap reading at the top of the page is building-wide and shown to
everybody, because how much of the corporation is sublet governs whether they
may apply and is the first thing a buyer's lender asks. That asymmetry is
deliberate rather than an oversight.

## Duty rotation, and whose week it was

The most mundane module in the product, and the one that answers a question
nobody else can. Trash set-out is not hard; remembering, three weeks later,
whose week it was when the summons was issued is — and that memory decides
whether the corporation absorbs a fine or a neighbour pays it.

**The rota is materialised, not computed on demand.** A `DutyAssignment` row per
period, each with an obligation behind it. The formula in
`primitives/duty.ts` generates them and then stops being the source of truth,
because a rotation nobody is reminded of is a rota on a fridge door — and
because the rows are where swaps live.

**The record beats the formula, always.** `turnForDate` prefers a recorded
assignment and only falls back to the arithmetic for a period that was never
generated. A caller reaching for the formula when a row exists names the wrong
neighbour on exactly the weeks somebody did somebody else a favour, which is the
one case where being wrong is socially expensive. There is a mutation test for
it: swap the preference and one test fails by name.

**A swap keeps both names.** `unitId` is who has the turn; `originalUnitId` is
who the rotation picked. Overwriting one would make "3R's week, taken by 4F"
unsayable, and that is the sentence a fine three weeks later needs. A
shareholder may swap a turn that is theirs — consent from the other side is a
social matter the software cannot verify, and pretending otherwise would just
mean the swap happens by text message and never gets recorded. Past turns cannot
be swapped: the week has happened, and rewriting it would move a fine onto
somebody who was away.

**The fine is attributed from its date, and the form never asks.** `logFine`
takes the summons number, the date, the violation and the amount, looks up the
turn the date fell in, and reports the apartment back. Asking would be asking
for a guess, and a guess with a bill attached is worse than no answer.

**No answer is a real answer.** A summons dated outside the rota is left
unattributed, and `chargeFineToUnit` refuses one. A building with no rotation on
record has nobody the bill honestly belongs to, and picking somebody plausible
is the failure mode this whole module exists to prevent.

**The answer-by date comes off the summons, not out of the software.** The
window to contest a DSNY violation is the most expensive thing here — miss it
and a contestable fine becomes an unarguable one — but the deadline is printed
on the ticket and depends on the violation. So the form asks for that date and
puts it on the compliance calendar, and the obligation says in as many words
that the date is the one on the summons rather than one Co-operator worked out.
Guessing a legal deadline would be exactly the kind of confident wrong answer
the compliance ruleset already refuses to give.

**Recharging is a decision, not a consequence.** The page says so: many boards
absorb a first summons and recharge a repeat. Attribution and billing are
separate acts by separate people — the super runs the rota and holds no money,
the treasurer bills and does not keep the rota.

**Periods are whole-day arithmetic and roll over on the eighth day.** A
seven-day turn starting Monday puts the following Monday in the _next_ period.
Off by one there blames the wrong neighbour every time a fine lands on a
changeover day, which is not a rare case — set-out happens the night before
collection, and collection days are when rotations turn over. A test walks a
year of days and asserts the periods tile the calendar exactly, which is also
where millisecond arithmetic would slip a day across a daylight-saving change.

---

## Bookings, and what it takes to confirm one

**A slot is held, not confirmed.** Asking for the freight elevator takes the
time off the calendar immediately; confirming is a separate act that runs the
resource's conditions and records what it found. Collapsing the two gives you
one of two failures: confirmations whose conditions are not met, or a slot left
open while a shareholder chases a certificate — and the second is how two
families hire movers for the same Saturday.

**The conditions are read against the day of the move, never against today.**
This is the module's whole reason for existing. A booking is made three weeks
out; the mover's certificate has to be current when the truck arrives, not when
the form was submitted. The primitive was written that way from the start
(`primitives/prerequisites.ts` takes a `bookingDate`), and the seed now
demonstrates it: The Adelaide's mover is insured today and lapses in five days,
before the move that apartment has booked.

**Nothing can be double-booked, and the database is what says so.** The write
path checks for a clash first, because that is what produces a refusal naming
who has the slot. It cannot be the only check: two people pressing the same slot
in the same second both read an empty calendar and both insert. So there is a
Postgres exclusion constraint over `tstamp` ranges scoped to one resource,
covering only bookings that still hold their slot — a cancelled booking must
give its time back. `btree_gist` is what allows a uuid equality and a range
overlap in one index. A test inserts an overlapping row directly, going around
the write path, to prove the constraint is real rather than decorative.

**A booking is a run of slots on a day, not a pair of timestamps.** The request
action takes a date, a slot index and a count; the window is derived on the far
side from the resource's own hours. A booking that starts at ten past nine, runs
past closing, or crosses midnight is not a validation error — it is not
expressible. Overlap is half-open, so a move running to noon does not block the
one starting at noon, which is the normal case for a long move split across
slots.

**Opening hours are rows.** `Resource.slotMinutes`, `opensMinute` and
`closesMinute`, so the roof deck opening at ten and closing at ten is data. That
is the same claim the prerequisite registry makes about conditions, extended to
the calendar: adding something bookable is a row and a few checkboxes, and
nothing in the checking, the calendar or the confirmation path knows what a roof
deck is.

**When a slot is taken is public; what it is for is not.** Every other
unit-scoped module hides the record itself. This one deliberately does not: a
calendar that hides its bookings is not a calendar, and a neighbour planning
their own move has to be able to see that Saturday morning is gone — they will
see the truck anyway. The note, the deposit and the conditions are blanked at
the query layer for anyone but the apartment and the board, rather than in the
page, so a component added later cannot render a field it was never handed.

**The deposit never touches the maintenance ledger.** A charge means "this
apartment owes us"; a deposit means "we are holding their cheque". Posting the
second as the first makes the arrears report wrong, and the arrears report is
the one number a volunteer board actually acts on. So the deposit lives on the
booking: received, reference, returned, and anything withheld with a reason.
Rejected: `ChargeKind.DEPOSIT` plus a reversing charge, which reads neatly and
inflates every affected apartment's balance for the fortnight it is outstanding.
Damage costing more than the deposit is a different thing entirely — a repair
the board determines is the shareholder's, billed through the repairs module
where the determination sits next to the bill.

**Returning it requires the booking to have happened.** A deposit exists to
cover what occurs during the move; handing it back in advance is the same as not
taking one. The exception is a cancelled booking, where there is nothing left to
cover. Withholding any part of it requires a reason, because a deduction nobody
explained is the one that gets disputed.

**Retiring a resource does not cancel what is booked on it.** Taking the roof
deck off the list is a decision about the list, not a decision to cancel the
party somebody arranged three weeks ago. The audit entry records how many
bookings were left standing.

**Confirming reports every unmet condition at once**, and writes down the
failures as well as the passes. Somebody missing a deposit and a certificate
should be told both now rather than discovering the second after fixing the
first, and a shareholder who was refused should be able to read which check
failed and when it ran instead of being told "not yet" by a board member who has
moved on. The detail page then re-evaluates live and says so when a recorded
check no longer reads the same — a certificate that expired after confirmation
is exactly what nobody notices until the movers are at the door.

**The super can book without holding `booking.request`.** They have no apartment
and so no shareholder capabilities, and they are precisely the person who needs
to put a contractor's van on the calendar. Requiring the shareholder capability
would leave the one person who runs the building unable to book anything in it.

---

## Annual notices, and what silence means

**An apartment that never replied is not an apartment that said no.** This is
the module, and it is the thing buildings get wrong. Under the window guard rule
an owner who hears nothing must treat the apartment as though a child lives
there — inspect it, fit the guards. The usual failure is to send twelve notices,
receive nine forms, and file the other three as "no children", which is the one
reading the law does not allow. So the number the page leads with is not how
many replied; it is how many apartments the building now owes work to, and after
the reply-by date the silent ones are in it.

**Closing a campaign is what converts silence into work**, rather than the
system doing it quietly on a date. Each silent apartment gets a follow-up on the
compliance calendar carrying the reason — "Never answered. An apartment that
does not answer is treated as though a child lives there" — so a board three
years later can see not just that the guards went in but why they had to.
Rejected: deriving the follow-ups lazily at read time. The obligation has to be
a row a reminder can fire on, and a board has to be able to point at the moment
somebody decided.

**Closing is refused before the reply-by date**, because silence on the fifth of
February is a neighbour who has not got round to it. And **refused while any
apartment has not been sent the notice at all**, which is the guard worth
stating: an apartment nobody wrote to has neither consented nor ignored you, and
closing the campaign around it would record a conclusion nobody is entitled to
draw in either direction.

**"Asked for it" is its own answer**, not a flavour of no. A resident with no
children who wants window guards is entitled to them; folding that into `NO`
loses the obligation, and folding it into `YES` loses what the form actually
said.

**A response that cannot be parsed reads as no answer, never as a no.** The
column is JSON because different notices ask different questions, and a row
mangled by a bad migration has to fall on the safe side of the line the whole
module exists to draw — "no answer" leaves the apartment on the list of work,
"no" quietly takes it off.

**Delivery is per apartment, not per campaign.** The two households with no
address on file are exactly the ones somebody walks a paper copy to, on a
different day, and the send reports them as a count rather than swallowing them.
Recording a hand delivery is a separate act with its own date and a slot for the
proof; recording _email_ by hand is refused, because that would let a row claim
a message went out with nothing in the notification log to show for it.

**Sending is idempotent on (campaign, unit).** Not on the date, not on the
address. Two presses of the button a second apart produce the same dedupe key
and the second loses the insert race inside `sendNotice` rather than arriving in
somebody's inbox. A building that double-sends its January notices teaches
twelve people to ignore its email, and after that the notices stop working at
all. The `sentAt` filter catches the ordinary second press; the key is what
catches two requests that both read the row before either wrote to it.

**The standing is public; the answers are not.** How many apartments the
building owes work to is a compliance fact about the building and goes to every
member. Which apartment has a child under six in it is not, and is blanked at
the query layer for anyone but that apartment and the board — along with the
notification log, which carries every address the notices went to.

**A shareholder may answer for their own apartment.** Most of these come back on
paper and an officer types them in, but a member who is already signed in should
not have to print a form to say no.

**The last scaffold going means the scaffold machinery goes too.**
`scoped/modules.ts`, the `ScaffoldNotice` banner, `tests/arch/scaffolds.test.ts`
and `scripts/write-module-todos.ts` existed to keep five half-built modules
honest about being half-built. With none left they are code that describes a
state the repository is no longer in, which is worse than no code at all.

---

## Vercel Blob, and what "private" had to mean

**Vercel Blob is the storage driver this deploys on**, because the hosting
account already has it and it needs no bucket, no access keys and no second
vendor to fall over. The S3 driver stays for anyone who would rather own the
bucket, and the filesystem driver stays for development.

**Every blob is private, and that is a constant rather than a setting.** Blob
will happily store objects at `access: "public"`, which means a permanent
unauthenticated URL. Unguessable, but permanent — and still working the day
after somebody leaves the board, which is precisely what this product says it
does not have. Rejected outright, even though it is the simpler integration and
the one most tutorials show.

**Uploads still go straight from the browser.** `issueSignedToken` plus
`presignUrl` produce a presigned PUT scoped to one pathname, one content type
and one exact size, valid for fifteen minutes — the same shape the S3 driver
already had, so nothing above the driver changed. Rejected: posting the file to
a route handler and calling `put()` server-side, which reads well and dies at
Vercel's 4.5 MB request body limit — well below the 25 MB a scanned certificate
is allowed to be.

**Downloads stream through the application, and only on this driver.** A Blob
presigned GET cannot carry a `Content-Disposition`, and there is no per-request
equivalent, so redirecting the browser at the store would serve a PDF inline
from the storage origin — the thing that header exists to prevent. So the
`StorageDriver` interface widened by exactly one axis: a download is either a
`redirect` to a signed URL or a `stream` of bytes, and each driver returns what
it can do best. S3 keeps the redirect, because its signature carries both the
filename and the disposition and the bytes never touch a function. Blob streams,
which costs a few hundred kilobytes of function bandwidth on something a
twelve-unit co-op does a handful of times a month — and, incidentally, means the
file never has a URL anybody can hold at all.

**The streamed response is built in one place and tested there**, because every
header on it is doing a job: `attachment` so nothing renders inline, `no-store,
private` so neither a shared cache nor the browser's disk keeps a copy that
outlives the capability check, and `nosniff` because the content type came from
whoever uploaded the file.

**Selecting Blob without a token refuses at boot.** The failure it prevents is
silent and expensive: a deployment that means to use Blob but quietly writes to
a Vercel filesystem reports every upload as a success, and the building's
certificates are gone at the next deploy.

## Founding a building, and who is allowed to

Every module before this one assumed a building already existed. The two in the
product came out of a seed script, which is not a thing a board president has.
So the honest summary of the state before this change is that a real co-op could
not begin using Co-operator at all — and the gap was invisible from inside,
because every screen worked perfectly once you were already in.

**Being signed in is the whole authorisation, and it has to be.** Capabilities
come from a membership, memberships come from invitations, and invitations come
from members who already hold one. That chain is right for everybody except the
first person, who has nobody to be invited by. Founding is the link at the top
of it, so there is no capability to check and no third party to ask.

Rejected: an instance administrator who provisions buildings. It is one more
concept, one more role in an enum that currently maps cleanly onto things a
co-op actually has, and it moves the bootstrap problem rather than solving it —
somebody still has to be the first administrator. Rejected too: making the seed
the only way in, which is what we had.

What makes the open door tolerable is that it grants nothing. A building founded
by a stranger is visible to that stranger and to nobody else on the deployment,
because `tenant_isolation` keys `Building` on its own `id` and there is no
policy that widens it. The worst available outcome is rows only their author can
read. For a deployment serving one co-op that already exists,
`ALLOW_NEW_BUILDINGS=0` shuts it; it defaults open because a deployment with it
shut and no building yet has no way to make its first one, and a product that
cannot be started is a worse failure than an untidy table.

**The apartment list is the unit count.** Asking for the number and then asking
for the apartments gives two sources for one fact, and they drift the moment
somebody adds a row — with the count feeding every applicability predicate in
the ruleset and the list feeding everything else. A building that thinks it has
five apartments and shows six is a building whose compliance calendar is wrong
about which laws apply, silently.

**Shares are proposed, and the proposal says it is one.** Quorum, every
assessment and the maintenance split all divide by the share register, so a
building founded on placeholder shares has quietly wrong arithmetic everywhere.
Demanding the offering plan up front is not the fix: the person setting this up
has about three minutes and possibly no paperwork, and a form that refuses to
proceed without it gets closed. So every apartment starts on a round hundred,
the form shows each one's percentage of the running total as it is typed, and
every allocation carries a note saying it was recorded at setup and should be
replaced. `looksProvisional` recognises the state afterwards — by the shares
being _identical_, not by their matching the default, because a founder who
replaced 100s with 250s and stopped has still not typed an allocation. That
distinction came out of a test that contradicted itself and was right to.

**Provenance is evidence, not a claim.** `attributeSource` exists so that a
board three years from now can tell which numbers a human actually looked at —
an unvouched-for attribute set makes the compliance assessment provisional. A
browser can assert anything about where its own values came from, so the server
asks the city itself at submit time and compares: every published figure
accepted unchanged is `NYC_OPEN_DATA`, any override is `MIXED`, nothing to
compare against is `MANUAL`. An attribute PLUTO did not publish is not an
override, because a null there is the absence of an opinion.

**The address is normalised to the city's conventions, and they are not
guessable.** PLUTO holds `150 BERGEN STREET`, `EAST 10 STREET`, `5 AVENUE`,
`84-74 257 STREET`. Directions are spelled out, ordinals are stripped from
numbered streets, Queens house numbers keep their hyphens — and street types are
expanded only in final position, because the dataset has 288 lots on `ST MARKS
PLACE` and expanding `ST` everywhere turns a saint into a street and matches
nothing. Every one of those rules was checked against the live dataset rather
than reasoned about; the tests record the counts that settled them and then
never call the API again, because a unit suite that depends on Socrata's mood is
a suite that goes red for reasons outside this repository.

**Nothing about the lookup can block founding.** It returns a value on every
path — found, not-found, unavailable — and never throws. `not-found` and
`unavailable` are kept distinct even though both lead to the same screen,
because a founder told "the city has no record of this address" when the truth
is "the city's API timed out" goes and digs out their deed.

**A slug collision is discovered by the insert, not by a query.** Slugs are
unique across the deployment and row-level security deliberately hides the
buildings a founder does not belong to, so there is no "is this taken?" to run
first — and adding a policy that permitted one would leak the list of every
co-op on the instance. The insert is the check, and a retry is a fresh
transaction with a fresh id, because a unique violation aborts the one it
happened in. The alternative slugs carry a random suffix rather than counting
upward: `adelaide-2` would tell whoever typed it exactly how many other
Adelaides exist, which is precisely what RLS hides everywhere else.

Recognising that violation turned out to need care. Prisma's documented
`meta.target` is empty under a driver adapter — a P2002 through
`@prisma/adapter-pg` reports "Unique constraint failed on the (not available)"
and carries the real Postgres message nested underneath — so the constraint name
is read from there, with the documented field kept as a fallback. The bug was
found by the test that founds two buildings under one name, which is the only
reason it is not still there: without it the retry never ran and the second
founder saw a crash.
