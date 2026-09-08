"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateQuotationMarginBenchmark } from "@/lib/quotation-client";

export function MarginBenchmarkControl({
  initialRate,
  projectId,
  quotationId,
}: {
  readonly initialRate: string;
  readonly projectId: string;
  readonly quotationId: string;
}) {
  const router = useRouter();
  const [percent, setPercent] = useState(formatPercent(initialRate));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const costMargin = await updateQuotationMarginBenchmark(
        projectId,
        quotationId,
        percent,
      );
      setPercent(formatPercent(costMargin.marginBenchmarkRate));
      setMessage("已保存");
      router.refresh();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex items-end gap-2" onSubmit={save}>
      <label className="grid gap-1 type-table-head">
        基准毛利率
        <span className="relative block w-28">
          <Input
            className="pr-7"
            disabled={busy}
            inputMode="decimal"
            onChange={(event) => setPercent(event.target.value)}
            value={percent}
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 type-body text-muted-foreground">
            %
          </span>
        </span>
      </label>
      <Button disabled={busy} type="submit" variant="outline">
        {busy ? "保存中…" : "保存基准"}
      </Button>
      {message ? (
        <span className="type-support text-muted-foreground" role="status">
          {message}
        </span>
      ) : null}
    </form>
  );
}

function formatPercent(rate: string): string {
  return (Number(rate) * 100).toFixed(2).replace(/\.00$/, "");
}
