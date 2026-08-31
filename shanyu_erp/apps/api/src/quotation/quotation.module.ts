import { Module } from "@nestjs/common";

import { AccessModule } from "../access/access.module";
import { CatalogModule } from "../catalog/catalog.module";
import { ProjectModule } from "../project/project.module";
import { HalfPackageCalculator } from "./half-package-calculator";
import { PgQuotationRepository } from "./pg-quotation.repository";
import { QUOTATION_REPOSITORY } from "./quotation.repository";
import {
  QuotationApprovalController,
  QuotationController,
  QuotationExportController,
} from "./quotation.controller";
import { QuotationExporter } from "./quotation-exporter";
import { QuotationService } from "./quotation.service";

@Module({
  controllers: [
    QuotationController,
    QuotationApprovalController,
    QuotationExportController,
  ],
  imports: [AccessModule, CatalogModule, ProjectModule],
  providers: [
    HalfPackageCalculator,
    PgQuotationRepository,
    QuotationExporter,
    QuotationService,
    { provide: QUOTATION_REPOSITORY, useExisting: PgQuotationRepository },
  ],
})
export class QuotationModule {}
