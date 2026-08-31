import { Module } from "@nestjs/common";

import { AccessPolicy } from "./access.policy";
import { AuditQueryController } from "./audit-query.controller";
import { AUDIT_QUERY_REPOSITORY } from "./audit-query.repository";
import { AuditQueryService } from "./audit-query.service";
import { AUDIT_REPOSITORY } from "./audit.repository";
import { AuthController } from "./auth.controller";
import { AUTH_REPOSITORY } from "./auth.repository";
import { AuthService } from "./auth.service";
import { PgAuditRepository } from "./pg-audit.repository";
import { PgAuditQueryRepository } from "./pg-audit-query.repository";
import { PgAuthRepository } from "./pg-auth.repository";
import { PgUsersRepository } from "./pg-users.repository";
import { UsersController } from "./users.controller";
import { USERS_REPOSITORY } from "./users.repository";
import { UsersService } from "./users.service";

@Module({
  controllers: [AuthController, AuditQueryController, UsersController],
  providers: [
    AccessPolicy,
    AuthService,
    AuditQueryService,
    PgAuditQueryRepository,
    PgAuditRepository,
    PgAuthRepository,
    PgUsersRepository,
    UsersService,
    { provide: AUDIT_REPOSITORY, useExisting: PgAuditRepository },
    { provide: AUDIT_QUERY_REPOSITORY, useExisting: PgAuditQueryRepository },
    { provide: AUTH_REPOSITORY, useExisting: PgAuthRepository },
    { provide: USERS_REPOSITORY, useExisting: PgUsersRepository },
  ],
  exports: [AccessPolicy, AuthService, AUDIT_REPOSITORY],
})
export class AccessModule {}
