export type { Bookmark, ContainerSummary, Disk, Host, Service, State, Stat, Status, Tone, Widget } from '../../shared/state.ts';
import type { State } from '../../shared/state.ts';

/** Something that can produce the current State; implemented by the live engine and the demo. */
export interface StateSource {
  start(): Promise<void>;
  stop(): void;
  snapshot(): State;
}
