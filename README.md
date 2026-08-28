# Co-operator

Management software for small, self-managed New York City housing co-ops —
brownstones and walk-ups of roughly 4 to 20 units, where the board is three or
four neighbours who volunteer and meet a few times a year.

These buildings don't fail at management because the work is hard. They fail
because nobody knows what the work _is_, and there's no continuity when the
board turns over. Co-operator makes the obligations visible and the record
durable.

> Co-operator is a tracking tool, not legal advice. The board remains
> responsible for its own filings.

## Status

Foundation build in progress. See `ARCHITECTURE.md` for how the system fits
together and `DECISIONS.md` for what was chosen and what was rejected.

| Module              | State |
| ------------------- | ----- |
| Compliance Calendar | built |
| Alterations & COIs  | built |
| Annual Notices      | built |
| Meetings & Proxies  | built |
| Sublet Register     | built |
| Arrears             | built |
| Bookings            | built |
| Repair Tickets      | built |
| Duty Rotation       | built |

Every module is built. Each of the last five started as a scaffold — real
tables, real scoped queries, a list view over real seeded data, and a `TODO.md`
saying exactly what was missing — and none of them needed anything about
tenancy, capabilities or the primitives to change on the way out of it, which
was the point of the exercise.

Outside the module list, the following are built: setting a building up from its
address, sign-in and invitation redemption, the members page with outstanding
invitations, the share register, the document index, the audit trail, and
building work — what the building has to pay for, with each apartment's share of
the cost shown as a percentage and a figure, and the assessment that turns it
into money owed.

Nothing in Co-operator votes, decides, or predicts. Meetings records what a
board resolved in a room; building work records what it authorised. The
software's contribution is the arithmetic nobody can do in their head — quorum
and thresholds as exact fractions of the share register — and the two or three
rules that are expensive to get wrong: no business without quorum, no vote from
an apartment that was not represented, no repair billed to a shareholder the
board has not held responsible, no sublet approved that would put the building
over its cap, no booking confirmed whose conditions are not met on the day of
the move, no apartment that ignored the window guard notice filed as a no, and
no editing a record the board has adopted. What it will not do is guess: a
sanitation summons the rota does not cover is left unattributed rather than
pinned on somebody plausible, and one that two rotas both cover is a question
put back to the board rather than answered by whichever row sorted first.

## Getting started

Requires Node 22+, pnpm, and PostgreSQL 16+.

```bash
pnpm install
cp .env.example .env          # then fill in AUTH_SECRET and CRON_SECRET
pnpm db:setup                 # creates the two database roles (see below)
pnpm db:migrate               # schema + row-level security policies
pnpm db:seed                  # two fictional buildings
pnpm dev
```

Sign in at http://localhost:3000 as any seeded member — `nora.whitfield@example.com`
is the president of The Adelaide, `ivan.petrosyan@example.com` the president of
Lispenard House, and `marta.oyelaran@example.com` belongs to both.

There are two ways in, and each is the other's recovery path. A password, and a
link in email. Seeded members have no password, so start with the link; to sign
in with a password instead, give one to an account:

```bash
pnpm auth:password nora.whitfield@example.com   # prints a generated password
```

New members never need either. An invitation link is the whole of sign-up: open
it, pick a name and a password, and you are in the building — no second email to
wait for. That is deliberate, and it is why a board can text the link to a
neighbour whose mail is bouncing. There is no open sign-up form; an account
exists to hold a membership, and memberships come from invitations.

### Starting a building of your own

Invitations come from members, and members come from invitations, so the chain
needs a first link. Signing in with an address that belongs to no building
offers one: **Set up a building** at `/start`.

Give it the address and Co-operator asks the city — PLUTO for the lot and the
building footprints dataset for the BIN and roof height — and fills in the unit
count, storeys, year built, floor area, landmark status and BBL for you to
check. If the city has no record of the address, or is having a bad morning,
"Enter it myself" does the same job without the prefill; nothing about the
lookup can stop you.

Then it proposes the apartments from the shape of the building — a brownstone
gets a garden floor, a walk-up starts at one — with an even share split you
should replace with the offering plan's when you have it to hand. Shares only
matter as proportions, and the form shows each apartment's percentage as you
type. Whoever sets the building up becomes its president, because somebody has
to be able to invite everybody else.

Nothing lands on the compliance calendar. The engine reads the attributes you
confirmed and says which of New York's requirements look like they apply, and
the board decides.

On a deployment that exists to serve one co-op, set `ALLOW_NEW_BUILDINGS=0` once
that building is set up. Anyone who can receive a sign-in link can otherwise
start one — they would see nothing but their own, but there is no reason to
leave the door open.

With `EMAIL_DRIVER=catcher` (the default) no mail leaves the machine. Sign-in
links, invitations and notices are written to `./.mail` as `.eml` files; open
the newest one and follow the link. Seed data uses plausible addresses at real
domains, which is exactly why the default never opens a socket.

On a hosted instance, set `SEED_DEVELOPER_EMAIL` to your own address before
reseeding. The seed truncates every table, including `User`, and without this it
would delete the account you sign in with; with it, your name and password
digest are carried across.

### Two database roles

`pnpm db:setup` creates `cooperator_owner` and `cooperator_app`. Migrations run
as the owner; the application connects as `cooperator_app`, which owns nothing
and cannot bypass row-level security. This is what makes the RLS policies more
than decoration — a role that owns the tables ignores them by default.

## Commands

| Command                      | What it does                                                |
| ---------------------------- | ----------------------------------------------------------- |
| `pnpm dev`                   | Development server                                          |
| `pnpm verify`                | Typecheck, lint and unit tests — run this before committing |
| `pnpm test`                  | Vitest, including the tenancy isolation suite               |
| `pnpm test:e2e`              | Playwright browser tests — builds, starts, drives a browser |
| `pnpm db:migrate`            | Apply migrations to the development database                |
| `pnpm db:deploy`             | Apply migrations to a deployed database                     |
| `pnpm db:seed`               | Reseed the two fictional buildings                          |
| `pnpm rules:sync`            | Upsert the compliance ruleset without reseeding             |
| `pnpm auth:password <email>` | Set a password on an existing account                       |

### Deploying a schema change

The Vercel build runs `prisma generate && next build` and deliberately does not
migrate — a build that silently rewrites a production schema is a build nobody
can review. Apply migrations first, then push:

```bash
DATABASE_OWNER_URL=<owner connection string> pnpm db:deploy
```

Where outbound TCP to port 5432 is blocked and only HTTPS gets out, `pnpm
db:deploy:ws` does the same over a WebSocket. It dry-runs by default, applies
with `APPLY=1`, runs each migration in its own transaction, and fails loudly if
a migration leaves a tenant table without a row-level security policy.

### The browser tests

`pnpm test:e2e` runs twenty-four paths end to end. A stranger with nothing but
an email address signs in, finds an account that belongs to no building, sets
one up — its apartments, its share register, its attributes — lands on the list
of requirements that look like they apply, puts one on the calendar, and finds
that being president of a new building grants no sight whatever of the two that
were already there. A president signs in, invites a
neighbour, the neighbour follows the link, signs in as the invited address,
joins, opens the compliance calendar, puts a requirement on it and files it. A
treasurer posts a month's maintenance, checks the share-weighted split adds up
before committing to it, then records a payment and watches the balance move.
A treasurer prices a piece of building work, checks that the per-apartment
percentages and amounts add up to the job, raises the assessment, and finds the
resulting charge on an apartment's ledger. And a secretary calls a meeting,
takes the roster, is refused a vote while the room is a hundred shares short of
quorum, records it once the shares are there, then adopts the minutes and
watches every control disappear. A shareholder reports a repair and the
treasurer is refused a bill for it until the board records who pays — then, once
they have, bills it and finds the charge on the ledger. And a neighbour is
turned away from a repair inside somebody else's apartment, by URL as well as by
list. And the board is refused a sublet that would put the building over its
twenty per cent cap, records the running one ending early, and watches the same
refusal turn into an approval. And two neighbours swap a week on the bin rota,
a summons is logged with nothing but its date, and the building names the
apartment that actually took the turn — while a building keeping two rotas is
asked which one a summons is about, because that is the one thing its date
cannot settle. And a move is refused because the
deposit is missing and the mover's certificate — current today — lapses before
the day of the move, then confirmed once both hold; a slot somebody is holding
cannot be taken; and the roof deck is added as a row, with its own hours and
its own conditions, and books like everything else. And a neighbour makes an
account from an invitation link, without an email ever arriving. And the board
sends the window guard notice to every apartment, one household answers, and
closing the year out puts each apartment that never replied on the compliance
calendar to be inspected — because silence is not a no. Nothing is faked — they read magic links out of `./.mail` the way a person
reads them out of an inbox.

It builds the app and starts it, so the first run takes a minute. If Playwright
cannot find a browser, point it at one:

```bash
PLAYWRIGHT_CHROMIUM_PATH=/path/to/chromium pnpm test:e2e
```

## Adding someone to a building

There is no sign-up. A member with `member.invite` sends an invitation from the
building's Members page, and the link works only for the address it was sent to
— a forwarded invitation is refused. It expires in fourteen days, can be used
once, and can be withdrawn from the same page while it is outstanding. Attaching
an officer role to an invitation additionally requires `member.manage`, so
"invite" cannot quietly become "promote".

## Reading order for a new developer

1. `ARCHITECTURE.md` — tenancy, capabilities, the eleven primitives.
2. `prisma/schema.prisma` — the domain, in one file.
3. `src/lib/db/scoped/` — every query in the system.
4. `tests/tenancy/` — what the isolation guarantee actually asserts.
5. `DECISIONS.md` — why things are the way they are.
