/**
 * Seed the demo dealership.
 *   pnpm seed                 # writes to DATA_BACKEND (memory file or Firestore)
 *   pnpm seed -- --org my-org # custom org id
 */
import { env } from "../src/config";
import { seedDemo } from "../src/demo/seed-demo";

const orgArg = process.argv.indexOf("--org");
const org = orgArg > 0 ? process.argv[orgArg + 1]! : env.DEV_ORG_ID;

console.log(`Seeding org "${org}" into ${env.DATA_BACKEND}…`);
seedDemo(org)
  .then((r) => {
    console.log(`Done: ${r.models} models, ${r.leads} leads, ${r.testDrives} test drives, ${r.serviceBookings} service bookings, ${r.calls} call logs.`);
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
