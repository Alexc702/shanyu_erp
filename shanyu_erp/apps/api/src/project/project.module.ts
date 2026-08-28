import { Module } from "@nestjs/common";

import { AccessModule } from "../access/access.module";
import { PgProjectsRepository } from "./pg-projects.repository";
import { PROJECTS_REPOSITORY } from "./projects.repository";
import { ProjectsController } from "./projects.controller";
import { ProjectsService } from "./projects.service";

@Module({
  controllers: [ProjectsController],
  imports: [AccessModule],
  providers: [
    PgProjectsRepository,
    ProjectsService,
    { provide: PROJECTS_REPOSITORY, useExisting: PgProjectsRepository },
  ],
})
export class ProjectModule {}
