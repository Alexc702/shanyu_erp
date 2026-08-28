import type { SessionUser } from "@shanyu/contracts";
import Link from "next/link";
import type { ReactNode } from "react";

import { getWorkbench } from "@/lib/workbench";

import { LogoutButton } from "./logout-button";

interface AppShellProps {
  readonly active: "catalog" | "dashboard" | "projects" | "users";
  readonly children: ReactNode;
  readonly user: SessionUser;
}

export function AppShell({ active, children, user }: AppShellProps) {
  const workbench = getWorkbench(user.role);

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark">山屿</div>
          <span>SHANYU DESIGN</span>
        </div>
        <nav className="sidebar-nav" aria-label="主要导航">
          <Link
            className={active === "dashboard" ? "nav-item active" : "nav-item"}
            href="/"
          >
            <span className="nav-dot" />工作台
          </Link>
          {user.role === "OWNER" || user.role === "LEAD_DESIGNER" ? (
            <Link
              className={active === "projects" ? "nav-item active" : "nav-item"}
              href="/projects"
            >
              <span className="nav-dot" />项目管理
            </Link>
          ) : (
            <span className="nav-item disabled" title="当前角色无项目权限">
              <span className="nav-dot" />项目管理
            </span>
          )}
          <span className="nav-item disabled" title="后续阶段开放">
            <span className="nav-dot" />半包报价
          </span>
          {user.role === "OWNER" || user.role === "LEAD_DESIGNER" ? (
            <Link
              className={active === "catalog" ? "nav-item active" : "nav-item"}
              href="/catalog"
            >
              <span className="nav-dot" />主材库
            </Link>
          ) : (
            <span className="nav-item disabled" title="当前角色无主材库权限">
              <span className="nav-dot" />主材库
            </span>
          )}
          <span className="nav-item disabled" title="后续阶段开放">
            <span className="nav-dot" />审批中心
          </span>
          {workbench.canManageUsers ? (
            <>
              <p className="nav-section-label">系统管理</p>
              <Link
                className={active === "users" ? "nav-item active" : "nav-item"}
                href="/users"
              >
                <span className="nav-dot" />用户与权限
              </Link>
              <span className="nav-item disabled" title="后续阶段开放">
                <span className="nav-dot" />操作日志
              </span>
            </>
          ) : null}
        </nav>
        <div className="sidebar-user">
          <span className="avatar">{user.displayName.slice(0, 1)}</span>
          <span className="user-meta">
            <strong>{user.displayName}</strong>
            <small>{workbench.roleLabel}</small>
          </span>
          <LogoutButton />
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <div>
            <span className="mobile-brand">山屿 ERP</span>
          </div>
          <div className="phase-badge">V1 · 阶段 3</div>
        </header>
        {children}
      </div>
    </div>
  );
}
