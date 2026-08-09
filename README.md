# Co-operator

Management software for small, self-managed New York City housing co-ops —
brownstones and walk-ups of roughly 4 to 20 units, where the board is three or
four neighbours who volunteer and meet a few times a year.

These buildings don't fail at management because the work is hard. They fail
because nobody knows what the work *is*, and there's no continuity when the
board turns over. Co-operator makes the obligations visible and the record
durable.

> Co-operator is a tracking tool, not legal advice. The board remains
> responsible for its own filings.

## Status

Foundation build in progress. See `ARCHITECTURE.md` for how the system fits
together and `DECISIONS.md` for what was chosen and what was rejected.

| Module | State |
| --- | --- |
| Compliance Calendar | built |
| Alterations & COIs | built |
| Annual Notices | scaffold |
| Meetings & Proxies | scaffold |
| Sublet Register | scaffold |
| Arrears | scaffold |
| Bookings | scaffold |
| Repair Tickets | scaffold |
| Duty Rotation | scaffold |

A scaffold has real tables, real scoped queries and a list view over real
seeded data, and writes nothing. Each one carries a `TODO.md` saying exactly
what is missing; `tests/arch/scaffolds.test.ts` fails if that file and the
banner on the page ever disagree.

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

Sign in at http://localhost:3000. With `EMAIL_DRIVER=catcher` (the default) no
mail leaves the machine — magic links and notices are written to `./.mail` as
`.eml` files, and the sign-in page prints the link directly in development.

### Two database roles

`pnpm db:setup` creates `cooperator_owner` and `cooperator_app`. Migrations run
as the owner; the application connects as `cooperator_app`, which owns nothing
and cannot bypass row-level security. This is what makes the RLS policies more
than decoration — a role that owns the tables ignores them by default.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Development server |
| `pnpm verify` | Typecheck, lint and unit tests — run this before committing |
| `pnpm test` | Vitest, including the tenancy isolation suite |
| `pnpm test:e2e` | Playwright smoke path |
| `pnpm db:migrate` | Apply migrations to the development database |
| `pnpm db:seed` | Reseed the two fictional buildings |
| `pnpm rules:sync` | Upsert the compliance ruleset without reseeding |

## Reading order for a new developer

1. `ARCHITECTURE.md` — tenancy, capabilities, the seven primitives.
2. `prisma/schema.prisma` — the domain, in one file.
3. `src/lib/db/scoped/` — every query in the system.
4. `tests/tenancy/` — what the isolation guarantee actually asserts.
5. `DECISIONS.md` — why things are the way they are.
