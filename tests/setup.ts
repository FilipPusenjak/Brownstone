import { config as loadDotenv } from "dotenv";

// Tests run against a real Postgres. There is no in-memory substitute that
// would exercise row-level security, and RLS is half of the tenancy guarantee.
loadDotenv({ path: ".env.test", quiet: true });
loadDotenv({ path: ".env", quiet: true });

// `process.env.NODE_ENV` is typed readonly, so it is assigned through the
// index signature. Tests must never pick up the development mail or storage
// driver from a stray .env.
Object.assign(process.env, {
  NODE_ENV: "test",
  EMAIL_DRIVER: "catcher",
  STORAGE_DRIVER: "local",
});
