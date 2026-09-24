import { CallHandler, ExecutionContext, ForbiddenException, Inject, Injectable, NestInterceptor, NotFoundException } from "@nestjs/common";
import type { Request } from "express";
import { from, lastValueFrom, type Observable } from "rxjs";
import { AuthService } from "../access/auth.service";
import { AccessPolicy } from "../access/access.policy";
import { readSessionToken } from "../access/session-cookie";
import { DatabaseClient } from "../database/database.client";
import { AUDIT_REPOSITORY, type AuditRepository } from "../access/audit.repository";

@Injectable()
export class ProjectAccessInterceptor implements NestInterceptor {
  constructor(private readonly database: DatabaseClient, private readonly auth: AuthService, private readonly policy: AccessPolicy,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    if (!/^\/(projects\/[^/]+|approvals\/half-package\/[^/]+|quotation-exports\/|quotation-export-jobs\/)/.test(request.path)) return next.handle();
    return from(this.run(request, next));
  }

  private async run(request: Request, next: CallHandler) {
    const actor = await this.auth.getSessionUser(readSessionToken(request.headers.cookie));
    let projectId = request.params.projectId as string | undefined;
    const quotationId = request.params.quotationId as string | undefined;
    const exportId = request.params.exportId as string | undefined;
    const jobId = request.params.jobId as string | undefined;
    for (const id of [projectId, quotationId, exportId, jobId]) {
      if (id && !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) throw new NotFoundException("项目不存在");
    }
    if (quotationId || exportId || jobId) {
      const result = await this.database.query<{ project_id: string }>(
        quotationId ? "SELECT project_id FROM half_package_quotations WHERE id=$1"
          : exportId ? "SELECT q.project_id FROM half_package_exports e JOIN half_package_quotations q ON q.id=e.quotation_id WHERE e.id=$1"
            : "SELECT q.project_id FROM quotation_export_jobs e JOIN half_package_quotations q ON q.id=e.quotation_id WHERE e.id=$1 UNION SELECT q.project_id FROM half_package_exports e JOIN half_package_quotations q ON q.id=e.quotation_id WHERE e.id=$1",
        [quotationId ?? exportId ?? jobId],
      );
      const actual = result.rows[0]?.project_id;
      if (!actual || (projectId && actual !== projectId)) throw new NotFoundException("项目不存在");
      projectId = actual;
    }
    if (!projectId) return lastValueFrom(next.handle());
    try { return await this.database.projectTransaction(projectId, async () => {
      const result = await this.database.query<{ lead_designer_id: string; readonly_designer_id: string | null }>(
        "SELECT lead_designer_id, readonly_designer_id FROM projects WHERE id=$1", [projectId],
      );
      const row = result.rows[0];
      if (!row) throw new NotFoundException("项目不存在");
      const project = { leadDesigner: { id: row.lead_designer_id }, readonlyDesigner: row.readonly_designer_id ? { id: row.readonly_designer_id } : null };
      this.policy.assertCanReadProject(actor, project);
      const fileOperation = /quotation-exports|quotation-export-jobs|\/exports|\/selection-sheet/.test(request.path);
      if (this.policy.isProjectReadonly(actor, project) && (request.method !== "GET" || fileOperation)) {
        throw new ForbiddenException("只读查看：不可修改、打印、导出或下载报价文件");
      }
      return lastValueFrom(next.handle());
    }); } catch (error) {
      if (/\/(lead-transfer|revoke-readonly)$/.test(request.path)) {
        await this.audit.append({ action: request.path.endsWith("lead-transfer") ? "PROJECT_LEAD_TRANSFERRED" : "PROJECT_READONLY_REVOKED",
          actorUserId: actor.id, occurredAt: new Date(), result: "FAILURE", targetId: projectId, targetType: "PROJECT",
          metadata: { message: error instanceof Error ? error.message : "转交失败" } });
      }
      throw error;
    }
  }
}
