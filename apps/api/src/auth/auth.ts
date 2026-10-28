import type { FastifyReply, FastifyRequest } from "fastify";
import type { Role } from "@axo/shared";
import { env, isProd } from "../config";
import { global } from "../db/repo";
import { safeEqual } from "../lib/crypto";
import { firebaseAuth } from "../lib/firebase";

export interface AuthContext {
  uid: string;
  email: string;
  orgId: string | null;
  role: Role | null;
  /** Platform owner: sees and controls every dealership */
  superAdmin: boolean;
  /** Super admin viewing a dealership's dashboard (x-act-as-org) */
  actingAs?: string;
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

/** Extra credentials besides the bearer token: admin key, impersonated org, dev role override. */
export interface AuthExtras {
  adminKey?: string;
  actAsOrg?: string;
  devRole?: Role;
}

function isSuperAdmin(email: string, adminKey?: string): boolean {
  if (env.ADMIN_KEY && adminKey && safeEqual(adminKey, env.ADMIN_KEY)) return true;
  const emails = env.SUPER_ADMIN_EMAILS.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (email && emails.includes(email.toLowerCase())) return true;
  // Local development without an admin key: the dev user is the platform owner.
  return env.AUTH_MODE === "dev" && !env.ADMIN_KEY && !isProd;
}

const header = (req: FastifyRequest, name: string) => {
  const v = req.headers[name];
  return (Array.isArray(v) ? v[0] : v) || undefined;
};

/** Verify the caller. Firebase mode: Bearer ID token. Dev mode: implicit owner of DEV_ORG_ID (x-dev-role overrides). */
export async function authenticate(req: FastifyRequest): Promise<AuthContext> {
  const raw = header(req, "authorization") ?? "";
  const token = raw.startsWith("Bearer ") ? raw.slice(7) : (req.query as Record<string, string>)?.token;
  return verifyToken(token, {
    adminKey: header(req, "x-admin-key"),
    actAsOrg: header(req, "x-act-as-org"),
    devRole: header(req, "x-dev-role") as Role | undefined,
  });
}

/** Verify a Firebase ID token (or accept anything in dev mode). Shared by HTTP and WebSocket auth. */
export async function verifyToken(token: string | undefined, extras: AuthExtras = {}): Promise<AuthContext> {
  let base: AuthContext;
  if (env.AUTH_MODE === "dev") {
    base = { uid: "dev-user", email: "dev@axo.local", orgId: env.DEV_ORG_ID, role: extras.devRole ?? "owner", superAdmin: false };
  } else {
    if (!token) throw new HttpError(401, "Missing bearer token");
    let decoded;
    try {
      decoded = await firebaseAuth().verifyIdToken(token);
    } catch {
      throw new HttpError(401, "Invalid or expired token");
    }
    const member = await global.users().get(decoded.uid);
    base = { uid: decoded.uid, email: decoded.email ?? "", orgId: member?.orgId ?? null, role: member?.role ?? null, superAdmin: false };
  }
  base.superAdmin = isSuperAdmin(base.email, extras.adminKey);
  if (base.superAdmin && extras.actAsOrg) {
    if (!(await global.orgs().get(extras.actAsOrg))) throw new HttpError(404, "Dealership not found");
    return { ...base, orgId: extras.actAsOrg, role: "owner", actingAs: extras.actAsOrg };
  }
  return base;
}

/** Fastify preHandler: requires an authenticated user that belongs to an org, optionally with one of `roles`. */
export function requireAuth(...roles: Role[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const auth = await authenticate(req);
      if (!auth.orgId || !auth.role) throw new HttpError(403, "User is not a member of any dealership");
      if (roles.length && !roles.includes(auth.role)) throw new HttpError(403, `Requires role: ${roles.join(", ")}`);
      if (!auth.superAdmin) {
        const org = await global.orgs().get(auth.orgId);
        if (org?.status === "suspended") throw new HttpError(403, "This account is suspended. Please contact your service provider.");
      }
      req.auth = auth;
    } catch (e) {
      const err = e as HttpError;
      return reply.code(err.statusCode ?? 401).send({ error: err.message });
    }
  };
}

/** Fastify preHandler for the platform admin panel. */
export function requireSuperAdmin() {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const auth = await authenticate(req);
      if (!auth.superAdmin) throw new HttpError(403, "Admin access required");
      req.auth = auth;
    } catch (e) {
      const err = e as HttpError;
      return reply.code(err.statusCode ?? 401).send({ error: err.message });
    }
  };
}

export const orgOf = (req: FastifyRequest): string => {
  if (!req.auth?.orgId) throw new HttpError(403, "No organisation");
  return req.auth.orgId;
};

export const MANAGERS: Role[] = ["owner", "sales_manager"];
export const ALL_ROLES: Role[] = ["owner", "sales_manager", "sales_executive", "service_advisor"];
