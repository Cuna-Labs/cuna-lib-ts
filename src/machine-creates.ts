import { assertUuid } from "./domain.js";
import type { ClientPort } from "./internal/client-port.js";

export interface MachineCreateRequest {
  readonly id: string;
  readonly machineId: string;
  readonly state: "prepared" | "in_progress" | "unknown" | "provider_succeeded" | "settled" | "terminal_failed";
  readonly retryable: boolean;
  readonly action: "retry_create" | "reconcile" | "wait" | "none";
  readonly updatedAt: string;
}

export interface MachineCreatesManager {
  get(requestId: string): Promise<MachineCreateRequest>;
  reconcile(requestId: string): Promise<MachineCreateRequest>;
}

class MachineCreatesManagerImplementation implements MachineCreatesManager {
  constructor(private readonly owner: ClientPort) {}
  async get(requestId: string): Promise<MachineCreateRequest> {
    assertUuid(requestId);
    return this.owner.invoke("machineCreates.get", { id: requestId }) as Promise<MachineCreateRequest>;
  }
  async reconcile(requestId: string): Promise<MachineCreateRequest> {
    assertUuid(requestId);
    return this.owner.invoke("machineCreates.reconcile", { id: requestId }) as Promise<MachineCreateRequest>;
  }
}

export function constructMachineCreatesManager(owner: ClientPort): MachineCreatesManager {
  return new MachineCreatesManagerImplementation(owner);
}
