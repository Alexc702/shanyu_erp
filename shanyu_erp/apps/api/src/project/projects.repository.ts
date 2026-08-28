import type {
  ProjectDetail,
  ProjectSpace,
  ProjectSummary,
  SessionUser,
} from "@shanyu/contracts";

export const PROJECTS_REPOSITORY = Symbol("PROJECTS_REPOSITORY");

export interface NewProject extends Omit<ProjectDetail, "leadDesigner"> {
  readonly createdByUserId: string;
  readonly leadDesignerId: string;
}

export interface ProjectsRepository {
  findLeadDesigner(userId: string): Promise<SessionUser | null>;
  create(input: NewProject): Promise<ProjectDetail>;
  list(leadDesignerId: string | null): Promise<ProjectSummary[]>;
  findById(projectId: string): Promise<ProjectDetail | null>;
  addSpace(projectId: string, input: ProjectSpace): Promise<ProjectSpace>;
  updateSpace(projectId: string, input: ProjectSpace): Promise<ProjectSpace>;
  deleteSpace(projectId: string, spaceId: string): Promise<void>;
}

export class DuplicateSpaceNameError extends Error {}
