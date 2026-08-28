import type { UserRole } from "@shanyu/contracts";

export interface WorkbenchDefinition {
  readonly canManageUsers: boolean;
  readonly description: string;
  readonly roleLabel: string;
}

const workbenches: Record<UserRole, WorkbenchDefinition> = {
  FINANCE: {
    canManageUsers: false,
    description: "财务角色已预留，财务功能不在当前交付范围。",
    roleLabel: "财务（预留）",
  },
  LEAD_DESIGNER: {
    canManageUsers: false,
    description: "创建并维护本人负责的住宅项目与统一空间。",
    roleLabel: "主案设计师",
  },
  OWNER: {
    canManageUsers: true,
    description: "管理公司账号与角色，并查看全部住宅项目。",
    roleLabel: "老板",
  },
  PROJECT_MANAGER: {
    canManageUsers: false,
    description: "项目经理角色已预留，施工功能不在当前交付范围。",
    roleLabel: "项目经理（预留）",
  },
  WOODWORK_DESIGNER: {
    canManageUsers: false,
    description: "木作项目指派与铂屿木作定制将在 V2 接入。",
    roleLabel: "木作设计师",
  },
};

export function getWorkbench(role: UserRole): WorkbenchDefinition {
  return workbenches[role];
}
