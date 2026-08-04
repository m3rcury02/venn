export const RESERVED_USERNAMES = [
  "admin",
  "administrator",
  "venn",
  "support",
  "help",
  "api",
  "settings",
  "login",
  "about",
  "privacy",
  "terms",
  "moderation",
  "root",
  "system",
  "official",
  "security",
];

export const ABUSIVE_USERNAMES = [
  "nigger",
  "nigga",
  "faggot",
  "retard",
  "cunt",
  "bitch",
  "chink",
  "kike",
  "spic",
  "whore",
  "slut",
];

export function isUsernameBlocked(username: string): boolean {
  const normalized = username.trim().toLowerCase();

  if (RESERVED_USERNAMES.includes(normalized)) {
    return true;
  }

  if (ABUSIVE_USERNAMES.some((word) => normalized.includes(word))) {
    return true;
  }

  return false;
}
