import { Injectable } from "@nestjs/common";
import { createReadStream, type ReadStream } from "node:fs";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";

import type { QuotationExportFormat } from "./quotation.repository";

export interface SavedQuotationExportFile {
  readonly sizeBytes: number;
  readonly storagePath: string;
}

@Injectable()
export class QuotationExportStorage {
  private readonly root = resolve(
    process.env.EXPORT_STORAGE_DIR ?? join(process.cwd(), ".runtime", "exports"),
  );

  async save(
    exportId: string,
    format: QuotationExportFormat,
    payload: Buffer,
  ): Promise<SavedQuotationExportFile> {
    await mkdir(this.root, { recursive: true });
    const extension = format === "PDF" ? "pdf" : "xlsx";
    const storagePath = `${exportId}.${extension}`;
    const target = this.resolveStoragePath(storagePath);
    const temporary = this.resolveStoragePath(`${storagePath}.tmp`);
    await writeFile(temporary, payload, { flag: "wx" });
    try {
      await rename(temporary, target);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
    return { sizeBytes: payload.length, storagePath };
  }

  open(storagePath: string): ReadStream {
    return createReadStream(this.resolveStoragePath(storagePath));
  }

  async remove(storagePath: string): Promise<void> {
    await unlink(this.resolveStoragePath(storagePath)).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
  }

  private resolveStoragePath(storagePath: string): string {
    if (basename(storagePath) !== storagePath) {
      throw new Error("导出文件存储路径不合法");
    }
    const target = resolve(this.root, storagePath);
    if (!target.startsWith(`${this.root}${sep}`)) {
      throw new Error("导出文件存储路径越界");
    }
    return target;
  }
}
