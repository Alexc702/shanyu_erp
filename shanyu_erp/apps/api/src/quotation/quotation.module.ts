import { Module } from "@nestjs/common";

import { AccessModule } from "../access/access.module";
import { CatalogModule } from "../catalog/catalog.module";
import { MainMaterialModule } from "../main-material/main-material.module";
import { ProjectModule } from "../project/project.module";
import { HalfPackageCalculator } from "./half-package-calculator";
import { PgQuotationRepository } from "./pg-quotation.repository";
import { QUOTATION_REPOSITORY } from "./quotation.repository";
import {
  QuotationApprovalController,
  QuotationController,
  QuotationExportController,
  QuotationExportJobController,
} from "./quotation.controller";
import {
  PgQuotationExportJobRepository,
  QUOTATION_EXPORT_JOB_REPOSITORY,
} from "./quotation-export-job.repository";
import { QuotationExportStorage } from "./quotation-export.storage";
import { QuotationExportWorker } from "./quotation-export.worker";
import { QuotationExporter } from "./quotation-exporter";
import { QuotationService } from "./quotation.service";

@Module({
  controllers: [
    QuotationController,
    QuotationApprovalController,
    QuotationExportController,
    QuotationExportJobController,
  ],
  imports: [AccessModule, CatalogModule, MainMaterialModule, ProjectModule],
  providers: [
    HalfPackageCalculator,
    PgQuotationRepository,
    PgQuotationExportJobRepository,
    QuotationExporter,
    QuotationExportStorage,
    QuotationExportWorker,
    QuotationService,
    { provide: QUOTATION_REPOSITORY, useExisting: PgQuotationRepository },
    {
      provide: QUOTATION_EXPORT_JOB_REPOSITORY,
      useExisting: PgQuotationExportJobRepository,
    },
  ],
  exports: [QuotationExportWorker],
})
export class QuotationModule {}
