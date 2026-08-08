import { config as loadDotenv } from "dotenv";

// Tests run against a real Postgres. There is no in-memory substitute that
// would exercise row-level security, and RLS is half of the tenancy guarantee.
loadDotenv({ path: ".env.test", quiet: true });
loadDotenv({ path: ".env", quiet: true });

process.env.NODE_ENV = "test";
process.env.EMAIL_DRIVER = "catcher";
process.env.STORAGE_DRIVER = "local";
