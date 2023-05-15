import { Manifest } from "./types.ts";
import type { LogLevel } from "./runtime/custom_logger.ts";
import { ControllerMessage, WorkerMessage } from "./protocol.ts";
import { Plug } from "./plug.ts";

export type SandboxFactory<HookT> = (plug: Plug<HookT>) => Sandbox<HookT>;

export type LogEntry = {
  level: LogLevel;
  message: string;
  date: number;
};

/**
 * Represents a "safe" execution environment for plug code
 * Effectively this wraps a web worker, the reason to have this split from Plugs is to allow plugs to manage multiple sandboxes, e.g. for performance in the future
 */
export class Sandbox<HookT> {
  private worker: Worker;
  private reqId = 0;
  private outstandingInvocations = new Map<
    number,
    { resolve: (result: any) => void; reject: (e: any) => void }
  >();
  public logBuffer: LogEntry[] = [];
  public maxLogBufferSize = 100;

  public ready: Promise<void>;
  public manifest?: Manifest<HookT>;

  constructor(
    readonly plug: Plug<HookT>,
    workerOptions = {},
  ) {
    this.worker = new Worker(plug.workerUrl, {
      ...workerOptions,
      type: "module",
    });
    this.ready = new Promise((resolve) => {
      this.worker.onmessage = (ev) => {
        if (ev.data.type === "manifest") {
          this.manifest = ev.data.manifest;
          resolve();
          return;
        }

        this.onMessage(ev.data);
      };
    });
  }

  async onMessage(data: ControllerMessage) {
    switch (data.type) {
      case "sys":
        try {
          const result = await this.plug.syscall(data.name!, data.args!);

          this.worker.postMessage({
            type: "sysr",
            id: data.id,
            result: result,
          } as WorkerMessage);
        } catch (e: any) {
          // console.error("Syscall fail", e);
          this.worker.postMessage({
            type: "sysr",
            id: data.id,
            error: e.message,
          } as WorkerMessage);
        }
        break;
      case "invr": {
        const resultCbs = this.outstandingInvocations.get(data.id!);
        this.outstandingInvocations.delete(data.id!);
        if (data.error) {
          resultCbs &&
            resultCbs.reject(
              new Error(`${data.error}\nStack trace: ${data.stack}`),
            );
        } else {
          resultCbs && resultCbs.resolve(data.result);
        }
        break;
      }
      case "log": {
        this.log(data.level!, data.message!);
        break;
      }
      default:
        console.error("Unknown message type", data);
    }
  }

  log(level: string, ...messageBits: any[]) {
    const message = messageBits.map((a) => "" + a).join(" ");
    this.logBuffer.push({
      message,
      level: level as LogLevel,
      date: Date.now(),
    });
    if (this.logBuffer.length > this.maxLogBufferSize) {
      this.logBuffer.shift();
    }
    console.log(`[Sandbox ${level}]`, message);
  }

  invoke(name: string, args: any[]): Promise<any> {
    this.reqId++;
    this.worker.postMessage({
      type: "inv",
      id: this.reqId,
      name,
      args,
    } as WorkerMessage);
    return new Promise((resolve, reject) => {
      this.outstandingInvocations.set(this.reqId, { resolve, reject });
    });
  }

  stop() {
    this.worker.terminate();
  }
}
