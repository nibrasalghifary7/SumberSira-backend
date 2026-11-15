import fs from "node:fs/promises";
import path from "node:path";
import { put, del } from "@vercel/blob";
import { config } from "../../config.js";

export interface StorageResult {
  url: string;
  key: string;
}

export interface Storage {
  put(key: string, buffer: Buffer, contentType: string): Promise<StorageResult>;
  remove(key: string): Promise<void>;
}

export const localStorageDriver: Storage = {
  async put(key: string, buffer: Buffer, contentType: string): Promise<StorageResult> {
    const uploadDir = path.resolve(process.cwd(), "uploads");
    const fullPath = path.join(uploadDir, key);

    // Pastikan parent directory tersedia
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, buffer);

    const baseUrl = config.PUBLIC_BASE_URL || `http://localhost:${config.PORT}`;
    const url = `${baseUrl}/uploads/${key.replace(/\\/g, "/")}`;

    return { url, key };
  },

  async remove(key: string): Promise<void> {
    const uploadDir = path.resolve(process.cwd(), "uploads");
    const fullPath = path.join(uploadDir, key);
    try {
      await fs.unlink(fullPath);
    } catch (err: any) {
      if (err.code !== "ENOENT") {
        throw err;
      }
    }
  },
};

export const vercelBlobDriver: Storage = {
  async put(key: string, buffer: Buffer, contentType: string): Promise<StorageResult> {
    const blob = await put(key, buffer, {
      access: "public",
      contentType,
      token: config.BLOB_READ_WRITE_TOKEN,
    });

    return {
      url: blob.url,
      key,
    };
  },

  async remove(key: string): Promise<void> {
    try {
      await del(key, {
        token: config.BLOB_READ_WRITE_TOKEN,
      });
    } catch (err) {
      console.warn(`Gagal menghapus blob ${key}:`, err);
    }
  },
};

export function getStorageDriver(): Storage {
  if (config.STORAGE_DRIVER === "vercel-blob") {
    return vercelBlobDriver;
  }
  return localStorageDriver;
}
