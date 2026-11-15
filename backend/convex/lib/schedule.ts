import { Temporal } from "@js-temporal/polyfill";

export const prompts = [
  { question: "Do you like pineapple on pizza?", options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }, { id: "depends", label: "Depends" }] },
  { question: "Do you think Elon Musk is a genius? How is he successful?", options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }, { id: "complicated", label: "It's complicated" }] },
];
export function chooseOpening(date: string, timeZone: string, startHour: number, endHour: number, random: number) {
  if (!Number.isInteger(startHour) || !Number.isInteger(endHour) || startHour < 0 || endHour > 23 || startHour >= endHour || random < 0 || random >= 1) throw new Error("Invalid round window");
  const day = Temporal.PlainDate.from(date);
  const start = day.toZonedDateTime({ timeZone, plainTime: { hour: startHour } });
  const end = day.toZonedDateTime({ timeZone, plainTime: { hour: endHour } });
  if (end.epochMilliseconds <= start.epochMilliseconds) throw new Error("Round window has no real instants");
  const plannedAt = start.epochMilliseconds + Math.floor(random * (end.epochMilliseconds - start.epochMilliseconds));
  const zoned = Temporal.Instant.fromEpochMilliseconds(plannedAt).toZonedDateTimeISO(timeZone);
  if (zoned.hour < startHour || zoned.hour >= endHour) throw new Error("Round opening is outside its local window");
  return plannedAt;
}
export function dailyPlans(now: number, timeZone: string, startHour: number, endHour: number, random: () => number) {
  const today = Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(timeZone).toPlainDate();
  return [0, 1, 2].map(offset => {
    const date = today.add({ days: offset }).toString();
    const prompt = prompts[Math.abs(Temporal.PlainDate.from(date).since(Temporal.PlainDate.from("2026-01-01")).days) % prompts.length];
    return { planKey: `${timeZone}:${date}`, plannedAt: chooseOpening(date, timeZone, startHour, endHour, random()), ...prompt };
  });
}
