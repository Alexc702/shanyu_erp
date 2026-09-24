import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { SessionUser, TransferProjectLeadRequest } from "@shanyu/contracts";
import { AccessPolicy } from "../access/access.policy";
import { PgAuditRepository } from "../access/pg-audit.repository";
import { DatabaseClient } from "../database/database.client";
import { PgProjectsRepository } from "./pg-projects.repository";

@Injectable()
export class ProjectTransferService {
  constructor(private readonly database: DatabaseClient, private readonly policy: AccessPolicy,
    private readonly projects: PgProjectsRepository, private readonly audit: PgAuditRepository) {}

  async change(actor: SessionUser, projectId: string, input: TransferProjectLeadRequest | { expectedAccessRevision: number }, revoke = false) {
    this.policy.assertCanManageUsers(actor);
    if (!input || !Number.isSafeInteger(input.expectedAccessRevision) || input.expectedAccessRevision < 0) throw new BadRequestException("权限修订号无效，请刷新后重试");
    const transfer = input as TransferProjectLeadRequest;
    if (!revoke && (typeof transfer.leadDesignerId !== "string" || !/^[0-9a-f-]{36}$/i.test(transfer.leadDesignerId)
      || typeof transfer.retainReadonly !== "boolean" || (transfer.reason !== undefined && (typeof transfer.reason !== "string" || transfer.reason.length > 1000)))) {
      throw new BadRequestException("请选择有效的新主案，转交原因最多1000字（选填）");
    }
    return this.database.projectTransaction(projectId, async () => {
      const project = await this.projects.findById(projectId);
      if (!project) throw new NotFoundException("项目不存在");
      if (project.accessRevision !== input.expectedAccessRevision) throw new ConflictException("项目权限已被他人变更，请刷新后重新选择");
      if (revoke && !project.readonlyDesigner) throw new ConflictException("当前没有原主案只读权限");
      if (!revoke) {
        if (transfer.leadDesignerId === project.leadDesigner.id) throw new BadRequestException("新主案不能与当前主案相同");
        const target = await this.database.query("SELECT id FROM users WHERE id=$1 AND role='LEAD_DESIGNER' AND status='ACTIVE' FOR SHARE", [transfer.leadDesignerId]);
        if (!target.rowCount) throw new BadRequestException("目标账号不可用，请重新选择");
      }
      const leadId = revoke ? project.leadDesigner.id : transfer.leadDesignerId;
      const viewerId = !revoke && transfer.retainReadonly ? project.leadDesigner.id : null;
      await this.database.query("UPDATE projects SET lead_designer_id=$2, readonly_designer_id=$3, access_revision=access_revision+1, updated_at=now() WHERE id=$1", [projectId, leadId, viewerId]);
      await this.audit.append({ action: revoke ? "PROJECT_READONLY_REVOKED" : "PROJECT_LEAD_TRANSFERRED", actorUserId: actor.id,
        occurredAt: new Date(), result: "SUCCESS", targetId: projectId, targetType: "PROJECT",
        beforeState: { leadDesignerId: project.leadDesigner.id, readonlyDesignerId: project.readonlyDesigner?.id ?? null, accessRevision: project.accessRevision },
        afterState: { leadDesignerId: leadId, readonlyDesignerId: viewerId, accessRevision: input.expectedAccessRevision + 1 },
        reason: revoke ? null : transfer.reason?.trim() || null });
      return (await this.projects.findById(projectId))!;
    });
  }
}
