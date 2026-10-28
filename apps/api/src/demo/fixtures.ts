import { agentConfigSchema, branchSchema, memberSchema, orgSchema, type Branch, type Member } from "@axo/shared";
import { AGENT_TEMPLATES } from "../../prompts/agents";
import { global, nowIso, repo } from "../db/repo";
import { parseCatalogCsv } from "../integrations/csv-import";
import { DEMO_CATALOG_CSV } from "./catalog-data";

export const DEMO_ORG_ID = "demo-org";

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n: number) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);

export const DEMO_BRANCHES: Omit<Branch, "orgId">[] = [
  {
    id: "br-indiranagar",
    name: "Indiranagar Car Showroom",
    address: "100 Feet Road, HAL 2nd Stage, Indiranagar, Bengaluru 560038",
    city: "Bengaluru",
    mapLink: "https://maps.google.com/?q=Indiranagar+100+Feet+Road+Bengaluru",
    phone: "+918041234567",
    workingHours: { days: [0, 1, 2, 3, 4, 5, 6], open: "09:30", close: "19:30" },
    testDriveSlotMinutes: 30,
    serviceSlotMinutes: 60,
    serviceBays: 4,
    transferNumbers: { sales: "+919800000001", service: "+919800000002", manager: "+919800000003", insurance: "+919800000004" },
    holidays: [],
  },
  {
    id: "br-koramangala",
    name: "Koramangala Two-Wheeler Showroom",
    address: "80 Feet Road, 4th Block, Koramangala, Bengaluru 560034",
    city: "Bengaluru",
    mapLink: "https://maps.google.com/?q=Koramangala+80+Feet+Road+Bengaluru",
    phone: "+918047654321",
    workingHours: { days: [1, 2, 3, 4, 5, 6], open: "09:30", close: "20:00" },
    testDriveSlotMinutes: 20,
    serviceSlotMinutes: 45,
    serviceBays: 6,
    transferNumbers: { sales: "+919800000011", service: "+919800000012", manager: "+919800000013", insurance: "+919800000014" },
    holidays: [],
  },
  {
    id: "br-whitefield-service",
    name: "Whitefield Service Center",
    address: "ITPL Main Road, Whitefield, Bengaluru 560066",
    city: "Bengaluru",
    mapLink: "https://maps.google.com/?q=ITPL+Main+Road+Whitefield",
    phone: "+918049998888",
    workingHours: { days: [1, 2, 3, 4, 5, 6], open: "08:30", close: "18:30" },
    testDriveSlotMinutes: 30,
    serviceSlotMinutes: 60,
    serviceBays: 8,
    transferNumbers: { sales: "+919800000001", service: "+919800000022", manager: "+919800000023", insurance: "+919800000004" },
    holidays: [],
  },
];

export const DEMO_MEMBERS: Omit<Member, "orgId" | "createdAt">[] = [
  { id: "dev-user", email: "dev@axo.local", name: "Arjun Mehta (Owner)", role: "owner", branchIds: [], departments: ["manager"], modelFocus: [], available: true, phone: "+919800000003" },
  { id: "u-manager", email: "sales.manager@axo.local", name: "Kavya Rao", role: "sales_manager", branchIds: ["br-indiranagar", "br-koramangala"], departments: ["sales", "manager"], modelFocus: [], available: true, phone: "+919800000005" },
  { id: "u-exec-1", email: "ravi@axo.local", name: "Ravi Kumar", role: "sales_executive", branchIds: ["br-indiranagar"], departments: ["sales"], modelFocus: ["Creta", "Alcazar", "Creta Electric", "Ioniq 5"], available: true, phone: "+919800000001" },
  { id: "u-exec-2", email: "sneha@axo.local", name: "Sneha Iyer", role: "sales_executive", branchIds: ["br-indiranagar"], departments: ["sales"], modelFocus: ["Venue", "i20", "Exter", "Verna"], available: true, phone: "+919800000006" },
  { id: "u-exec-3", email: "imran@axo.local", name: "Imran Khan", role: "sales_executive", branchIds: ["br-koramangala"], departments: ["sales"], modelFocus: [], available: true, phone: "+919800000011" },
  { id: "u-advisor", email: "service@axo.local", name: "Manjunath Gowda", role: "service_advisor", branchIds: ["br-whitefield-service"], departments: ["service", "insurance"], modelFocus: [], available: true, phone: "+919800000002" },
];

/** Install the demo dealership (org, branches, catalog, offers, team, agents, settings). Idempotent. */
export async function installDemoOrg(orgId = DEMO_ORG_ID) {
  const r = repo(orgId);
  const { models } = parseCatalogCsv(orgId, DEMO_CATALOG_CSV);
  await global.orgs().set(
    orgSchema.parse({
      id: orgId,
      name: "AXO Motors Group",
      showroomName: "AXO Motors",
      brands: [...new Set(models.map((m) => m.brand))],
      createdAt: nowIso(),
      plan: "growth",
      platform: { contact: { name: "Demo owner", phone: "+919800000003", email: "owner@axomotors.example" } },
    }),
  );
  for (const b of DEMO_BRANCHES) await r.branches.set(branchSchema.parse({ ...b, orgId }));
  for (const m of models) await r.catalog.set(m);
  for (const m of DEMO_MEMBERS) {
    const member = memberSchema.parse({ ...m, orgId, createdAt: nowIso() });
    await r.members.set(member);
    await global.users().set(member);
  }

  await r.offers.set({ id: "of-festive", orgId, title: "Festive cash benefit", description: "Cash benefit of 25,000 rupees on Creta petrol variants", models: ["Creta"], validFrom: plusDays(-10), validTo: plusDays(30), active: true });
  await r.offers.set({ id: "of-exchange", orgId, title: "Exchange bonus", description: "Additional exchange bonus of 20,000 rupees on Venue and Exter", models: ["Venue", "Exter"], validFrom: plusDays(-5), validTo: plusDays(25), active: true });
  await r.offers.set({ id: "of-2w", orgId, title: "Low down payment", description: "Activa and Shine with down payment from 4,999 rupees on select finance schemes", models: ["Activa 6G", "Shine 125"], validFrom: today(), validTo: plusDays(45), active: true });

  const tdv = [
    ["Creta", "br-indiranagar", "KA01MX4521"],
    ["Venue", "br-indiranagar", "KA01MX7710"],
    ["Verna", "br-indiranagar", "KA01MY1203"],
    ["Exter", "br-indiranagar", "KA01MY3341"],
    ["Creta Electric", "br-indiranagar", "KA01EV0042"],
    ["Activa 6G", "br-koramangala", "KA51HB2201"],
    ["Shine 125", "br-koramangala", "KA51HB2202"],
    ["Hornet 2.0", "br-koramangala", "KA51HB2203"],
    ["Activa e", "br-koramangala", "KA51EV1101"],
    ["CB350", "br-koramangala", "KA51HB2204"],
  ] as const;
  for (const [model, branchId, reg] of tdv) await r.testDriveVehicles.set({ id: `tdv-${reg.toLowerCase()}`, orgId, branchId, model, variant: "", registrationNo: reg, active: true });

  for (const t of AGENT_TEMPLATES) await r.agents.set(agentConfigSchema.parse({ ...t, orgId }));

  // A vehicle currently in the workshop (used by the "is my vehicle ready?" flow).
  const jobStart = new Date(Date.now() - 3 * 3600_000);
  await r.serviceBookings.set({
    id: "svc-demo-inprogress",
    orgId,
    branchId: "br-whitefield-service",
    customerName: "Deepak Sharma",
    phone: "+919845012345",
    vehicleNo: "KA03MN4567",
    model: "Creta",
    kilometres: 20150,
    serviceType: "paid_service",
    pickupDrop: false,
    start: jobStart.toISOString(),
    end: new Date(jobStart.getTime() + 5 * 3600_000).toISOString(),
    status: "in_progress",
    jobCardNo: "JC-24117",
    estimatedReadyAt: "6 PM today",
    createdAt: jobStart.toISOString(),
  });

  await r.saveSettings({
    emi: { interestRate: 9.5, tenureMonths: 60, downPaymentPercent: 20 },
    callingHours: { start: "09:00", end: "20:00" },
    serviceTypes: [
      { type: "free_service", label: "Free service", durationMinutes: 60, description: "Manufacturer free service within warranty schedule" },
      { type: "paid_service", label: "Paid periodic service", durationMinutes: 90, description: "Periodic maintenance service" },
      { type: "repair", label: "General repair", durationMinutes: 120, description: "Diagnosis and repair" },
      { type: "accident", label: "Accident / body repair", durationMinutes: 240, description: "Insurance-assisted body repair" },
      { type: "warranty", label: "Warranty claim", durationMinutes: 120, description: "Warranty inspection and repair" },
    ],
  });
  return { models: models.length };
}
