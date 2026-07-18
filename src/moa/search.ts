// Web search 模块：为 DRACO 等深度研究任务提供联网检索能力。
//
// 设计为可插拔 provider：通过环境变量选择后端（AnySearch / Tavily / SerpAPI / no-op）。
// 默认 no-op（返回空结果），保证未配置搜索时不影响现有 MoA 流程。
//
// 相关文档：docs/DRACO接入方案.md §3.1 / Phase 1

/** 单条检索结果。 */
export interface SearchHit {
  title: string;
  url: string;
  /** 摘要 / 片段，已截断到合理长度。 */
  snippet: string;
}

/** 一次检索的返回。 */
export interface SearchResult {
  query: string;
  hits: readonly SearchHit[];
  /** 检索耗时 ms。 */
  duration_ms: number;
  /** provider 名称，便于 trace。 */
  provider: string;
}

/** 检索请求选项。 */
export interface SearchRequest {
  query: string;
  /** 返回结果数上限，默认 5。 */
  maxResults?: number;
  /** 截止时间戳，超时则放弃。 */
  deadline: number;
}

/** 检索 provider 接口。 */
export interface SearchProvider {
  readonly name: string;
  search(request: SearchRequest): Promise<SearchResult>;
}

/** 把命中结果格式化为可注入 prompt 的文本块。 */
export function formatSearchContext(results: readonly SearchResult[]): string {
  if (results.length === 0) return "";
  const blocks: string[] = [];
  for (const result of results) {
    if (result.hits.length === 0) continue;
    const lines = result.hits.map(
      (hit, i) => `[${i + 1}] ${hit.title}\n    ${hit.url}\n    ${hit.snippet}`,
    );
    blocks.push(`Query: ${result.query}\n${lines.join("\n")}`);
  }
  return blocks.join("\n\n");
}

/** 从检索结果中提取需检索的查询词集合（去重），便于后续复用。 */
export function queriesOf(results: readonly SearchResult[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of results) {
    if (!seen.has(r.query)) {
      seen.add(r.query);
      out.push(r.query);
    }
  }
  return out;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

// ─────────────────────────────────────────────────────────────────────────────
// No-op provider：未配置搜索 API 时使用，返回空结果，不影响 MoA 流程。
// ─────────────────────────────────────────────────────────────────────────────

class NoopSearchProvider implements SearchProvider {
  readonly name = "noop";

  async search(request: SearchRequest): Promise<SearchResult> {
    return {
      query: request.query,
      hits: [],
      duration_ms: 0,
      provider: this.name,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AnySearch provider：https://www.anysearch.com/docs
// API key 可选（重名访问也支持，有 key 则更高限频）。
// POST https://api.anysearch.com/v1/search → {data: {results: [{title, url, snippet, content}]}}
// 优先用 content（清洗后的正文）作为上下文，回退到 snippet。
// ─────────────────────────────────────────────────────────────────────────────

interface AnySearchRawResult {
  title?: unknown;
  url?: unknown;
  snippet?: unknown;
  content?: unknown;
}

interface AnySearchResponse {
  code?: unknown;
  message?: unknown;
  data?: { results?: AnySearchRawResult[] };
}

class AnySearchProvider implements SearchProvider {
  readonly name = "anysearch";
  /** content 字段截断长度（比 snippet 更长，提供更丰富的上下文）。 */
  private readonly contentMax = 1200;
  private readonly snippetMax = 800;

  constructor(
    private readonly apiKey?: string,
    private readonly endpoint = "https://api.anysearch.com/v1/search",
  ) {}

  async search(request: SearchRequest): Promise<SearchResult> {
    const started = Date.now();
    const remaining = request.deadline - started;
    if (remaining <= 0) {
      return { query: request.query, hits: [], duration_ms: 0, provider: this.name };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (this.apiKey) {
        headers["Authorization"] = `Bearer ${this.apiKey}`;
      }
      const body = {
        query: request.query,
        max_results: request.maxResults ?? 5,
      };
      const resp = await fetch(this.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!resp.ok) {
        return { query: request.query, hits: [], duration_ms: Date.now() - started, provider: this.name };
      }
      const data = (await resp.json()) as AnySearchResponse;
      // AnySearch 返回 code !== 0 表示错误
      if (typeof data.code === "number" && data.code !== 0) {
        return { query: request.query, hits: [], duration_ms: Date.now() - started, provider: this.name };
      }
      const raw = Array.isArray(data.data?.results) ? data.data!.results! : [];
      const max = request.maxResults ?? 5;
      const hits: SearchHit[] = raw.slice(0, max).map((r) => {
        // 优先用 content（清洗后的正文），回退到 snippet
        const content = String(r.content ?? "").trim();
        const snippet = String(r.snippet ?? "").trim();
        const text = content || snippet;
        const limit = content ? this.contentMax : this.snippetMax;
        return {
          title: truncate(String(r.title ?? ""), 200),
          url: String(r.url ?? ""),
          snippet: truncate(text, limit),
        };
      });
      return { query: request.query, hits, duration_ms: Date.now() - started, provider: this.name };
    } catch {
      return { query: request.query, hits: [], duration_ms: Date.now() - started, provider: this.name };
    } finally {
      clearTimeout(timer);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tavily provider：https://docs.tavily.com/api-reference/search
// 需配置 TAVILY_API_KEY。返回 title / url / content 摘要。
// ─────────────────────────────────────────────────────────────────────────────

interface TavilyRawResult {
  title?: unknown;
  url?: unknown;
  content?: unknown;
}

class TavilySearchProvider implements SearchProvider {
  readonly name = "tavily";
  private readonly snippetMax = 800;

  constructor(
    private readonly apiKey: string,
    private readonly endpoint = "https://api.tavily.com/search",
  ) {}

  async search(request: SearchRequest): Promise<SearchResult> {
    const started = Date.now();
    const remaining = request.deadline - started;
    if (remaining <= 0) {
      return { query: request.query, hits: [], duration_ms: 0, provider: this.name };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    try {
      const body = {
        api_key: this.apiKey,
        query: request.query,
        max_results: request.maxResults ?? 5,
        search_depth: "advanced",
        include_answer: false,
      };
      const resp = await fetch(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!resp.ok) {
        return { query: request.query, hits: [], duration_ms: Date.now() - started, provider: this.name };
      }
      const data = (await resp.json()) as { results?: TavilyRawResult[] };
      const raw = Array.isArray(data.results) ? data.results : [];
      const hits: SearchHit[] = raw.slice(0, request.maxResults ?? 5).map((r) => ({
        title: truncate(String(r.title ?? ""), 200),
        url: String(r.url ?? ""),
        snippet: truncate(String(r.content ?? ""), this.snippetMax),
      }));
      return { query: request.query, hits, duration_ms: Date.now() - started, provider: this.name };
    } catch {
      return { query: request.query, hits: [], duration_ms: Date.now() - started, provider: this.name };
    } finally {
      clearTimeout(timer);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SerpAPI provider：https://serpapi.com/search-api
// 需配置 SERPAPI_API_KEY。返回 organic_results 的 title / link / snippet。
// ─────────────────────────────────────────────────────────────────────────────

interface SerpapiOrganicResult {
  title?: unknown;
  link?: unknown;
  snippet?: unknown;
}

class SerpapiSearchProvider implements SearchProvider {
  readonly name = "serpapi";
  private readonly snippetMax = 800;

  constructor(
    private readonly apiKey: string,
    private readonly endpoint = "https://serpapi.com/search",
  ) {}

  async search(request: SearchRequest): Promise<SearchResult> {
    const started = Date.now();
    const remaining = request.deadline - started;
    if (remaining <= 0) {
      return { query: request.query, hits: [], duration_ms: 0, provider: this.name };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    try {
      const params = new URLSearchParams({
        api_key: this.apiKey,
        q: request.query,
        num: String(request.maxResults ?? 5),
        engine: "google",
        output: "json",
      });
      const resp = await fetch(`${this.endpoint}?${params.toString()}`, {
        method: "GET",
        signal: controller.signal,
      });
      if (!resp.ok) {
        return { query: request.query, hits: [], duration_ms: Date.now() - started, provider: this.name };
      }
      const data = (await resp.json()) as { organic_results?: SerpapiOrganicResult[] };
      const raw = Array.isArray(data.organic_results) ? data.organic_results : [];
      const hits: SearchHit[] = raw.slice(0, request.maxResults ?? 5).map((r) => ({
        title: truncate(String(r.title ?? ""), 200),
        url: String(r.link ?? ""),
        snippet: truncate(String(r.snippet ?? ""), this.snippetMax),
      }));
      return { query: request.query, hits, duration_ms: Date.now() - started, provider: this.name };
    } catch {
      return { query: request.query, hits: [], duration_ms: Date.now() - started, provider: this.name };
    } finally {
      clearTimeout(timer);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 工厂：根据 env 选择 provider
// ─────────────────────────────────────────────────────────────────────────────

export interface SearchEnv {
  /** 搜索 provider：anysearch / tavily / serpapi / none，默认 none。 */
  MOA_SEARCH_PROVIDER?: string;
  ANYSEARCH_API_KEY?: string;
  TAVILY_API_KEY?: string;
  SERPAPI_API_KEY?: string;
  /** 检索结果数上限，默认 5。 */
  MOA_SEARCH_MAX_RESULTS?: string;
}

export interface SearchConfig {
  enabled: boolean;
  provider: SearchProvider;
  maxResults: number;
  /** 每个任务最多发起几次检索，默认 1。 */
  maxQueries: number;
}

export function getSearchConfig(env: SearchEnv): SearchConfig {
  const providerName = (env.MOA_SEARCH_PROVIDER ?? "none").toLowerCase();
  const maxResults = parsePositiveInt(env.MOA_SEARCH_MAX_RESULTS, 5);
  let provider: SearchProvider;
  switch (providerName) {
    case "anysearch":
      // AnySearch 支持重名访问（无 key 也能用，只是限频更低），所以即使无 key 也创建 provider
      provider = new AnySearchProvider(env.ANYSEARCH_API_KEY);
      break;
    case "tavily":
      provider = env.TAVILY_API_KEY
        ? new TavilySearchProvider(env.TAVILY_API_KEY)
        : new NoopSearchProvider();
      break;
    case "serpapi":
      provider = env.SERPAPI_API_KEY
        ? new SerpapiSearchProvider(env.SERPAPI_API_KEY)
        : new NoopSearchProvider();
      break;
    default:
      provider = new NoopSearchProvider();
  }
  return {
    enabled: provider.name !== "noop",
    provider,
    maxResults,
    maxQueries: 1,
  };
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * 对一个任务执行检索：从 task 中抽取检索查询词，调用 provider。
 * 失败 / 超时不抛错，返回空结果（搜索是 best-effort 增强，不应阻断 MoA）。
 */
export async function searchForTask(
  task: string,
  config: SearchConfig,
  deadline: number,
): Promise<SearchResult[]> {
  if (!config.enabled) return [];
  const queries = extractSearchQueries(task, config.maxQueries);
  if (queries.length === 0) return [];
  const results = await Promise.all(
    queries.map((query) =>
      config.provider.search({ query, maxResults: config.maxResults, deadline }),
    ),
  );
  return results;
}

/**
 * 从任务文本中抽取检索查询词。
 * 策略：取任务前 N 个非空行作为查询（DRACO 任务通常是完整研究问题）。
 * 避免把超长任务整段当查询。
 */
function extractSearchQueries(task: string, maxQueries: number): string[] {
  const lines = task
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const queries: string[] = [];
  for (const line of lines) {
    if (queries.length >= maxQueries) break;
    // 单条查询截断到 200 字符，避免 URL 过长
    queries.push(truncate(line, 200));
  }
  return queries;
}
