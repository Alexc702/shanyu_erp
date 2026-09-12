import type {
  ProjectDetail,
  ProjectSpace,
  ProjectSummary,
  SessionUser,
} from "@shanyu/contracts";

export const PROJECTS_REPOSITORY = Symbol("PROJECTS_REPOSITORY");

export interface NewProject
  extends Omit<
    ProjectDetail,
    | "createdAt"
    | "leadDesigner"
    | "quotationAmount"
    | "quotationId"
    | "quotationStatus"
    | "quotationVersion"
    | "updatedAt"
  > {
  readonly createdByUserId: string;
  readonly leadDesignerId: string;
}

export interface ProjectsRepository {
  findLeadDesigner(userId: string): Promise<SessionUser | null>;
  create(input: NewProject): Promise<ProjectDetail>;
  list(leadDesignerId: string | null): Promise<ProjectSummary[]>;
  findById(projectId: string): Promise<ProjectDetail | null>;
  getSpaceAdjustmentState(projectId: string): Promise<SpaceAdjustmentState>;
  addSpace(projectId: string, input: ProjectSpace): Promise<ProjectSpace>;
  updateSpace(projectId: string, input: ProjectSpace): Promise<ProjectSpace>;
  reorderSpaces(
    projectId: string,
    spaceIds: readonly string[],
  ): Promise<ProjectSpace[]>;
  deleteSpace(projectId: string, spaceId: string): Promise<void>;
}

export class DuplicateSpaceNameError extends Error {}
export class SpaceAdjustmentLockedError extends Error {}
export class SpaceOrderConflictError extends Error {}

export type SpaceAdjustmentState = "DRAFT" | "LOCKED" | "NO_QUOTATION";
