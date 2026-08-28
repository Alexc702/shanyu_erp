import { Module } from "@nestjs/common";

import { AccessModule } from "../access/access.module";
import { CatalogController } from "./catalog.controller";
import { CATALOG_REPOSITORY } from "./catalog.repository";
import { CatalogService } from "./catalog.service";
import { PgCatalogRepository } from "./pg-catalog.repository";

@Module({
  controllers: [CatalogController],
  imports: [AccessModule],
  providers: [
    CatalogService,
    PgCatalogRepository,
    { provide: CATALOG_REPOSITORY, useExisting: PgCatalogRepository },
  ],
})
export class CatalogModule {}
