export type PrefixState = {
    lastPrefix: string | null;
    lastIsLinebreak: boolean;
};
import stream from 'node:stream';
export default function createPrefixTransform(prefix: string, state: PrefixState): stream.Transform;
//# sourceMappingURL=create-prefix-transform-stream.d.ts.map