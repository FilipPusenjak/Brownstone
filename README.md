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

| Module              | State    |
| ------------------- | -------- |
| Compliance Calendar | built    |
| Alterations & COIs  | built    |
| Annual Notices      | scaffold |
| Meetings & Proxies  | scaffold |
| Sublet Register     | scaffold |
| Arrears             | built    |
| Bookings            | scaffold |
| Repair Tickets      | scaffold |
| Duty Rotation       | scaffold |

A scaffold has real tables, real scoped queries and a list view over real
seeded data, and writes nothing. Each one carries a `TODO.md` saying exactly
what is missing; `tests/arch/scaffolds.test.ts` fails if that file and the
banner on the page ever disagree.

Outside the module list, the following are built: sign-in and invitation
redemption, the members page with outstanding invitations, the share register,
the document index, the audit trail, and building work — what the building has
to pay for, with each apartment's share of the cost shown as a percentage and a
figure, and the assessment that turns it into money owed.

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

With `EMAIL_DRIVER=catcher` (the default) no mail leaves the machine. Magic
links, invitations and notices are written to `./.mail` as `.eml` files; open
the newest one and follow the link. Seed data uses plausible addresses at real
domains, which is exactly why the default never opens a socket.

### Two database roles

`pnpm db:setup` creates `cooperator_owner` and `cooperator_app`. Migrations run
as the owner; the application connects as `cooperator_app`, which owns nothing
and cannot bypass row-level security. This is what makes the RLS policies more
than decoration — a role that owns the tables ignores them by default.

## Commands

| Command           | What it does                                                |
| ----------------- | ----------------------------------------------------------- |
| `pnpm dev`        | Development server                                          |
| `pnpm verify`     | Typecheck, lint and unit tests — run this before committing |
| `pnpm test`       | Vitest, including the tenancy isolation suite               |
| `pnpm test:e2e`   | Playwright browser tests — builds, starts, drives a browser |
| `pnpm db:migrate` | Apply migrations to the development database                |
| `pnpm db:seed`    | Reseed the two fictional buildings                          |
| `pnpm rules:sync` | Upsert the compliance ruleset without reseeding             |

### The browser tests

`pnpm test:e2e` runs three paths end to end. A president signs in, invites a
neighbour, the neighbour follows the link, signs in as the invited address,
joins, opens the compliance calendar, puts a requirement on it and files it. A
treasurer posts a month's maintenance, checks the share-weighted split adds up
before committing to it, then records a payment and watches the balance move.
And a treasurer prices a piece of building work, checks that the per-apartment
percentages and amounts add up to the job, raises the assessment, and finds the
resulting charge on an apartment's ledger. Nothing is faked — they read magic
links out of `./.mail` the way a person reads them out of an inbox.

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

1. `ARCHITECTURE.md` — tenancy, capabilities, the seven primitives.
2. `prisma/schema.prisma` — the domain, in one file.
3. `src/lib/db/scoped/` — every query in the system.
4. `tests/tenancy/` — what the isolation guarantee actually asserts.
5. `DECISIONS.md` — why things are the way they are.
