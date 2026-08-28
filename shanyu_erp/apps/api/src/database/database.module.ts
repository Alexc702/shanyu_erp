import { Global, Module } from "@nestjs/common";

import { DatabaseClient } from "./database.client";

@Global()
@Module({
  exports: [DatabaseClient],
  providers: [DatabaseClient],
})
export class DatabaseModule {}
