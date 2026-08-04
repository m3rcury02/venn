export function isAdminUser(userId: string | null | undefined): boolean {
  if (!userId) return false;
  const raw = process.env.ADMIN_USER_IDS ?? "";
  const adminIds = raw
    .split(",")
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean);
  return adminIds.includes(userId.toLowerCase());
}
