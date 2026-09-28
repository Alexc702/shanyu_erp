import type { DirectMaterialBatchView, DirectMaterialInformation, DirectMaterialProcessingStage } from "@shanyu/contracts";
import { apiUrl } from "./api-url";

export class DirectImportError extends Error {
  constructor(message: string, readonly kind?: string) { super(message); }
}
const root = `${apiUrl}/catalog/main-materials/direct-imports`;
export function createDirectUploadRequestId() {
  // getRandomValues also works on existing HTTP deployments; randomUUID requires HTTPS.
  const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6]! & 15) | 64; bytes[8] = (bytes[8]! & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2,"0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
async function request(path: string, init?: RequestInit): Promise<DirectMaterialBatchView> {
  const response = await fetch(`${root}${path}`, { credentials: "include", ...init });
  const body = await response.json();
  if (!response.ok) throw new DirectImportError(Array.isArray(body.message) ? body.message.join("；") : body.message ?? "请求失败", body.kind);
  return withAssetUrls(body.batch as DirectMaterialBatchView);
}
function withAssetUrls(batch: DirectMaterialBatchView) {
  return { ...batch, rows: batch.rows.map(row => ({ ...row, oldImageUrls: row.oldImageUrls.map(url => url.startsWith("/") ? `${apiUrl}${url}` : url) })) };
}
export async function uploadDirectMaterials(file: File, images: readonly File[], signal: AbortSignal, requestId: string, progress: (stage: DirectMaterialProcessingStage) => void) {
  const form = new FormData(); form.append("file", file); images.forEach(image => form.append("images", image));
  const response = await fetch(root, { credentials: "include", method: "POST", body: form, signal, headers: { Accept: "application/x-ndjson", "X-Import-Request-Id": requestId } });
  if (!response.ok) { const body = await response.json(); throw new DirectImportError(Array.isArray(body.message) ? body.message.join("；") : body.message ?? "上传失败", body.kind); }
  if (!response.body) throw new DirectImportError("文件处理结果未返回，请重试");
  const reader = response.body.getReader(), decoder = new TextDecoder(); let pending = "", batch: DirectMaterialBatchView | undefined;
  function receive(line: string) {
    if (!line.trim()) return;
    const event = JSON.parse(line) as { stage?: DirectMaterialProcessingStage; batch?: DirectMaterialBatchView; error?: { message?: string | string[]; kind?: string } };
    if (event.error) throw new DirectImportError(Array.isArray(event.error.message) ? event.error.message.join("；") : event.error.message ?? "文件处理失败", event.error.kind);
    if (event.stage) progress(event.stage);
    if (event.batch) batch = event.batch;
  }
  try {
    while (true) {
      const { value, done } = await reader.read(); pending += decoder.decode(value, { stream: !done });
      let end: number; while ((end = pending.indexOf("\n")) >= 0) { receive(pending.slice(0, end)); pending = pending.slice(end + 1); }
      if (done) { receive(pending); break; }
    }
  } finally { reader.releaseLock(); }
  if (!batch) throw new DirectImportError("文件处理未完成，请重试");
  return withAssetUrls(batch);
}
export function previewDirectMaterials(batch: DirectMaterialBatchView, information: DirectMaterialInformation) {
  return request(`/${batch.id}/preview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: batch.revision, information }) });
}
export function publishDirectMaterials(batch: DirectMaterialBatchView, reason: string) {
  return request(`/${batch.id}/publish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: batch.revision, previewHash: batch.previewHash, reason, confirmed: true }) });
}
export function downloadDirectBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function downloadDirectReference() {
  const response = await fetch(`${root}/reference`, { credentials: "include" });
  if (!response.ok) throw new Error("参考文件下载失败");
  downloadDirectBlob(await response.blob(), "新增瓷砖.xlsx");
}
