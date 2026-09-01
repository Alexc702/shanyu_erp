"use client";

import type {
  SessionUser,
  SpaceInput,
  SpaceType,
} from "@shanyu/contracts";
import type { FormEvent } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiUrl } from "@/lib/api-url";
import { hasOwnerPermissions } from "@/lib/permissions";
import { createSpaceDraftKey } from "@/lib/space-draft-key";

interface CreateProjectFormProps {
  readonly currentUser: SessionUser;
  readonly leadDesigners: SessionUser[];
}

interface SpaceDraft extends SpaceInput {
  readonly key: string;
}

const spaceLabels: Record<SpaceType, string> = {
  BALCONY: "阳台",
  BATHROOM: "卫生间",
  BEDROOM: "卧室",
  CLOSET: "衣帽间",
  KITCHEN: "厨房",
  LIVING_DINING: "客餐厅",
};

export function CreateProjectForm({
  currentUser,
  leadDesigners,
}: CreateProjectFormProps) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [standaloneBalconyDialogOpen, setStandaloneBalconyDialogOpen] =
    useState(false);
  const [spaces, setSpaces] = useState<SpaceDraft[]>([
    draftSpace("LIVING_DINING", "客餐厅"),
  ]);

  function updateSpace(key: string, patch: Partial<SpaceDraft>) {
    setSpaces((current) =>
      current.map((space) =>
        space.key === key
          ? {
              ...space,
              ...patch,
              includesBalcony:
                patch.type && patch.type !== "LIVING_DINING"
                  ? false
                  : (patch.includesBalcony ?? space.includesBalcony),
            }
          : space,
      ),
    );
  }

  function addSpace(type: SpaceType) {
    if (
      type === "BALCONY" &&
      spaces.some(
        (space) =>
          space.type === "LIVING_DINING" && space.includesBalcony,
      )
    ) {
      setStandaloneBalconyDialogOpen(true);
      return;
    }
    appendSpace(type);
  }

  function appendSpace(type: SpaceType) {
    const sameTypeCount = spaces.filter((space) => space.type === type).length;
    const base = spaceLabels[type];
    const displayName = sameTypeCount === 0 ? base : `${base}${sameTypeCount + 1}`;
    setSpaces((current) => [...current, draftSpace(type, displayName)]);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setIsSubmitting(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`${apiUrl}/projects`, {
        body: JSON.stringify({
          address: form.get("address"),
          buildingArea: form.get("buildingArea"),
          customerName: form.get("customerName"),
          leadDesignerId:
            currentUser.role === "LEAD_DESIGNER"
              ? currentUser.id
              : form.get("leadDesignerId"),
          name: form.get("name"),
          spaces: spaces.map((space) => ({
            area: space.area,
            displayName: space.displayName,
            height: space.height,
            includesBalcony: space.includesBalcony,
            perimeter: space.perimeter,
            type: space.type,
          })),
        }),
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as {
        message?: string;
        project?: { id: string };
      };
      if (!response.ok || !payload.project) {
        setMessage(payload.message ?? "创建失败，请检查输入");
        return;
      }
      router.push(`/projects/${payload.project.id}`);
      router.refresh();
    } catch {
      setMessage("暂时无法连接服务");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="project-form" onSubmit={handleSubmit}>
      <section className="panel form-section">
        <div className="panel-heading">
          <div><p className="eyebrow">01</p><h2>项目信息</h2></div>
        </div>
        <div className="project-field-grid">
          <label>项目名称<input name="name" required /></label>
          <label>客户<input name="customerName" required /></label>
          <label>建筑面积（㎡）<input inputMode="decimal" name="buildingArea" required /></label>
          {hasOwnerPermissions(currentUser.role) ? (
            <label>主案设计师
              <select name="leadDesignerId" required defaultValue="">
                <option disabled value="">请选择</option>
                {leadDesigners.map((designer) => (
                  <option key={designer.id} value={designer.id}>{designer.displayName}</option>
                ))}
              </select>
            </label>
          ) : (
            <label>主案设计师<input disabled value={currentUser.displayName} /></label>
          )}
          <label className="wide-field">项目地址<input name="address" required /></label>
        </div>
      </section>

      <section className="panel form-section">
        <div className="panel-heading">
          <div><p className="eyebrow">02</p><h2>空间与基础参数</h2><p>名称去除首尾空格后须为 1–6 个字符。</p></div>
        </div>
        <div className="space-draft-list">
          {spaces.map((space, index) => (
            <article className="space-draft" key={space.key}>
              <div className="space-draft-heading">
                <strong>空间 {index + 1}</strong>
                {spaces.length > 1 ? (
                  <button type="button" onClick={() => setSpaces((current) => current.filter((item) => item.key !== space.key))}>移除</button>
                ) : null}
              </div>
              <div className="space-field-grid">
                <label>空间类型
                  <select value={space.type} onChange={(event) => updateSpace(space.key, { type: event.target.value as SpaceType })}>
                    {Object.entries(spaceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <label>空间名称<input maxLength={6} minLength={1} required value={space.displayName} onChange={(event) => updateSpace(space.key, { displayName: event.target.value })} /></label>
                <label>面积（㎡）<input inputMode="decimal" required value={space.area} onChange={(event) => updateSpace(space.key, { area: event.target.value })} /></label>
                <label>周长（m）<input inputMode="decimal" required value={space.perimeter} onChange={(event) => updateSpace(space.key, { perimeter: event.target.value })} /></label>
                <label>层高（m）<input inputMode="decimal" required value={space.height} onChange={(event) => updateSpace(space.key, { height: event.target.value })} /></label>
              </div>
              {space.type === "LIVING_DINING" ? (
                <label className="inline-check"><input checked={space.includesBalcony} type="checkbox" onChange={(event) => updateSpace(space.key, { includesBalcony: event.target.checked })} />客餐厅包阳台</label>
              ) : null}
            </article>
          ))}
        </div>
        <div className="add-space-row">
          <span>添加：</span>
          {(Object.keys(spaceLabels) as SpaceType[]).map((type) => (
            <button key={type} type="button" onClick={() => addSpace(type)}>+ {spaceLabels[type]}</button>
          ))}
        </div>
      </section>

      <div className="project-submit-row">
        <ul className="check-list">
          <li>项目名称、客户与地址为必填</li>
          <li>空间名称须为 1–6 字且项目内唯一</li>
          <li>面积、周长、层高用于已确认数量规则</li>
          <li>客餐厅包阳台与独立阳台分别计量</li>
        </ul>
        <span className="form-message" role="status">{message}</span>
        <Button disabled={isSubmitting}>{isSubmitting ? "创建中…" : "创建并进入项目"}</Button>
      </div>

      <Dialog
        onOpenChange={setStandaloneBalconyDialogOpen}
        open={standaloneBalconyDialogOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>仍要增加独立阳台吗？</DialogTitle>
            <DialogDescription>
              当前“客餐厅”已勾选包阳台，其内部会自动包含七、阳台工程。继续新增“生活阳台”后，两处阳台工程将分别计量、汇总和导出。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">取消</Button></DialogClose>
            <Button
              onClick={() => {
                appendSpace("BALCONY");
                setStandaloneBalconyDialogOpen(false);
              }}
              type="button"
            >
              确认新增独立阳台
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}

function draftSpace(type: SpaceType, displayName: string): SpaceDraft {
  return {
    area: "",
    displayName,
    height: "",
    includesBalcony: false,
    key: createSpaceDraftKey(),
    perimeter: "",
    type,
  };
}
