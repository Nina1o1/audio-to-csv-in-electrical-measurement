import type { Readable, Writable } from 'node:stream';
import type { PrefixState } from './create-prefix-transform-stream.js';
import type { PackageInfo } from './index.js';
export type ColorMode = 'auto' | 'none' | '16' | '256';
export type LabelState = PrefixState & {
    enabled: boolean;
    width: number;
};
export type RunTaskOptions = {
    stdin: Readable | null;
    stdout: Writable | null;
    stderr: Writable | null;
    prefixOptions: string[];
    labelState: LabelState;
    printName: boolean;
    packageInfo: PackageInfo | null;
    npmPath?: string | null | undefined;
    nodeRun?: boolean;
    colorMode?: ColorMode;
};
export type RunTaskResult = {
    task: string;
    code: number | null;
    signal: NodeJS.Signals | null;
};
export type AbortableRunTaskPromise = Promise<RunTaskResult> & {
    abort: () => void;
};
export default function runTask(task: string, options: RunTaskOptions): AbortableRunTaskPromise;
//# sourceMappingURL=run-task.d.ts.map