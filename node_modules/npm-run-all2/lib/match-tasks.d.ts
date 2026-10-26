export type TaskFilter = {
    match: (candidate: string) => boolean;
    task: string;
    args: string;
    isGlob: boolean;
};
export default function matchTasks(taskList: string[], patterns: string[]): string[];
//# sourceMappingURL=match-tasks.d.ts.map