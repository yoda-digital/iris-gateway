declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type ChannelId = Brand<string, "ChannelId">;
export type SessionId = Brand<string, "SessionId">;
export type UserId = Brand<string, "UserId">;
export type ChatId = Brand<string, "ChatId">;

export const ChannelId = {
  make: (value: string): ChannelId => value as ChannelId,
};

export const SessionId = {
  make: (value: string): SessionId => value as SessionId,
};

export const UserId = {
  make: (value: string): UserId => value as UserId,
};

export const ChatId = {
  make: (value: string): ChatId => value as ChatId,
};
