import { Module } from "@nestjs/common";

import { AccessModule } from "../access/access.module";
import { PgProjectsRepository } from "./pg-projects.repository";
import { PROJECTS_REPOSITORY } from "./projects.repository";
import { ProjectsController } from "./projects.controller";
import { ProjectsService } from "./projects.service";
import { ProjectTransferService } from "./project-transfer.service";
import { PgAuditRepository } from "../access/pg-audit.repository";

@Module({
  controllers: [ProjectsController],
  exports: [PROJECTS_REPOSITORY],
  imports: [AccessModule],
  providers: [
    ProjectTransferService,
    PgAuditRepository,
    PgProjectsRepository,
    ProjectsService,
    { provide: PROJECTS_REPOSITORY, useExisting: PgProjectsRepository },
  ],
})
export class ProjectModule {}
