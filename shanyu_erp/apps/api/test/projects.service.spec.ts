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
      address: "上海市静安区测试路 1 号",
      buildingArea: "130.0000",
      customerName: "林先生",
      leadDesignerId: lead.id,
      name: "静悦府",
      spaces: [
        space(" 客餐厅 ", "LIVING_DINING", true),
        space("主卧", "BEDROOM"),
      ],
    });

    expect(project).toMatchObject({
      customerName: "林先生",
      leadDesigner: { id: lead.id },
      name: "静悦府",
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
      address: "地址",
      buildingArea: "100",
      customerName: "客户",
      leadDesignerId: lead.id,
      name: "管理员创建项目",
      spaces: [space("主卧", "BEDROOM")],
    });

    await expect(service.list(administrator)).resolves.toHaveLength(1);
    expect(repository.lastListLeadDesignerId).toBeNull();
  });

  it("保留衣帽间的独立空间类型", async () => {
    const project = await service.create(owner, {
      address: "地址",
      buildingArea: "100",
      customerName: "客户",
      leadDesignerId: lead.id,
      name: "项目",
      spaces: [space("衣帽间", "CLOSET")],
    });

    expect(project.spaces).toMatchObject([
      { displayName: "衣帽间", type: "CLOSET" },
    ]);
  });

  it("only lets a lead create a project for themselves", async () => {
    await expect(
      service.create(lead, {
        address: "地址",
        buildingArea: "100",
        customerName: "客户",
        leadDesignerId: "another-lead",
        name: "项目",
        spaces: [space("主卧", "BEDROOM")],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      service.create(woodwork, {
        address: "地址",
        buildingArea: "100",
        customerName: "客户",
        leadDesignerId: lead.id,
        name: "项目",
        spaces: [space("主卧", "BEDROOM")],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rejects invalid, duplicate, or invented space semantics", async () => {
    const base = {
      address: "地址",
      buildingArea: "100",
      customerName: "客户",
      leadDesignerId: lead.id,
      name: "项目",
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

  it("requires confirmation before adding a standalone balcony", async () => {
    const project = await service.create(owner, {
      address: "地址",
      buildingArea: "100",
      customerName: "客户",
      leadDesignerId: lead.id,
      name: "项目",
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
      address: "地址",
      buildingArea: "100",
      customerName: "客户",
      leadDesignerId: lead.id,
      name: "项目",
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
      address: "地址",
      buildingArea: "100",
      customerName: "客户",
      leadDesignerId: lead.id,
      name: "项目",
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
      address: "地址",
      buildingArea: "100",
      customerName: "客户",
      leadDesignerId: lead.id,
      name: "项目",
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
      address: input.address,
      buildingArea: input.buildingArea,
      customerName: input.customerName,
      id: input.id,
      leadDesigner: lead,
      name: input.name,
      spaces: input.spaces.map((item) => ({ ...item })),
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
