import { execSync } from "node:child_process";
import "dotenv/config";
import { testDatabaseUrl } from "./test-database";

// Bring the test database up to the latest migration once per run.
export default function setup() {
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
  });
}
