import { Module } from "@nestjs/common";

import { AccessModule } from "../access/access.module";
import { CatalogModule } from "../catalog/catalog.module";
import { ProjectModule } from "../project/project.module";
import { HalfPackageCalculator } from "./half-package-calculator";
import { PgQuotationRepository } from "./pg-quotation.repository";
import { QUOTATION_REPOSITORY } from "./quotation.repository";
import { QuotationController } from "./quotation.controller";
import { QuotationService } from "./quotation.service";

@Module({
  controllers: [QuotationController],
  imports: [AccessModule, CatalogModule, ProjectModule],
  providers: [
    HalfPackageCalculator,
    PgQuotationRepository,
    QuotationService,
    { provide: QUOTATION_REPOSITORY, useExisting: PgQuotationRepository },
  ],
})
export class QuotationModule {}
