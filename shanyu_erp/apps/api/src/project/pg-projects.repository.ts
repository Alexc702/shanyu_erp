import { Injectable } from "@nestjs/common";
import type {
  ProjectDetail,
  ProjectSpace,
  ProjectSummary,
  SessionUser,
  SpaceType,
  UserRole,
} from "@shanyu/contracts";

import { DatabaseClient } from "../database/database.client";
import {
  DuplicateSpaceNameError,
  type NewProject,
  type ProjectsRepository,
} from "./projects.repository";

interface ProjectRow {
  address: string;
  building_area: string;
  customer_name: string;
  id: string;
  lead_account: string;
  lead_display_name: string;
  lead_designer_id: string;
  lead_phone: string | null;
  lead_role: UserRole;
  name: string;
}

interface SpaceRow {
  area: string;
  display_name: string;
  height: string;
  id: string;
  includes_balcony: boolean;
  perimeter: string;
  sort_order: number;
  type: SpaceType;
}

interface UserRow {
  account: string;
  display_name: string;
  id: string;
  phone: string | null;
  role: UserRole;
}

@Injectable()
export class PgProjectsRepository implements ProjectsRepository {
  constructor(private readonly database: DatabaseClient) {}

  async findLeadDesigner(userId: string): Promise<SessionUser | null> {
    const result = await this.database.query<UserRow>(
      `SELECT id, account, display_name, phone, role
         FROM users
        WHERE id = $1 AND role = 'LEAD_DESIGNER' AND status = 'ACTIVE'`,
      [userId],
    );
    const row = result.rows[0];
    return row
      ? {
          account: row.account,
          displayName: row.display_name,
          id: row.id,
          phone: row.phone,
          role: row.role,
        }
      : null;
  }

  async create(input: NewProject): Promise<ProjectDetail> {
    try {
      await this.database.transaction(async (database) => {
        await database.query(
          `INSERT INTO projects
             (id, name, customer_name, address, building_area,
              lead_designer_id, created_by_user_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            input.id,
            input.name,
            input.customerName,
            input.address,
            input.buildingArea,
            input.leadDesignerId,
            input.createdByUserId,
          ],
        );
        for (const space of input.spaces) {
          await database.query(
            `INSERT INTO project_spaces
               (id, project_id, type, display_name, area, perimeter, height,
                includes_balcony, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              space.id,
              input.id,
              space.type,
              space.displayName,
              space.area,
              space.perimeter,
              space.height,
              space.includesBalcony,
              space.sortOrder,
            ],
          );
        }
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateSpaceNameError();
      }
      throw error;
    }
    const project = await this.findById(input.id);
    if (!project) {
      throw new Error("创建项目后无法读取项目");
    }
    return project;
  }

  async list(leadDesignerId: string | null): Promise<ProjectSummary[]> {
    const result = await this.database.query<ProjectRow>(
      `${projectSelect}
        WHERE ($1::uuid IS NULL OR p.lead_designer_id = $1)
        ORDER BY p.created_at DESC, p.id`,
      [leadDesignerId],
    );
    return result.rows.map(toProjectSummary);
  }

  async findById(projectId: string): Promise<ProjectDetail | null> {
    const projectResult = await this.database.query<ProjectRow>(
      `${projectSelect} WHERE p.id = $1`,
      [projectId],
    );
    const row = projectResult.rows[0];
    if (!row) {
      return null;
    }
    const spacesResult = await this.database.query<SpaceRow>(
      `SELECT id, type, display_name, area, perimeter, height,
              includes_balcony, sort_order
         FROM project_spaces
        WHERE project_id = $1
        ORDER BY sort_order, id`,
      [projectId],
    );
    return {
      ...toProjectSummary(row),
      spaces: spacesResult.rows.map(toProjectSpace),
    };
  }

  async addSpace(
    projectId: string,
    input: ProjectSpace,
  ): Promise<ProjectSpace> {
    try {
      const result = await this.database.query<SpaceRow>(
        `INSERT INTO project_spaces
           (id, project_id, type, display_name, area, perimeter, height,
            includes_balcony, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, type, display_name, area, perimeter, height,
                   includes_balcony, sort_order`,
        [
          input.id,
          projectId,
          input.type,
          input.displayName,
          input.area,
          input.perimeter,
          input.height,
          input.includesBalcony,
          input.sortOrder,
        ],
      );
      const row = result.rows[0];
      if (!row) {
        throw new Error("新增空间后未返回结果");
      }
      return toProjectSpace(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateSpaceNameError();
      }
      throw error;
    }
  }

  async updateSpace(
    projectId: string,
    input: ProjectSpace,
  ): Promise<ProjectSpace> {
    try {
      const result = await this.database.query<SpaceRow>(
        `UPDATE project_spaces
            SET type = $3, display_name = $4, area = $5, perimeter = $6,
                height = $7, includes_balcony = $8,
                updated_at = current_timestamp
          WHERE project_id = $1 AND id = $2
          RETURNING id, type, display_name, area, perimeter, height,
                    includes_balcony, sort_order`,
        [
          projectId,
          input.id,
          input.type,
          input.displayName,
          input.area,
          input.perimeter,
          input.height,
          input.includesBalcony,
        ],
      );
      const row = result.rows[0];
      if (!row) {
        throw new Error("更新空间后未返回结果");
      }
      return toProjectSpace(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateSpaceNameError();
      }
      throw error;
    }
  }

  async deleteSpace(projectId: string, spaceId: string): Promise<void> {
    await this.database.query(
      "DELETE FROM project_spaces WHERE project_id = $1 AND id = $2",
      [projectId, spaceId],
    );
    await this.database.query(
      `WITH ordered AS (
         SELECT id, row_number() OVER (ORDER BY sort_order, id) - 1 AS new_order
           FROM project_spaces
          WHERE project_id = $1
       )
       UPDATE project_spaces ps
          SET sort_order = ordered.new_order
         FROM ordered
        WHERE ps.id = ordered.id`,
      [projectId],
    );
  }
}

const projectSelect = `SELECT p.id, p.name, p.customer_name, p.address,
                              p.building_area, p.lead_designer_id,
                              u.account AS lead_account,
                              u.display_name AS lead_display_name,
                              u.phone AS lead_phone, u.role AS lead_role
                         FROM projects p
                         JOIN users u ON u.id = p.lead_designer_id`;

function toProjectSummary(row: ProjectRow): ProjectSummary {
  return {
    address: row.address,
    buildingArea: row.building_area,
    customerName: row.customer_name,
    id: row.id,
    leadDesigner: {
      account: row.lead_account,
      displayName: row.lead_display_name,
      id: row.lead_designer_id,
      phone: row.lead_phone,
      role: row.lead_role,
    },
    name: row.name,
  };
}

function toProjectSpace(row: SpaceRow): ProjectSpace {
  return {
    area: row.area,
    displayName: row.display_name,
    height: row.height,
    id: row.id,
    includesBalcony: row.includes_balcony,
    perimeter: row.perimeter,
    sortOrder: row.sort_order,
    type: row.type,
  };
}

function isUniqueViolation(error: unknown): error is { code: "23505" } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}
