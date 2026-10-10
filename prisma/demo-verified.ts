import "dotenv/config";
import { db } from "../lib/db";
import { DEMO_ACCESS_CODE, seedVerifiedUsersDemo } from "./verified-users-demo";

// Adds the verified-users demo to a database that was seeded before it existed.
seedVerifiedUsersDemo()
  .then(() => console.log(`Verified-users demo ready. Enter ${DEMO_ACCESS_CODE} at /verify/stripe.`))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
