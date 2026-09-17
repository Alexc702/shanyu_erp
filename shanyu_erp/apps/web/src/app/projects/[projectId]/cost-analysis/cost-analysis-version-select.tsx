"use client";

import type { HalfPackageQuotationVersionSummary } from "@shanyu/contracts";
import { useRouter, useSearchParams } from "next/navigation";

import { NativeSelect } from "@/components/ui/native-select";

export function CostAnalysisVersionSelect({
  projectId,
  selectedId,
  versions,
}: {
  readonly projectId: string;
  readonly selectedId: string;
  readonly versions: readonly HalfPackageQuotationVersionSummary[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function selectVersion(quotationId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("quotationId", quotationId);
    router.push(`/projects/${projectId}/cost-analysis?${params.toString()}`);
  }

  return (
    <NativeSelect
      aria-label="选择报价版本"
      className="min-w-44 font-medium"
      onChange={(event) => selectVersion(event.target.value)}
      value={selectedId}
    >
      {versions.map((version) => (
        <option key={version.id} value={version.id}>
          V{version.versionNumber} · {versionStatusLabel(version)}
        </option>
      ))}
    </NativeSelect>
  );
}

function versionStatusLabel(
  version: HalfPackageQuotationVersionSummary,
): string {
  if (version.adjustmentStatus === "PENDING_APPROVAL") return "优惠审批中";
  if (version.status === "APPROVED") return "批准生效";
  if (version.status === "RETURNED") return "已退回";
  if (version.status === "DRAFT") return "草稿实时";
  return version.isCurrent ? "当前生效" : "历史版本";
}
