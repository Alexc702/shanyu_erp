"use client";

import type {
  ProjectSpace,
  SpaceInput,
  SpaceType,
} from "@shanyu/contracts";
import type { FormEvent } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { apiUrl } from "@/lib/api-client";

interface SpaceManagerProps {
  readonly projectId: string;
  readonly spaces: ProjectSpace[];
}

export const spaceTypeLabels: Record<SpaceType, string> = {
  BALCONY: "阳台",
  BATHROOM: "卫生间",
  BEDROOM: "卧室",
  CLOSET: "衣帽间",
  KITCHEN: "厨房",
  LIVING_DINING: "客餐厅",
};

export function SpaceManager({ projectId, spaces }: SpaceManagerProps) {
  const hasWrappedBalcony = spaces.some(
    (space) => space.type === "LIVING_DINING" && space.includesBalcony,
  );
  return (
    <div className="space-manager">
      <div className="space-card-grid">
        {spaces.map((space) => (
          <SpaceCard
            canDelete={spaces.length > 1}
            key={space.id}
            projectId={projectId}
            space={space}
          />
        ))}
      </div>
      <AddSpaceForm
        hasWrappedBalcony={hasWrappedBalcony}
        projectId={projectId}
      />
    </div>
  );
}

function SpaceCard({
  canDelete,
  projectId,
  space,
}: {
  readonly canDelete: boolean;
  readonly projectId: string;
  readonly space: ProjectSpace;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [isPending, setIsPending] = useState(false);

  async function update(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsPending(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const type = String(form.get("type")) as SpaceType;
    const input = inputFromForm(form, type);
    const response = await fetch(
      `${apiUrl}/projects/${projectId}/spaces/${space.id}`,
      {
        body: JSON.stringify(input),
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "PATCH",
      },
    );
    const payload = (await response.json()) as { message?: string };
    setMessage(response.ok ? "已保存" : (payload.message ?? "保存失败"));
    setIsPending(false);
    if (response.ok) {
      router.refresh();
    }
  }

  async function remove() {
    if (!window.confirm(`确认删除空间“${space.displayName}”？`)) {
      return;
    }
    setIsPending(true);
    const response = await fetch(
      `${apiUrl}/projects/${projectId}/spaces/${space.id}`,
      { credentials: "include", method: "DELETE" },
    );
    if (!response.ok) {
      const payload = (await response.json()) as { message?: string };
      setMessage(payload.message ?? "删除失败");
      setIsPending(false);
      return;
    }
    router.refresh();
  }

  return (
    <article className="space-card">
      <div className="space-card-header">
        <div>
          <span>{spaceTypeLabels[space.type]}</span>
          <h3>{space.displayName}</h3>
        </div>
        <span className="space-order">#{space.sortOrder + 1}</span>
      </div>
      <dl className="space-metrics">
        <div><dt>面积</dt><dd>{Number(space.area).toFixed(2)} ㎡</dd></div>
        <div><dt>周长</dt><dd>{Number(space.perimeter).toFixed(2)} m</dd></div>
        <div><dt>层高</dt><dd>{Number(space.height).toFixed(2)} m</dd></div>
      </dl>
      {space.includesBalcony ? <p className="wrapped-balcony">已包含阳台工程项</p> : null}
      <details className="space-edit">
        <summary>编辑空间</summary>
        <form onSubmit={update}>
          <label>空间类型
            <select defaultValue={space.type} name="type">
              {Object.entries(spaceTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>空间名称<input defaultValue={space.displayName} maxLength={6} minLength={1} name="displayName" required /></label>
          <label>面积（㎡）<input defaultValue={Number(space.area).toFixed(2)} inputMode="decimal" name="area" required /></label>
          <label>周长（m）<input defaultValue={Number(space.perimeter).toFixed(2)} inputMode="decimal" name="perimeter" required /></label>
          <label>层高（m）<input defaultValue={Number(space.height).toFixed(2)} inputMode="decimal" name="height" required /></label>
          <label className="inline-check"><input defaultChecked={space.includesBalcony} name="includesBalcony" type="checkbox" />客餐厅包阳台</label>
          <div className="space-edit-actions">
            <span role="status">{message}</span>
            {canDelete ? <button className="danger-button" disabled={isPending} onClick={remove} type="button">删除</button> : null}
            <button className="secondary-button" disabled={isPending}>保存</button>
          </div>
        </form>
      </details>
    </article>
  );
}

function AddSpaceForm({
  hasWrappedBalcony,
  projectId,
}: {
  readonly hasWrappedBalcony: boolean;
  readonly projectId: string;
}) {
  const router = useRouter();
  const [type, setType] = useState<SpaceType>("BEDROOM");
  const [message, setMessage] = useState("");
  const [isPending, setIsPending] = useState(false);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsPending(true);
    setMessage("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const response = await fetch(`${apiUrl}/projects/${projectId}/spaces`, {
      body: JSON.stringify({
        ...inputFromForm(form, type),
        confirmStandaloneBalcony:
          form.get("confirmStandaloneBalcony") === "on",
      }),
      credentials: "include",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const payload = (await response.json()) as { message?: string };
    if (!response.ok) {
      setMessage(payload.message ?? "新增失败");
      setIsPending(false);
      return;
    }
    formElement.reset();
    setType("BEDROOM");
    setMessage("空间已新增");
    setIsPending(false);
    router.refresh();
  }

  return (
    <section className="panel add-space-panel">
      <div className="panel-heading">
        <div><p className="eyebrow">空间管理</p><h2>新增空间</h2></div>
      </div>
      <form className="add-space-form" onSubmit={add}>
        <label>空间类型
          <select name="type" value={type} onChange={(event) => setType(event.target.value as SpaceType)}>
            {Object.entries(spaceTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>空间名称<input maxLength={6} minLength={1} name="displayName" placeholder="如主卧" required /></label>
        <label>面积（㎡）<input inputMode="decimal" name="area" required /></label>
        <label>周长（m）<input inputMode="decimal" name="perimeter" required /></label>
        <label>层高（m）<input inputMode="decimal" name="height" required /></label>
        {type === "LIVING_DINING" ? (
          <label className="inline-check"><input name="includesBalcony" type="checkbox" />客餐厅包阳台</label>
        ) : null}
        {type === "BALCONY" && hasWrappedBalcony ? (
          <label className="inline-check confirmation-check"><input name="confirmStandaloneBalcony" type="checkbox" />我确认仍需新增独立阳台</label>
        ) : null}
        <div className="add-space-actions">
          <span className="form-message" role="status">{message}</span>
          <button className="primary-button" disabled={isPending}>{isPending ? "新增中…" : "新增空间"}</button>
        </div>
      </form>
    </section>
  );
}

function inputFromForm(form: FormData, type: SpaceType): SpaceInput {
  return {
    area: String(form.get("area") ?? ""),
    displayName: String(form.get("displayName") ?? ""),
    height: String(form.get("height") ?? ""),
    includesBalcony:
      type === "LIVING_DINING" && form.get("includesBalcony") === "on",
    perimeter: String(form.get("perimeter") ?? ""),
    type,
  };
}
