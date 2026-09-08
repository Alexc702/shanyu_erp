"use client";

import type { ProjectSummary } from "@shanyu/contracts";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

export function ProjectList({ projects }: { readonly projects: readonly ProjectSummary[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [leadDesignerId, setLeadDesignerId] = useState("ALL");
  const [sort, setSort] = useState("RECENT");
  const designers = useMemo(
    () =>
      Array.from(
        new Map(
          projects.map((project) => [project.leadDesigner.id, project.leadDesigner]),
        ).values(),
      ).sort((left, right) => left.displayName.localeCompare(right.displayName, "zh-CN")),
    [projects],
  );
  const visibleProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    return projects
      .filter((project) => {
        const quotationStatus = project.quotationStatus ?? "DRAFT";
        const matchesQuery =
          !normalizedQuery ||
          [
            project.projectAddress,
            project.customerName,
            project.leadDesigner.displayName,
          ].some((value) => value.toLocaleLowerCase("zh-CN").includes(normalizedQuery));
        return (
          matchesQuery &&
          (status === "ALL" || quotationStatus === status) &&
          (leadDesignerId === "ALL" || project.leadDesigner.id === leadDesignerId)
        );
      })
      .sort((left, right) =>
        sort === "ADDRESS"
          ? left.projectAddress.localeCompare(right.projectAddress, "zh-CN")
          : Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
      );
  }, [leadDesignerId, projects, query, sort, status]);

  return (
    <section className="panel project-table-panel">
      <div className="project-table-toolbar" aria-label="项目筛选">
        <Input
          className="filter-control filter-search"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索项目地址 / 客户 / 主案"
          value={query}
        />
        <select
          aria-label="报价状态"
          className="filter-control"
          onChange={(event) => setStatus(event.target.value)}
          value={status}
        >
          <option value="ALL">全部状态</option>
          <option value="DRAFT">草稿</option>
          <option value="QUOTED">已报价</option>
          <option value="RETURNED">已退回</option>
          <option value="APPROVED">已批准</option>
        </select>
        <select
          aria-label="主案设计师"
          className="filter-control"
          onChange={(event) => setLeadDesignerId(event.target.value)}
          value={leadDesignerId}
        >
          <option value="ALL">全部主案</option>
          {designers.map((designer) => (
            <option key={designer.id} value={designer.id}>{designer.displayName}</option>
          ))}
        </select>
        <select
          aria-label="排序"
          className="filter-control"
          onChange={(event) => setSort(event.target.value)}
          value={sort}
        >
          <option value="RECENT">最近更新</option>
          <option value="ADDRESS">项目地址</option>
        </select>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>项目地址 / 客户</th>
              <th>项目阶段</th>
              <th>外框面积</th>
              <th>主案设计师</th>
              <th>报价阶段</th>
              <th>半包金额</th>
              <th>当前待办</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {visibleProjects.map((project) => (
              <tr key={project.id}>
                <td>
                  <strong>{project.projectAddress}</strong>
                  <span className="table-secondary">{project.customerName}</span>
                </td>
                <td>{project.quotationStatus === "APPROVED" ? "报价完成" : "报价中"}</td>
                <td>{Number(project.outerFrameArea).toFixed(2)} ㎡</td>
                <td>{project.leadDesigner.displayName}</td>
                <td>
                  <Badge variant={quotationStatusVariant(project.quotationStatus)}>
                    {quotationStatusLabel(project.quotationStatus)}
                  </Badge>
                </td>
                <td>{project.quotationAmount === null ? "—" : `¥ ${Number(project.quotationAmount).toFixed(2)}`}</td>
                <td>{currentTask(project.quotationStatus)}</td>
                <td><Link className="text-link" href={`/projects/${project.id}`}>打开项目</Link></td>
              </tr>
            ))}
            {visibleProjects.length === 0 ? (
              <tr>
                <td className="text-center text-muted-foreground" colSpan={8}>当前筛选条件下没有项目</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function quotationStatusLabel(status: ProjectSummary["quotationStatus"]): string {
  return status === null
    ? "草稿"
    : { APPROVED: "已批准", DRAFT: "草稿", QUOTED: "已报价", RETURNED: "已退回" }[status];
}

function quotationStatusVariant(
  status: ProjectSummary["quotationStatus"],
): "destructive" | "secondary" | "success" | "warning" {
  if (status === "APPROVED") return "success";
  if (status === "QUOTED") return "warning";
  if (status === "RETURNED") return "destructive";
  return "secondary";
}

function currentTask(status: ProjectSummary["quotationStatus"]): string {
  if (status === "APPROVED") return "报价已完成";
  if (status === "QUOTED") return "设置折扣或等待老板审批";
  if (status === "RETURNED") return "按打回原因继续编辑";
  return "完善报价并确认生成";
}
