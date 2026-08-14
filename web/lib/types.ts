// Re-export from constants (single source of truth)
export {
    type TaskStatus,
    type UserRole,
    type ColumnConfig,
    ADMIN_COLUMNS,
    ARTIST_COLUMNS,
    STATUS_CONFIG,
    TASK_STATUSES,
    USER_ROLES,
    isValidTransition,
    getColumnsForRole,
} from "./constants";

export interface Asset {
    timestamp: string;
    emailAddress: string;
    skuId: string;
    itemName: string;
    itemCategory: string;
    primarySources: string;
    sourceLinks: string;
    budget: string;
    itemProportion: string;
    mannequinRig: string;
    technicalSpecs: string;
    recolours: string;
    thoughtBehind: string;
    refImages: string; // refImages are a set of strings, multiple strings
    productionStatus: string;
    artist: string;
    assignmentEmailSentAt: string;
    assignmentThreadId: string;
}

export interface Artist {
    name: string;
    email: string;
}

