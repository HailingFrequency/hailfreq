export interface Credentials {
  userId: string;
  accessToken: string;
  deviceId: string;
  homeserverUrl: string;
}

export type LoginMethod = "citizenid" | "local";
