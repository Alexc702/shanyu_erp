import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { SessionUser } from "@shanyu/contracts";

@Injectable()
export class AccessPolicy {
  assertCanManageUsers(user: SessionUser): void {
    this.assertOwner(user);
  }

  assertCanViewSensitivePricing(user: SessionUser): void {
    this.assertOwner(user);
  }

  assertCanCreateProject(user: SessionUser, leadDesignerId: string): void {
    if (user.role === "OWNER") {
      return;
    }
    if (user.role !== "LEAD_DESIGNER" || user.id !== leadDesignerId) {
      throw new ForbiddenException("无权为该主案创建项目");
    }
  }

  assertCanListProjects(user: SessionUser): void {
    if (user.role !== "OWNER" && user.role !== "LEAD_DESIGNER") {
      throw new ForbiddenException("无权访问项目");
    }
  }

  assertCanAccessProject(user: SessionUser, leadDesignerId: string): void {
    if (
      user.role === "OWNER" ||
      (user.role === "LEAD_DESIGNER" && user.id === leadDesignerId)
    ) {
      return;
    }
    throw new NotFoundException("项目不存在");
  }

  private assertOwner(user: SessionUser): void {
    if (user.role !== "OWNER") {
      throw new ForbiddenException("无权执行此操作");
    }
  }
}
