/**
 * 鉴权与用户类型。
 *
 * 与 docs/api/系统接口.md 对应：§3 鉴权接口、§4 用户接口。
 */

/** 权限角色。权限由后端执行，前端守卫仅改善交互。 */
export type Role = "admin" | "user";

/** 账户状态。 */
export type UserStatus = "active" | "disabled";

export interface User {
  id: string;
  username: string;
  display_name: string;
  role: Role;
  status: UserStatus;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: "bearer";
  /** Access Token 有效期，单位秒。 */
  expires_in: number;
  user: User;
}

export interface ChangePasswordRequest {
  current_password: string;
  new_password: string;
}
