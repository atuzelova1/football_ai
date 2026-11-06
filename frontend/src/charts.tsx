import { useEffect, useState, type ReactElement } from "react";
import {
  ResponsiveContainer,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  LineChart,
  Line,
  BarChart,
  Bar,
  ReferenceLine,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ScatterChart,
  Scatter,
  Cell,
  ZAxis,
} from "recharts";
import type { MatchAnalysis, Opponents, Shot } from "./types";
import { clubName, metricName, n } from "./format";
import { useApp } from "./context";

export const BLUE = "#2878e8",
  CYAN = "#72d4ee",
  MINT = "#139782",
  AMBER = "#c48b24",
  RED = "#ad6173";
const colors = [BLUE, AMBER, MINT, RED, CYAN];
const grid = { stroke: "#dce5ef", strokeDasharray: "3 5", vertical: false };
const axis = {
  stroke: "#52677c",
  fontSize: 14,
  tickLine: false,
  axisLine: false,
};
const tooltipStyle = {
  background: "#ffffff",
  border: "1px solid #cadbea",
  borderRadius: 10,
  color: "#1b3048",
  fontSize: 14,
  boxShadow: "0 8px 30px #06132499",
};
export function Chart({
  children,
  height = 260,
  label,
}: {
  children: ReactElement;
  height?: number;
  label: string;
}) {
  return (
    <div className="chart" style={{ height }} role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}
export function TrendChart({
  data,
  lines,
  x = "round",
  height = 260,
}: {
  data: object[];
  lines: { key: string; name: string; color: string }[];
  x?: string;
  height?: number;
}) {
  return (
    <Chart height={height} label={lines.map((l) => l.name).join(", ")}>
      <LineChart
        data={data}
        margin={{ top: 10, right: 12, left: -22, bottom: 0 }}
      >
        <CartesianGrid {...grid} />
        <XAxis {...axis} dataKey={x} minTickGap={24} />
        <YAxis
          {...axis}
          tickFormatter={(v: number) => n(v, Number.isInteger(v) ? 0 : 2)}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(v: number, name: string) => [n(v, 2), name]}
          labelFormatter={(v) =>
            x === "minute" ? `${v}-я минута` : `Тур / дата: ${v}`
          }
        />
        <Legend
          iconType="circle"
          iconSize={7}
          wrapperStyle={{ fontSize: 14, paddingTop: 12 }}
        />
        {lines.map((l) => (
          <Line
            key={l.key}
            type={x === "minute" ? "stepAfter" : "monotone"}
            dataKey={l.key}
            name={l.name}
            stroke={l.color}
            dot={false}
            strokeWidth={2.2}
          />
        ))}
      </LineChart>
    </Chart>
  );
}
export function ComparisonChart({
  data,
  bars,
  x = "label",
  height,
  horizontal = false,
  reference,
  valueFormatter = (v: number) => n(v, 2),
}: {
  data: object[];
  bars: { key: string; name: string; color: string }[];
  x?: string;
  height?: number;
  horizontal?: boolean;
  reference?: number;
  valueFormatter?: (v: number) => string;
}) {
  return (
    <Chart
      height={
        horizontal
          ? Math.min(height ?? 360, Math.max(150, data.length * 42 + 65))
          : (height ?? 230)
      }
      label={bars.map((b) => b.name).join(", ")}
    >
      <BarChart
        data={data}
        layout={horizontal ? "vertical" : "horizontal"}
        margin={{ top: 8, right: 12, left: horizontal ? 10 : -23, bottom: 0 }}
        barGap={4}
      >
        <CartesianGrid {...grid} />
        {horizontal ? (
          <>
            <XAxis
              {...axis}
              type="number"
              tickFormatter={valueFormatter}
            />
            <YAxis
              {...axis}
              type="category"
              dataKey={x}
              width={175}
              interval={0}
              tickFormatter={(value: string) =>
                value.length > 23 ? value.slice(0, 22) + "…" : value
              }
            />
          </>
        ) : (
          <>
            <XAxis
              {...axis}
              dataKey={x}
              interval={0}
              tick={{ fontSize: 14, fill: "#52677c" }}
            />
            <YAxis
              {...axis}
              tickFormatter={valueFormatter}
            />
          </>
        )}
        <Tooltip
          cursor={{ fill: "#68c9ff0b" }}
          contentStyle={tooltipStyle}
          formatter={(v: number, name: string) => [valueFormatter(v), name]}
        />
        <Legend
          iconType="circle"
          iconSize={7}
          wrapperStyle={{ fontSize: 14, paddingTop: 12 }}
        />
        {reference != null &&
          (horizontal ? (
            <ReferenceLine x={reference} stroke={AMBER} strokeDasharray="4 4" />
          ) : (
            <ReferenceLine y={reference} stroke={AMBER} strokeDasharray="4 4" />
          ))}
        {bars.map((b) => (
          <Bar
            key={b.key}
            dataKey={b.key}
            name={b.name}
            fill={b.color}
            radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
            maxBarSize={34}
          />
        ))}
      </BarChart>
    </Chart>
  );
}
export function StyleRadar({ value }: { value: Opponents }) {
  const data = value.visuals.radar.map((r) => ({
    ...r,
    label: metricName[r.metric] ?? r.metric,
  }));
  return (
    <Chart label="Нормированный профиль клуба и соперника" height={330}>
      <RadarChart data={data} outerRadius="68%">
        <PolarGrid stroke="#37546b" />
        <PolarAngleAxis
          dataKey="label"
          tick={{ fontSize: 14, fill: "#52677c" }}
        />
        <PolarRadiusAxis
          angle={90}
          domain={[0, 100]}
          tick={{ fontSize: 9, fill: "#7f9cb5" }}
          tickCount={3}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(v: number, name: string) => [`${n(v, 1)} / 100`, name]}
        />
        <Radar
          name="Выбранный клуб"
          dataKey="team"
          stroke={BLUE}
          fill={BLUE}
          fillOpacity={0.15}
        />
        <Radar
          name="Соперник"
          dataKey="opponent"
          stroke={AMBER}
          fill={AMBER}
          fillOpacity={0.08}
        />
        <Legend
          iconType="circle"
          iconSize={7}
          wrapperStyle={{ fontSize: 14 }}
        />
      </RadarChart>
    </Chart>
  );
}
export function ClusterScatter({ value }: { value: Opponents }) {
  const { clubs, selectedClubId, selectedOpponentId, setOpponent } = useApp();
  return (
    <Chart label="Кластеры клубов: передачи и удары за матч" height={330}>
      <ScatterChart margin={{ top: 15, right: 15, left: -15, bottom: 10 }}>
        <CartesianGrid {...grid} />
        <XAxis
          {...axis}
          type="number"
          dataKey="passes"
          name="Передачи за матч"
          domain={["auto", "auto"]}
          label={{
            value: "Передачи за матч",
            position: "insideBottom",
            offset: -6,
            fill: "#52677c",
            fontSize: 14,
          }}
        />
        <YAxis
          {...axis}
          tickFormatter={(v: number) => n(v, Number.isInteger(v) ? 0 : 2)}
          type="number"
          dataKey="shots"
          name="Удары за матч"
          domain={["auto", "auto"]}
        />
        <ZAxis range={[85, 85]} />
        <Tooltip
          cursor={{ strokeDasharray: "3 3" }}
          contentStyle={tooltipStyle}
          content={({ active, payload }) => {
            const p = payload?.[0]?.payload as
              | Opponents["visuals"]["team_profiles"][number]
              | undefined;
            return active && p ? (
              <div className="chart-tooltip">
                <b>
                  {clubName(
                    clubs.find((c) => c.team_id === p.team_id)?.name ?? "Клуб",
                  )}
                </b>
                <p>
                  Передачи: {n(p.passes)} · Удары: {n(p.shots)}
                </p>
                <p>Группа {p.cluster_id + 1} · нажмите для выбора соперника</p>
              </div>
            ) : null;
          }}
        />
        {value.style_model.clusters.map((c) => (
          <Scatter
            key={c.cluster_id}
            name={`Группа ${c.cluster_id + 1}`}
            data={value.visuals.team_profiles.filter(
              (p) => p.cluster_id === c.cluster_id,
            )}
            fill={colors[c.cluster_id % colors.length]}
            onClick={(p) => {
              if (p.team_id !== selectedClubId) setOpponent(Number(p.team_id));
            }}
          >
            {value.visuals.team_profiles
              .filter((p) => p.cluster_id === c.cluster_id)
              .map((p) => (
                <Cell
                  key={p.team_id}
                  stroke={
                    p.team_id === selectedClubId
                      ? "#fff"
                      : p.team_id === selectedOpponentId
                        ? AMBER
                        : "transparent"
                  }
                  strokeWidth={3}
                />
              ))}
          </Scatter>
        ))}
        <Legend
          iconType="circle"
          iconSize={7}
          wrapperStyle={{ fontSize: 14, paddingTop: 15 }}
        />
      </ScatterChart>
    </Chart>
  );
}

export function ShotPitch({ analysis }: { analysis: MatchAnalysis }) {
  const [shown, setShown] = useState("both");
  const [hover, setHover] = useState<Shot | null>(null);
  useEffect(() => {
    setHover(null);
    setShown("both");
  }, [analysis.match.match_id]);
  const own = analysis.teams.find((t) => t.team_id === analysis.team.team_id)!,
    opp = analysis.teams.find((t) => t.team_id !== analysis.team.team_id)!;
  const shots = analysis.shots.filter(
    (s) =>
      s.x != null &&
      s.y != null &&
      (shown === "both" ||
        (shown === "team" && s.is_selected_team) ||
        (shown === "opponent" && !s.is_selected_team) ||
        (shown === "dangerous" &&
          analysis.visuals.coaching.dangerous_event_ids.includes(s.event_id)) ||
        (shown === "central" &&
          analysis.visuals.coaching.central_event_ids.includes(s.event_id)) ||
        (shown === "low" &&
          analysis.visuals.coaching.low_quality_event_ids.includes(
            s.event_id,
          ))),
  );
  return (
    <div className="pitch-module">
      <div className="pitch-controls">
        <div className="segmented" role="group" aria-label="Удары на карте">
          {[
            ["both", "Все удары"],
            ["team", "Команда"],
            ["opponent", "Соперник"],
            ["dangerous", "Опасные допущенные"],
            ["central", "Допущенные из центра"],
            ["low", "Свои с низким xG"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={shown === id ? "active" : ""}
              onClick={() => {
                setShown(id);
                setHover(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="tiny">
          Крупнее маркер — выше xG · низкий xG &lt; 0,05
        </span>
      </div>
      <div className="pitch-direction">
        <span>{clubName(opp.name)} ←</span>
        <span>→ {clubName(own.name)}</span>
      </div>
      <div className="pitch-wrap">
        <svg
          viewBox="-5 -7 130 94"
          className="football-pitch"
          role="img"
          aria-label={`Карта реальных ударов: ${clubName(own.name)} — ${clubName(opp.name)}`}
        >
          <defs>
            <linearGradient id="pitch-bg" x2="1" y2="1">
              <stop stopColor="#153b4d" />
              <stop offset="1" stopColor="#123347" />
            </linearGradient>
            <pattern
              id="grass"
              width="20"
              height="80"
              patternUnits="userSpaceOnUse"
            >
              <rect width="10" height="80" fill="#80c6d6" opacity=".035" />
            </pattern>
          </defs>
          <rect
            x="0"
            y="0"
            width="120"
            height="80"
            fill="url(#pitch-bg)"
            rx=".8"
          />
          <rect width="120" height="80" fill="url(#grass)" />
          <g stroke="#7ba1b4" strokeWidth=".3" fill="none" opacity=".75">
            <rect width="120" height="80" />
            <path d="M60 0v80" />
            <circle cx="60" cy="40" r="9.15" />
            <circle cx="60" cy="40" r=".55" fill="#7ba1b4" />
            <path d="M0 18h18v44H0 M0 30h6v20H0 M120 18h-18v44h18 M120 30h-6v20h6" />
            <path d="M18 32a10 10 0 0 1 0 16 M102 32a10 10 0 0 0 0 16" />
            <circle cx="12" cy="40" r=".45" fill="#7ba1b4" />
            <circle cx="108" cy="40" r=".45" fill="#7ba1b4" />
            <path d="M0 36h-2v8h2 M120 36h2v8h-2" />
          </g>
          {shots.map((s) => {
            const x = s.is_selected_team ? s.x! : 120 - s.x!,
              y = s.is_selected_team ? s.y! : 80 - s.y!;
            const radius = 0.7 + Math.sqrt(s.xg ?? 0) * 3.7;
            const color = s.is_selected_team ? "#50c5ff" : "#ffce7d";
            const description = `${s.minute}′ · ${s.player_name} · ${clubName(s.is_selected_team ? own.name : opp.name)} · ${s.outcome_label} · xG ${n(s.xg, 3)}`;
            return (
              <g
                key={s.event_id}
                className="shot-marker"
                tabIndex={0}
                role="img"
                aria-label={description}
                onMouseEnter={() => setHover(s)}
                onFocus={() => setHover(s)}
                onMouseLeave={() => setHover(null)}
                onBlur={() => setHover(null)}
              >
                <title>{description}</title>
                <circle
                  cx={x}
                  cy={y}
                  r={radius}
                  fill={s.goal ? color : "#102b3f"}
                  fillOpacity={s.goal ? 1 : 0.85}
                  stroke={color}
                  strokeWidth={s.goal ? 0.5 : 0.4}
                />
                {s.goal === 1 && (
                  <path
                    d={`M${x - radius * 0.4} ${y}l${radius * 0.3} ${radius * 0.3} ${radius * 0.55} -${radius * 0.6}`}
                    fill="none"
                    stroke="#082039"
                    strokeWidth=".45"
                  />
                )}
              </g>
            );
          })}
        </svg>
        {hover && (
          <div className="shot-tooltip" role="status">
            <b>
              {hover.minute}′ · {hover.player_name}
            </b>
            <span>
              {clubName(hover.is_selected_team ? own.name : opp.name)} ·{" "}
              {hover.outcome_label}
            </span>
            <strong>xG {n(hover.xg, 3)}</strong>
          </div>
        )}
      </div>
      <div className="pitch-legend">
        <span>
          <i className="dot" style={{ background: BLUE }} />
          {clubName(own.name)}
        </span>
        <span>
          <i className="dot" style={{ background: AMBER }} />
          {clubName(opp.name)}
        </span>
        <span>● Гол · ○ Другой исход</span>
      </div>
    </div>
  );
}
export function PassingHeatmap({ value }: { value: MatchAnalysis }) {
  const max = Math.max(
    1,
    ...value.visuals.passing_matrix.map((p) => p.attempts),
  );
  return (
    <div className="passing-heatmap">
      <div className="heatmap-layout">
        <span className="heatmap-y">Начальная зона</span>
        <div>
          <div className="heatmap-grid">
            {value.visuals.passing_matrix.map((p) => (
              <div
                key={`${p.start_zone}:${p.end_zone}`}
                tabIndex={0}
                style={{
                  background: `rgba(53,168,255,${0.06 + (p.attempts / max) * 0.7})`,
                }}
                title={`Из зоны ${p.start_zone + 1} в ${p.end_zone + 1}: ${p.attempts} передач, ${p.completed} завершено`}
                aria-label={`Зона ${p.start_zone + 1} → ${p.end_zone + 1}: ${p.attempts} передач`}
              >
                {p.attempts || "·"}
              </div>
            ))}
          </div>
          <div className="heatmap-scale">
            {Array.from({ length: 9 }, (_, i) => (
              <span key={i}>{i + 1}</span>
            ))}
          </div>
          <p className="tiny text-center">Конечная зона</p>
        </div>
      </div>
      <p className="tiny mt-3">
        Поле поделено на 9 зон: три трети × три коридора. Цвет — число передач;
        наведение — завершённые передачи.
      </p>
    </div>
  );
}
