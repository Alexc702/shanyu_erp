"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ProjectDetail, UserSummary } from "@shanyu/contracts";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { apiUrl } from "@/lib/api-url";

export function TransferLead({ project, designers }: { project: ProjectDetail; designers: UserSummary[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<"transfer" | "revoke" | null>(null);
  const [target, setTarget] = useState("");
  const [retain, setRetain] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  function open(next: "transfer" | "revoke") { setMode(next); setTarget(""); setRetain(false); setReason(""); setError(""); setMessage(""); }
  async function confirm() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`${apiUrl}/projects/${project.id}/${mode === "transfer" ? "lead-transfer" : "revoke-readonly"}`, {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedAccessRevision: project.accessRevision, ...(mode === "transfer" ? { leadDesignerId: target, retainReadonly: retain, reason } : {}) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(typeof body.message === "string" ? body.message : "操作失败，请刷新后重试");
      setMessage(mode === "transfer" ? "转交成功，已更新负责人及项目权限。" : "已取消原主案只读权限。");
      setMode(null); router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "操作失败"); }
    finally { setBusy(false); }
  }
  return <>
    <Button variant="outline" onClick={() => open("transfer")}>转交主案</Button>
    {project.readonlyDesigner ? <Button variant="outline" onClick={() => open("revoke")}>取消只读权限</Button> : null}
    {message ? <span role="status" className="type-support text-muted-foreground">{message}</span> : null}
    <Dialog open={mode !== null} onOpenChange={open => { if (!open && !busy) setMode(null); }}>
      <DialogContent className={mode === "revoke" ? "max-w-[600px] gap-6 p-8" : "max-h-[90vh] max-w-[680px] gap-[18px] overflow-y-auto p-8"}>
        <DialogHeader><DialogTitle>{mode === "revoke" ? `取消 ${project.readonlyDesigner?.displayName} 的只读权限？` : "转交主案"}</DialogTitle>
          <DialogDescription>{project.projectAddress} · 仅变更当前负责人</DialogDescription></DialogHeader>
        <p className="type-body">当前主案　{project.leadDesigner.displayName}</p>
        {mode === "transfer" ? <>
          <label className="grid gap-2 type-table-head">新主案 *
            <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={target} onChange={e => setTarget(e.target.value)} disabled={busy}>
              <option value="">请选择新主案</option>
              {designers.filter(d => d.role === "LEAD_DESIGNER" && d.status === "ACTIVE" && d.id !== project.leadDesigner.id).map(d => <option key={d.id} value={d.id}>{d.displayName}（主案设计师 · 启用）</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2.5 type-body"><Checkbox checked={retain} disabled={busy} onCheckedChange={v => setRetain(v === true)} />保留原主案只读查看权限</label>
          <p className="type-body text-muted-foreground">{retain ? `${project.leadDesigner.displayName} 将保留最新进展的只读查看，不能修改、打印或导出。` : `转交后，${project.leadDesigner.displayName} 将无法查看此项目。`}<br />{project.readonlyDesigner ? `已有只读者：${project.readonlyDesigner.displayName}；本次转交后将失去访问权限。` : "如已有更早的只读者，其访问权限也将取消。"}</p>
          <label className="grid gap-2 type-table-head">转交原因（选填）<Textarea className="min-h-20" placeholder="请填写转交原因" maxLength={1000} value={reason} disabled={busy} onChange={e => setReason(e.target.value)} /></label>
          <p className="rounded-md bg-muted p-3 type-support text-muted-foreground">新主案接手已保存数据及后续返修／待办；未保存输入不交接。<br />报价金额、历史署名、审批快照与库版本保持不变。</p>
        </> : <><p className="type-body">原主案只读查看者：{project.readonlyDesigner?.displayName}</p><p className="type-body text-muted-foreground">取消后，该用户将无法在列表、搜索、统计或旧链接中访问此项目。当前主案及其他角色权限不变。已下载文件无法收回。</p></>}
        {error ? <p role="alert" className="type-body text-destructive">{error}</p> : null}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setMode(null)}>{mode === "revoke" ? "暂不取消" : "取消"}</Button><Button disabled={busy || (mode === "transfer" && !target)} onClick={() => void confirm()}>{busy ? "保存中…" : mode === "revoke" ? "确认取消只读" : "确认转交"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
