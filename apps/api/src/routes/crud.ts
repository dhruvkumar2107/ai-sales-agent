import type { FastifyInstance } from "fastify";
import type { Role } from "@axo/shared";
import type { z } from "zod";
import { orgOf, requireAuth } from "../auth/auth";
import { newId, repo, type Repo } from "../db/repo";
import type { Collection } from "../db/store";

type CollectionKey = {
  [K in keyof Repo]: Repo[K] extends Collection<infer _T> ? K : never;
}[keyof Repo];

interface CrudOptions {
  path: string;
  collection: CollectionKey;
  schema: z.ZodObject<z.ZodRawShape>;
  readRoles?: Role[];
  writeRoles?: Role[];
  idPrefix?: string;
  /** Build the document id from the payload (e.g. slug); defaults to a random id */
  idFrom?: (body: Record<string, unknown>) => string | undefined;
  orderBy?: string;
}

/** Register list/get/create/update/delete routes for a tenant collection, validated with zod. */
export function crudRoutes(app: FastifyInstance, o: CrudOptions) {
  const col = (orgId: string) => repo(orgId)[o.collection] as unknown as Collection<{ id: string } & Record<string, unknown>>;
  const read = requireAuth(...(o.readRoles ?? []));
  const write = requireAuth(...(o.writeRoles ?? ["owner", "sales_manager"]));

  app.get(o.path, { preHandler: read }, async (req) => {
    const q = req.query as Record<string, string>;
    const where = Object.fromEntries(Object.entries(q).filter(([k]) => !["limit", "orderBy", "desc"].includes(k)));
    return col(orgOf(req)).list({ where, orderBy: (q.orderBy ?? o.orderBy) as never, desc: q.desc === "true", limit: q.limit ? Number(q.limit) : undefined });
  });

  app.get(`${o.path}/:id`, { preHandler: read }, async (req, reply) => {
    const doc = await col(orgOf(req)).get((req.params as { id: string }).id);
    return doc ?? reply.code(404).send({ error: "Not found" });
  });

  app.post(o.path, { preHandler: write }, async (req, reply) => {
    const orgId = orgOf(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const id = (body.id as string) || o.idFrom?.(body) || newId(o.idPrefix);
    const parsed = o.schema.safeParse({ createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...body, id, orgId });
    if (!parsed.success) return reply.code(400).send({ error: "Validation failed", issues: parsed.error.issues });
    return col(orgId).set(parsed.data as { id: string });
  });

  app.patch(`${o.path}/:id`, { preHandler: write }, async (req, reply) => {
    const orgId = orgOf(req);
    const { id } = req.params as { id: string };
    const cur = await col(orgId).get(id);
    if (!cur) return reply.code(404).send({ error: "Not found" });
    const parsed = o.schema.safeParse({ ...cur, ...(req.body as object), id, orgId, updatedAt: new Date().toISOString() });
    if (!parsed.success) return reply.code(400).send({ error: "Validation failed", issues: parsed.error.issues });
    return col(orgId).set(parsed.data as { id: string });
  });

  app.delete(`${o.path}/:id`, { preHandler: write }, async (req) => {
    await col(orgOf(req)).delete((req.params as { id: string }).id);
    return { ok: true };
  });
}
