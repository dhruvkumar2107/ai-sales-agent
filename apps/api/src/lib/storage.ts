import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { env } from "../config";
import { decryptBuffer, encryptBuffer } from "./crypto";
import { storageBucket } from "./firebase";

/** Encrypted object storage: Firebase Storage in production, local disk otherwise. Objects are AES-256-GCM. */
const useFirebase = () => env.DATA_BACKEND === "firestore" && Boolean(env.FIREBASE_STORAGE_BUCKET);

function localPath(path: string) {
  const safe = normalize(path).replace(/^(\.\.[/\\])+/, "");
  return join(env.RECORDINGS_DIR, safe);
}

export async function putEncrypted(path: string, data: Buffer): Promise<string> {
  const blob = encryptBuffer(data);
  if (useFirebase()) {
    await storageBucket().file(path).save(blob, { contentType: "application/octet-stream", resumable: false });
  } else {
    const p = localPath(path);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, blob);
  }
  return path;
}

export async function getDecrypted(path: string): Promise<Buffer> {
  const blob = useFirebase() ? (await storageBucket().file(path).download())[0] : await readFile(localPath(path));
  return decryptBuffer(blob);
}

export async function deleteObject(path: string): Promise<void> {
  if (useFirebase()) await storageBucket().file(path).delete({ ignoreNotFound: true });
  else await rm(localPath(path), { force: true });
}
