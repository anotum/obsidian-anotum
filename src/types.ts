export type AuthState = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
};

export type SyncState = {
  last_cursor: string | null;
};

export type PluginSettings = {
  sync_interval_minutes: number;
  folder_name: string;
  dev_mode: boolean;
  highlight_template: string;
  dev_api_url: string;
  dev_frontend_url: string;
};

export type PluginState = {
  auth: AuthState | null;
  sync_state: SyncState;
  settings: PluginSettings;
};

export type Book = {
  id: string;
  title: string;
  authors: string[];
  categories: string[];
};

export type Annotation = {
  id: string;
  index: number;
  date: number;
  chapter: string | null;
  highlight: string;
  highlightEdit: string | null;
  color: string;
  note: string;
  book: Book;
};

export type AnnotationChangeAction = "UPSERT" | "DELETE";

export type AnnotationChange = {
  id: string;
  action: AnnotationChangeAction;
  annotation: Annotation | null;
};

export type AnnotationChangeEdge = {
  node: AnnotationChange;
};

export type PageInfo = {
  endCursor: string;
  hasNextPage: boolean;
};

export type AnnotationChangeConnection = {
  edges: AnnotationChangeEdge[];
  pageInfo: PageInfo;
};

export type RefreshTokenResponse = {
  refreshToken: {
    accessToken: string;
    refreshToken: string;
  };
};

export type AnnotationChangesResponse = {
  annotationChanges: AnnotationChangeConnection;
};
