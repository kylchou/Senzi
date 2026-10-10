import "dotenv/config";
import { testDatabaseUrl } from "./test-database";

// Must run before lib/db.ts is imported so the shared client targets the test DB.
process.env.DATABASE_URL = testDatabaseUrl();

// Lets resolveMarket() propose and approve with one admin in tests. The
// two-admin rule itself is tested in resolutions.test.ts with this turned off.
process.env.SENZI_ALLOW_SELF_APPROVAL = "true";
