"use client";

import type {
  HalfPackageQuotation,
  ProjectSpace,
  SpaceInput,
  SpaceType,
} from "@shanyu/contracts";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  LockKeyhole,
  PencilLine,
  Plus,
  Settings2,
  Trash2,
} from "lucide-react";
import type { FormEvent, MouseEvent } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiUrl } from "@/lib/api-url";
import { continueEditingQuotation } from "@/lib/quotation-client";
import { moveSpace } from "@/lib/space-order";

interface SpaceManagerProps {
  readonly projectId: string;
  readonly quotation: HalfPackageQuotation;
  readonly spaces: readonly ProjectSpace[];
}

type ManagerView =
  | { readonly kind: "LIST" }
  | { readonly kind: "ADD" }
  | { readonly kind: "RENAME"; readonly space: ProjectSpace };

export const spaceTypeLabels: Record<SpaceType, string> = {
  BALCONY: "阳台",
  BATHROOM: "卫生间",
  BEDROOM: "卧室",
  CLOSET: "衣帽间",
  KITCHEN: "厨房",
  LIVING_DINING: "客餐厅",
};

export function SpaceManager({ projectId, quotation, spaces }: SpaceManagerProps) {
  const router = useRouter();
  const [currentQuotation, setCurrentQuotation] = useState(quotation);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<ManagerView>({ kind: "LIST" });
  const [deleteTarget, setDeleteTarget] = useState<ProjectSpace | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  const [orderedSpaces, setOrderedSpaces] = useState(() => [...spaces]);
  const canAdjust = currentQuotation.status === "DRAFT";
  const hasWrappedBalcony = spaces.some(
    (space) => space.type === "LIVING_DINING" && space.includesBalcony,
  );

  function changeOpen(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen) {
      setOrderedSpaces([...spaces]);
    }
    if (!nextOpen) {
      setView({ kind: "LIST" });
      setMessage("");
    }
  }

  async function saveOrder() {
    setIsPending(true);
    setMessage("");
    try {
      const response = await fetch(`${apiUrl}/projects/${projectId}/spaces/order`, {
        body: JSON.stringify({ spaceIds: orderedSpaces.map((space) => space.id) }),
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "PUT",
      });
      if (!response.ok) throw await responseError(response, "空间排序保存失败");
      finish();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "空间排序保存失败");
    } finally {
      setIsPending(false);
    }
  }

  function finish() {
    setSuccess(true);
    setOpen(false);
    setView({ kind: "LIST" });
    router.refresh();
  }

  async function prepareAdjustment() {
    setIsPending(true);
    setMessage("");
    try {
      const draft = await continueEditingQuotation(
        projectId,
        currentQuotation.id,
      );
      setCurrentQuotation(draft);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法建立新草稿");
    } finally {
      setIsPending(false);
    }
  }

  async function remove(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (!deleteTarget) return;
    setIsPending(true);
    setMessage("");
    try {
      const response = await fetch(
        `${apiUrl}/projects/${projectId}/spaces/${deleteTarget.id}`,
        { credentials: "include", method: "DELETE" },
      );
      if (!response.ok) throw await responseError(response, "删除失败");
      setDeleteTarget(null);
      finish();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除失败");
      setDeleteTarget(null);
    } finally {
      setIsPending(false);
    }
  }

  const deleteSelectedCount = deleteTarget
    ? currentQuotation.scopes
        .find((scope) => scope.projectSpaceId === deleteTarget.id)
        ?.lines.filter((line) => line.selected).length ?? 0
    : 0;

  return (
    <>
      <Dialog onOpenChange={changeOpen} open={open}>
        <DialogTrigger asChild>
          <Button variant="outline"><Settings2 />调整空间</Button>
        </DialogTrigger>
        {canAdjust ? (
          view.kind === "LIST" ? (
            <DialogContent className="max-h-[88vh] max-w-4xl overflow-y-auto border-border p-0">
              <DialogHeader className="border-b border-border px-6 py-5">
                <DialogTitle>调整空间</DialogTitle>
                <DialogDescription>
                  修改同步至当前半包草稿；历史报价版本、导出文件及当时空间名称不受影响。
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 px-6">
                <div className="flex items-center justify-between gap-3">
                  <div><p className="font-medium">当前空间</p><p className="type-support text-muted-foreground">共 {spaces.length} 个空间</p></div>
                  <Button onClick={() => setView({ kind: "ADD" })} size="sm"><Plus />增加空间</Button>
                </div>
                <div className="overflow-hidden rounded-lg border border-border">
                  <div className="type-table-head hidden grid-cols-[100px_minmax(120px,1fr)_90px_90px_90px_190px] gap-3 bg-muted/55 px-4 py-2 text-muted-foreground md:grid">
                    <span>类型</span><span>显示名称</span><span>面积㎡</span><span>周长m</span><span>层高m</span><span className="text-right">操作</span>
                  </div>
                  {orderedSpaces.map((space, index) => (
                    <div className="grid gap-3 border-t border-border px-4 py-3 first:border-t-0 md:grid-cols-[100px_minmax(120px,1fr)_90px_90px_90px_190px] md:items-center" key={space.id}>
                      <span className="type-body text-muted-foreground">{spaceTypeLabels[space.type]}</span>
                      <div className="flex items-center gap-2"><span className="font-medium">{space.displayName}</span>{space.includesBalcony ? <Badge variant="outline">包阳台</Badge> : null}</div>
                      <span className="type-body">{Number(space.area).toFixed(2)}</span>
                      <span className="type-body">{Number(space.perimeter).toFixed(2)}</span>
                      <span className="type-body">{Number(space.height).toFixed(2)}</span>
                      <div className="flex justify-end gap-1">
                        <Button aria-label={`上移${space.displayName}`} disabled={index === 0 || isPending} onClick={() => setOrderedSpaces((current) => moveSpace(current, index, -1))} size="icon" variant="ghost"><ArrowUp /></Button>
                        <Button aria-label={`下移${space.displayName}`} disabled={index === orderedSpaces.length - 1 || isPending} onClick={() => setOrderedSpaces((current) => moveSpace(current, index, 1))} size="icon" variant="ghost"><ArrowDown /></Button>
                        <Button aria-label={`修改${space.displayName}`} onClick={() => setView({ kind: "RENAME", space })} size="icon" variant="ghost"><PencilLine /></Button>
                        <Button aria-label={`删除${space.displayName}`} disabled={spaces.length === 1} onClick={() => setDeleteTarget(space)} size="icon" variant="ghost"><Trash2 className="text-destructive" /></Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <DialogFooter className="border-t border-border px-6 py-4">
                <p className="type-support mr-auto text-muted-foreground">仅当前草稿可保存；排序同步至半包报价及客户版导出。</p>
                <Button disabled={isPending} onClick={() => changeOpen(false)} variant="outline">取消</Button>
                <Button disabled={isPending} onClick={() => void saveOrder()}>{isPending ? "保存中…" : "保存调整"}</Button>
              </DialogFooter>
            </DialogContent>
          ) : view.kind === "ADD" ? (
            <AddSpaceDialog
              hasWrappedBalcony={hasWrappedBalcony}
              onBack={() => setView({ kind: "LIST" })}
              onFinish={finish}
              projectId={projectId}
            />
          ) : (
            <RenameSpaceDialog
              onBack={() => setView({ kind: "LIST" })}
              onFinish={finish}
              projectId={projectId}
              space={view.space}
            />
          )
        ) : (
          <DialogContent className="max-w-lg border-border">
            <DialogHeader>
              <span className="mb-2 grid size-10 place-items-center rounded-full bg-warning-soft text-warning"><LockKeyhole className="size-5" /></span>
              <DialogTitle>当前报价暂不可调整空间</DialogTitle>
              <DialogDescription>
                {currentQuotation.status === "APPROVED"
                  ? "当前报价已批准。请先由老板打回，再调整项目空间。"
                  : "调整空间将自动建立新草稿，当前已生成报价单随即失效，修改后需再次确认生成。"}
              </DialogDescription>
            </DialogHeader>
            {message ? <p className="type-body text-destructive" role="alert">{message}</p> : null}
            <DialogFooter>
              <Button disabled={isPending} onClick={() => changeOpen(false)} variant="outline">取消</Button>
              {currentQuotation.status === "APPROVED" ? (
                <Button asChild><a href={`/projects/${projectId}/quotation/versions`}>项目版本管理</a></Button>
              ) : (
                <Button disabled={isPending} onClick={() => void prepareAdjustment()}>
                  {isPending ? "正在建立草稿…" : "确认并调整空间"}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      <AlertDialog onOpenChange={(next) => !next && setDeleteTarget(null)} open={deleteTarget !== null}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <span className="mb-2 grid size-10 place-items-center rounded-full bg-destructive-soft text-destructive"><AlertTriangle className="size-5" /></span>
            <AlertDialogTitle>删除空间“{deleteTarget?.displayName}”？</AlertDialogTitle>
            <AlertDialogDescription>
              确认后，该空间会从当前草稿及后续报价中移除，此操作不能撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="type-body space-y-2 rounded-lg border border-border bg-muted/35 p-4">
            <p className="font-medium">当前草稿影响</p>
            <p className="flex justify-between"><span className="text-muted-foreground">半包报价</span><span>{deleteSelectedCount > 0 ? `删除 ${deleteSelectedCount} 个已选工程项数据` : "无已选数据"}</span></p>
            <p className="flex justify-between"><span className="text-muted-foreground">木作报价</span><span>当前未启用</span></p>
            <p className="flex justify-between"><span className="text-muted-foreground">第三方报价</span><span>当前未启用</span></p>
          </div>
          <p className="type-support text-muted-foreground">历史报价版本、导出文件及当时空间名称不受影响。</p>
          {message ? <p className="type-body text-destructive" role="alert">{message}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>取消</AlertDialogCancel>
            <AlertDialogAction disabled={isPending} onClick={remove}>
              {isPending ? "删除中…" : "确认删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {success ? (
        <div className="fixed bottom-6 right-6 z-[70] flex items-center gap-3 rounded-lg border border-border bg-background px-4 py-3 shadow-lg" role="status">
          <CheckCircle2 className="size-5 text-success" />
          <div><p className="type-entity">空间调整已保存</p><p className="type-support text-muted-foreground">当前项目与半包草稿已同步</p></div>
          <Button aria-label="关闭提示" onClick={() => setSuccess(false)} size="sm" variant="ghost">关闭</Button>
        </div>
      ) : null}
    </>
  );
}

function AddSpaceDialog({
  hasWrappedBalcony,
  onBack,
  onFinish,
  projectId,
}: {
  readonly hasWrappedBalcony: boolean;
  readonly onBack: () => void;
  readonly onFinish: () => void;
  readonly projectId: string;
}) {
  const [type, setType] = useState<SpaceType>("BEDROOM");
  const [includeBalcony, setIncludeBalcony] = useState(false);
  const [confirmStandaloneBalcony, setConfirmStandaloneBalcony] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setIsPending(true);
    setMessage("");
    try {
      const response = await fetch(`${apiUrl}/projects/${projectId}/spaces`, {
        body: JSON.stringify({
          area: form.get("area"),
          confirmStandaloneBalcony,
          displayName: form.get("displayName"),
          height: form.get("height"),
          includesBalcony: type === "LIVING_DINING" && includeBalcony,
          perimeter: form.get("perimeter"),
          type,
        }),
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) throw await responseError(response, "新增失败");
      onFinish();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "新增失败");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <DialogContent className="max-w-2xl border-border">
      <DialogHeader><DialogTitle>增加空间</DialogTitle><DialogDescription>填写空间基础参数。名称须为 1–6 个字符且项目内唯一。</DialogDescription></DialogHeader>
      <form className="space-y-5" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="空间类型"><select className={selectClass} onChange={(event) => { setType(event.target.value as SpaceType); setIncludeBalcony(false); setConfirmStandaloneBalcony(false); }} value={type}>{Object.entries(spaceTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
          <Field label="空间名称"><Input maxLength={6} minLength={1} name="displayName" placeholder="如主卧" required /></Field>
          <Field label="面积（㎡）"><Input inputMode="decimal" name="area" required /></Field>
          <Field label="周长（m）"><Input inputMode="decimal" name="perimeter" required /></Field>
          <Field label="层高（m）"><Input inputMode="decimal" name="height" required /></Field>
        </div>
        {type === "LIVING_DINING" ? <CheckRow checked={includeBalcony} label="客餐厅包阳台" onCheckedChange={setIncludeBalcony} /> : null}
        {type === "BALCONY" && hasWrappedBalcony ? <div className="rounded-lg border border-warning/30 bg-warning-soft p-3"><CheckRow checked={confirmStandaloneBalcony} label="客餐厅已包阳台，我确认仍需新增独立阳台" onCheckedChange={setConfirmStandaloneBalcony} /></div> : null}
        {message ? <p className="type-body text-destructive" role="alert">{message}</p> : null}
        <DialogFooter><Button disabled={isPending} onClick={onBack} type="button" variant="outline">返回列表</Button><Button disabled={isPending}>{isPending ? "保存中…" : "增加空间"}</Button></DialogFooter>
      </form>
    </DialogContent>
  );
}

function RenameSpaceDialog({
  onBack,
  onFinish,
  projectId,
  space,
}: {
  readonly onBack: () => void;
  readonly onFinish: () => void;
  readonly projectId: string;
  readonly space: ProjectSpace;
}) {
  const [isPending, setIsPending] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input: SpaceInput = {
      area: String(form.get("area") ?? ""),
      displayName: String(form.get("displayName") ?? ""),
      height: String(form.get("height") ?? ""),
      includesBalcony: space.includesBalcony,
      perimeter: String(form.get("perimeter") ?? ""),
      type: space.type,
    };
    setIsPending(true);
    setMessage("");
    try {
      const response = await fetch(`${apiUrl}/projects/${projectId}/spaces/${space.id}`, {
        body: JSON.stringify(input),
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "PATCH",
      });
      if (!response.ok) throw await responseError(response, "修改失败");
      onFinish();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "修改失败");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <DialogContent className="max-w-lg border-border">
      <DialogHeader><DialogTitle>修改空间</DialogTitle><DialogDescription>{spaceTypeLabels[space.type]} · 自动工程项将按新参数重算，手工数量保持不变。</DialogDescription></DialogHeader>
      <form className="space-y-5" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="显示名称"><Input defaultValue={space.displayName} maxLength={6} minLength={1} name="displayName" required /></Field>
          <Field label="面积（㎡）"><Input defaultValue={space.area} inputMode="decimal" name="area" required /></Field>
          <Field label="周长（m）"><Input defaultValue={space.perimeter} inputMode="decimal" name="perimeter" required /></Field>
          <Field label="层高（m）"><Input defaultValue={space.height} inputMode="decimal" name="height" required /></Field>
        </div>
        <p className="type-support text-muted-foreground">修改同步至当前半包草稿；历史报价版本保留原名称和参数。</p>
        {message ? <p className="type-body text-destructive" role="alert">{message}</p> : null}
        <DialogFooter><Button disabled={isPending} onClick={onBack} type="button" variant="outline">返回列表</Button><Button disabled={isPending}>{isPending ? "保存中…" : "保存修改"}</Button></DialogFooter>
      </form>
    </DialogContent>
  );
}

function Field({ children, label }: { readonly children: React.ReactNode; readonly label: string }) {
  return <div className="space-y-2"><Label>{label}</Label>{children}</div>;
}

function CheckRow({ checked, label, onCheckedChange }: { readonly checked: boolean; readonly label: string; readonly onCheckedChange: (checked: boolean) => void }) {
  return <div className="flex items-center gap-2"><Checkbox checked={checked} id={label} onCheckedChange={(value) => onCheckedChange(value === true)} /><Label htmlFor={label}>{label}</Label></div>;
}

async function responseError(response: Response, fallback: string): Promise<Error> {
  const payload = (await response.json().catch(() => null)) as { message?: unknown } | null;
  return new Error(typeof payload?.message === "string" ? payload.message : fallback);
}

const selectClass = "type-form-control flex h-9 w-full rounded-md border border-input bg-background px-3 shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30";
