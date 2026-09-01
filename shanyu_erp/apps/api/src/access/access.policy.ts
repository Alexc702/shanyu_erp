import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { SessionUser } from "@shanyu/contracts";

@Injectable()
export class AccessPolicy {
  assertCanManageUsers(user: SessionUser): void {
    this.assertAdministratorOrOwner(user);
  }

  assertCanManageCatalog(user: SessionUser): void {
    this.assertAdministratorOrOwner(user);
  }

  assertCanReadCatalog(user: SessionUser): void {
    if (
      user.role !== "ADMIN" &&
      user.role !== "OWNER" &&
      user.role !== "LEAD_DESIGNER"
    ) {
      throw new ForbiddenException("无权访问主材库");
    }
  }

  assertCanViewSensitivePricing(user: SessionUser): void {
    this.assertAdministratorOrOwner(user);
  }

  assertCanApproveQuotation(user: SessionUser): void {
    this.assertAdministratorOrOwner(user);
  }

  assertCanReadAudit(user: SessionUser): void {
    if (user.role !== "ADMIN") {
      throw new ForbiddenException("无权查看操作日志");
    }
  }

  assertCanCreateProject(user: SessionUser, leadDesignerId: string): void {
    if (user.role === "ADMIN" || user.role === "OWNER") {
      return;
    }
    if (user.role !== "LEAD_DESIGNER" || user.id !== leadDesignerId) {
      throw new ForbiddenException("无权为该主案创建项目");
    }
  }

  assertCanListProjects(user: SessionUser): void {
    if (
      user.role !== "ADMIN" &&
      user.role !== "OWNER" &&
      user.role !== "LEAD_DESIGNER"
    ) {
      throw new ForbiddenException("无权访问项目");
    }
  }

  assertCanAccessProject(user: SessionUser, leadDesignerId: string): void {
    if (
      user.role === "ADMIN" ||
      user.role === "OWNER" ||
      (user.role === "LEAD_DESIGNER" && user.id === leadDesignerId)
    ) {
      return;
    }
    throw new NotFoundException("项目不存在");
  }

  private assertAdministratorOrOwner(user: SessionUser): void {
    if (user.role !== "ADMIN" && user.role !== "OWNER") {
      throw new ForbiddenException("无权执行此操作");
    }
  }
}
