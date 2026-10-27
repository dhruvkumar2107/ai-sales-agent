import { env } from "../../config";
import { DeepgramStt } from "./deepgram";
import { SarvamStt } from "./sarvam";
import { SttStream, type SttProvider } from "./types";

export * from "./types";

/** No-op STT used in text mode (simulator, console text chat) and tests. */
class MockSttStream extends SttStream {
  write() {}
  close() {
    this.emit("close");
  }
}

export class MockStt implements SttProvider {
  readonly name = "mock";
  open() {
    return new MockSttStream();
  }
}

export function createStt(kind = env.STT_PROVIDER): SttProvider {
  if (kind === "deepgram" && env.DEEPGRAM_API_KEY) return new DeepgramStt();
  if (kind === "sarvam" && env.SARVAM_API_KEY) return new SarvamStt();
  return new MockStt();
}
