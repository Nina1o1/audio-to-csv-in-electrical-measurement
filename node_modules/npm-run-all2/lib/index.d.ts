import type { Readable, Writable } from 'node:stream';
import type { PackageJson } from 'read-package-json-fast';
import type { ColorMode } from './run-task.js';
export type ConfigValue = string | number | boolean | null | undefined;
export type ConfigMap = Record<string, ConfigValue>;
export type PackageConfigMap = Record<string, ConfigMap>;
export type PackageInfo = {
    path: string;
    body: PackageJson;
};
export type NpmRunAllOptions = {
    parallel?: boolean;
    stdin?: Readable | null;
    stdout?: Writable | null;
    stderr?: Writable | null;
    taskList?: string[] | null;
    config?: ConfigMap | null;
    packageConfig?: PackageConfigMap | null;
    arguments?: string[];
    silent?: boolean;
    continueOnError?: boolean;
    printLabel?: boolean;
    printName?: boolean;
    maxParallel?: number;
    npmPath?: string | null;
    race?: boolean;
    aggregateOutput?: boolean;
    nodeRun?: boolean | undefined;
    colorMode?: ColorMode;
};
export type NpmRunAllResult = {
    name: string;
    code: number | undefined;
};
export type PackageJsonConfig = {
    nodeRun?: boolean;
};
export type ArgumentPlaceholder = {
    start: number;
    end: number;
    whole: string;
    indirectionMark: string | undefined;
    id: string;
    options: string | undefined;
};
export default function npmRunAll(patternOrPatterns: string | string[], options?: NpmRunAllOptions): Promise<null | NpmRunAllResult[]>;
//# sourceMappingURL=index.d.ts.map