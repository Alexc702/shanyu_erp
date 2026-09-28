import { BadRequestException, Body, Controller, Get, Headers, HttpException, Param, Post, Res, UploadedFiles, UseInterceptors } from "@nestjs/common";
import { FileFieldsInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { AuthService } from "../access/auth.service";
import { readSessionToken } from "../access/session-cookie";
import { MainMaterialDirectService } from "./main-material-direct.service";
interface Upload { originalname: string; buffer: Buffer }

@Controller("catalog/main-materials/direct-imports")
export class MainMaterialDirectController {
  constructor(private readonly auth: AuthService, private readonly service: MainMaterialDirectService) {}
  @Get("reference")
  async reference(@Headers("cookie") cookie: string | undefined, @Res() response: Response) {
    const payload = await this.service.reference(await this.actor(cookie));
    response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    response.setHeader("Content-Disposition", `attachment; filename="material-reference.xlsx"; filename*=UTF-8''${encodeURIComponent("新增瓷砖.xlsx")}`);
    response.setHeader("Cache-Control", "private, no-store"); response.send(payload);
  }
  @Post()
  @UseInterceptors(FileFieldsInterceptor([{ name: "file", maxCount: 1 }, { name: "images", maxCount: 50 }], { limits: { fileSize: 20 * 1024 * 1024, files: 51 } }))
  async upload(@Headers("cookie") cookie: string | undefined, @Headers("accept") accept: string | undefined, @Headers("x-import-request-id") requestId: string | undefined, @UploadedFiles() files: { file?: Upload[]; images?: Upload[] } | undefined, @Res() response: Response) {
    const actor = await this.actor(cookie), file = files?.file?.[0];
    if (!file) throw new BadRequestException("请选择客户 Excel 文件");
    const source = { name: directUploadName(file.originalname), buffer: file.buffer }, images = (files?.images ?? []).map(i => ({ name: directUploadName(i.originalname), buffer: i.buffer }));
    if (!accept?.includes("application/x-ndjson")) {
      response.status(201).json({ batch: await this.service.upload(actor, source, images, requestId) }); return;
    }
    response.status(201).setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    response.setHeader("Cache-Control", "no-store"); response.setHeader("X-Accel-Buffering", "no"); response.flushHeaders();
    const send = (event: unknown) => { if (!response.destroyed) response.write(`${JSON.stringify(event)}\n`); };
    try { send({ batch: await this.service.upload(actor, source, images, requestId, stage => send({ stage })) }); }
    catch (error) {
      const detail = error instanceof HttpException ? error.getResponse() : null;
      send({ error: typeof detail === "object" && detail ? detail : { message: error instanceof HttpException ? error.message : "文件处理失败，请重试" } });
    }
    response.end();
  }
  @Get(":id") async get(@Headers("cookie") cookie: string | undefined, @Param("id") id: string) { return { batch: await this.service.get(await this.actor(cookie), id) }; }
  @Post(":id/preview") async preview(@Headers("cookie") cookie: string | undefined, @Param("id") id: string, @Body() body: unknown) { return { batch: await this.service.repreview(await this.actor(cookie), id, body) }; }
  @Post(":id/publish") async publish(@Headers("cookie") cookie: string | undefined, @Param("id") id: string, @Body() body: unknown) { return { batch: await this.service.publish(await this.actor(cookie), id, body) }; }
  private actor(cookie: string | undefined) { return this.auth.getSessionUser(readSessionToken(cookie)); }
}

export function directUploadName(name: string): string {
  // Multipart headers can arrive as UTF-8 bytes decoded by Multer as Latin-1.
  if ([...name].some(character => character.charCodeAt(0) > 255)) return name;
  const bytes=Buffer.from(name,"latin1"),decoded=bytes.toString("utf8");
  return Buffer.from(decoded,"utf8").equals(bytes) ? decoded : name;
}
