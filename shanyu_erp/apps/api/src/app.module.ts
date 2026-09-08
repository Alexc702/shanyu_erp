import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { resolve } from "node:path";

import { AccessModule } from "./access/access.module";
import { CatalogModule } from "./catalog/catalog.module";
import { DatabaseModule } from "./database/database.module";
import { HealthController } from "./health.controller";
import { MainMaterialModule } from "./main-material/main-material.module";
import { ProjectModule } from "./project/project.module";
import { QuotationModule } from "./quotation/quotation.module";

@Module({
  controllers: [HealthController],
  imports: [
    ConfigModule.forRoot({
      envFilePath: [
        resolve(process.cwd(), ".env"),
        resolve(process.cwd(), "../../.env"),
      ],
      isGlobal: true,
    }),
    DatabaseModule,
    AccessModule,
    CatalogModule,
    MainMaterialModule,
    ProjectModule,
    QuotationModule,
  ],
})
export class AppModule {}
