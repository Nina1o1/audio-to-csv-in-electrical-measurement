import type { Writable } from 'node:stream';
import type { RunTaskOptions } from './run-task.js';
import type { NpmRunAllResult } from './index.js';
export type RunTasksOptions = RunTaskOptions & {
    continueOnError: boolean;
    race: boolean;
    maxParallel: number;
    aggregateOutput: boolean;
    stdout: Writable | null;
};
export default function runTasks(tasks: string[], options: RunTasksOptions): Promise<NpmRunAllResult[]>;
//# sourceMappingURL=run-tasks.d.ts.map