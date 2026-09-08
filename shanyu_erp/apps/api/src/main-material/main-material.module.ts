import { Module } from "@nestjs/common";

import { AccessModule } from "../access/access.module";
import { ProjectModule } from "../project/project.module";
import {
  MainMaterialCatalogController,
  MainMaterialQuotationController,
} from "./main-material.controller";
import { MAIN_MATERIAL_REPOSITORY } from "./main-material.repository";
import { MainMaterialService } from "./main-material.service";
import { PgMainMaterialRepository } from "./pg-main-material.repository";

@Module({
  controllers: [MainMaterialCatalogController, MainMaterialQuotationController],
  exports: [MAIN_MATERIAL_REPOSITORY, MainMaterialService],
  imports: [AccessModule, ProjectModule],
  providers: [
    MainMaterialService,
    PgMainMaterialRepository,
    { provide: MAIN_MATERIAL_REPOSITORY, useExisting: PgMainMaterialRepository },
  ],
})
export class MainMaterialModule {}
