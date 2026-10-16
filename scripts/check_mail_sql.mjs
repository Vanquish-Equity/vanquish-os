// Run the EXACT contextual-comments shell order against disposable PGlite Postgres.
// npm install --prefix /tmp/crm-sql @electric-sql/pglite (test runtime only).
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(
  process.env.PGLITE_MODULE_PATH || "/tmp/crm-sql/package.json",
);
const { PGlite } = await import(require.resolve("@electric-sql/pglite"));
const { pgcrypto } = await import(
  require.resolve("@electric-sql/pglite/contrib/pgcrypto")
);
const { pg_trgm } = await import(
  require.resolve("@electric-sql/pglite/contrib/pg_trgm")
);
const body = readFileSync(".github/workflows/contextual-comments.yml", "utf8")
  .split("        run: |\n")[1]
  .split("\n")
  .map((l) => l.slice(10))
  .join("\n");
writeFileSync(
  "/tmp/crm-sql-order.sh",
  `psql() { while [ "$#" -gt 0 ]; do if [ "$1" = "-f" ]; then shift; echo "$1" >> /tmp/crm-sql-order.txt; fi; shift; done; }\n${body}`,
);
writeFileSync("/tmp/crm-sql-order.txt", "");
execFileSync("bash", ["/tmp/crm-sql-order.sh"]);
const files = readFileSync("/tmp/crm-sql-order.txt", "utf8").trim().split("\n");
const db = new PGlite({ extensions: { pgcrypto, pg_trgm } });
let migrate = false;
async function execute(file) {
  return runSql(readFileSync(file, "utf8"), file);
}
async function runSql(sql, file) {
  if (migrate)
    sql = sql.replace(/^reset role;$/gm, "set role phase1_migrator;");
  if (sql.includes("\\set ON_ERROR_STOP off")) {
    const m = sql.match(
      /([\s\S]*?)\\set ON_ERROR_STOP off\s+\\ir ([^\n]+)\s+\\set ON_ERROR_STOP on([\s\S]*)/,
    );
    if (!m) throw Error("Unknown psql control in " + file);
    await db.exec(m[1]);
    let failed = false;
    try {
      await execute(resolve(dirname(file), m[2].trim()));
    } catch (e) {
      if (
        !/Unexpected authenticated Storage access|RLS must already|Phase 2 has durable LP records|Phase 3 has metric reviews|Phase 5A has protected reviews/.test(
          e.message,
        )
      )
        throw e;
      failed = true;
      await db.exec("rollback");
    }
    if (!failed) throw Error("Expected migration rejection: " + file);
    await runSql(m[3], file);
    return;
  }
  const lines = sql.split("\n");
  sql = "";
  for (const line of lines) {
    if (line.startsWith("\\ir ")) {
      if (sql.trim()) await db.exec(sql);
      sql = "";
      await execute(resolve(dirname(file), line.slice(4).trim()));
    } else sql += line + "\n";
  }
  if (sql.trim()) {
    const result = await db.exec(sql);
    if (file.endsWith("relationships_explain.sql")) {
      const plans = result.flatMap((r) =>
        r.rows
          .filter((row) => "QUERY PLAN" in row)
          .map((row) => row["QUERY PLAN"]),
      );
      writeFileSync("/tmp/relationships-explain.txt", plans.join("\n") + "\n");
    }
  }
}
for (const file of files) {
  try {
    if (migrate) await db.exec("set role phase1_migrator");
    await execute(resolve(file));
    if (file.endsWith("auth_worker_storage_setup.sql")) migrate = true;
  } catch (e) {
    console.error("FAILED", file, e.message);
    process.exitCode = 1;
    await db.close();
    process.exit(1);
  }
  console.log("PASS", file);
}
console.log(
  `PASS ${files.length} SQL executions (disposable PostgreSQL/PGlite)`,
);
await db.close();
