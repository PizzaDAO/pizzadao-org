/**
 * Type definitions for Discord API entities
 * Used for Discord bot integration and role management
 */

export interface DiscordUser {
  id: string;
  username: string;
  discriminator: string;
  avatar?: string;
}

export interface DiscordMember {
  user?: DiscordUser;
  nick?: string;
  roles?: string[];
}

export interface DiscordErrorResponse {
  code?: number;
  message?: string;
}

export interface DiscordRole {
  id: string;
  name: string;
  color: number;
  position: number;
  permissions: string;
}
