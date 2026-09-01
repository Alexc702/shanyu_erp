import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  AddSpaceRequest,
  CreateProjectRequest,
  ProjectDetail,
  ProjectSpace,
  ProjectSummary,
  SessionUser,
  SpaceInput,
  SpaceType,
  UpdateSpaceRequest,
} from "@shanyu/contracts";
import { randomUUID } from "node:crypto";

import { AccessPolicy } from "../access/access.policy";
import {
  AUDIT_REPOSITORY,
  type AuditRepository,
} from "../access/audit.repository";
import {
  DuplicateSpaceNameError,
  PROJECTS_REPOSITORY,
  SpaceAdjustmentLockedError,
  type ProjectsRepository,
} from "./projects.repository";

const spaceTypes = new Set<SpaceType>([
  "LIVING_DINING",
  "BEDROOM",
  "CLOSET",
  "KITCHEN",
  "BATHROOM",
  "BALCONY",
]);

@Injectable()
export class ProjectsService {
  constructor(
    private readonly accessPolicy: AccessPolicy,
    @Inject(PROJECTS_REPOSITORY)
    private readonly projectsRepository: ProjectsRepository,
    @Inject(AUDIT_REPOSITORY)
    private readonly auditRepository: AuditRepository,
  ) {}

  async create(
    actor: SessionUser,
    input: CreateProjectRequest,
  ): Promise<ProjectDetail> {
    this.accessPolicy.assertCanCreateProject(actor, input.leadDesignerId);
    const normalized = normalizeProject(input);
    const leadDesigner = await this.projectsRepository.findLeadDesigner(
      normalized.leadDesignerId,
    );
    if (!leadDesigner) {
      throw new BadRequestException("主案设计师无效或未启用");
    }

    const projectId = randomUUID();
    const spaces = normalized.spaces.map((space, sortOrder) => ({
      ...space,
      id: randomUUID(),
      sortOrder,
    }));
    const project = await this.projectsRepository.create({
      ...normalized,
      createdByUserId: actor.id,
      id: projectId,
      spaces,
    });
    await this.auditRepository.append({
      action: "PROJECT_CREATED",
      actorUserId: actor.id,
      occurredAt: new Date(),
      result: "SUCCESS",
      targetId: project.id,
      targetType: "PROJECT",
    });
    return project;
  }

  async list(actor: SessionUser): Promise<ProjectSummary[]> {
    this.accessPolicy.assertCanListProjects(actor);
    return this.projectsRepository.list(
      actor.role === "ADMIN" || actor.role === "OWNER" ? null : actor.id,
    );
  }

  async get(actor: SessionUser, projectId: string): Promise<ProjectDetail> {
    const project = await this.projectsRepository.findById(projectId);
    if (!project) {
      throw new NotFoundException("项目不存在");
    }
    this.accessPolicy.assertCanAccessProject(actor, project.leadDesigner.id);
    return project;
  }

  async addSpace(
    actor: SessionUser,
    projectId: string,
    input: AddSpaceRequest,
  ): Promise<ProjectSpace> {
    const project = await this.get(actor, projectId);
    await this.assertSpaceAdjustable(projectId);
    const normalized = normalizeSpace(input);
    if (
      normalized.type === "BALCONY" &&
      project.spaces.some(
        (space) => space.type === "LIVING_DINING" && space.includesBalcony,
      ) &&
      !input.confirmStandaloneBalcony
    ) {
      throw new ConflictException(
        "本项目客餐厅已包阳台，请确认是否仍需新增独立阳台",
      );
    }
    if (
      project.spaces.some(
        (space) => space.displayName === normalized.displayName,
      )
    ) {
      throw new ConflictException("空间名称在项目内必须唯一");
    }

    let space: ProjectSpace;
    try {
      space = await this.projectsRepository.addSpace(projectId, {
        ...normalized,
        id: randomUUID(),
        sortOrder: project.spaces.length,
      });
    } catch (error) {
      if (error instanceof DuplicateSpaceNameError) {
        throw new ConflictException("空间名称在项目内必须唯一");
      }
      throw error;
    }
    await this.auditRepository.append({
      action: "SPACE_CREATED",
      actorUserId: actor.id,
      occurredAt: new Date(),
      result: "SUCCESS",
      targetId: space.id,
      targetType: "SPACE",
    });
    return space;
  }

  async updateSpace(
    actor: SessionUser,
    projectId: string,
    spaceId: string,
    input: UpdateSpaceRequest,
  ): Promise<ProjectSpace> {
    const project = await this.get(actor, projectId);
    await this.assertSpaceAdjustable(projectId);
    const current = project.spaces.find((space) => space.id === spaceId);
    if (!current) {
      throw new NotFoundException("空间不存在");
    }
    const normalized = normalizeSpace(input);
    if (
      project.spaces.some(
        (space) =>
          space.id !== spaceId && space.displayName === normalized.displayName,
      )
    ) {
      throw new ConflictException("空间名称在项目内必须唯一");
    }
    let space: ProjectSpace;
    try {
      space = await this.projectsRepository.updateSpace(projectId, {
        ...normalized,
        id: spaceId,
        sortOrder: current.sortOrder,
      });
    } catch (error) {
      if (error instanceof DuplicateSpaceNameError) {
        throw new ConflictException("空间名称在项目内必须唯一");
      }
      throw error;
    }
    await this.auditRepository.append({
      action: "SPACE_UPDATED",
      actorUserId: actor.id,
      occurredAt: new Date(),
      result: "SUCCESS",
      targetId: space.id,
      targetType: "SPACE",
    });
    return space;
  }

  async deleteSpace(
    actor: SessionUser,
    projectId: string,
    spaceId: string,
  ): Promise<void> {
    const project = await this.get(actor, projectId);
    if (!project.spaces.some((space) => space.id === spaceId)) {
      throw new NotFoundException("空间不存在");
    }
    if (project.spaces.length === 1) {
      throw new ConflictException("项目至少保留一个空间");
    }
    await this.assertSpaceAdjustable(projectId);
    try {
      await this.projectsRepository.deleteSpace(projectId, spaceId);
    } catch (error) {
      if (error instanceof SpaceAdjustmentLockedError) {
        throw new ConflictException("当前报价不是草稿，暂不可调整空间");
      }
      throw error;
    }
    await this.auditRepository.append({
      action: "SPACE_DELETED",
      actorUserId: actor.id,
      occurredAt: new Date(),
      result: "SUCCESS",
      targetId: spaceId,
      targetType: "SPACE",
    });
  }

  private async assertSpaceAdjustable(projectId: string): Promise<void> {
    const state = await this.projectsRepository.getSpaceAdjustmentState(projectId);
    if (state === "LOCKED") {
      throw new ConflictException("当前报价不是草稿，暂不可调整空间");
    }
  }
}

function normalizeProject(input: CreateProjectRequest): CreateProjectRequest {
  const name = normalizedRequiredText(input.name, "项目名称", 100);
  const customerName = normalizedRequiredText(input.customerName, "客户", 100);
  const address = normalizedRequiredText(input.address, "地址", 500);
  const buildingArea = normalizedPositiveDecimal(input.buildingArea, "建筑面积");
  if (
    typeof input.leadDesignerId !== "string" ||
    !input.leadDesignerId ||
    !Array.isArray(input.spaces) ||
    input.spaces.length === 0
  ) {
    throw new BadRequestException("项目必须指定主案设计师和至少一个空间");
  }
  const spaces = input.spaces.map(normalizeSpace);
  const names = new Set(spaces.map((space) => space.displayName));
  if (names.size !== spaces.length) {
    throw new ConflictException("空间名称在项目内必须唯一");
  }
  return {
    address,
    buildingArea,
    customerName,
    leadDesignerId: input.leadDesignerId,
    name,
    spaces,
  };
}

function normalizeSpace(input: SpaceInput): SpaceInput {
  if (
    !input ||
    typeof input.displayName !== "string" ||
    typeof input.type !== "string" ||
    typeof input.includesBalcony !== "boolean"
  ) {
    throw new BadRequestException("空间信息格式不正确");
  }
  const displayName = input.displayName.trim();
  const nameLength = [...displayName].length;
  if (nameLength < 1 || nameLength > 6) {
    throw new BadRequestException("空间名称去除首尾空格后须为 1–6 个字符");
  }
  if (!spaceTypes.has(input.type)) {
    throw new BadRequestException("空间类型无效");
  }
  if (input.includesBalcony && input.type !== "LIVING_DINING") {
    throw new BadRequestException("只有客餐厅可以选择包阳台");
  }
  return {
    area: normalizedPositiveDecimal(input.area, "空间面积"),
    displayName,
    height: normalizedPositiveDecimal(input.height, "层高"),
    includesBalcony: input.includesBalcony,
    perimeter: normalizedPositiveDecimal(input.perimeter, "周长"),
    type: input.type,
  };
}

function normalizedRequiredText(
  value: unknown,
  label: string,
  maxLength: number,
): string {
  if (typeof value !== "string") {
    throw new BadRequestException(`${label}格式不正确`);
  }
  const normalized = value.trim();
  if (!normalized || [...normalized].length > maxLength) {
    throw new BadRequestException(`${label}格式不正确`);
  }
  return normalized;
}

function normalizedPositiveDecimal(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !/^\d{1,10}(?:\.\d{1,4})?$/.test(value) ||
    Number(value) <= 0
  ) {
    throw new BadRequestException(`${label}须为最多 4 位小数的正数`);
  }
  return value;
}
