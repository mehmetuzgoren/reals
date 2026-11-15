export type PushRequest = {
  token: string;
  notification: { title: string; body: string };
  data: { type: string; roundId: string; contentId?: string };
  apns: { headers: Record<string, string>; payload: { aps: { sound: string } } };
};

export type PushResult = "sent" | "invalid-token" | "unavailable";

export async function sendPush(_request: PushRequest): Promise<PushResult> {
  return "unavailable";
}
