"use client";

import type {
  CatalogImportBatchSummary,
  CatalogImportResponse,
  PublishedHalfPackageCatalogResponse,
} from "@shanyu/contracts";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiUrl } from "@/lib/api-client";

interface CatalogImportFormProps {
  readonly currentItemCount: number;
  readonly currentVersionNumber: number | null;
}

export function CatalogImportForm({
  currentItemCount,
  currentVersionNumber,
}: CatalogImportFormProps) {
  const router = useRouter();
  const [batch, setBatch] = useState<CatalogImportBatchSummary | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [message, setMessage] = useState("");

  async function handleValidate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBatch(null);
    setConfirmed(false);
    setMessage("");
    setIsValidating(true);
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch(`${apiUrl}/catalog/half-package/imports`, {
        body: form,
        credentials: "include",
        method: "POST",
      });
      const payload = (await response.json()) as CatalogImportResponse & {
        message?: string;
      };
      if (!response.ok) {
        setMessage(payload.message ?? "Excel 校验失败");
        return;
      }
      setBatch(payload.batch);
      setMessage(
        payload.batch.reused
          ? "该文件已校验，已复用原导入批次。"
          : "Excel 校验完成。",
      );
    } catch {
      setMessage("暂时无法连接服务");
    } finally {
      setIsValidating(false);
    }
  }

  async function handlePublish() {
    if (!batch || batch.status !== "VALIDATED" || !confirmed) {
      return;
    }
    setMessage("");
    setIsPublishing(true);
    try {
      const response = await fetch(
        `${apiUrl}/catalog/half-package/imports/${batch.id}/publish`,
        { credentials: "include", method: "POST" },
      );
      const payload = (await response.json()) as
        | PublishedHalfPackageCatalogResponse
        | { message?: string };
      if (!response.ok) {
        setMessage("message" in payload && payload.message ? payload.message : "发布失败");
        return;
      }
      router.replace("/catalog");
      router.refresh();
    } catch {
      setMessage("暂时无法连接服务");
    } finally {
      setIsPublishing(false);
    }
  }

  const report = batch?.validation;
  const nextItemCount = report?.itemCount ?? 0;

  return (
    <div className="catalog-import-grid">
      <section className="panel catalog-upload-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">01 · 选择文件</p>
            <h2>上传来源 Excel</h2>
            <p>必须包含“半包报价模板”工作表；同一文件会按 SHA-256 复用校验结果。</p>
          </div>
        </div>
        <form className="catalog-upload-form" onSubmit={handleValidate}>
          <Label htmlFor="catalog-file">Excel 文件</Label>
          <Input accept=".xlsx" id="catalog-file" name="file" required type="file" />
          <Button disabled={isValidating}>
            {isValidating ? "正在校验…" : "上传并校验"}
          </Button>
        </form>
        {message ? <p className="catalog-form-message" aria-live="polite">{message}</p> : null}
      </section>

      <aside className="panel catalog-rules-panel">
        <p className="eyebrow">本次对算口径</p>
        <h2>源 Excel → 发布版本</h2>
        <ul>
          <li>8 个固定报价分区、157 个标准工程项</li>
          <li>销售价 157 项、成本价 157 项，内部保留 4 位小数</li>
          <li>41 条 Excel 公式仅原样保留，未经映射不自动执行</li>
          <li>第 56、101、163 行缺施工说明按已确认警告处理</li>
        </ul>
      </aside>

      {report ? (
        <section className="panel catalog-validation-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">02 · 校验与差异</p>
              <h2>{report.blockerCount === 0 ? "校验通过" : "存在阻断错误"}</h2>
            </div>
            <span className={report.blockerCount === 0 ? "validation-pass" : "validation-fail"}>
              {report.blockerCount === 0 ? "可发布" : `${report.blockerCount} 项阻断`}
            </span>
          </div>

          <div className="validation-metrics">
            <ValidationMetric actual={report.sectionCount} expected={8} label="报价分区" />
            <ValidationMetric actual={report.itemCount} expected={157} label="工程项" />
            <ValidationMetric actual={report.salePriceCount} expected={157} label="销售价" />
            <ValidationMetric actual={report.costPriceCount} expected={157} label="成本价" />
            <ValidationMetric actual={report.formulaCount} expected={41} label="保留公式" />
          </div>

          <div className="catalog-diff-row">
            <div>
              <span>现行版本</span>
              <strong>{currentVersionNumber ? `V${currentVersionNumber} · ${currentItemCount} 项` : "尚未发布"}</strong>
            </div>
            <span aria-hidden="true">→</span>
            <div>
              <span>待发布批次</span>
              <strong>{nextItemCount} 项</strong>
            </div>
            <span className="catalog-delta">
              {currentVersionNumber ? `${nextItemCount - currentItemCount >= 0 ? "+" : ""}${nextItemCount - currentItemCount} 项` : `+${nextItemCount} 项`}
            </span>
          </div>

          {report.blockers.length > 0 ? (
            <ul className="validation-errors">
              {report.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
            </ul>
          ) : null}
          <p className="validation-warning">
            已确认警告行：{report.warningSourceRows.join("、") || "无"}
          </p>

          {batch.status === "VALIDATED" ? (
            <div className="catalog-publish-box">
              <label className="inline-check">
                <Checkbox
                  checked={confirmed}
                  onCheckedChange={(checked) => setConfirmed(checked === true)}
                />
                <span>我已确认上述对算结果，并同意发布不可变的新版本。</span>
              </label>
              <Button
                disabled={!confirmed || isPublishing}
                onClick={handlePublish}
                type="button"
              >
                {isPublishing ? "正在发布…" : "确认发布"}
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function ValidationMetric({
  actual,
  expected,
  label,
}: {
  readonly actual: number;
  readonly expected: number;
  readonly label: string;
}) {
  return (
    <div>
      <span>{label}</span>
      <strong>{actual}</strong>
      <small>/ {expected}</small>
    </div>
  );
}
