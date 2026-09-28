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
import { MainMaterialDirectController } from "./main-material-direct.controller";
import { MainMaterialDirectService } from "./main-material-direct.service";

@Module({
  controllers: [MainMaterialCatalogController, MainMaterialQuotationController, MainMaterialDirectController],
  exports: [MAIN_MATERIAL_REPOSITORY, MainMaterialService],
  imports: [AccessModule, ProjectModule],
  providers: [
    MainMaterialService,
    MainMaterialDirectService,
    PgMainMaterialRepository,
    { provide: MAIN_MATERIAL_REPOSITORY, useExisting: PgMainMaterialRepository },
  ],
})
export class MainMaterialModule {}
