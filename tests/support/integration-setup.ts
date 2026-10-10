import "dotenv/config";
import { testDatabaseUrl } from "./test-database";

// Must run before lib/db.ts is imported so the shared client targets the test DB.
process.env.DATABASE_URL = testDatabaseUrl();
