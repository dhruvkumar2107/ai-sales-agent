// Drives a text-mode test call through the browser-console WebSocket, like the dashboard does.
// Usage: node scripts/smoke-console.mjs [ws://localhost:4000]
import WebSocket from "ws";

const base = process.argv[2] ?? "ws://localhost:4000";
const lines = ["Hi, I want to book a test drive of the Creta tomorrow", "My name is Rahul", "11 am please", "Yes, please confirm", "That's all, thank you"];
const ws = new WebSocket(`${base}/ws/console?token=dev&mode=text&agentId=agent-car-showroom`);
let audioBytes = 0;
let i = 0;
let timer;

const next = () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (i < lines.length) {
      console.log(`caller> ${lines[i]}`);
      ws.send(JSON.stringify({ type: "text", text: lines[i++] }));
    }
  }, 400);
};

ws.on("message", (data, isBinary) => {
  if (isBinary) return void (audioBytes += data.length);
  const msg = JSON.parse(data.toString());
  if (msg.type === "transcript" && msg.role === "agent") {
    console.log(`agent>  ${msg.text}`);
    next();
  }
  if (msg.type === "latency") console.log(`        (first audio ${msg.firstAudioMs} ms)`);
  if (msg.type === "call_summary") {
    console.log(`\nresult: ${msg.outcome} | score ${msg.leadScore} | cost ₹${msg.cost?.total} | audio received ${audioBytes} bytes`);
    ws.close();
    process.exit(msg.outcome === "test_drive_booked" ? 0 : 1);
  }
});
ws.on("error", (e) => {
  console.error(e.message);
  process.exit(1);
});
setTimeout(() => {
  console.error("timeout");
  process.exit(1);
}, 30000);
