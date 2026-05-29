export interface BaseScEvent {
  timestamp: string; // ISO-8601 from log
}

export interface LoginEvent extends BaseScEvent {
  kind: "login";
  nickname: string;
  geid: string;
}

export interface YouJoinedChannelEvent extends BaseScEvent {
  kind: "you-joined-channel";
  shipType: string;
  owner: string;
}

export interface OtherJoinedChannelEvent extends BaseScEvent {
  kind: "other-joined-channel";
  player: string;
  shipType: string;
  owner: string;
}

export interface ShipDestroyedEvent extends BaseScEvent {
  kind: "ship-destroyed";
  shipType: string;
  owner: string | null;
}

export type ScEvent =
  | LoginEvent
  | YouJoinedChannelEvent
  | OtherJoinedChannelEvent
  | ShipDestroyedEvent;
