export function parseDailySchedule(value) {
  const match = /^([0-5]?\d)\s+([01]?\d|2[0-3])\s+\*\s+\*\s+\*$/u.exec(value.trim());
  if (match === null) {
    throw new Error("BACKUP_SCHEDULE must be a daily cron expression such as '17 2 * * *'.");
  }
  return { minute: Number(match[1]), hour: Number(match[2]) };
}

export function nextScheduledRun(schedule, now = new Date()) {
  const next = new Date(now);
  next.setUTCSeconds(0, 0);
  next.setUTCHours(schedule.hour, schedule.minute, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}
