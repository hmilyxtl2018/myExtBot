/**
 * ResultChart — renders tool call outputs as charts / visual cards.
 * Handles: weather data, string arrays (topic lists), numeric objects.
 * Falls back to a pre-formatted JSON block for unknown shapes.
 */

interface WeatherOutput {
  city?: string;
  temp?: number;
  condition?: string;
  humidity?: string;
  wind?: string;
}

interface SearchOutput {
  results?: string[];
}

function isWeather(o: unknown): o is WeatherOutput {
  return typeof o === "object" && o !== null && "temp" in o;
}

function isSearch(o: unknown): o is SearchOutput {
  return (
    typeof o === "object" &&
    o !== null &&
    "results" in o &&
    Array.isArray((o as SearchOutput).results)
  );
}

/** Parse a humidity string like "45%" → 45 */
function parsePercent(s: string | undefined): number {
  if (!s) return 0;
  const n = parseFloat(s);
  return isNaN(n) ? 0 : Math.min(100, Math.max(0, n));
}

/** Map temperature (−20..50°C) to a 0–100 scale for the gauge */
const TEMP_MIN = -20;
const TEMP_RANGE = 70; // covers -20°C to 50°C

function tempToScale(t: number): number {
  return Math.min(100, Math.max(0, ((t - TEMP_MIN) / TEMP_RANGE) * 100));
}

function WeatherCard({ o }: { o: WeatherOutput }) {
  const humidityPct = parsePercent(o.humidity);
  const tempScale = tempToScale(o.temp ?? 0);
  return (
    <div className="result-card result-weather">
      <div className="weather-header">
        <span className="weather-city">{o.city ?? "—"}</span>
        <span className="weather-condition">{o.condition ?? "—"}</span>
        <span className="weather-temp">{o.temp}°C</span>
      </div>
      <div className="weather-gauge-row">
        <span className="weather-gauge-label">气温</span>
        <div className="gauge-track">
          <div className="gauge-fill gauge-temp" style={{ width: `${tempScale}%` }} />
        </div>
        <span className="weather-gauge-val">{o.temp}°</span>
      </div>
      <div className="weather-gauge-row">
        <span className="weather-gauge-label">湿度</span>
        <div className="gauge-track">
          <div className="gauge-fill gauge-humidity" style={{ width: `${humidityPct}%` }} />
        </div>
        <span className="weather-gauge-val">{o.humidity}</span>
      </div>
      {o.wind && <div className="weather-meta">{o.wind}</div>}
    </div>
  );
}

function TopicList({ o }: { o: SearchOutput }) {
  const items = o.results ?? [];
  return (
    <div className="result-card result-topics">
      <div className="topic-list-title">搜索结果 · {items.length} 条</div>
      <ol className="topic-list">
        {items.map((item, i) => (
          <li key={i} className="topic-item">
            <span className="topic-rank">{String(i + 1).padStart(2, "0")}</span>
            <span className="topic-text">{item}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Generic object with numeric values — render as horizontal bar chart */
function BarChart({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data);
  const max = Math.max(...entries.map(([, v]) => v), 1);
  return (
    <div className="result-card result-barchart">
      {entries.map(([label, value]) => (
        <div key={label} className="bar-row">
          <span className="bar-label">{label}</span>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${(value / max) * 100}%` }} />
          </div>
          <span className="bar-val">{value}</span>
        </div>
      ))}
    </div>
  );
}

function isNumericObject(o: unknown): o is Record<string, number> {
  if (typeof o !== "object" || o === null || Array.isArray(o)) return false;
  return Object.values(o as object).every((v) => typeof v === "number");
}

interface Props {
  tool?: string;
  output: unknown;
}

export default function ResultChart({ output }: Props) {
  if (isWeather(output)) return <WeatherCard o={output} />;
  if (isSearch(output)) return <TopicList o={output} />;
  // Render numeric objects as bar charts only when the output shape matches
  // (don't attempt bar charts for weather-shaped objects caught by isWeather above)
  if (isNumericObject(output)) return <BarChart data={output} />;

  // Fallback — pretty-printed JSON
  return (
    <pre className="log-params">
      {JSON.stringify(output, null, 2)}
    </pre>
  );
}
