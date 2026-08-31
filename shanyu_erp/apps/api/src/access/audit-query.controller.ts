import { BadRequestException, Controller, Get, Headers, Query } from "@nestjs/common";
import type { AuditEventListResponse } from "@shanyu/contracts";

import { AuthService } from "./auth.service";
import { AuditQueryService } from "./audit-query.service";
import { readSessionToken } from "./session-cookie";

@Controller("audit-events")
export class AuditQueryController {
  constructor(
    private readonly authService: AuthService,
    private readonly service: AuditQueryService,
  ) {}

  @Get()
  async list(
    @Headers("cookie") cookieHeader: string | undefined,
    @Query("action") action: string | undefined,
    @Query("result") result: string | undefined,
  ): Promise<AuditEventListResponse> {
    if (result && result !== "SUCCESS" && result !== "FAILURE") {
      throw new BadRequestException("审计结果筛选值无效");
    }
    const actor = await this.authService.getSessionUser(
      readSessionToken(cookieHeader),
    );
    return {
      events: await this.service.list(actor, {
        action: action?.trim() || undefined,
        result: result as "SUCCESS" | "FAILURE" | undefined,
      }),
    };
  }
}
