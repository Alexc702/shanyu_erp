import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const host = process.env.API_BIND_HOST ?? "127.0.0.1";
  const port = Number.parseInt(process.env.PORT ?? "3001", 10);

  app.enableCors({
    credentials: true,
    origin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  });

  await app.listen(port, host);
}

void bootstrap();
