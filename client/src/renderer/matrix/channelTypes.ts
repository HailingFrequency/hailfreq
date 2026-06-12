export enum ChannelType {
  TEXT = "text",
  VOICE = "voice",
}

export interface Channel {
  id: string; // Matrix room ID
  name: string;
  type: ChannelType;
  netId: string; // Parent net/Space ID
  topic?: string;
  encrypted: boolean;
}

export interface TextChannel extends Channel {
  type: ChannelType.TEXT;
}

export interface VoiceChannel extends Channel {
  type: ChannelType.VOICE;
  connectedMembers: string[]; // User IDs currently in voice
}
