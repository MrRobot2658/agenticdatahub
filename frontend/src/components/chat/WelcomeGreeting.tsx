import { useEffect, useState } from "react";
import { useLang } from "../../context/LangContext";

// 鸡汤（每次进入随机一条）
const QUOTES_ZH = [
  "今天的每一点努力，都是明天的底气。",
  "先完成，再完美。",
  "把简单的事做到极致，就是不简单。",
  "数据不会说谎，但它会等懂它的人。",
  "慢慢来，反而比较快。",
  "你不需要很厉害才能开始，但要开始才会很厉害。",
  "保持好奇，保持热爱。",
  "比起昨天的自己，今天进步一点点就好。",
];
const QUOTES_EN = [
  "Every small effort today is tomorrow's confidence.",
  "Done is better than perfect.",
  "Doing simple things extremely well is not simple at all.",
  "Data never lies — it waits for those who understand it.",
  "Slow is smooth, and smooth is fast.",
  "You don't have to be great to start, but you have to start to be great.",
  "Stay curious, stay passionate.",
  "Just be a little better than yesterday.",
];

// WMO 天气码 → emoji + 描述
function wmo(code: number): { emoji: string; zh: string; en: string } {
  if (code === 0) return { emoji: "☀️", zh: "晴", en: "Clear" };
  if (code <= 2) return { emoji: "⛅", zh: "多云", en: "Partly cloudy" };
  if (code === 3) return { emoji: "☁️", zh: "阴", en: "Overcast" };
  if (code <= 48) return { emoji: "🌫️", zh: "雾", en: "Fog" };
  if (code <= 67) return { emoji: "🌧️", zh: "雨", en: "Rain" };
  if (code <= 77) return { emoji: "❄️", zh: "雪", en: "Snow" };
  if (code <= 82) return { emoji: "🌦️", zh: "阵雨", en: "Showers" };
  if (code <= 86) return { emoji: "🌨️", zh: "阵雪", en: "Snow showers" };
  return { emoji: "⛈️", zh: "雷雨", en: "Thunderstorm" };
}

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function WelcomeGreeting({ name }: { name: string }) {
  const { tr, lang } = useLang();
  const [now, setNow] = useState(() => new Date());
  const [weather, setWeather] = useState<{ temp: number; code: number } | null>(null);
  const [quoteIdx] = useState(() => Math.floor(Math.random() * QUOTES_ZH.length));

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const get = (lat: number, lon: number) =>
      fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code`)
        .then((r) => r.json())
        .then((d) => {
          const c = d?.current;
          if (c) setWeather({ temp: Math.round(Number(c.temperature_2m)), code: Number(c.weather_code) });
        })
        .catch(() => {});
    // 优先用浏览器定位，失败/拒绝则回退北京
    if (typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (p) => get(p.coords.latitude, p.coords.longitude),
        () => get(39.9042, 116.4074),
        { timeout: 3000, maximumAge: 600000 },
      );
    } else {
      get(39.9042, 116.4074);
    }
  }, []);

  const h = now.getHours();
  const greet =
    h < 6 ? tr("凌晨好", "Still up") :
    h < 12 ? tr("早上好", "Good morning") :
    h < 14 ? tr("中午好", "Good noon") :
    h < 18 ? tr("下午好", "Good afternoon") :
    h < 23 ? tr("晚上好", "Good evening") : tr("夜深了", "Good night");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const wd = (lang === "en" ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] : ["日", "一", "二", "三", "四", "五", "六"])[now.getDay()];
  const dateStr = lang === "en"
    ? `${MONTHS_EN[now.getMonth()]} ${now.getDate()}, ${wd}`
    : `${now.getMonth() + 1}月${now.getDate()}日 周${wd}`;
  const w = weather ? wmo(weather.code) : null;
  const quote = (lang === "en" ? QUOTES_EN : QUOTES_ZH)[quoteIdx];

  return (
    <div className="text-center">
      <h2 className="text-2xl font-bold tracking-tight text-gray-900">{greet}，{name} 👋</h2>
      <p className="mt-1.5 text-sm text-gray-500">
        {dateStr} {hh}:{mm}
        {w && <span className="ml-2">· {w.emoji} {tr(w.zh, w.en)} {weather!.temp}°C</span>}
      </p>
      <p className="mx-auto mt-3 max-w-md text-[13px] italic text-gray-400">“{quote}”</p>
    </div>
  );
}
