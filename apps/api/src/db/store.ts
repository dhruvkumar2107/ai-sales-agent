import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { env } from "../config";
import { firestore } from "../lib/firebase";

export type Doc = { id: string };

export interface ListOptions<T> {
  where?: Partial<Record<keyof T & string, unknown>>;
  orderBy?: keyof T & string;
  desc?: boolean;
  limit?: number;
}

export interface Collection<T extends Doc> {
  get(id: string): Promise<T | null>;
  list(opts?: ListOptions<T>): Promise<T[]>;
  set(doc: T): Promise<T>;
  update(id: string, patch: Partial<T>): Promise<T | null>;
  delete(id: string): Promise<void>;
}

export interface Store {
  collection<T extends Doc>(path: string): Collection<T>;
  flush?(): void;
}

function applyList<T extends Doc>(items: T[], opts: ListOptions<T> = {}): T[] {
  let out = items;
  if (opts.where) {
    const entries = Object.entries(opts.where).filter(([, v]) => v !== undefined);
    out = out.filter((d) => entries.every(([k, v]) => (d as Record<string, unknown>)[k] === v));
  }
  if (opts.orderBy) {
    const k = opts.orderBy;
    out = [...out].sort((a, b) => {
      const av = a[k] as unknown as string | number;
      const bv = b[k] as unknown as string | number;
      if (av === bv) return 0;
      if (av === undefined) return 1;
      if (bv === undefined) return -1;
      return (av < bv ? -1 : 1) * (opts.desc ? -1 : 1);
    });
  }
  if (opts.limit) out = out.slice(0, opts.limit);
  return out;
}

// ---------------- In-memory store (dev, tests, demos) ----------------

class MemoryStore implements Store {
  private data = new Map<string, Map<string, Doc>>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private file?: string) {
    if (file && existsSync(file)) {
      const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, Record<string, Doc>>;
      for (const [path, docs] of Object.entries(raw)) this.data.set(path, new Map(Object.entries(docs)));
    }
  }

  private bucket(path: string) {
    let b = this.data.get(path);
    if (!b) {
      b = new Map();
      this.data.set(path, b);
    }
    return b;
  }

  private schedulePersist() {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, 250);
  }

  flush() {
    if (!this.file) return;
    const out: Record<string, Record<string, Doc>> = {};
    for (const [path, docs] of this.data) out[path] = Object.fromEntries(docs);
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(out));
  }

  collection<T extends Doc>(path: string): Collection<T> {
    const b = () => this.bucket(path) as Map<string, T>;
    const clone = <X>(x: X): X => structuredClone(x);
    return {
      get: async (id) => {
        const d = b().get(id);
        return d ? clone(d) : null;
      },
      list: async (opts) => applyList([...b().values()], opts).map(clone),
      set: async (doc) => {
        b().set(doc.id, clone(doc));
        this.schedulePersist();
        return doc;
      },
      update: async (id, patch) => {
        const cur = b().get(id);
        if (!cur) return null;
        const next = { ...cur, ...patch, id } as T;
        b().set(id, clone(next));
        this.schedulePersist();
        return next;
      },
      delete: async (id) => {
        b().delete(id);
        this.schedulePersist();
      },
    };
  }
}

// ---------------- Firestore store ----------------

function stripUndefined<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}

class FirestoreStore implements Store {
  collection<T extends Doc>(path: string): Collection<T> {
    const col = () => firestore().collection(path);
    return {
      get: async (id) => {
        const snap = await col().doc(id).get();
        return snap.exists ? ({ ...(snap.data() as T), id: snap.id } as T) : null;
      },
      list: async (opts = {}) => {
        let q: FirebaseFirestore.Query = col();
        const where = Object.entries(opts.where ?? {}).filter(([, v]) => v !== undefined);
        for (const [k, v] of where) q = q.where(k, "==", v);
        // Equality + orderBy needs composite indexes; when filtering we sort client-side instead.
        if (opts.orderBy && where.length === 0) {
          q = q.orderBy(opts.orderBy, opts.desc ? "desc" : "asc");
          if (opts.limit) q = q.limit(opts.limit);
        }
        const snap = await q.get();
        const docs = snap.docs.map((d) => ({ ...(d.data() as T), id: d.id }) as T);
        return where.length ? applyList(docs, { orderBy: opts.orderBy, desc: opts.desc, limit: opts.limit }) : docs;
      },
      set: async (doc) => {
        await col().doc(doc.id).set(stripUndefined(doc));
        return doc;
      },
      update: async (id, patch) => {
        const ref = col().doc(id);
        const snap = await ref.get();
        if (!snap.exists) return null;
        await ref.set(stripUndefined(patch), { merge: true });
        return { ...(snap.data() as T), ...patch, id } as T;
      },
      delete: async (id) => {
        await col().doc(id).delete();
      },
    };
  }
}

let store: Store | null = null;

export function getStore(): Store {
  if (!store) {
    store =
      env.DATA_BACKEND === "firestore"
        ? new FirestoreStore()
        : new MemoryStore(process.env.VITEST ? undefined : env.MEMORY_DB_FILE);
  }
  return store;
}

/** Test helper: replace the store with a fresh in-memory one. */
export function resetStore(): Store {
  store = new MemoryStore();
  return store;
}
