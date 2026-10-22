export interface ConversationMessage { from: string; text: string; at: number; }
export const visibleConversationText = (messages: readonly ConversationMessage[], max = 2): ConversationMessage[] => messages.filter(message => message.text.trim()).slice(-max).map(message => ({ ...message, text: message.text.slice(0, 40) }));
export const conversationTitle = (names: readonly string[]): string => names.length <= 2 ? `Talk to ${names.join(", ")}` : `Talk to ${names.slice(0, 2).join(", ")} +${names.length - 2}`;
