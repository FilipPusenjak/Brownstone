/**
 * Sets a password on an account, from a terminal.
 *
 * Every in-app route to a password needs something the person already has: an
 * invitation token, or a session they got from an emailed link. That is the
 * right shape for members, and it leaves exactly one gap — the first account on
 * a fresh deployment, and anybody locked out because the mail is not working
 * yet. Both are the same person: whoever is standing up the instance.
 *
 * So this is the ops door, and it is deliberately a terminal command rather
 * than a page. It needs the database URL, which is not something a visitor can
 * present.
 *
 *   pnpm auth:password nora@example.com              # generates one, prints it
 *   PASSWORD='...' pnpm auth:password nora@example.com
 *
 * The generated form is four words from a small list plus a number — long
 * enough to be a real password, short enough to read down a phone line to
 * somebody who is about to change it anyway.
 *
 * Two deliberate choices. It refuses to create an account: a typo in an address
 * would otherwise leave a passworded orphan with no membership, and there is no
 * sensible name to give it. And it ends every existing session for that user,
 * because a password set from a terminal is usually a response to something
 * going wrong.
 */
import "dotenv/config";
import { randomInt } from "node:crypto";
import { hashPassword, passwordProblem } from "../src/lib/auth/passwords";
import { withUntenantedTx } from "../src/lib/db/tx";

const WORDS = [
  "stoop",
  "cornice",
  "parapet",
  "lintel",
  "transom",
  "newel",
  "gable",
  "mantel",
  "dormer",
  "quoin",
  "soffit",
  "brownstone",
  "verdigris",
  "limestone",
  "ironwork",
  "boiler",
  "cellar",
  "areaway",
  "brickwork",
  "shutter",
];

function generate(): string {
  const words = Array.from({ length: 4 }, () => WORDS[randomInt(WORDS.length)]!);
  return `${words.join("-")}-${randomInt(10, 100)}`;
}

async function main(): Promise<void> {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    throw new Error("Usage: pnpm auth:password <email>   (PASSWORD=... to choose one)");
  }

  const supplied = process.env["PASSWORD"];
  const password = supplied ?? generate();

  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);

  const user = await withUntenantedTx((tx) =>
    tx.user.findUnique({ where: { email }, select: { id: true, name: true } }),
  );
  if (!user) {
    throw new Error(
      `No account for ${email}. This sets a password on an account that exists; it does not create one — invite the address instead.`,
    );
  }

  const passwordHash = await hashPassword(password);

  await withUntenantedTx(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        passwordSetAt: new Date(),
        signInFailures: 0,
        signInBlockedTill: null,
      },
    });
    await tx.session.deleteMany({ where: { userId: user.id } });
  });

  console.info(`\nPassword set for ${email}${user.name ? ` (${user.name})` : ""}.`);
  if (supplied) {
    console.info("Used the password from PASSWORD.\n");
  } else {
    console.info(`\n    ${password}\n`);
    console.info("Sign in with it, then change it on /account.\n");
  }
}

main()
  .catch((error: unknown) => {
    console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    // The Prisma client keeps the pool open and the process alive otherwise.
    process.exit(process.exitCode ?? 0);
  });
