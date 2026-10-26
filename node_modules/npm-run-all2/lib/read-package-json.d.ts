import type { PackageInfo } from './index.js';
export type ReadPackageJsonResult = {
    taskList: string[];
    packageInfo: PackageInfo;
};
export default function readPackageJson(): Promise<ReadPackageJsonResult>;
//# sourceMappingURL=read-package-json.d.ts.map