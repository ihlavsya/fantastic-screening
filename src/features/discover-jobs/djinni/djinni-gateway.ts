export type DjinniGateway = {
  fetchFeed: (query: FeedQuery) => Promise<string>;
  fetchJob: (jobId: string) => Promise<unknown>;
};

export type FeedQuery = {
  keyword: string;
  isEuRemote: boolean;
};

const BASE_URL = "https://djinni.co";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const REQUEST_TIMEOUT_MS = 15_000;

export const djinniGateway: DjinniGateway = {
  fetchFeed: (query) => fetchText(buildFeedUrl(query)),
  fetchJob: (jobId) => fetchJson(`${BASE_URL}/api/jobs/${jobId}/`),
};

function buildFeedUrl({ keyword, isEuRemote }: FeedQuery): string {
  const url = new URL("/jobs/rss/", BASE_URL);
  url.searchParams.set("primary_keyword", keyword);
  if (isEuRemote) {
    url.searchParams.set("region", "eu");
    url.searchParams.set("employment", "remote");
  }
  return url.toString();
}

async function fetchJson(url: string): Promise<unknown> {
  return JSON.parse(await fetchText(url)) as unknown;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`djinni responded ${String(response.status)} for ${url}`);
  }
  return response.text();
}
