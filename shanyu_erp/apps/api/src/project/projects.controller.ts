import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Put,
} from "@nestjs/common";
import type {
  AddSpaceRequest,
  CreateProjectRequest,
  ProjectDetail,
  ProjectSpace,
  ProjectSummary,
  ReorderSpacesRequest,
  UpdateSpaceRequest,
} from "@shanyu/contracts";

import { AuthService } from "../access/auth.service";
import { readSessionToken } from "../access/session-cookie";
import { ProjectsService } from "./projects.service";

@Controller("projects")
export class ProjectsController {
  constructor(
    private readonly authService: AuthService,
    private readonly projectsService: ProjectsService,
  ) {}

  @Get()
  async list(
    @Headers("cookie") cookieHeader?: string,
  ): Promise<{ projects: ProjectSummary[] }> {
    const actor = await this.currentUser(cookieHeader);
    return { projects: await this.projectsService.list(actor) };
  }

  @Post()
  async create(
    @Headers("cookie") cookieHeader: string | undefined,
    @Body() body: unknown,
  ): Promise<{ project: ProjectDetail }> {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("项目信息格式不正确");
    }
    const actor = await this.currentUser(cookieHeader);
    return {
      project: await this.projectsService.create(
        actor,
        body as CreateProjectRequest,
      ),
    };
  }

  @Get(":projectId")
  async get(
    @Headers("cookie") cookieHeader: string | undefined,
    @Param("projectId") projectId: string,
  ): Promise<{ project: ProjectDetail }> {
    const actor = await this.currentUser(cookieHeader);
    return { project: await this.projectsService.get(actor, projectId) };
  }

  @Post(":projectId/spaces")
  async addSpace(
    @Headers("cookie") cookieHeader: string | undefined,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
  ): Promise<{ space: ProjectSpace }> {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("空间信息格式不正确");
    }
    const actor = await this.currentUser(cookieHeader);
    return {
      space: await this.projectsService.addSpace(
        actor,
        projectId,
        body as AddSpaceRequest,
      ),
    };
  }

  @Patch(":projectId/spaces/:spaceId")
  async updateSpace(
    @Headers("cookie") cookieHeader: string | undefined,
    @Param("projectId") projectId: string,
    @Param("spaceId") spaceId: string,
    @Body() body: unknown,
  ): Promise<{ space: ProjectSpace }> {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("空间信息格式不正确");
    }
    const actor = await this.currentUser(cookieHeader);
    return {
      space: await this.projectsService.updateSpace(
        actor,
        projectId,
        spaceId,
        body as UpdateSpaceRequest,
      ),
    };
  }

  @Put(":projectId/spaces/order")
  async reorderSpaces(
    @Headers("cookie") cookieHeader: string | undefined,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
  ): Promise<{ spaces: ProjectSpace[] }> {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("空间排序信息格式不正确");
    }
    const actor = await this.currentUser(cookieHeader);
    return {
      spaces: await this.projectsService.reorderSpaces(
        actor,
        projectId,
        body as ReorderSpacesRequest,
      ),
    };
  }

  @Delete(":projectId/spaces/:spaceId")
  async deleteSpace(
    @Headers("cookie") cookieHeader: string | undefined,
    @Param("projectId") projectId: string,
    @Param("spaceId") spaceId: string,
  ): Promise<void> {
    const actor = await this.currentUser(cookieHeader);
    await this.projectsService.deleteSpace(actor, projectId, spaceId);
  }

  private async currentUser(cookieHeader?: string) {
    return this.authService.getSessionUser(readSessionToken(cookieHeader));
  }
}
