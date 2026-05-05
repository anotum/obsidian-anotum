import { GraphQLClient, ClientError, gql } from "graphql-request";
import type {
	AnnotationChange,
	AnnotationChangesResponse,
	RefreshTokenResponse,
	AuthState,
} from "../types";
import { PAGE_SIZE, MAX_RETRIES, BASE_BACKOFF_MS } from "../constants";
import { getExpiresAt, isExpired } from "../auth/jwt";
import { requestUrl } from "obsidian";

const ANNOTATION_CHANGES_QUERY = gql`
  query AnnotationChanges($first: Int, $after: ID) {
    annotationChanges(first: $first, after: $after) {
      edges {
        node {
          id
          action
          annotation {
            id
            index
            date
            chapter
            highlight
            highlightEdit
            color
            note
            book {
              id
              title
              authors
              categories
            }
          }
        }
      }
      pageInfo {
        endCursor
        hasNextPage
      }
    }
  }
`;

const REFRESH_TOKEN_MUTATION = gql`
  mutation RefreshToken($token: String!) {
    refreshToken(token: $token) {
      accessToken
      refreshToken
    }
  }
`;

const obsidianFetch = async (
	req: RequestInfo | URL,
	init?: RequestInit,
): Promise<Response> => {
	const res = await requestUrl({
		url: req instanceof Request ? req.url : req.toString(),
		method: init?.method || "POST",
		headers: init?.headers as Record<string, string>,
		body: init?.body as string,
		throw: false,
	});

	return new Response(res.arrayBuffer, {
		status: res.status,
		headers: res.headers,
	});
};

export class ApiClient {
	private client: GraphQLClient;
	private auth: AuthState;
	private onAuthRefreshed: (auth: AuthState) => Promise<void>;

	constructor(
		apiUrl: string,
		auth: AuthState,
		onAuthRefreshed: (auth: AuthState) => Promise<void>,
	) {
		this.client = new GraphQLClient(apiUrl, {
			fetch: obsidianFetch as typeof fetch,
		});
		this.auth = auth;
		this.onAuthRefreshed = onAuthRefreshed;
	}

	private async ensureValidToken(): Promise<void> {
		if (!isExpired(this.auth.expires_at)) return;

		const response = await this.client.request<RefreshTokenResponse>(
			REFRESH_TOKEN_MUTATION,
			{ token: this.auth.refresh_token },
		);

		this.auth = {
			access_token: response.refreshToken.accessToken,
			refresh_token: response.refreshToken.refreshToken,
			expires_at: getExpiresAt(response.refreshToken.accessToken),
		};

		await this.onAuthRefreshed(this.auth);
	}

	private async requestWithRetry<T>(
		document: string,
		variables: Record<string, unknown>,
		attempt = 0,
	): Promise<T> {
		await this.ensureValidToken();

		try {
			return await this.client.request<T>(document, variables, {
				Authorization: `Bearer ${this.auth.access_token}`,
			});
		} catch (error: unknown) {
			const isRateLimited =
				error instanceof ClientError && error.response.status === 429;
			if (!isRateLimited || attempt >= MAX_RETRIES) throw error;

			await new Promise((resolve) =>
				setTimeout(resolve, BASE_BACKOFF_MS * Math.pow(2, attempt)),
			);
			return this.requestWithRetry(document, variables, attempt + 1);
		}
	}

	async fetchAllChanges(
		cursor: string | null,
	): Promise<{ changes: AnnotationChange[]; endCursor: string | null }> {
		return this.fetchPage(cursor, [], cursor);
	}

	private async fetchPage(
		cursor: string | null,
		accumulated: AnnotationChange[],
		lastEndCursor: string | null,
	): Promise<{ changes: AnnotationChange[]; endCursor: string | null }> {
		const variables: Record<string, unknown> = {
			first: PAGE_SIZE,
			...(cursor && { after: cursor }),
		};

		const response = await this.requestWithRetry<AnnotationChangesResponse>(
			ANNOTATION_CHANGES_QUERY,
			variables,
		);

		const { edges, pageInfo } = response.annotationChanges;

		if (edges.length === 0) {
			return { changes: accumulated, endCursor: lastEndCursor };
		}

		const changes = [...accumulated, ...edges.map((edge) => edge.node)];
		return this.fetchPage(pageInfo.endCursor, changes, pageInfo.endCursor);
	}
}
