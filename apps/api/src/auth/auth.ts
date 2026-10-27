import type { FastifyReply, FastifyRequest } from "fastify";
import type { Role } from "@axo/shared";
import { env } from "../config";
import { global } from "../db/repo";
import { firebaseAuth } from "../lib/firebase";

export interface AuthContext {
  uid: string;
  email: string;
  orgId: string | null;
  role: Role | null;
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

/** Verify the caller. Firebase mode: Bearer ID token. Dev mode: implicit owner of DEV_ORG_ID (x-dev-role overrides). */
export async function authenticate(req: FastifyRequest): Promise<AuthContext> {
  if (env.AUTH_MODE === "dev") {
    const role = (req.headers["x-dev-role"] as Role | undefined) ?? "owner";
    return { uid: "dev-user", email: "dev@axo.local", orgId: env.DEV_ORG_ID, role };
  }
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : (req.query as Record<string, string>)?.token;
  if (!token) throw new HttpError(401, "Missing bearer token");
  let decoded;
  try {
    decoded = await firebaseAuth().verifyIdToken(token);
  } catch {
    throw new HttpError(401, "Invalid or expired token");
  }
  const member = await global.users().get(decoded.uid);
  return {
    uid: decoded.uid,
    email: decoded.email ?? "",
    orgId: member?.orgId ?? null,
    role: member?.role ?? null,
  };
}

/** Fastify preHandler: requires an authenticated user that belongs to an org, optionally with one of `roles`. */
export function requireAuth(...roles: Role[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const auth = await authenticate(req);
      if (!auth.orgId || !auth.role) throw new HttpError(403, "User is not a member of any dealership");
      if (roles.length && !roles.includes(auth.role)) throw new HttpError(403, `Requires role: ${roles.join(", ")}`);
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
