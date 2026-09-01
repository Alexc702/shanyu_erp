"use client";

import type {
  AuditEventView,
  SessionUser,
  UserRole,
  UserSummary,
} from "@shanyu/contracts";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleEllipsis,
  FileKey2,
  History,
  Info,
  KeyRound,
  Search,
  ShieldCheck,
  Trash2,
  UserCog,
  UserPlus,
} from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { useMemo, useState } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { apiUrl } from "@/lib/api-url";

import styles from "./users.module.css";

interface UserManagementProps {
  readonly auditEvents: readonly AuditEventView[];
  readonly currentUser: SessionUser;
  readonly generatedAt: string;
  readonly users: readonly UserSummary[];
}

type AccountModal =
  | { readonly kind: "create" }
  | { readonly kind: "edit"; readonly user: UserSummary }
  | { readonly kind: "password"; readonly user: UserSummary }
  | { readonly kind: "delete"; readonly user: UserSummary }
  | null;

type PageTab = "accounts" | "roles";
type AccountDisplayStatus = "ACTIVE" | "DISABLED" | "PENDING";

const accountAuditActions = new Set([
  "USER_CREATED",
  "USER_UPDATED",
  "USER_PASSWORD_RESET",
  "USER_DELETED",
]);

const roleLabels: Record<UserRole, string> = {
  ADMIN: "管理员",
  FINANCE: "财务",
  LEAD_DESIGNER: "主案设计师",
  OWNER: "老板",
  PROJECT_MANAGER: "项目经理",
  WOODWORK_DESIGNER: "木作设计师",
};

const roleScopes: Record<UserRole, string> = {
  ADMIN: "全部页面、数据和功能",
  FINANCE: "预留；V1 暂不开放业务入口",
  LEAD_DESIGNER: "自有与获授权项目",
  OWNER: "全部项目、定价、审批与导出",
  PROJECT_MANAGER: "预留；V1 暂不开放业务入口",
  WOODWORK_DESIGNER: "被指派项目的木作模块",
};

const roleMatrix = [
  ["管理员", "全部项目", "全部模块与功能", "全部价格、成本、返点、毛利", "审批、退回、导出", "全部账号"],
  ["老板", "全部项目", "全部报价模块", "维护价格成本；查看毛利", "定价、审批、导出", "除本人和管理员"],
  ["主案设计师", "自有或获授权", "半包/主材/代购/定制；木作只读", "仅已发布标准价；不可见成本", "导出自有已批准版本", "无"],
  ["木作设计师", "被指派项目", "仅铂屿木作定制，可编辑", "不可见价格成本与毛利", "仅提交木作模块", "无"],
  ["项目经理/财务", "预留", "V1 不开放业务入口", "按后续模块授权", "V1 不开放", "无"],
] as const;

export function UserManagement({
  auditEvents,
  currentUser,
  generatedAt,
  users,
}: UserManagementProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<PageTab>("accounts");
  const [modal, setModal] = useState<AccountModal>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<UserRole | "ALL">("ALL");
  const [statusFilter, setStatusFilter] = useState<AccountDisplayStatus | "ALL">("ALL");

  const accountEvents = useMemo(
    () => auditEvents.filter((event) => accountAuditActions.has(event.action)),
    [auditEvents],
  );
  const filteredUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    return users.filter((user) => {
      const matchesQuery =
        !normalizedQuery ||
        user.displayName.toLocaleLowerCase("zh-CN").includes(normalizedQuery) ||
        user.account.toLocaleLowerCase("zh-CN").includes(normalizedQuery);
      return (
        matchesQuery &&
        (roleFilter === "ALL" || user.role === roleFilter) &&
        (statusFilter === "ALL" || displayStatus(user) === statusFilter)
      );
    });
  }, [query, roleFilter, statusFilter, users]);

  function finishMutation(text: string, deletedSelf = false) {
    setMessage(text);
    setModal(null);
    if (deletedSelf) {
      router.replace("/login");
      return;
    }
    router.refresh();
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>用户与权限</h1>
          <p>管理账号、角色与访问边界；密码仅可重设，关键操作全程留痕</p>
        </div>
        <div className={styles.headerActions}>
          <Button onClick={() => setLogOpen(true)} variant="outline">
            <History />操作日志
          </Button>
          <Button onClick={() => setModal({ kind: "create" })}>
            <UserPlus />新建账号
          </Button>
        </div>
      </header>

      <section className={styles.viewBanner}>
        <ShieldCheck aria-hidden="true" />
        <div>
          <strong>{currentUser.role === "ADMIN" ? "管理员视角" : "何老板视角"}</strong>
          <span>
            {currentUser.role === "ADMIN"
              ? "可新建和管理全部员工及账号，包括管理员与老板账号。"
              : "可新建和管理全部员工员账号。"}
          </span>
        </div>
      </section>

      <nav className={styles.tabs} aria-label="用户与权限页面">
        <button
          aria-current={activeTab === "accounts" ? "page" : undefined}
          className={activeTab === "accounts" ? styles.activeTab : undefined}
          onClick={() => setActiveTab("accounts")}
          type="button"
        >
          账号管理
        </button>
        {currentUser.role === "ADMIN" ? (
          <button
            aria-current={activeTab === "roles" ? "page" : undefined}
            className={activeTab === "roles" ? styles.activeTab : undefined}
            onClick={() => setActiveTab("roles")}
            type="button"
          >
            角色权限
          </button>
        ) : null}
      </nav>

      {message ? <p className={styles.statusMessage} role="status"><Check />{message}</p> : null}

      {activeTab === "accounts" ? (
        <>
          <section className={styles.toolbar} aria-label="账号筛选">
            <label className={styles.searchField}>
              <Search aria-hidden="true" />
              <span className="sr-only">搜索账号</span>
              <input
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索姓名或登录账号"
                value={query}
              />
            </label>
            <select
              aria-label="筛选角色"
              onChange={(event) => setRoleFilter(event.target.value as UserRole | "ALL")}
              value={roleFilter}
            >
              <option value="ALL">全部角色</option>
              {visibleRoleOptions(currentUser.role).map((role) => (
                <option key={role} value={role}>{roleLabels[role]}</option>
              ))}
            </select>
            <select
              aria-label="筛选状态"
              onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
              value={statusFilter}
            >
              <option value="ALL">全部状态</option>
              <option value="ACTIVE">可登录</option>
              <option value="PENDING">待创建</option>
              <option value="DISABLED">已删除</option>
            </select>
          </section>

          <section className={styles.accountPanel}>
            <div className={styles.panelTitle}>
              <h2>账号列表</h2>
              <span>共 {filteredUsers.length} 个账号</span>
            </div>
            <div className={styles.tableScroll}>
              <table className={styles.accountTable}>
                <thead>
                  <tr>
                    <th>用户</th>
                    <th>角色</th>
                    <th>权限范围</th>
                    <th>状态</th>
                    <th>最近操作</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((user) => {
                    const latestEvent = accountEvents.find(
                      (event) => event.targetId === user.id || event.actorUserId === user.id,
                    );
                    const manageable = canManageUser(currentUser, user);
                    const status = displayStatus(user);
                    return (
                      <tr key={user.id}>
                        <td>
                          <div className={styles.userIdentity}>
                            <span className={styles.avatar}>{user.displayName.slice(0, 1)}</span>
                            <span>
                              <strong>
                                {user.displayName}
                                {user.id === currentUser.id ? <em>当前账号</em> : null}
                              </strong>
                              <small>{user.account}</small>
                            </span>
                          </div>
                        </td>
                        <td><RoleBadge role={user.role} /></td>
                        <td>{roleScopes[user.role]}</td>
                        <td>
                          <span className={status === "ACTIVE" ? styles.activeStatus : styles.disabledStatus}>
                            {status === "ACTIVE" ? "可登录" : status === "PENDING" ? "待创建" : "已删除"}
                          </span>
                        </td>
                        <td>{latestEvent ? formatDateTime(latestEvent.occurredAt, generatedAt) : "—"}</td>
                        <td>
                          {manageable ? (
                            <AccountMenu onSelect={(kind) => setModal({ kind, user })} user={user} />
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {filteredUsers.length === 0 ? <p className={styles.emptyState}>没有符合筛选条件的账号</p> : null}
          </section>

          <RecentAccountActivity
            events={accountEvents.slice(0, 3)}
            generatedAt={generatedAt}
            onOpenAll={() => setLogOpen(true)}
            users={users}
          />
        </>
      ) : (
        <RolePermissionPanel />
      )}

      <AccountDialog
        currentUser={currentUser}
        modal={modal}
        onClose={() => setModal(null)}
        onSuccess={finishMutation}
      />
      <AuditLogDrawer
        events={accountEvents}
        generatedAt={generatedAt}
        onOpenChange={setLogOpen}
        open={logOpen}
        users={users}
      />
    </main>
  );
}

function AccountMenu({
  onSelect,
  user,
}: {
  readonly onSelect: (kind: "delete" | "edit" | "password") => void;
  readonly user: UserSummary;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button aria-label={`管理 ${user.displayName}`} size="icon" variant="outline">
          <CircleEllipsis />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className={styles.actionMenu}>
        <p>{user.displayName} · {roleLabels[user.role]}</p>
        <button onClick={() => onSelect("edit")} type="button"><UserCog />编辑账号</button>
        <button onClick={() => onSelect("password")} type="button"><KeyRound />重设密码</button>
        <span />
        <button className={styles.deleteAction} onClick={() => onSelect("delete")} type="button">
          <Trash2 />删除账号
        </button>
      </PopoverContent>
    </Popover>
  );
}

function AccountDialog({
  currentUser,
  modal,
  onClose,
  onSuccess,
}: {
  readonly currentUser: SessionUser;
  readonly modal: AccountModal;
  readonly onClose: () => void;
  readonly onSuccess: (message: string, deletedSelf?: boolean) => void;
}) {
  if (modal?.kind === "delete") {
    return (
      <DeleteAccountDialog
        currentUser={currentUser}
        onClose={onClose}
        onSuccess={onSuccess}
        user={modal.user}
      />
    );
  }
  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open={modal !== null}>
      {modal?.kind === "create" ? (
        <CreateAccountForm currentUser={currentUser} onClose={onClose} onSuccess={onSuccess} />
      ) : null}
      {modal?.kind === "edit" ? (
        <EditAccountForm currentUser={currentUser} onClose={onClose} onSuccess={onSuccess} user={modal.user} />
      ) : null}
      {modal?.kind === "password" ? (
        <ResetPasswordForm onClose={onClose} onSuccess={onSuccess} user={modal.user} />
      ) : null}
    </Dialog>
  );
}

function CreateAccountForm({
  currentUser,
  onClose,
  onSuccess,
}: {
  readonly currentUser: SessionUser;
  readonly onClose: () => void;
  readonly onSuccess: (message: string) => void;
}) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password !== String(form.get("confirmPassword") ?? "")) {
      setError("两次输入的密码不一致");
      return;
    }
    setPending(true);
    setError("");
    const result = await sendAccountRequest("/users", {
      body: JSON.stringify({
        account: form.get("account"),
        displayName: form.get("displayName"),
        password,
        phone: null,
        role: form.get("role"),
      }),
      method: "POST",
    });
    setPending(false);
    if (result.error) setError(result.error);
    else onSuccess("账号已创建");
  }

  return (
    <DialogContent className={styles.formDialog}>
      <DialogHeader>
        <DialogTitle>新建账号</DialogTitle>
        <DialogDescription>创建可登录账号并分配初始角色；后续角色调整会记录到操作日志。</DialogDescription>
      </DialogHeader>
      <form autoComplete="off" className={styles.accountForm} onSubmit={submit}>
        <FormField autoComplete="off" label="姓名" name="displayName" placeholder="请输入用户姓名" />
        <FormField autoComplete="off" label="登录账号" name="account" pattern="[A-Za-z0-9._-]{3,64}" placeholder="请输入登录账号" />
        <RoleField currentRole={currentUser.role} />
        <FormField autoComplete="new-password" label="初始密码" minLength={8} name="password" placeholder="至少 8 位，包含数字与字母" type="password" />
        <FormField autoComplete="new-password" label="确认密码" minLength={8} name="confirmPassword" placeholder="再次输入初始密码" type="password" />
        <p className={styles.infoBox}><Info />{currentUser.role === "ADMIN" ? "管理员可创建全部角色账号；系统会阻止删除最后一个可用管理员。" : "当前为老板视角，可选老板、主案设计师或木作设计师；管理员账号只能由管理员创建。"}</p>
        <p aria-live="polite" className={styles.formError}>{error}</p>
        <DialogFooter className={styles.formFooter}>
          <Button onClick={onClose} type="button" variant="outline">取消</Button>
          <Button disabled={pending} type="submit"><UserPlus />{pending ? "创建中…" : "创建账号"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function EditAccountForm({
  currentUser,
  onClose,
  onSuccess,
  user,
}: {
  readonly currentUser: SessionUser;
  readonly onClose: () => void;
  readonly onSuccess: (message: string) => void;
  readonly user: UserSummary;
}) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    const result = await sendAccountRequest(`/users/${user.id}`, {
      body: JSON.stringify({
        account: form.get("account"),
        displayName: form.get("displayName"),
        role: form.get("role"),
      }),
      method: "PATCH",
    });
    setPending(false);
    if (result.error) setError(result.error);
    else onSuccess("账号修改已保存");
  }

  return (
    <DialogContent className={styles.formDialog}>
      <DialogHeader>
        <DialogTitle>编辑账号</DialogTitle>
        <DialogDescription>更新账号资料或角色。密码请通过“重设密码”单独修改。</DialogDescription>
      </DialogHeader>
      <form autoComplete="off" className={styles.accountForm} onSubmit={submit}>
        <FormField defaultValue={user.displayName} label="姓名" name="displayName" />
        <FormField defaultValue={user.account} label="登录账号" name="account" pattern="[A-Za-z0-9._-]{3,64}" />
        <RoleField currentRole={currentUser.role} defaultValue={user.role} />
        <p className={styles.infoBox}><ShieldCheck />角色或权限范围发生变化时，记录操作人、目标账号、变更内容与时间。</p>
        <p aria-live="polite" className={styles.formError}>{error}</p>
        <DialogFooter className={styles.formFooter}>
          <Button onClick={onClose} type="button" variant="outline">取消</Button>
          <Button disabled={pending} type="submit">{pending ? "保存中…" : "保存修改"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function ResetPasswordForm({
  onClose,
  onSuccess,
  user,
}: {
  readonly onClose: () => void;
  readonly onSuccess: (message: string) => void;
  readonly user: UserSummary;
}) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password !== String(form.get("confirmPassword") ?? "")) {
      setError("两次输入的密码不一致");
      return;
    }
    setPending(true);
    setError("");
    const result = await sendAccountRequest(`/users/${user.id}/password`, {
      body: JSON.stringify({ password }),
      method: "PUT",
    });
    setPending(false);
    if (result.error) setError(result.error);
    else onSuccess("密码已重设，该账号原有会话已失效");
  }

  return (
    <DialogContent className={styles.formDialog}>
      <DialogHeader>
        <DialogTitle>重设密码</DialogTitle>
        <DialogDescription>为目标账号设置新密码。系统不会显示或导出原密码。</DialogDescription>
      </DialogHeader>
      <div className={styles.targetStrip}>
        <span className={styles.avatar}>{user.displayName.slice(0, 1)}</span>
        <span><strong>{user.displayName}</strong><small>{user.account} · {roleLabels[user.role]}</small></span>
      </div>
      <form autoComplete="off" className={styles.accountForm} onSubmit={submit}>
        <FormField autoComplete="new-password" label="新密码" minLength={8} name="password" placeholder="至少 8 位，包含数字与字母" type="password" />
        <FormField autoComplete="new-password" label="确认新密码" minLength={8} name="confirmPassword" placeholder="再次输入新密码" type="password" />
        <p className={styles.infoBox}><FileKey2 />确认后立即生效，并记录操作人、目标账号与时间；日志不保存密码明文。</p>
        <p aria-live="polite" className={styles.formError}>{error}</p>
        <DialogFooter className={styles.formFooter}>
          <Button onClick={onClose} type="button" variant="outline">取消</Button>
          <Button disabled={pending} type="submit">{pending ? "重设中…" : "确认重设"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function DeleteAccountDialog({
  currentUser,
  onClose,
  onSuccess,
  user,
}: {
  readonly currentUser: SessionUser;
  readonly onClose: () => void;
  readonly onSuccess: (message: string, deletedSelf?: boolean) => void;
  readonly user: UserSummary;
}) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function remove() {
    setPending(true);
    setError("");
    const result = await sendAccountRequest(`/users/${user.id}`, { method: "DELETE" });
    setPending(false);
    if (result.error) setError(result.error);
    else onSuccess("账号已删除，历史业务记录继续保留", user.id === currentUser.id);
  }

  return (
    <AlertDialog onOpenChange={(open) => !open && onClose()} open>
      <AlertDialogContent className={styles.deleteDialog}>
        <AlertDialogHeader className={styles.deleteHeader}>
          <span><AlertTriangle /></span>
          <div>
            <AlertDialogTitle>删除账号？</AlertDialogTitle>
            <AlertDialogDescription>此操作会立即取消目标账号的登录权限，请确认账号与影响范围。</AlertDialogDescription>
          </div>
        </AlertDialogHeader>
        <div className={styles.deleteTarget}>
          <strong>{user.displayName}</strong>
          <RoleBadge role={user.role} />
          <span>登录账号：{user.account}</span>
        </div>
        <div className={styles.deleteEffects}>
          <strong>删除后：</strong>
          <span><Check />该账号不可再登录系统</span>
          <span><Check />历史项目、报价版本与操作记录继续保留</span>
          <span><Check />删除操作记录操作人、目标账号与时间</span>
        </div>
        <p aria-live="polite" className={styles.formError}>{error}</p>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>取消</AlertDialogCancel>
          <AlertDialogAction disabled={pending} onClick={(event) => { event.preventDefault(); void remove(); }}>
            <Trash2 />{pending ? "删除中…" : "确认删除账号"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function FormField({
  autoComplete,
  defaultValue,
  label,
  minLength,
  name,
  pattern,
  placeholder,
  type = "text",
}: {
  readonly autoComplete?: string;
  readonly defaultValue?: string;
  readonly label: string;
  readonly minLength?: number;
  readonly name: string;
  readonly pattern?: string;
  readonly placeholder?: string;
  readonly type?: string;
}) {
  return (
    <div className={styles.field}>
      <Label htmlFor={`${name}-${defaultValue ?? "new"}`}>{label} <span>*</span></Label>
      <Input
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        id={`${name}-${defaultValue ?? "new"}`}
        minLength={minLength}
        name={name}
        pattern={pattern}
        placeholder={placeholder}
        required
        type={type}
      />
    </div>
  );
}

function RoleField({
  currentRole,
  defaultValue,
}: {
  readonly currentRole: UserRole;
  readonly defaultValue?: UserRole;
}) {
  const visibleOptions = visibleRoleOptions(currentRole);
  const options = defaultValue && !visibleOptions.includes(defaultValue)
    ? [...visibleOptions, defaultValue]
    : visibleOptions;
  return (
    <div className={styles.field}>
      <Label htmlFor={`role-${defaultValue ?? "new"}`}>角色 <span>*</span></Label>
      <select defaultValue={defaultValue ?? ""} id={`role-${defaultValue ?? "new"}`} name="role" required>
        <option disabled value="">请选择角色</option>
        {options.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}
      </select>
    </div>
  );
}

function RecentAccountActivity({
  events,
  generatedAt,
  onOpenAll,
  users,
}: {
  readonly events: readonly AuditEventView[];
  readonly generatedAt: string;
  readonly onOpenAll: () => void;
  readonly users: readonly UserSummary[];
}) {
  return (
    <section className={styles.recentPanel}>
      <div className={styles.panelTitle}>
        <h2>最近账号操作</h2>
        <button onClick={onOpenAll} type="button">查看全部日志</button>
      </div>
      {events.length ? events.map((event) => (
        <div className={styles.recentRow} key={event.id}>
          <strong>{event.actorDisplayName ?? "系统"}</strong>
          <span>{eventSummary(event, users)}</span>
          <time>{formatDateTime(event.occurredAt, generatedAt)}</time>
        </div>
      )) : <p className={styles.emptyRecent}>暂无账号操作记录</p>}
    </section>
  );
}

function RolePermissionPanel() {
  return (
    <section className={styles.rolePage}>
      <div className={styles.ruleIntro}>
        <strong>权限判定规则</strong>
        <span>实际权限由角色、项目指派、模块权限与敏感字段权限共同决定，并由服务端强制校验</span>
      </div>
      <div className={styles.roleMatrixPanel}>
        <div className={styles.matrixHeading}>
          <div><h2>角色与权限范围</h2><p>角色决定基础能力，项目与模块指派进一步收窄可访问范围</p></div>
          <Badge>服务端强制校验</Badge>
        </div>
        <div className={styles.tableScroll}>
          <table className={styles.roleTable}>
            <thead><tr><th>角色</th><th>项目范围</th><th>报价模块</th><th>价格与敏感字段</th><th>审批与导出</th><th>账号管理</th></tr></thead>
            <tbody>{roleMatrix.map((row, rowIndex) => <tr key={row[0]}>{row.map((cell, index) => <td key={cell}>{index === 0 ? <Badge variant={rowIndex === 0 ? "destructive" : rowIndex === 1 ? "success" : rowIndex === 3 ? "warning" : "secondary"}>{cell}</Badge> : cell}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </div>
      <section className={styles.securityPanel}>
        <h2>安全与版本规则</h2>
        <div className={styles.securityGrid}>
          <SecurityRule icon={<ShieldCheck />} title="敏感字段">成本、返点、毛利及可推导底价只返回给管理员和老板</SecurityRule>
          <SecurityRule icon={<FileKey2 />} title="标准单价">主案仅使用已发布标准价，不能修改销售单价</SecurityRule>
          <SecurityRule icon={<KeyRound />} title="批准版本">已批准报价只读，调整必须创建新版本</SecurityRule>
          <SecurityRule icon={<History />} title="操作留痕">价格、成本、权限、审批、附件与导出等关键操作全部记录</SecurityRule>
        </div>
      </section>
      <p className={styles.warningBox}><AlertTriangle />仅管理员可创建或授予管理员角色；删除或降级管理员前，系统必须确认至少保留一个可用管理员账号。</p>
    </section>
  );
}

function SecurityRule({ children, icon, title }: { readonly children: string; readonly icon: ReactNode; readonly title: string }) {
  return <div><span>{icon}</span><p><strong>{title}</strong><small>{children}</small></p></div>;
}

function AuditLogDrawer({
  events,
  generatedAt,
  onOpenChange,
  open,
  users,
}: {
  readonly events: readonly AuditEventView[];
  readonly generatedAt: string;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
  readonly users: readonly UserSummary[];
}) {
  const [query, setQuery] = useState("");
  const [action, setAction] = useState("ALL");
  const [range, setRange] = useState("30");
  const [page, setPage] = useState(0);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    const since = range === "ALL" ? null : new Date(generatedAt).getTime() - Number(range) * 86_400_000;
    return events.filter((event) => {
      const target = users.find((user) => user.id === event.targetId);
      const haystack = `${event.actorDisplayName ?? "系统"} ${target?.displayName ?? ""} ${target?.account ?? ""}`.toLocaleLowerCase("zh-CN");
      return (
        (!normalized || haystack.includes(normalized)) &&
        (action === "ALL" || event.action === action) &&
        (since === null || new Date(event.occurredAt).getTime() >= since)
      );
    });
  }, [action, events, generatedAt, query, range, users]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / 10));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * 10, safePage * 10 + 10);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className={`${styles.logDrawer} inset-y-0 right-0 left-auto top-0 h-screen w-[min(520px,calc(100vw-32px))] max-w-none translate-x-0 translate-y-0 gap-0 rounded-none p-0`}
      >
        <DialogHeader className={styles.drawerHeader}>
          <DialogTitle>账号操作日志</DialogTitle>
          <DialogDescription>记录账号、角色与密码管理操作；日志不保存密码明文。</DialogDescription>
        </DialogHeader>
        <div className={styles.logFilters}>
          <label className={styles.searchField}>
            <Search /><span className="sr-only">搜索日志</span>
            <input onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="搜索操作人或目标账号" value={query} />
          </label>
          <select aria-label="筛选操作" onChange={(event) => { setAction(event.target.value); setPage(0); }} value={action}>
            <option value="ALL">全部操作</option>
            <option value="USER_CREATED">新建账号</option>
            <option value="USER_UPDATED">编辑账号</option>
            <option value="USER_PASSWORD_RESET">重设密码</option>
            <option value="USER_DELETED">删除账号</option>
          </select>
          <select aria-label="筛选时间" onChange={(event) => { setRange(event.target.value); setPage(0); }} value={range}>
            <option value="30">最近 30 天</option>
            <option value="90">最近 90 天</option>
            <option value="ALL">全部时间</option>
          </select>
        </div>
        <div className={styles.logTitle}><strong>操作记录</strong><span>共 {filtered.length} 条</span></div>
        <div className={styles.logList}>
          {visible.map((event) => <AuditEventCard event={event} generatedAt={generatedAt} key={event.id} users={users} />)}
          {visible.length === 0 ? <p className={styles.emptyState}>没有符合筛选条件的操作记录</p> : null}
        </div>
        <footer className={styles.drawerFooter}>
          <span>每页 10 条 · 第 {safePage + 1} / {pageCount} 页</span>
          <div>
            <Button aria-label="上一页" disabled={safePage === 0} onClick={() => setPage((value) => Math.max(0, value - 1))} size="icon" variant="outline"><ChevronLeft /></Button>
            <Button aria-label="下一页" disabled={safePage >= pageCount - 1} onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))} size="icon" variant="outline"><ChevronRight /></Button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

function AuditEventCard({ event, generatedAt, users }: { readonly event: AuditEventView; readonly generatedAt: string; readonly users: readonly UserSummary[] }) {
  const target = users.find((user) => user.id === event.targetId);
  const deleted = event.action === "USER_DELETED";
  const Icon = event.action === "USER_PASSWORD_RESET" ? KeyRound : event.action === "USER_CREATED" ? UserPlus : event.action === "USER_UPDATED" ? UserCog : Trash2;
  return (
    <article className={styles.logCard}>
      <div className={deleted ? styles.dangerLogIcon : styles.logIcon}><Icon /></div>
      <div className={styles.logCardBody}>
        <header><strong>{eventActionLabel(event)}</strong><time>{formatDateTime(event.occurredAt, generatedAt)}</time></header>
        <p>目标：{target ? `${target.displayName} · ${target.account}` : event.targetId ?? "—"}</p>
        <div><strong>操作人：{event.actorDisplayName ?? "系统"}</strong><span>{auditChangeSummary(event)}</span></div>
      </div>
    </article>
  );
}

function RoleBadge({ role }: { readonly role: UserRole }) {
  const variant = role === "ADMIN" ? "destructive" : role === "OWNER" ? "success" : role === "LEAD_DESIGNER" ? "default" : role === "WOODWORK_DESIGNER" ? "warning" : "secondary";
  return <Badge variant={variant}>{roleLabels[role]}{role === "PROJECT_MANAGER" || role === "FINANCE" ? "（预留）" : ""}</Badge>;
}

function canManageUser(actor: SessionUser, target: UserSummary): boolean {
  if (target.status !== "ACTIVE") return false;
  if (actor.role === "ADMIN") return true;
  return actor.role === "OWNER" && actor.id !== target.id && target.role !== "ADMIN";
}

function displayStatus(user: UserSummary): AccountDisplayStatus {
  if (user.status === "DISABLED") return "DISABLED";
  if (user.role === "PROJECT_MANAGER" || user.role === "FINANCE") return "PENDING";
  return "ACTIVE";
}

function visibleRoleOptions(actorRole: UserRole): readonly UserRole[] {
  return actorRole === "ADMIN"
    ? ["ADMIN", "OWNER", "LEAD_DESIGNER", "WOODWORK_DESIGNER", "PROJECT_MANAGER", "FINANCE"]
    : ["OWNER", "LEAD_DESIGNER", "WOODWORK_DESIGNER"];
}

async function sendAccountRequest(path: string, init: RequestInit): Promise<{ error?: string }> {
  try {
    const response = await fetch(`${apiUrl}${path}`, {
      ...init,
      credentials: "include",
      headers: { "content-type": "application/json", ...init.headers },
    });
    const payload = (await response.json()) as { message?: string | string[] };
    if (!response.ok) {
      return { error: Array.isArray(payload.message) ? payload.message.join("；") : payload.message ?? "操作失败，请稍后重试" };
    }
    return {};
  } catch {
    return { error: "暂时无法连接服务" };
  }
}

function eventActionLabel(event: AuditEventView): string {
  if (event.action === "USER_UPDATED") {
    return event.beforeValue?.role !== event.afterValue?.role ? "调整角色" : "编辑账号";
  }
  return ({ USER_CREATED: "新建账号", USER_PASSWORD_RESET: "重设密码", USER_DELETED: "删除账号" } as Record<string, string>)[event.action] ?? event.action;
}

function eventSummary(event: AuditEventView, users: readonly UserSummary[]): string {
  const target = users.find((user) => user.id === event.targetId);
  const targetName = target?.displayName ?? String(event.afterValue?.displayName ?? event.beforeValue?.displayName ?? "目标账号");
  if (event.action === "USER_PASSWORD_RESET") return `重设 ${targetName} 的密码`;
  if (event.action === "USER_DELETED") return `删除 ${targetName} 账号`;
  if (event.action === "USER_CREATED") return `新建 ${targetName} 账号`;
  if (event.beforeValue?.role !== event.afterValue?.role) return `将 ${targetName} 调整为 ${roleLabels[String(event.afterValue?.role) as UserRole] ?? "新角色"}`;
  return `编辑 ${targetName} 账号`;
}

function auditChangeSummary(event: AuditEventView): string {
  if (event.action === "USER_PASSWORD_RESET") return "变更：新密码已生效；未记录密码内容";
  if (event.action === "USER_DELETED") return "变更：账号不可登录；历史记录保留";
  if (event.action === "USER_CREATED") return `变更：角色 · ${roleLabels[String(event.afterValue?.role) as UserRole] ?? "已设置"}`;
  if (event.beforeValue?.role !== event.afterValue?.role) {
    const before = roleLabels[String(event.beforeValue?.role) as UserRole] ?? "原角色";
    const after = roleLabels[String(event.afterValue?.role) as UserRole] ?? "新角色";
    return `变更：${before} → ${after}`;
  }
  return "变更：账号资料已更新";
}

function formatDateTime(value: string, generatedAt: string): string {
  const date = new Date(value);
  const now = new Date(generatedAt);
  const time = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", hour12: false, minute: "2-digit" }).format(date);
  if (date.toDateString() === now.toDateString()) return `今天 ${time}`;
  return new Intl.DateTimeFormat("zh-CN", { day: "2-digit", hour: "2-digit", hour12: false, minute: "2-digit", month: "2-digit" }).format(date).replaceAll("/", "-");
}
