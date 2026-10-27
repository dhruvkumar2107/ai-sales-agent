// Emulates Twilio's <Connect><Stream> protocol: sends start + 3 s of mu-law silence, checks the agent
// streams greeting audio back as base64 mu-law "media" events, then sends "stop".
// Usage: node scripts/smoke-twilio.mjs [ws://localhost:4000]
import WebSocket from "ws";

const base = process.argv[2] ?? "ws://localhost:4000";
const ws = new WebSocket(`${base}/media/twilio`);
let mediaOut = 0;
let bytesOut = 0;

ws.on("open", () => {
  ws.send(JSON.stringify({ event: "connected", protocol: "Call", version: "1.0.0" }));
  ws.send(JSON.stringify({ event: "start", start: { streamSid: "MZtest", callSid: "CAtest", customParameters: { orgId: "demo-org", agentId: "agent-two-wheeler", from: "+919845012345", to: "+918041234567", direction: "inbound" } } }));
  const silence = Buffer.alloc(160, 0xff).toString("base64"); // 20 ms of mu-law silence
  let n = 0;
  const t = setInterval(() => {
    ws.send(JSON.stringify({ event: "media", media: { track: "inbound", payload: silence } }));
    if (++n >= 150) {
      clearInterval(t);
      ws.send(JSON.stringify({ event: "stop" }));
      setTimeout(() => {
        console.log(`agent media events: ${mediaOut}, mu-law bytes: ${bytesOut}`);
        process.exit(mediaOut > 0 ? 0 : 1);
      }, 1500);
    }
  }, 20);
});
ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.event === "media" && msg.streamSid === "MZtest") {
    mediaOut++;
    bytesOut += Buffer.from(msg.media.payload, "base64").length;
  }
});
ws.on("error", (e) => {
  console.error(e.message);
  process.exit(1);
});
