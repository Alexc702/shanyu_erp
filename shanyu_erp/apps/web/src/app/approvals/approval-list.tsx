"use client";

import type { HalfPackageApprovalSummary } from "@shanyu/contracts";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatQuotationMoney } from "@/lib/quotation-client";

interface ApprovalListItem extends HalfPackageApprovalSummary {
  readonly leadDesignerName: string;
}

const pageSize = 10;

export function ApprovalList({
  quotations,
}: {
  readonly quotations: readonly ApprovalListItem[];
}) {
  const [query, setQuery] = useState("");
  const [leadDesigner, setLeadDesigner] = useState("ALL");
  const [page, setPage] = useState(1);
  const leadDesigners = useMemo(
    () => [...new Set(quotations.map((item) => item.leadDesignerName))],
    [quotations],
  );
  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("zh-CN");
    return quotations.filter(
      (item) =>
        (leadDesigner === "ALL" ||
          item.leadDesignerName === leadDesigner) &&
        (!keyword ||
          item.projectName.toLocaleLowerCase("zh-CN").includes(keyword) ||
          item.customerName.toLocaleLowerCase("zh-CN").includes(keyword)),
    );
  }, [leadDesigner, query, quotations]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const activePage = Math.min(page, pageCount);
  const visible = filtered.slice(
    (activePage - 1) * pageSize,
    activePage * pageSize,
  );

  return (
    <main className="compact-workflow-page workflow-page">
      <header className="centered-workflow-header workflow-header">
        <div className="grid gap-1">
          <h1 className="type-page-title">报价审批</h1>
          <p className="type-table-body">
            仅展示当前有效的待审批项目，以项目报价与毛利水平作为审批依据
          </p>
        </div>
        <Badge className="px-2.5 py-1" variant="warning">
          {quotations.length} 项待审批
        </Badge>
      </header>

      <div className="flex flex-wrap items-center gap-2" aria-label="审批筛选">
        <label className="relative min-w-[260px] flex-1 sm:max-w-[320px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="搜索项目或客户"
            className="h-10 border-border pl-9"
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder="搜索项目、客户…"
            value={query}
          />
        </label>
        <select
          aria-label="筛选主案设计师"
          className="type-form-control h-10 min-w-[148px] rounded-md border border-border bg-background px-3 text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          onChange={(event) => {
            setLeadDesigner(event.target.value);
            setPage(1);
          }}
          value={leadDesigner}
        >
          <option value="ALL">全部主案设计师</option>
          {leadDesigners.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <span className="type-support ml-auto text-muted-foreground">
          按提交时间倒序
        </span>
      </div>

      <div className="type-table-body rounded-lg bg-primary-soft px-3 py-3 font-medium text-primary">
        项目报价、预计成本、预计毛利及综合毛利率均不含第三方代购；第三方代购报价单独展示。
      </div>

      <Card className="overflow-hidden border-border shadow-none">
        <Table className="min-w-[1120px] table-fixed">
          <colgroup>
            <col className="w-[188px]" />
            <col className="w-[170px]" />
            <col className="w-[132px]" />
            <col className="w-[132px]" />
            <col className="w-[132px]" />
            <col className="w-[110px]" />
            <col className="w-[150px]" />
            <col className="w-[130px]" />
          </colgroup>
          <TableHeader>
            <TableRow className="border-border bg-muted hover:bg-muted">
              <TableHead className="h-[42px]">项目 / 客户</TableHead>
              <TableHead className="h-[42px]">提交信息</TableHead>
              <TableHead className="h-[42px] whitespace-normal">
                项目报价 / 对客收入
              </TableHead>
              <TableHead className="h-[42px]">预计成本</TableHead>
              <TableHead className="h-[42px]">预计毛利</TableHead>
              <TableHead className="h-[42px]">综合毛利率</TableHead>
              <TableHead className="h-[42px]">第三方代购</TableHead>
              <TableHead className="h-[42px]">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((quotation) => (
              <TableRow className="h-[88px] border-border" key={quotation.id}>
                <TableCell className="whitespace-normal px-3 py-3">
                  <strong className="type-entity block">
                    {quotation.projectName}
                  </strong>
                  <span className="type-support mt-1 block text-muted-foreground">
                    {quotation.customerName}
                  </span>
                </TableCell>
                <TableCell className="whitespace-normal px-3 py-3">
                  <strong className="type-table-body block font-medium">
                    {quotation.leadDesignerName} · V{quotation.versionNumber}
                  </strong>
                  <span className="type-support mt-1 block text-muted-foreground">
                    {formatDateTime(quotation.submittedAt)}
                  </span>
                </TableCell>
                <MoneyCell value={quotation.salesAmount} />
                <MoneyCell value={quotation.expectedCost} />
                <MoneyCell
                  emphasis={moneyTone(quotation.grossProfit)}
                  value={quotation.grossProfit}
                />
                <TableCell
                  className={`px-3 font-semibold ${moneyTone(quotation.grossProfit)}`}
                >
                  {formatMarginRate(quotation.grossMarginRate)}
                </TableCell>
                <TableCell className="px-3 font-medium text-warning">
                  {quotation.thirdPartyPurchaseAmount === null
                    ? "未启用"
                    : `¥${displayMoney(quotation.thirdPartyPurchaseAmount)}`}
                </TableCell>
                <TableCell className="px-3">
                  <Button asChild className="h-8 px-2.5" variant="ghost">
                    <Link href={`/approvals/${quotation.id}`}>
                      查看详情 →
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {visible.length === 0 ? (
          <div className="type-body flex h-40 items-center justify-center text-muted-foreground">
            当前筛选条件下没有待审批报价
          </div>
        ) : null}
        <footer className="flex h-12 items-center justify-between border-t border-border px-3">
          <span className="type-support text-muted-foreground">
            共 {filtered.length} 项 · 每页 {pageSize} 项
          </span>
          <div className="flex gap-1.5">
            <Button
              aria-label="上一页"
              className="size-8"
              disabled={activePage <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              size="icon"
              variant="secondary"
            >
              <ChevronLeft />
            </Button>
            <Button
              aria-label="下一页"
              className="size-8"
              disabled={activePage >= pageCount}
              onClick={() =>
                setPage((current) => Math.min(pageCount, current + 1))
              }
              size="icon"
              variant="secondary"
            >
              <ChevronRight />
            </Button>
          </div>
        </footer>
      </Card>
    </main>
  );
}

function MoneyCell({
  emphasis = "",
  value,
}: {
  readonly emphasis?: string;
  readonly value: string;
}) {
  return (
    <TableCell className={`px-3 font-semibold tabular-nums ${emphasis}`}>
      ¥{displayMoney(value)}
    </TableCell>
  );
}

function displayMoney(value: string | null): string {
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
  }).format(new Date(value));
}

function moneyTone(value: string): string {
  return value.startsWith("-") ? "text-destructive" : "text-success";
}
