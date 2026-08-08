import { z } from "zod";

/**
 * Boot-time configuration.
 *
 * The rule here is that a misconfigured deployment fails loudly at startup
 * naming the variable it needs, rather than throwing `undefined is not a
 * string` from inside a mailer three weeks later. Conditional requirements —
 * a Resend key only when the Resend driver is selected — are part of the
 * schema rather than a runtime check at the call site.
 */

const nonEmpty = (label: string) => z.string().trim().min(1, `${label} must not be empty`);

const schema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),

    DATABASE_URL: nonEmpty("DATABASE_URL").startsWith(
      "postgres",
      "DATABASE_URL must be a postgres:// or postgresql:// connection string",
    ),
    DIRECT_URL: nonEmpty("DIRECT_URL").startsWith(
      "postgres",
      "DIRECT_URL must be a postgres:// or postgresql:// connection string",
    ),

    AUTH_SECRET: z
      .string()
      .min(32, "AUTH_SECRET must be at least 32 characters (openssl rand -base64 32)"),
    AUTH_URL: z.url("AUTH_URL must be an absolute URL, e.g. http://localhost:3000"),

    EMAIL_DRIVER: z.enum(["catcher", "resend"]).default("catcher"),
    EMAIL_FROM: nonEmpty("EMAIL_FROM"),
    RESEND_API_KEY: z.string().optional(),
    RESEND_WEBHOOK_SECRET: z.string().optional(),

    STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().default("auto"),
    S3_ENDPOINT: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),

    CRON_SECRET: z
      .string()
      .min(16, "CRON_SECRET must be at least 16 characters (openssl rand -hex 32)"),

    NYC_OPEN_DATA_APP_TOKEN: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.EMAIL_DRIVER === "resend") {
      for (const key of ["RESEND_API_KEY", "RESEND_WEBHOOK_SECRET"] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: `${key} is required when EMAIL_DRIVER=resend`,
          });
        }
      }
    }

    if (env.STORAGE_DRIVER === "s3") {
      for (const key of [
        "S3_BUCKET",
        "S3_ENDPOINT",
        "S3_ACCESS_KEY_ID",
        "S3_SECRET_ACCESS_KEY",
      ] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: `${key} is required when STORAGE_DRIVER=s3`,
          });
        }
      }
    }

    if (env.NODE_ENV === "production" && env.EMAIL_DRIVER === "catcher") {
      ctx.addIssue({
        code: "custom",
        path: ["EMAIL_DRIVER"],
        message:
          "EMAIL_DRIVER=catcher writes mail to disk and sends nothing. Set EMAIL_DRIVER=resend in production.",
      });
    }

    if (env.NODE_ENV === "production" && env.STORAGE_DRIVER === "local") {
      ctx.addIssue({
        code: "custom",
        path: ["STORAGE_DRIVER"],
        message:
          "STORAGE_DRIVER=local writes to the filesystem, which is ephemeral on Vercel. Set STORAGE_DRIVER=s3 in production.",
      });
    }
  });

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);

  if (!parsed.success) {
    const lines = parsed.error.issues.map((issue) => {
      const name = issue.path.join(".") || "(root)";
      return `  • ${name}: ${issue.message}`;
    });

    throw new Error(
      [
        "",
        "Co-operator cannot start: the environment is incomplete.",
        "",
        ...lines,
        "",
        "Copy .env.example to .env and fill in the values above.",
        "",
      ].join("\n"),
    );
  }

  return parsed.data;
}

let cached: Env | undefined;

/**
 * Validated environment. Server-only — importing this from a client component
 * is a build error worth having, since it would leak secrets into the bundle.
 */
export function env(): Env {
  cached ??= load();
  return cached;
}

/** Test seam. Resets the memoised environment after mutating process.env. */
export function resetEnvCache(): void {
  cached = undefined;
}
