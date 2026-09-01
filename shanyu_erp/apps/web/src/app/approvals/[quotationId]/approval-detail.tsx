"use client";

import type {
  HalfPackageApprovalDecision,
  HalfPackageCostMargin,
  HalfPackageQuotation,
  ProjectDetail,
} from "@shanyu/contracts";
import { ArrowLeft, Check, RotateCcw, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { decideQuotation, formatQuotationMoney } from "@/lib/quotation-client";

interface ModuleRow {
  readonly cost: string | null;
  readonly detailsHref: string | null;
  readonly marginRate: string | null;
  readonly name: string;
  readonly note?: string;
  readonly profitOrRebate: string | null;
  readonly sales: string | null;
  readonly status: "COMPLETED" | "NOT_ENABLED";
  readonly thirdParty?: boolean;
}

export function ApprovalDetail({
  costMargin,
  initialQuotation,
  project,
}: {
  readonly costMargin: HalfPackageCostMargin;
  readonly initialQuotation: HalfPackageQuotation;
  readonly project: ProjectDetail;
}) {
  const router = useRouter();
  const [quotation, setQuotation] = useState(initialQuotation);
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnReason, setReturnReason] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = quotation.status === "PENDING_APPROVAL";
  const modules: readonly ModuleRow[] = [
    {
      cost: costMargin.expectedCost,
      detailsHref: `/projects/${project.id}/quotation/cost-margin?quotationId=${quotation.id}`,
      marginRate: costMargin.grossMarginRate,
      name: "半包报价",
      note: "09 总览 → 09B 工程项明细",
      profitOrRebate: costMargin.grossProfit,
      sales: costMargin.salesAmount,
      status: "COMPLETED",
    },
    disabledModule("铂屿木作定制"),
    disabledModule("定制报价"),
    {
      ...disabledModule("第三方代购"),
      note: "报价 / 成本 / 返点独立展示",
      thirdParty: true,
    },
    disabledModule("设计费"),
  ];

  async function decide(
    action: HalfPackageApprovalDecision,
    reason: string | null,
  ) {
    setWorking(true);
    setError(null);
    try {
      const decided = await decideQuotation(quotation.id, action, reason);
      setQuotation(decided);
      setReturnOpen(false);
      setReturnReason("");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "审批失败");
    } finally {
      setWorking(false);
    }
  }

  return (
    <main className="compact-workflow-page workflow-page">
      <header className="centered-workflow-header workflow-header">
        <div className="grid gap-1">
          <Link
            className="type-action flex w-fit items-center gap-1 text-muted-foreground hover:text-primary"
            href="/approvals"
          >
            <ArrowLeft className="size-3.5" />
            返回报价审批
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="type-page-title">{quotation.projectName}</h1>
            <Badge variant={pending ? "warning" : "success"}>
              {statusLabel(quotation.status)}
            </Badge>
          </div>
        </div>
        {pending ? (
          <div className="workflow-actions">
            <Button
              className="h-10 border-destructive text-destructive hover:bg-destructive-soft hover:text-destructive"
              disabled={working}
              onClick={() => setReturnOpen(true)}
              variant="outline"
            >
              <RotateCcw />
              打回修改
            </Button>
            <Button
              className="h-10 px-5"
              disabled={working}
              onClick={() => decide("APPROVED", null)}
            >
              <Check />
              批准
            </Button>
          </div>
        ) : null}
      </header>

      {error ? (
        <p
          className="type-body m-0 rounded-md bg-destructive-soft px-3 py-2 text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <Card className="border-border py-0 shadow-none">
        <CardContent className="grid gap-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="type-entity">项目基础信息</h2>
            <span className="type-support text-muted-foreground">
              当前有效版本 V{quotation.versionNumber} · 提交于 {formatDateTime(quotation.submittedAt)}
            </span>
          </div>
          <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2 xl:grid-cols-4">
            <ProjectField label="客户" value={project.customerName} />
            <ProjectField label="地址" value={project.address} />
            <ProjectField
              label="建筑面积"
              value={`${formatArea(project.buildingArea)} M²`}
            />
            <ProjectField
              label="主案设计师"
              value={project.leadDesigner.displayName}
            />
            <ProjectField label="木作设计师" value="未指派" />
            <ProjectField label="报价版本" value={`V${quotation.versionNumber}`} />
            <ProjectField
              label="提交时间"
              value={formatDateTime(quotation.submittedAt)}
            />
            <ProjectField label="报价状态" value={statusLabel(quotation.status)} />
          </div>
        </CardContent>
      </Card>

      <section className="grid gap-2" aria-label="项目经营汇总">
        <div className="flex items-center justify-between gap-3">
          <h2 className="type-entity">项目经营汇总</h2>
          <span className="type-support text-muted-foreground">
            不含第三方代购
          </span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <BusinessMetric
            label="项目报价 / 对客收入"
            note="不含第三方代购"
            value={`¥${displayMoney(costMargin.salesAmount)}`}
          />
          <BusinessMetric
            label="预计成本"
            note="当前待审批版本"
            value={`¥${displayMoney(costMargin.expectedCost)}`}
          />
          <BusinessMetric
            emphasis={moneyTone(costMargin.grossProfit)}
            label="预计毛利"
            note="项目报价 − 预计成本"
            value={`¥${displayMoney(costMargin.grossProfit)}`}
          />
          <BusinessMetric
            emphasis={moneyTone(costMargin.grossProfit)}
            label="综合毛利率"
            note="预计毛利 ÷ 项目报价"
            value={formatMarginRate(costMargin.grossMarginRate)}
          />
        </div>
      </section>

      <section className="grid gap-3 rounded-lg bg-warning-soft px-4 py-3 sm:grid-cols-[minmax(260px,1fr)_repeat(3,minmax(120px,170px))] sm:items-center">
        <div className="grid gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="type-entity">第三方代购</h2>
            <Badge className="bg-background text-warning" variant="warning">
              不计入项目毛利
            </Badge>
          </div>
          <p className="type-support m-0 text-muted-foreground">
            报价、成本和返点独立核算，不与项目经营指标混算
          </p>
        </div>
        <ThirdPartyMetric label="代购报价" />
        <ThirdPartyMetric label="代购成本" />
        <ThirdPartyMetric label="预计返点" />
      </section>

      <Card className="overflow-hidden border-border py-0 shadow-none">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <h2 className="type-entity">报价模块</h2>
          <span className="type-support text-muted-foreground">
            点击模块查看当前待审批版本的报价与成本明细
          </span>
        </div>
        <Table className="min-w-[980px] table-fixed">
          <colgroup>
            <col className="w-[230px]" />
            <col className="w-[100px]" />
            <col className="w-[150px]" />
            <col className="w-[150px]" />
            <col className="w-[150px]" />
            <col className="w-[110px]" />
            <col className="w-[210px]" />
          </colgroup>
          <TableHeader>
            <TableRow className="border-border bg-muted hover:bg-muted">
              <TableHead>报价模块</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>报价 / 对客收入</TableHead>
              <TableHead>预计成本</TableHead>
              <TableHead>预计毛利 / 返点</TableHead>
              <TableHead>毛利率</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {modules.map((module) => (
              <TableRow className="h-[51px] border-border" key={module.name}>
                <TableCell className="whitespace-normal py-2">
                  <strong className="type-table-body block font-semibold">
                    {module.name}
                  </strong>
                  {module.note ? (
                    <span className="mt-0.5 block text-[10px] leading-[15px] text-muted-foreground">
                      {module.note}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      module.status === "COMPLETED" ? "success" : "secondary"
                    }
                  >
                    {module.status === "COMPLETED" ? "已完成" : "未启用"}
                  </Badge>
                </TableCell>
                <ModuleValue value={module.sales} />
                <ModuleValue value={module.cost} />
                <ModuleValue
                  emphasis={
                    module.profitOrRebate
                      ? moneyTone(module.profitOrRebate)
                      : undefined
                  }
                  prefix={module.thirdParty ? "返点 " : undefined}
                  value={module.profitOrRebate}
                />
                <TableCell className="font-semibold">
                  {module.thirdParty
                    ? "不计入"
                    : module.marginRate === null
                      ? "未启用"
                      : formatMarginRate(module.marginRate)}
                </TableCell>
                <TableCell>
                  {module.detailsHref ? (
                    <Button asChild className="h-8 px-2.5" variant="ghost">
                      <Link href={module.detailsHref}>查看成本毛利 →</Link>
                    </Button>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <p className="type-support m-0 rounded-lg bg-primary-soft px-3 py-3 font-medium text-primary">
        批准或打回修改时校验当前有效版本；若申请已撤回，系统拒绝操作。打回修改必须填写原因并生成已退回版本。
      </p>

      <Dialog onOpenChange={setReturnOpen} open={returnOpen}>
        <DialogContent className="max-w-[550px] border-border">
          <DialogHeader className="gap-2">
            <DialogTitle>打回报价 V{quotation.versionNumber}</DialogTitle>
            <DialogDescription>
              打回后将生成“已退回”版本，主案设计师可按原因继续修改并再次提交。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <label className="type-form-label" htmlFor="return-reason">
              打回原因 *
            </label>
            <Textarea
              className="h-[110px] resize-none border-border"
              id="return-reason"
              onChange={(event) => setReturnReason(event.target.value)}
              placeholder="请明确说明需要修改的内容"
              value={returnReason}
            />
          </div>
          <p className="type-support m-0 rounded-md bg-warning-soft px-3 py-2 text-warning">
            原因、操作者、时间和版本将写入审计日志。
          </p>
          <DialogFooter>
            <Button
              className="border-border"
              onClick={() => setReturnOpen(false)}
              variant="outline"
            >
              <X />
              取消
            </Button>
            <Button
              disabled={working || !returnReason.trim()}
              onClick={() => decide("RETURNED", returnReason.trim())}
            >
              <RotateCcw />
              确认打回
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function ProjectField({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="grid min-w-0 gap-0.5 py-1">
      <span className="type-support text-muted-foreground">{label}</span>
      <strong className="type-table-body truncate font-medium" title={value}>
        {value}
      </strong>
    </div>
  );
}

function BusinessMetric({
  emphasis,
  label,
  note,
  value,
}: {
  readonly emphasis?: string;
  readonly label: string;
  readonly note: string;
  readonly value: string;
}) {
  return (
    <Card className="border-border py-0 shadow-none">
      <CardContent className="grid gap-1 p-3.5">
        <span className="type-support text-muted-foreground">{label}</span>
        <strong className={`text-[21px] leading-[29px] font-semibold ${emphasis ?? ""}`}>
          {value}
        </strong>
        <small className="type-support text-muted-foreground">{note}</small>
      </CardContent>
    </Card>
  );
}

function ThirdPartyMetric({ label }: { readonly label: string }) {
  return (
    <div className="grid gap-1">
      <span className="type-support text-muted-foreground">{label}</span>
      <strong className="type-section-title text-warning">未启用</strong>
    </div>
  );
}

function ModuleValue({
  emphasis,
  prefix = "",
  value,
}: {
  readonly emphasis?: string;
  readonly prefix?: string;
  readonly value: string | null;
}) {
  return (
    <TableCell className={`font-medium tabular-nums ${emphasis ?? ""}`}>
      {value === null ? "未启用" : `${prefix}¥${displayMoney(value)}`}
    </TableCell>
  );
}

function disabledModule(name: string): ModuleRow {
  return {
    cost: null,
    detailsHref: null,
    marginRate: null,
    name,
    profitOrRebate: null,
    sales: null,
    status: "NOT_ENABLED",
  };
}

function displayMoney(value: string): string {
  return formatQuotationMoney(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatMarginRate(value: string | null): string {
  return value === null ? "—" : `${(Number(value) * 100).toFixed(2)}%`;
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function formatArea(value: string): string {
  return Number(value).toFixed(2);
}

function moneyTone(value: string): string {
  return value.startsWith("-") ? "text-destructive" : "text-success";
}

function statusLabel(status: HalfPackageQuotation["status"]): string {
  return {
    APPROVED: "已审批",
    DRAFT: "草稿",
    PENDING_APPROVAL: "待审批",
    PENDING_PRICING: "待定价",
    PENDING_SUPPLEMENT: "待补充",
    RETURNED: "已退回",
    SUPERSEDED: "已替代",
    VOID: "已作废",
  }[status];
}
