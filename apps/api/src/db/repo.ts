import { randomUUID } from "node:crypto";
import type {
  AgentConfig,
  Branch,
  Call,
  CallbackTask,
  Campaign,
  CampaignContact,
  CatalogModel,
  Conversation,
  CustomerVehicle,
  Lead,
  Member,
  Message,
  Offer,
  OptOut,
  Org,
  OrgPlatform,
  OrgSettings,
  ServiceBooking,
  TestDrive,
  TestDriveVehicle,
  Ticket,
  VehicleBooking,
} from "@axo/shared";
import { orgPlatformSchema, orgSettingsSchema } from "@axo/shared";
import { getStore } from "./store";

export const newId = (prefix = "") => `${prefix}${randomUUID().replace(/-/g, "").slice(0, 20)}`;
export const nowIso = () => new Date().toISOString();

/** Global (non-tenant) collections */
export const global = {
  orgs: () => getStore().collection<Org>("orgs"),
  /** uid -> membership (for auth lookups) */
  users: () => getStore().collection<Member>("users"),
  /** E.164 number -> org/agent routing for inbound calls */
  phoneRoutes: () => getStore().collection<{ id: string; orgId: string; agentId: string }>("phoneRoutes"),
  /** Global DND / NDNC registry cache (synced from operator scrub lists) */
  dnd: () => getStore().collection<{ id: string; phone: string; addedAt: string }>("dnd"),
  /** Meta WhatsApp phone number id -> org, for routing incoming WhatsApp messages */
  waRoutes: () => getStore().collection<{ id: string; orgId: string }>("waRoutes"),
};

/** Platform controls with defaults filled in (orgs created before these existed have none stored). */
export const platformOf = (org: Pick<Org, "platform"> | null | undefined): OrgPlatform => orgPlatformSchema.parse(org?.platform ?? {});

/** Tenant-scoped repository. All org data lives under orgs/{orgId}/... */
export function repo(orgId: string) {
  const c = <T extends { id: string }>(name: string) => getStore().collection<T>(`orgs/${orgId}/${name}`);
  return {
    orgId,
    branches: c<Branch>("branches"),
    members: c<Member>("members"),
    catalog: c<CatalogModel>("catalog"),
    offers: c<Offer>("offers"),
    testDriveVehicles: c<TestDriveVehicle>("testDriveVehicles"),
    agents: c<AgentConfig>("agents"),
    leads: c<Lead>("leads"),
    testDrives: c<TestDrive>("testDrives"),
    serviceBookings: c<ServiceBooking>("serviceBookings"),
    vehicleBookings: c<VehicleBooking>("vehicleBookings"),
    customerVehicles: c<CustomerVehicle>("customerVehicles"),
    tickets: c<Ticket>("tickets"),
    callbacks: c<CallbackTask>("callbacks"),
    calls: c<Call>("calls"),
    campaigns: c<Campaign>("campaigns"),
    campaignContacts: c<CampaignContact>("campaignContacts"),
    optOuts: c<OptOut>("optOuts"),
    messages: c<Message>("messages"),
    conversations: c<Conversation>("conversations"),
    settingsCol: c<OrgSettings & { id: string }>("settings"),
    async settings(): Promise<OrgSettings> {
      const s = await this.settingsCol.get("main");
      return orgSettingsSchema.parse(s ?? { orgId });
    },
    async saveSettings(patch: Partial<OrgSettings>): Promise<OrgSettings> {
      const cur = await this.settings();
      const next = orgSettingsSchema.parse({ ...cur, ...patch, orgId });
      await this.settingsCol.set({ ...next, id: "main" });
      return next;
    },
  };
}

export type Repo = ReturnType<typeof repo>;
