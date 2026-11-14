import { transform, type WorkerReply, type WorkerRequest } from "./rsa.ts";

interface Port {
  addEventListener(type: "message", listener: (event: { data: WorkerRequest }) => void): void;
  postMessage(reply: WorkerReply): void;
}

const port = (globalThis.process?.getBuiltinModule?.("node:worker_threads")?.parentPort ?? globalThis) as unknown as Port;

port.addEventListener("message", async ({ data }) => {
  port.postMessage({ result: await transform(data, done => port.postMessage({ done })) });
});
