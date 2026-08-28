/** Transport contract returned by the API liveness endpoint. */
export interface HealthResponse {
  readonly status: "ok";
}

export type UserRole =
  | "OWNER"
  | "LEAD_DESIGNER"
  | "WOODWORK_DESIGNER"
  | "PROJECT_MANAGER"
  | "FINANCE";

export interface SessionUser {
  readonly id: string;
  readonly account: string;
  readonly displayName: string;
  readonly phone: string | null;
  readonly role: UserRole;
}

export interface LoginRequest {
  readonly identifier: string;
  readonly password: string;
  readonly rememberMe: boolean;
}

export interface LoginResponse {
  readonly user: SessionUser;
}

export type UserStatus = "ACTIVE" | "DISABLED";

export interface UserSummary extends SessionUser {
  readonly status: UserStatus;
}

export interface CreateUserRequest {
  readonly account: string;
  readonly displayName: string;
  readonly password: string;
  readonly phone: string | null;
  readonly role: UserRole;
}

export type SpaceType =
  | "LIVING_DINING"
  | "BEDROOM"
  | "KITCHEN"
  | "BATHROOM"
  | "BALCONY";

export interface ProjectSpace {
  readonly area: string;
  readonly displayName: string;
  readonly height: string;
  readonly id: string;
  readonly includesBalcony: boolean;
  readonly perimeter: string;
  readonly sortOrder: number;
  readonly type: SpaceType;
}

export interface SpaceInput {
  readonly area: string;
  readonly displayName: string;
  readonly height: string;
  readonly includesBalcony: boolean;
  readonly perimeter: string;
  readonly type: SpaceType;
}

export interface ProjectSummary {
  readonly address: string;
  readonly buildingArea: string;
  readonly customerName: string;
  readonly id: string;
  readonly leadDesigner: SessionUser;
  readonly name: string;
}

export interface ProjectDetail extends ProjectSummary {
  readonly spaces: ProjectSpace[];
}

export interface CreateProjectRequest {
  readonly address: string;
  readonly buildingArea: string;
  readonly customerName: string;
  readonly leadDesignerId: string;
  readonly name: string;
  readonly spaces: SpaceInput[];
}

export interface AddSpaceRequest extends SpaceInput {
  readonly confirmStandaloneBalcony: boolean;
}

export type UpdateSpaceRequest = SpaceInput;
