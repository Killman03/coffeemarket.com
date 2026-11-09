"use client";
import styles from "./Calculator.module.css";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { calculate, type CalculatorInput } from "../domain/calculator";
import { formatMoney } from "./format";

/** Displays sales sensitivity through the same calculation use case. */
export function ProfitChart({ input }: { input: CalculatorInput }) {
  const max = Math.min(10000, Math.max(100, input.cupsPerDay * 2));
  const data = Array.from({ length: 11 }, (_, index) => {
    const cups = Math.round((max * index) / 10);
    return { cups, profit: calculate({ ...input, cupsPerDay: cups }).profit };
  });
  return (
    <div
      className={styles["chart"]}
      role="img"
      aria-label="График месячной прибыли по количеству чашек в день. Точные значения приведены в таблице сценариев."
    >
      <ResponsiveContainer width="100%" height={205} minWidth={0}>
        <LineChart
          data={data}
          margin={{ top: 12, right: 10, left: 0, bottom: 0 }}
        >
          <CartesianGrid
            vertical={false}
            stroke="#eee4d6"
            strokeDasharray="4 4"
          />
          <XAxis
            dataKey="cups"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "#86796b" }}
          />
          <YAxis
            width={58}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10, fill: "#86796b" }}
            tickFormatter={(v: number) => `${Math.round(v / 1000)} тыс.`}
          />
          <Tooltip
            formatter={(v) => [
              `${formatMoney(Number(v))} сом`,
              "Прибыль / мес.",
            ]}
            labelFormatter={(v) => `${v} чашек / день`}
            contentStyle={{
              borderRadius: 12,
              border: "1px solid #e9dece",
              fontSize: 12,
            }}
          />
          <ReferenceLine y={0} stroke="#b8a58f" />
          <ReferenceLine
            x={input.cupsPerDay}
            stroke="#dec2a1"
            strokeDasharray="4 4"
          />
          <Line
            type="linear"
            dataKey="profit"
            stroke="#9a602b"
            strokeWidth={3}
            dot={false}
            activeDot={{ r: 5 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
      <div className={styles["chart-caption"]}>Объём продаж, чашек в день</div>
    </div>
  );
}
