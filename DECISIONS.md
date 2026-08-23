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
