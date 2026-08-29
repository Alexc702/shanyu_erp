import type { SessionUser } from "@shanyu/contracts";
import {
  BadgeCheck,
  Bell,
  Database,
  FolderKanban,
  HardHat,
  LayoutDashboard,
  Search,
  UsersRound,
  WalletCards,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { getWorkbench } from "@/lib/workbench";

import { LogoutButton } from "./logout-button";

interface AppShellProps {
  readonly active: "catalog" | "dashboard" | "projects" | "quotation" | "users";
  readonly children: ReactNode;
  readonly user: SessionUser;
}

const pageTitles: Record<AppShellProps["active"], string> = {
  catalog: "主材库",
  dashboard: "工作台",
  projects: "项目报价",
  quotation: "半包报价",
  users: "用户与权限",
};

export function AppShell({ active, children, user }: AppShellProps) {
  const workbench = getWorkbench(user.role);
  const canAccessQuotation = user.role === "OWNER" || user.role === "LEAD_DESIGNER";

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <Link className="sidebar-brand" href="/">
          <Image
            alt="山屿"
            className="brand-logo"
            height={38}
            priority
            src="/images/shanyu-logo.png"
            width={38}
          />
          <span className="brand-name">山屿 ERP</span>
        </Link>

        <nav className="sidebar-nav" aria-label="主要导航">
          <NavLink active={active === "dashboard"} href="/" icon={<LayoutDashboard />}>
            工作台
          </NavLink>
          {canAccessQuotation ? (
            <NavLink
              active={active === "projects" || active === "quotation"}
              href="/projects"
              icon={<FolderKanban />}
            >
              项目报价
            </NavLink>
          ) : (
            <DisabledNav icon={<FolderKanban />}>项目报价</DisabledNav>
          )}
          {canAccessQuotation ? (
            <NavLink active={active === "catalog"} href="/catalog" icon={<Database />}>
              主材库
            </NavLink>
          ) : (
            <DisabledNav icon={<Database />}>主材库</DisabledNav>
          )}
          <DisabledNav icon={<BadgeCheck />}>审批中心</DisabledNav>

          <p className="nav-section-label">长期规划</p>
          <DisabledNav future icon={<HardHat />}>施工项目</DisabledNav>
          <DisabledNav future icon={<WalletCards />}>财务中心</DisabledNav>

          <span className="nav-spacer" />
          {workbench.canManageUsers ? (
            <NavLink active={active === "users"} href="/users" icon={<UsersRound />}>
              用户与权限
            </NavLink>
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
          <strong className="topbar-title">{pageTitles[active]}</strong>
          <span className="topbar-spacer" />
          <div className="global-search" role="search">
            <Search aria-hidden="true" />
            <span>搜索项目、客户…</span>
          </div>
          <button aria-label="通知" className="notification-button" type="button">
            <Bell aria-hidden="true" />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

function NavLink({
  active,
  children,
  href,
  icon,
}: {
  readonly active: boolean;
  readonly children: ReactNode;
  readonly href: string;
  readonly icon: ReactNode;
}) {
  return (
    <Link className={active ? "nav-item active" : "nav-item"} href={href}>
      {icon}
      <span>{children}</span>
    </Link>
  );
}

function DisabledNav({
  children,
  future = false,
  icon,
}: {
  readonly children: ReactNode;
  readonly future?: boolean;
  readonly icon: ReactNode;
}) {
  return (
    <span aria-disabled="true" className="nav-item disabled" title="当前阶段不开放">
      {icon}
      <span>{children}</span>
      {future ? <span className="future-badge">后续</span> : null}
    </span>
  );
}
