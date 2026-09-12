import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";
import type {
  ProjectDetail,
  ProjectSpace,
  ProjectSummary,
  SessionUser,
  SpaceInput,
} from "@shanyu/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import { AccessPolicy } from "../src/access/access.policy";
import type {
  AuditRecord,
  AuditRepository,
} from "../src/access/audit.repository";
import {
  type NewProject,
  type ProjectsRepository,
} from "../src/project/projects.repository";
import { ProjectsService } from "../src/project/projects.service";

describe("ProjectsService", () => {
  let audits: AuditRecord[];
  let repository: InMemoryProjectsRepository;
  let service: ProjectsService;

  beforeEach(() => {
    audits = [];
    repository = new InMemoryProjectsRepository();
    const auditRepository: AuditRepository = {
      async append(record) {
        audits.push(record);
      },
    };
    service = new ProjectsService(
      new AccessPolicy(),
      repository,
      auditRepository,
    );
  });

  it("lets the owner create a project with normalized unique spaces", async () => {
    const project = await service.create(owner, {
      outerFrameArea: "130.00",
      customerName: "林先生",
      leadDesignerId: lead.id,
      projectAddress: "上海市静安区测试路 1 号",
      spaces: [
        space(" 客餐厅 ", "LIVING_DINING", true),
        space("主卧", "BEDROOM"),
      ],
    });

    expect(project).toMatchObject({
      customerName: "林先生",
      leadDesigner: { id: lead.id },
      outerFrameArea: "130.00",
      projectAddress: "上海市静安区测试路 1 号",
      spaces: [
        { displayName: "客餐厅", includesBalcony: true, sortOrder: 0 },
        { displayName: "主卧", includesBalcony: false, sortOrder: 1 },
      ],
    });
    expect(audits).toMatchObject([
      {
        action: "PROJECT_CREATED",
        actorUserId: owner.id,
        result: "SUCCESS",
        targetId: project.id,
        targetType: "PROJECT",
      },
    ]);
  });

  it("gives the administrator the owner project scope", async () => {
    await service.create(administrator, {
      outerFrameArea: "100",
      customerName: "客户",
      leadDesignerId: lead.id,
      projectAddress: "管理员创建项目",
      spaces: [space("主卧", "BEDROOM")],
    });

    await expect(service.list(administrator)).resolves.toHaveLength(1);
    expect(repository.lastListLeadDesignerId).toBeNull();
  });

  it("保留衣帽间的独立空间类型", async () => {
    const project = await service.create(owner, {
      outerFrameArea: "100",
      customerName: "客户",
      leadDesignerId: lead.id,
      projectAddress: "项目地址",
      spaces: [space("衣帽间", "CLOSET")],
    });

    expect(project.spaces).toMatchObject([
      { displayName: "衣帽间", type: "CLOSET" },
    ]);
  });

  it("only lets a lead create a project for themselves", async () => {
    await expect(
      service.create(lead, {
        outerFrameArea: "100",
        customerName: "客户",
        leadDesignerId: "another-lead",
        projectAddress: "项目地址",
        spaces: [space("主卧", "BEDROOM")],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      service.create(woodwork, {
        outerFrameArea: "100",
        customerName: "客户",
        leadDesignerId: lead.id,
        projectAddress: "项目地址",
        spaces: [space("主卧", "BEDROOM")],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rejects invalid, duplicate, or invented space semantics", async () => {
    const base = {
      outerFrameArea: "100",
      customerName: "客户",
      leadDesignerId: lead.id,
      projectAddress: "项目地址",
    };

    await expect(
      service.create(owner, {
        ...base,
        spaces: [space("这是超过六字符", "BEDROOM")],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create(owner, {
        ...base,
        spaces: [space("主卧", "BEDROOM"), space(" 主卧 ", "BEDROOM")],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.create(owner, {
        ...base,
        spaces: [space("主卧", "BEDROOM", true)],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("enforces the new project customer and outer-frame-area limits", async () => {
    const base = {
      customerName: "客户",
      leadDesignerId: lead.id,
      outerFrameArea: "130.00",
      projectAddress: "项目地址",
      spaces: [space("主卧", "BEDROOM")],
    };

    await expect(
      service.create(owner, { ...base, customerName: "一二三四五六七八九十一" }),
    ).rejects.toThrow("客户名称最多 10 个中文或 20 个英文字符");
    await expect(
      service.create(owner, { ...base, customerName: "abcdefghijklmnopqrstu" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create(owner, { ...base, outerFrameArea: "123456.78" }),
    ).rejects.toThrow("外框面积最多 5 位整数并保留 2 位小数");
    await expect(service.create(owner, base)).resolves.toMatchObject({
      customerName: "客户",
      outerFrameArea: "130.00",
    });
  });

  it("requires confirmation before adding a standalone balcony", async () => {
    const project = await service.create(owner, {
      outerFrameArea: "100",
      customerName: "客户",
      leadDesignerId: lead.id,
      projectAddress: "项目地址",
      spaces: [space("客餐厅", "LIVING_DINING", true)],
    });

    await expect(
      service.addSpace(owner, project.id, {
        ...space("阳台", "BALCONY"),
        confirmStandaloneBalcony: false,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    const balcony = await service.addSpace(owner, project.id, {
      ...space("阳台", "BALCONY"),
      confirmStandaloneBalcony: true,
    });
    expect(balcony).toMatchObject({ displayName: "阳台", sortOrder: 1 });
    expect(audits.at(-1)).toMatchObject({
      action: "SPACE_CREATED",
      actorUserId: owner.id,
      targetId: balcony.id,
      targetType: "SPACE",
    });
  });

  it("updates one-to-six-character names and prevents deleting the last space", async () => {
    const project = await service.create(owner, {
      outerFrameArea: "100",
      customerName: "客户",
      leadDesignerId: lead.id,
      projectAddress: "项目地址",
      spaces: [space("主卧", "BEDROOM"), space("次卧", "BEDROOM")],
    });
    const firstSpace = project.spaces[0];
    const secondSpace = project.spaces[1];
    if (!firstSpace || !secondSpace) {
      throw new Error("测试项目应包含两个空间");
    }

    await expect(
      service.updateSpace(owner, project.id, firstSpace.id, space("房", "BEDROOM")),
    ).resolves.toMatchObject({ displayName: "房" });
    await expect(
      service.updateSpace(
        owner,
        project.id,
        firstSpace.id,
        space("六个字符名称", "BEDROOM"),
      ),
    ).resolves.toMatchObject({ displayName: "六个字符名称" });
    await expect(
      service.updateSpace(
        owner,
        project.id,
        firstSpace.id,
        space("这是超过六字符", "BEDROOM"),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    await service.deleteSpace(owner, project.id, secondSpace.id);
    await expect(
      service.deleteSpace(owner, project.id, firstSpace.id),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("only adjusts spaces while the current quotation is a draft", async () => {
    const project = await service.create(owner, {
      outerFrameArea: "100",
      customerName: "客户",
      leadDesignerId: lead.id,
      projectAddress: "项目地址",
      spaces: [space("主卧", "BEDROOM"), space("次卧", "BEDROOM")],
    });
    repository.spaceAdjustmentState = "LOCKED";

    await expect(
      service.addSpace(owner, project.id, {
        ...space("书房", "BEDROOM"),
        confirmStandaloneBalcony: false,
      }),
    ).rejects.toThrow("当前报价不是草稿，暂不可调整空间");
    await expect(
      service.updateSpace(
        owner,
        project.id,
        project.spaces[0]!.id,
        space("长辈房", "BEDROOM"),
      ),
    ).rejects.toThrow("当前报价不是草稿，暂不可调整空间");
    await expect(
      service.deleteSpace(owner, project.id, project.spaces[1]!.id),
    ).rejects.toThrow("当前报价不是草稿，暂不可调整空间");
    expect(audits.filter((audit) => audit.targetType === "SPACE")).toHaveLength(0);
  });

  it("deletes a draft space and records the audit event", async () => {
    const project = await service.create(owner, {
      outerFrameArea: "100",
      customerName: "客户",
      leadDesignerId: lead.id,
      projectAddress: "项目地址",
      spaces: [space("主卧", "BEDROOM"), space("次卧", "BEDROOM")],
    });
    const deletedSpace = project.spaces[1]!;

    await service.deleteSpace(lead, project.id, deletedSpace.id);

    expect((await repository.findById(project.id))?.spaces).toHaveLength(1);
    expect(audits.at(-1)).toMatchObject({
      action: "SPACE_DELETED",
      actorUserId: lead.id,
      result: "SUCCESS",
      targetId: deletedSpace.id,
      targetType: "SPACE",
    });
  });

  it("reorders all spaces and records the previous and next order", async () => {
    const project = await service.create(owner, {
      outerFrameArea: "100",
      customerName: "客户",
      leadDesignerId: lead.id,
      projectAddress: "项目地址",
      spaces: [
        space("客餐厅", "LIVING_DINING"),
        space("主卧", "BEDROOM"),
        space("次卧", "BEDROOM"),
      ],
    });
    const nextIds = [
      project.spaces[1]!.id,
      project.spaces[0]!.id,
      project.spaces[2]!.id,
    ];
    const previousIds = project.spaces.map((item) => item.id);

    const reordered = await service.reorderSpaces(owner, project.id, {
      spaceIds: nextIds,
    });

    expect(reordered.map((item) => item.id)).toEqual(nextIds);
    expect(reordered.map((item) => item.sortOrder)).toEqual([0, 1, 2]);
    expect(audits.at(-1)).toMatchObject({
      action: "SPACES_REORDERED",
      afterState: { spaceIds: nextIds },
      beforeState: { spaceIds: previousIds },
      targetId: project.id,
      targetType: "PROJECT",
    });
  });

  it("rejects incomplete, duplicate, or locked space orders", async () => {
    const project = await service.create(owner, {
      outerFrameArea: "100",
      customerName: "客户",
      leadDesignerId: lead.id,
      projectAddress: "项目地址",
      spaces: [space("主卧", "BEDROOM"), space("次卧", "BEDROOM")],
    });
    const firstId = project.spaces[0]!.id;

    await expect(
      service.reorderSpaces(owner, project.id, { spaceIds: [firstId] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.reorderSpaces(owner, project.id, { spaceIds: [firstId, firstId] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    repository.spaceAdjustmentState = "LOCKED";
    await expect(
      service.reorderSpaces(owner, project.id, {
        spaceIds: project.spaces.map((item) => item.id),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

class InMemoryProjectsRepository implements ProjectsRepository {
  private readonly projects: ProjectDetail[] = [];
  lastListLeadDesignerId: string | null | undefined;
  spaceAdjustmentState: "DRAFT" | "LOCKED" | "NO_QUOTATION" = "DRAFT";

  async findLeadDesigner(userId: string): Promise<SessionUser | null> {
    return userId === lead.id ? lead : null;
  }

  async create(input: NewProject): Promise<ProjectDetail> {
    const project: ProjectDetail = {
      createdAt: new Date().toISOString(),
      customerName: input.customerName,
      id: input.id,
      leadDesigner: lead,
      outerFrameArea: input.outerFrameArea,
      projectAddress: input.projectAddress,
      quotationAmount: null,
      quotationId: null,
      quotationStatus: null,
      quotationVersion: null,
      spaces: input.spaces.map((item) => ({ ...item })),
      updatedAt: new Date().toISOString(),
    };
    this.projects.push(project);
    return project;
  }

  async findById(projectId: string): Promise<ProjectDetail | null> {
    return this.projects.find((project) => project.id === projectId) ?? null;
  }

  async list(leadDesignerId: string | null): Promise<ProjectSummary[]> {
    this.lastListLeadDesignerId = leadDesignerId;
    return this.projects;
  }

  async getSpaceAdjustmentState() {
    return this.spaceAdjustmentState;
  }

  async addSpace(
    projectId: string,
    input: ProjectSpace,
  ): Promise<ProjectSpace> {
    const project = this.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error("项目不存在");
    }
    (project.spaces as ProjectSpace[]).push(input);
    return input;
  }

  async updateSpace(
    projectId: string,
    input: ProjectSpace,
  ): Promise<ProjectSpace> {
    const project = this.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error("项目不存在");
    }
    const index = project.spaces.findIndex((space) => space.id === input.id);
    (project.spaces as ProjectSpace[])[index] = input;
    return input;
  }

  async reorderSpaces(
    projectId: string,
    spaceIds: readonly string[],
  ): Promise<ProjectSpace[]> {
    const project = this.projects.find((item) => item.id === projectId);
    if (!project) throw new Error("项目不存在");
    const spacesById = new Map(project.spaces.map((item) => [item.id, item]));
    const reordered = spaceIds.map((id, sortOrder) => ({
      ...spacesById.get(id)!,
      sortOrder,
    }));
    (project as { spaces: ProjectSpace[] }).spaces = reordered;
    return reordered;
  }

  async deleteSpace(projectId: string, spaceId: string): Promise<void> {
    const project = this.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error("项目不存在");
    }
    const remaining = project.spaces.filter((space) => space.id !== spaceId);
    (project as { spaces: ProjectSpace[] }).spaces = remaining;
  }
}

const administrator: SessionUser = {
  account: "admin",
  displayName: "系统管理员",
  id: "admin-id",
  phone: null,
  role: "ADMIN",
};

const owner: SessionUser = {
  account: "owner",
  displayName: "何总",
  id: "owner-id",
  phone: null,
  role: "OWNER",
};
const lead: SessionUser = {
  account: "alex",
  displayName: "Alex",
  id: "lead-id",
  phone: null,
  role: "LEAD_DESIGNER",
};
const woodwork: SessionUser = {
  account: "mori",
  displayName: "木作设计师",
  id: "woodwork-id",
  phone: null,
  role: "WOODWORK_DESIGNER",
};

function space(
  displayName: string,
  type: SpaceInput["type"],
  includesBalcony = false,
): SpaceInput {
  return {
    area: "20.0000",
    displayName,
    height: "2.8000",
    includesBalcony,
    perimeter: "18.0000",
    type,
  };
}
