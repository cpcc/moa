import type { RuntimeConfig } from "../config";
import { DEFAULT_AGGREGATOR, resolveModelAlias } from "../workers-ai/models";

/** 解析后的模型组合（均为白名单内的 binding ID）。 */
export interface ModelSelection {
  /** proposer 模型 binding ID 列表（已截断到 maxProposers）。 */
  readonly proposers: readonly string[];
  /** aggregator 模型 binding ID。 */
  readonly aggregator: string;
}

/** 模型组合字符串解析错误。 */
export class ModelSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelSelectionError";
  }
}

/**
 * 解析模型组合字符串。
 *
 * 格式：`proposer1/proposer2/.../aggregator`，用 `/` 分隔，**最后一个是 aggregator**。
 *
 * - 空字符串 / undefined → 返回 undefined（表示用默认组合）
 * - 单个模型 → 1 proposer + 默认 aggregator
 * - N≥2 个模型 → 前 N-1 个 proposer + 最后 1 个 aggregator
 *
 * 每段可以是短名（如 `kimi-k2.7-code`）或完整 binding ID（如 `@cf/moonshotai/kimi-k2.7-code`）。
 * 未知模型、proposer 数量超过 maxProposers 会抛 ModelSelectionError。
 */
export function parseModelSelection(
  spec: string | undefined,
  config: RuntimeConfig,
): ModelSelection | undefined {
  const trimmed = spec?.trim();
  if (!trimmed) return undefined;

  // 用 / 分隔，但完整 binding ID（如 @cf/moonshotai/kimi-k2.6）内部也含 /，
  // 需要智能合并：以 @ 开头的段视为 binding ID 起始，合并随后两段（@vendor/org/model）。
  const rawParts = trimmed.split("/").map((p) => p.trim());
  const parts: string[] = [];
  for (let i = 0; i < rawParts.length; ) {
    const seg = rawParts[i];
    if (seg === "") { i += 1; continue; }
    if (seg.startsWith("@")) {
      if (rawParts[i + 1] && rawParts[i + 2]) {
        parts.push(`${rawParts[i]}/${rawParts[i + 1]}/${rawParts[i + 2]}`);
        i += 3;
      } else {
        throw new ModelSelectionError(`Incomplete binding ID near "${rawParts.slice(i).join("/")}"`);
      }
    } else {
      parts.push(seg);
      i += 1;
    }
  }
  if (parts.length === 0) return undefined;

  // 解析每段为 binding ID（短名查表，完整 ID 校验白名单），未知则报错
  const resolved: string[] = [];
  for (const part of parts) {
    const id = resolveModelAlias(part);
    if (!id) throw new ModelSelectionError(`Unknown model: "${part}"`);
    resolved.push(id);
  }

  // 单个模型 → 1 proposer + 默认 aggregator
  if (resolved.length === 1) {
    return { proposers: resolved, aggregator: DEFAULT_AGGREGATOR };
  }

  // 最后一个是 aggregator，前面是 proposer
  const aggregator = resolved[resolved.length - 1];
  const proposersAll = resolved.slice(0, -1);

  // proposer 数量限制
  if (proposersAll.length > config.maxProposers) {
    throw new ModelSelectionError(
      `Too many proposers: ${proposersAll.length} > maxProposers=${config.maxProposers}`,
    );
  }

  return { proposers: proposersAll, aggregator };
}
