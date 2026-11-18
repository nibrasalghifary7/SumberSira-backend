import { createHash, randomBytes } from "node:crypto";

export const COOKIE = "ss_admin_session";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export const newToken = () => randomBytes(32).toString("hex");