import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import { QuotationExportWorker } from "./quotation/quotation-export.worker";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const host = process.env.API_BIND_HOST ?? "127.0.0.1";
  const port = Number.parseInt(process.env.PORT ?? "3001", 10);

  app.enableCors({
    credentials: true,
    origin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  });

  if (process.env.NODE_ENV !== "production") {
    const exportWorker = app.get(QuotationExportWorker);
    void exportWorker.run();
    const stopExportWorker = () => exportWorker.stop();
    process.once("SIGINT", stopExportWorker);
    process.once("SIGTERM", stopExportWorker);
  }

  await app.listen(port, host);
}

void bootstrap();
