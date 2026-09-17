import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import { QuotationExportWorker } from "./quotation/quotation-export.worker";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);
  const worker = app.get(QuotationExportWorker);
  const stop = () => worker.stop();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  await worker.run();
  await app.close();
}

void bootstrap();
