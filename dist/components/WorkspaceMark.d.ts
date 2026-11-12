import type { Workspace } from '../workspace.js';
/** The mark's looks, as in the VocalStack Dashboard, on Payload's theme colours. */
export declare const WorkspaceMarkStyles: () => import("react").JSX.Element;
/**
 * A workspace's mark, as the VocalStack Dashboard draws it: its own icon when it has
 * one, a person for the personal workspace, else its initials on its colour.
 */
export declare const WorkspaceMark: React.FC<{
    size?: number;
    workspace: Workspace;
}>;
