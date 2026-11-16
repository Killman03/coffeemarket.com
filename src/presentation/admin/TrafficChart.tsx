"use client";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AnalyticsReport } from "../../domain/analytics";
const shortDate = (date: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
  }).format(new Date(date));

/** Displays UTC session cohorts using the project's existing chart library. */
export default function TrafficChart({
  daily,
}: {
  daily: AnalyticsReport["daily"];
}) {
  return (
    <div
      style={{ width: "100%", height: 260, minWidth: 0 }}
      role="img"
      aria-label="Динамика сессий, начала работы и полученных результатов по дням UTC"
    >
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <AreaChart
          data={daily}
          margin={{ top: 12, right: 16, bottom: 0, left: -24 }}
          accessibilityLayer
        >
          <CartesianGrid
            strokeDasharray="3 5"
            vertical={false}
            stroke="#eee8df"
          />
          <XAxis
            dataKey="date"
            tickFormatter={shortDate}
            tick={{ fontSize: 11, fill: "#817366" }}
            axisLine={false}
            tickLine={false}
            minTickGap={32}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 11, fill: "#817366" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            labelFormatter={(value) => shortDate(String(value))}
            contentStyle={{
              border: "1px solid #e6ddcf",
              borderRadius: 12,
              fontSize: 12,
            }}
          />
          <Area
            type="monotone"
            dataKey="sessions"
            name="Сессии"
            stroke="#b58245"
            fill="#f4e4cb"
            strokeWidth={2}
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="engaged"
            name="Начали работу"
            stroke="#547a65"
            fill="#e1ebe5"
            strokeWidth={2}
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="completed"
            name="Получили результат"
            stroke="#503623"
            fill="#e5d8ca"
            strokeWidth={2}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
